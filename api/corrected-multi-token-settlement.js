const { ethers } = require('ethers');
const axios = require('axios');

require('dotenv').config({ path: '../.env.local' });

const CHAIN_ID = process.env.VITE_CHAIN_ID;
const FUSION_API_BASE = 'https://api.1inch.dev/fusion';
const API_KEY = process.env.VITE_ONE_INCH_API_KEY;
const PRIVATE_KEY = process.env.RESOLVER_PRIVATE_KEY;

// Contract addresses
const CONTRACTS = {
  MULTI_TOKEN_RESOLVER: process.env.MULTI_TOKEN_RESOLVER_ADDRESS,
  USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  FUSION_SETTLEMENT: '0x1111111254fb6c44bAC0beD2854e76F90643097d',
};

const logEvent = (level, message, data) => {
  console.log(
    `[${level}] ${new Date().toISOString()} - ${message}`,
    data ? JSON.stringify(data) : ''
  );
};

/**
 * CORRECTED APPROACH: Smart Contract Handles Full Flow
 * 
 * 1. User signs permits for their tokens
 * 2. Backend creates Fusion orders (signed by backend)
 * 3. Smart contract executes: Permit → Fusion → Auction
 * 4. All happens in single transaction per winner
 */

/**
 * Execute winning bids using smart contract intermediary
 */
const executeWinningBidsWithSmartContract = async (winningBids, auctionToken) => {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);

    // Multi-token resolver contract ABI
    const resolverABI = [
      'function executePermitSwapAndAuction(address sourceToken, address user, uint256 sourceAmount, uint256 deadline, uint8 v, bytes32 r, bytes32 s, bytes calldata fusionCalldata, address auctionToken, uint256 expectedAuctionTokens) external returns (uint256)',
      'function executeUSDCPermitAndAuction(address user, uint256 usdcAmount, uint256 deadline, uint8 v, bytes32 r, bytes32 s, address auctionToken, uint256 expectedAuctionTokens) external returns (uint256)',
      'function batchExecuteWinningBids(address[] calldata users, address[] calldata sourceTokens, uint256[] calldata sourceAmounts, uint256[] calldata deadlines, uint8[] calldata vs, bytes32[] calldata rs, bytes32[] calldata ss, bytes[] calldata fusionCalldatas, address auctionToken, uint256[] calldata expectedAuctionTokens) external',
    ];

    const resolverContract = new ethers.Contract(
      CONTRACTS.MULTI_TOKEN_RESOLVER,
      resolverABI,
      signer
    );

    const executedBids = [];

    for (const bid of winningBids) {
      try {
        logEvent('INFO', 'Executing winning bid with smart contract', {
          bidId: bid.id,
          user: bid.user_wallet,
          sourceToken: bid.bid_token_symbol,
          amount: bid.bid_token_amount,
        });

        if (bid.bid_token_symbol.toUpperCase() === 'USDC') {
          // Handle USDC bids (no fusion needed)
          const tx = await resolverContract.executeUSDCPermitAndAuction(
            bid.user_wallet,
            bid.bid_token_amount,
            bid.permit_deadline,
            bid.permit_v,
            bid.permit_r,
            bid.permit_s,
            auctionToken,
            bid.fillQuantity
          );

          const receipt = await tx.wait();
          
          executedBids.push({
            ...bid,
            txHash: receipt.hash,
            conversionMethod: 'direct_usdc',
            gasUsed: receipt.gasUsed.toString(),
          });

        } else {
          // Handle non-USDC tokens with Fusion
          
          // Step 1: Create Fusion calldata (backend signs this)
          const fusionCalldata = await createFusionCalldata(bid);

          // Step 2: Execute permit + fusion + auction in one transaction
          const tx = await resolverContract.executePermitSwapAndAuction(
            bid.bid_token_address,
            bid.user_wallet,
            bid.bid_token_amount,
            bid.permit_deadline,
            bid.permit_v,
            bid.permit_r,
            bid.permit_s,
            fusionCalldata,
            auctionToken,
            bid.fillQuantity
          );

          const receipt = await tx.wait();

          executedBids.push({
            ...bid,
            txHash: receipt.hash,
            conversionMethod: 'fusion_swap',
            gasUsed: receipt.gasUsed.toString(),
          });
        }

        logEvent('INFO', 'Winning bid executed successfully', {
          bidId: bid.id,
          txHash: executedBids[executedBids.length - 1].txHash,
        });

      } catch (error) {
        logEvent('ERROR', 'Failed to execute winning bid', {
          bidId: bid.id,
          error: error.message,
        });
      }
    }

    return executedBids;

  } catch (error) {
    logEvent('ERROR', 'Failed to execute winning bids', {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Create Fusion calldata for smart contract execution
 * This is where WE (backend) create and sign the Fusion order
 */
const createFusionCalldata = async (bid) => {
  try {
    logEvent('INFO', 'Creating Fusion calldata for smart contract', {
      fromToken: bid.bid_token_symbol,
      amount: bid.bid_token_amount,
    });

    // Create Fusion order request (backend is the "maker")
    const fusionOrderRequest = {
      fromTokenAddress: bid.bid_token_address,
      toTokenAddress: CONTRACTS.USDC,
      amount: bid.bid_token_amount,
      from: CONTRACTS.MULTI_TOKEN_RESOLVER, // Smart contract is the source
      preset: 'fast',
    };

    // Create the Fusion order
    const response = await axios.post(
      `${FUSION_API_BASE}/${CHAIN_ID}/orders`,
      fusionOrderRequest,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const fusionOrder = response.data;

    // Generate calldata for 1inch settlement contract
    const calldata = await generateFusionCalldata(fusionOrder);

    logEvent('INFO', 'Fusion calldata created successfully', {
      orderHash: fusionOrder.orderHash,
      calldataLength: calldata.length,
    });

    return calldata;

  } catch (error) {
    logEvent('ERROR', 'Failed to create Fusion calldata', {
      error: error.message,
      bid: bid.id,
    });
    throw error;
  }
};

/**
 * Generate calldata for 1inch Fusion settlement
 */
const generateFusionCalldata = async (fusionOrder) => {
  // This would generate the proper calldata for calling 1inch settlement contract
  // The exact implementation depends on 1inch Fusion API response format
  
  // Simplified example - in practice, you'd use 1inch SDK or API to generate this
  const iface = new ethers.Interface([
    'function fillOrder(bytes calldata order, bytes calldata signature, bytes calldata interaction, uint256 makingAmount, uint256 takingAmountThreshold) external payable returns (uint256, uint256)'
  ]);

  const calldata = iface.encodeFunctionData('fillOrder', [
    fusionOrder.orderData || '0x',
    fusionOrder.signature || '0x',
    fusionOrder.interaction || '0x',
    fusionOrder.makingAmount || '0',
    fusionOrder.takingAmountThreshold || '0',
  ]);

  return calldata;
};

/**
 * Batch execute all winning bids for gas efficiency
 */
const batchExecuteWinningBids = async (winningBids, auctionToken) => {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);

    const resolverContract = new ethers.Contract(
      CONTRACTS.MULTI_TOKEN_RESOLVER,
      ['function batchExecuteWinningBids(address[] calldata users, address[] calldata sourceTokens, uint256[] calldata sourceAmounts, uint256[] calldata deadlines, uint8[] calldata vs, bytes32[] calldata rs, bytes32[] calldata ss, bytes[] calldata fusionCalldatas, address auctionToken, uint256[] calldata expectedAuctionTokens) external'],
      signer
    );

    // Prepare arrays for batch execution
    const users = [];
    const sourceTokens = [];
    const sourceAmounts = [];
    const deadlines = [];
    const vs = [];
    const rs = [];
    const ss = [];
    const fusionCalldatas = [];
    const expectedAuctionTokens = [];

    // Generate fusion calldata for non-USDC tokens
    for (const bid of winningBids) {
      users.push(bid.user_wallet);
      sourceTokens.push(bid.bid_token_address);
      sourceAmounts.push(bid.bid_token_amount);
      deadlines.push(bid.permit_deadline);
      vs.push(bid.permit_v);
      rs.push(bid.permit_r);
      ss.push(bid.permit_s);
      expectedAuctionTokens.push(bid.fillQuantity);

      if (bid.bid_token_symbol.toUpperCase() === 'USDC') {
        fusionCalldatas.push('0x'); // No fusion needed for USDC
      } else {
        const calldata = await createFusionCalldata(bid);
        fusionCalldatas.push(calldata);
      }
    }

    // Execute batch transaction
    const tx = await resolverContract.batchExecuteWinningBids(
      users,
      sourceTokens,
      sourceAmounts,
      deadlines,
      vs,
      rs,
      ss,
      fusionCalldatas,
      auctionToken,
      expectedAuctionTokens
    );

    const receipt = await tx.wait();

    logEvent('INFO', 'Batch execution completed', {
      txHash: receipt.hash,
      gasUsed: receipt.gasUsed.toString(),
      winningBids: winningBids.length,
    });

    return {
      txHash: receipt.hash,
      gasUsed: receipt.gasUsed.toString(),
      executedBids: winningBids.length,
    };

  } catch (error) {
    logEvent('ERROR', 'Batch execution failed', {
      error: error.message,
    });
    throw error;
  }
};

module.exports = {
  executeWinningBidsWithSmartContract,
  batchExecuteWinningBids,
  createFusionCalldata,
};