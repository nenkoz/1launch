const { ethers } = require('ethers');
const {
  Sdk,
  LimitOrder,
  MakerTraits,
  Address,
  randBigInt,
  FetchProviderConnector,
} = require('@1inch/limit-order-sdk');

require('dotenv').config({ path: '../.env.local' });

const CONTRACTS = {
  USDC: process.env.USDC_ADDRESS ?? '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  AUCTION_CONTROLLER: process.env.AUCTION_CONTROLLER_ADDRESS,
};

const CHAIN_ID = process.env.VITE_CHAIN_ID;
const API_KEY = process.env.VITE_ONE_INCH_API_KEY;

const logEvent = (level, message, data) => {
  console.log(
    `[${level}] ${new Date().toISOString()} - ${message}`,
    data ? JSON.stringify(data) : ''
  );
};

/**
 * HYBRID APPROACH: Use permits for privacy + 1inch for execution
 * 
 * Phase 1: Private bidding with permits (privacy maintained)
 * Phase 2: Convert winning bids to 1inch orders (leverage 1inch infrastructure)
 * Phase 3: Execute 1inch orders with pre-authorized permits
 */
const executeHybridSettlement = async (supabaseClient, launchId) => {
  try {
    logEvent('INFO', 'Starting hybrid permit + 1inch settlement', { launchId });

    // Phase 1: Get and sort private bids (same as before)
    const { winningBids, clearingPrice } = await selectWinningBids(supabaseClient, launchId);
    
    if (winningBids.length === 0) {
      return { error: null, result: { settledBids: 0, clearingPrice: 0 } };
    }

    // Phase 2: Convert winning bids to 1inch limit orders
    const oneInchOrders = await createOneInchOrdersFromPermits(winningBids);
    
    // Phase 3: Execute 1inch orders with permit authorization
    const executedOrders = await executeOneInchOrdersWithPermits(oneInchOrders);

    logEvent('INFO', 'Hybrid settlement completed', {
      launchId,
      winningBids: winningBids.length,
      executedOrders: executedOrders.length,
      clearingPrice,
    });

    return {
      error: null,
      result: {
        settledBids: executedOrders.length,
        clearingPrice,
        executionMethod: 'hybrid_permit_1inch',
      },
    };
  } catch (error) {
    logEvent('ERROR', 'Hybrid settlement failed', {
      error: error.message,
      launchId,
    });
    return { error: error.message, result: null };
  }
};

/**
 * Phase 1: Select winning bids from private permits (privacy preserved until now)
 */
const selectWinningBids = async (supabaseClient, launchId) => {
  // Get all pending bids
  const { data: pendingBids, error } = await supabaseClient
    .from('private_bids')
    .select('*')
    .eq('launch_id', launchId)
    .eq('status', 'pending')
    .order('price', { ascending: false });

  if (error) throw new Error(`Database error: ${error.message}`);

  // Get launch details for allocation
  const { data: launch, error: launchError } = await supabaseClient
    .from('launches')
    .select('*')
    .eq('id', launchId)
    .single();

  if (launchError) throw new Error('Launch not found');

  // Select winning bids (same logic as before)
  const targetAllocation = BigInt(launch.target_allocation);
  let remainingAllocation = targetAllocation;
  const winningBids = [];
  let clearingPrice = 0;

  for (const bid of pendingBids) {
    if (remainingAllocation <= 0) break;

    const bidQuantity = BigInt(bid.quantity);
    const fillQuantity = bidQuantity > remainingAllocation ? remainingAllocation : bidQuantity;
    
    if (fillQuantity > 0) {
      winningBids.push({
        ...bid,
        fillQuantity: fillQuantity.toString(),
      });
      clearingPrice = bid.price;
      remainingAllocation -= fillQuantity;
    }
  }

  logEvent('INFO', 'Winning bids selected', {
    totalBids: pendingBids.length,
    winningBids: winningBids.length,
    clearingPrice,
  });

  return { winningBids, clearingPrice };
};

/**
 * Phase 2: Convert permit-based bids to 1inch limit orders
 * This happens AFTER auction ends, so privacy is maintained during auction
 */
const createOneInchOrdersFromPermits = async (winningBids) => {
  const sdk = new Sdk({
    authKey: API_KEY,
    networkId: CHAIN_ID,
    httpConnector: new FetchProviderConnector(),
  });

  const oneInchOrders = [];

  for (const bid of winningBids) {
    try {
      // Calculate precise amounts based on clearing price
      const usdcAmount = BigInt(Math.floor(bid.price * Number(bid.fillQuantity) * 1e6));
      const tokenAmount = BigInt(bid.fillQuantity);

      // Create 1inch limit order for the winning bid
      const order = await sdk.createOrder(
        {
          makerAsset: new Address(CONTRACTS.USDC), // Bidder provides USDC
          takerAsset: new Address(bid.taker_asset), // Bidder receives tokens
          makingAmount: usdcAmount,
          takingAmount: tokenAmount,
          maker: new Address(bid.user_wallet),
          receiver: new Address(bid.user_wallet),
        },
        MakerTraits.default()
          .withExpiration(BigInt(Math.floor(Date.now() / 1000) + 3600)) // 1 hour to execute
          .allowPartialFills()
      );

      const orderHash = order.getOrderHash(CHAIN_ID);
      const typedData = order.getTypedData();

      oneInchOrders.push({
        bid,
        order,
        orderHash,
        typedData,
        usdcAmount: usdcAmount.toString(),
        tokenAmount: tokenAmount.toString(),
      });

      logEvent('INFO', '1inch order created from permit bid', {
        bidId: bid.id,
        orderHash,
        usdcAmount: usdcAmount.toString(),
        tokenAmount: tokenAmount.toString(),
      });
    } catch (error) {
      logEvent('ERROR', 'Failed to create 1inch order from permit', {
        bidId: bid.id,
        error: error.message,
      });
    }
  }

  return oneInchOrders;
};

/**
 * Phase 3: Execute 1inch orders using pre-authorized permits
 * Best of both worlds: 1inch infrastructure + permit authorization
 */
const executeOneInchOrdersWithPermits = async (oneInchOrders) => {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const signer = new ethers.Wallet(process.env.RESOLVER_PRIVATE_KEY, provider);

  // Custom resolver contract that combines permit execution with 1inch order filling
  const hybridResolverABI = [
    'function executePermitAnd1inchOrder(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s, bytes calldata oneInchOrderData, bytes calldata oneInchSignature) external',
  ];

  const hybridResolver = new ethers.Contract(
    process.env.HYBRID_RESOLVER_ADDRESS,
    hybridResolverABI,
    signer
  );

  const executedOrders = [];

  for (const orderData of oneInchOrders) {
    try {
      const { bid, order, orderHash } = orderData;

      // Execute permit + 1inch order in single transaction
      const tx = await hybridResolver.executePermitAnd1inchOrder(
        bid.permit_owner,
        bid.permit_spender,
        bid.permit_value,
        bid.permit_deadline,
        bid.permit_v,
        bid.permit_r,
        bid.permit_s,
        order.build(), // 1inch order data
        '0x' // Order signature (can be empty for our resolver)
      );

      const receipt = await tx.wait();
      
      executedOrders.push({
        bidId: bid.id,
        orderHash,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
      });

      logEvent('INFO', 'Hybrid permit + 1inch order executed', {
        bidId: bid.id,
        orderHash,
        txHash: receipt.hash,
      });
    } catch (error) {
      logEvent('ERROR', 'Failed to execute hybrid order', {
        bidId: orderData.bid.id,
        error: error.message,
      });
    }
  }

  return executedOrders;
};

module.exports = {
  executeHybridSettlement,
  selectWinningBids,
  createOneInchOrdersFromPermits,
  executeOneInchOrdersWithPermits,
};