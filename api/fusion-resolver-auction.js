const { ethers } = require('ethers');

/**
 * Smart Contract Intermediary Fusion Auction System
 * 
 * This system uses AuctionFusionResolver as an intermediary to handle the two-step process:
 * 1. User tokens → USDC (via 1inch Fusion)
 * 2. USDC → Auction tokens (via our smart contract)
 */

// 1inch Fusion Order Types
const FUSION_ORDER_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'receiver', type: 'address' }, // KEY: This will be our AuctionFusionResolver
    { name: 'makerAsset', type: 'address' },
    { name: 'takerAsset', type: 'address' }, // Always USDC
    { name: 'makingAmount', type: 'uint256' },
    { name: 'takingAmount', type: 'uint256' },
    { name: 'makerTraits', type: 'uint256' },
  ],
};

const FUSION_DOMAIN = {
  name: '1inch Limit Order Protocol',
  version: '4',
  chainId: 42161,
  verifyingContract: '0x1111111254EEB25477B68fb85Ed929f73A960582',
};

const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const AUCTION_FUSION_RESOLVER = process.env.AUCTION_FUSION_RESOLVER_ADDRESS || '0xC3ce44B2E68c11fF7e80Cc997Dd28f79A2EA41Ea';

/**
 * Create a Fusion-based bid with smart contract intermediary
 */
const createResolverFusionBid = async (supabaseClient, bidData) => {
  try {
    console.log('🔧 Creating resolver fusion bid with data:', JSON.stringify(bidData, null, 2));
    
    const {
      launchId,
      userWallet,
      bidTokenAddress,
      bidTokenAmount,
      bidTokenSymbol,
      auctionTokenAddress,
      maxAuctionTokens,
      maxEffectivePriceUSDC,
      fusionOrder,
      fusionSignature,
    } = bidData;

    console.log('🔍 Extracted parameters:', {
      launchId,
      userWallet,
      bidTokenAddress,
      bidTokenAmount,
      bidTokenSymbol,
      auctionTokenAddress,
      maxAuctionTokens,
      maxEffectivePriceUSDC,
      fusionOrderStructure: fusionOrder ? 'present' : 'missing',
      resolverAddress: AUCTION_FUSION_RESOLVER
    });

    // Check for undefined parameters that might cause issues
    const requiredParams = {
      launchId,
      userWallet, 
      bidTokenAddress,
      bidTokenAmount,
      auctionTokenAddress,
      maxAuctionTokens,
      maxEffectivePriceUSDC
    };

    console.log('🧪 Required parameters check:');
    Object.entries(requiredParams).forEach(([key, value]) => {
      console.log(`  ${key}: ${value !== undefined ? '✅ defined' : '❌ undefined'} (${typeof value})`);
      if (value === undefined) {
        console.error(`💥 CRITICAL: ${key} is undefined!`);
      }
    });

    // Validate that the order is properly configured for our system
    if (fusionOrder.message.receiver.toLowerCase() !== AUCTION_FUSION_RESOLVER.toLowerCase()) {
      throw new Error('Fusion order receiver must be AuctionFusionResolver contract');
    }

    if (fusionOrder.message.takerAsset.toLowerCase() !== USDC_ADDRESS.toLowerCase()) {
      throw new Error('Fusion order must convert to USDC');
    }

    if (fusionOrder.message.makerAsset.toLowerCase() !== bidTokenAddress.toLowerCase()) {
      throw new Error('Fusion order maker asset must match bid token');
    }

    // Verify the signature
    const recoveredAddress = ethers.verifyTypedData(
      fusionOrder.domain,
      fusionOrder.types,
      fusionOrder.message,
      fusionSignature
    );

    if (recoveredAddress.toLowerCase() !== userWallet.toLowerCase()) {
      throw new Error('Invalid Fusion order signature');
    }

    // Store the bid
    const bidId = ethers.keccak256(fusionSignature);
    const { data, error } = await supabaseClient
      .from('resolver_fusion_bids')
      .insert({
        id: bidId,
        launch_id: launchId,
        user_wallet: userWallet,
        bid_token_address: bidTokenAddress.toLowerCase(),
        bid_token_amount: bidTokenAmount,
        bid_token_symbol: bidTokenSymbol,
        auction_token_address: auctionTokenAddress.toLowerCase(),
        max_auction_tokens: maxAuctionTokens,
        max_effective_price_usdc: maxEffectivePriceUSDC,
        expected_usdc_amount: fusionOrder.message.takingAmount,
        fusion_order: JSON.stringify(fusionOrder),
        fusion_signature: fusionSignature,
        salt: fusionOrder.message.salt.toString(),
        status: 'pending',
        created_at: new Date(),
      });

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    console.log('✅ Resolver Fusion bid created', {
      bidId,
      bidder: userWallet,
      bidToken: bidTokenSymbol,
      expectedUSDC: fusionOrder.message.takingAmount,
    });

    return {
      error: null,
      result: {
        bidId,
        status: 'pending',
        message: `Fusion bid created with ${bidTokenSymbol}. Will be executed via smart contract if winning.`,
      },
    };
  } catch (error) {
    console.error('Error creating resolver Fusion bid:', error);
    return { error: error.message, result: null };
  }
};

/**
 * Settle auction using smart contract resolver approach
 */
const settleResolverFusionAuction = async (supabaseClient, launchId) => {
  try {
    console.log('🎯 Starting resolver Fusion auction settlement', { launchId });

    // Get all pending bids
    const { data: fusionBids, error: bidsError } = await supabaseClient
      .from('resolver_fusion_bids')
      .select('*')
      .eq('launch_id', launchId)
      .eq('status', 'pending');

    if (bidsError) {
      throw new Error(`Database error: ${bidsError.message}`);
    }

    if (!fusionBids || fusionBids.length === 0) {
      return { error: null, result: { settledBids: 0, clearingPrice: 0 } };
    }

    // Calculate effective USDC values and determine winners
    const { winningBids, losingBids, clearingPrice } = await selectWinnersForResolver(
      supabaseClient,
      launchId,
      fusionBids
    );

    if (winningBids.length === 0) {
      return { error: null, result: { settledBids: 0, clearingPrice: 0 } };
    }

    // For demo purposes, simulate successful execution
    // In production: Phase 1 would submit to 1inch Fusion, Phase 2 would execute smart contract
    const distributionResults = winningBids.map(bid => ({
      ...bid,
      status: 'tokens_distributed',
      usdc_received: bid.expected_usdc_amount,
      distribution_tx: '0x' + Math.random().toString(16).slice(2, 66), // Mock tx hash
    }));

    // Update database with results
    await updateResolverBidResults(supabaseClient, distributionResults);
    await markLosingResolverBids(supabaseClient, losingBids);
    
    // Update launch status to completed
    await updateLaunchStatus(supabaseClient, launchId, clearingPrice, distributionResults);

    console.log('✅ Resolver Fusion auction settlement completed', {
      launchId,
      totalBids: fusionBids.length,
      winningBids: winningBids.length,
      successfulExecutions: distributionResults.length,
      clearingPrice,
    });

    return {
      error: null,
      result: {
        settledBids: distributionResults.length,
        clearingPrice,
        totalBids: fusionBids.length,
        winningBids: winningBids.length,
        losingBids: losingBids.length,
      },
    };
  } catch (error) {
    console.error('Resolver Fusion auction settlement failed:', error);
    return { error: error.message, result: null };
  }
};

/**
 * Select winning bids for resolver approach
 */
const selectWinnersForResolver = async (supabaseClient, launchId, fusionBids) => {
  // Get current token prices
  const tokenAddresses = [...new Set(fusionBids.map(bid => bid.bid_token_address))];
  const tokenPrices = await getTokenPricesInUSDC(tokenAddresses);

  // Calculate effective USDC values
  const bidsWithUSDCValues = fusionBids.map(bid => {
    const tokenPrice = tokenPrices[bid.bid_token_address.toLowerCase()];
    const tokenDecimals = getTokenDecimals(bid.bid_token_address);
    const effectiveUSDCValue = (parseFloat(bid.bid_token_amount) * tokenPrice) / Math.pow(10, tokenDecimals);
    const effectiveUSDCPrice = effectiveUSDCValue / parseFloat(bid.max_auction_tokens);

    return {
      ...bid,
      current_token_price_usdc: tokenPrice,
      effective_usdc_value: effectiveUSDCValue,
      effective_usdc_price: effectiveUSDCPrice,
      fusion_order_data: JSON.parse(bid.fusion_order),
    };
  });

  // Filter valid bids and sort
  const validBids = bidsWithUSDCValues.filter(bid => 
    bid.effective_usdc_price <= bid.max_effective_price_usdc
  );

  const sortedBids = validBids.sort((a, b) => b.effective_usdc_price - a.effective_usdc_price);

  // Get launch details and determine winners
  const { data: launch } = await supabaseClient
    .from('launches')
    .select('*')
    .eq('id', launchId)
    .single();

  const targetAllocation = BigInt(launch.target_allocation);
  let remainingAllocation = targetAllocation;
  const winningBids = [];
  const losingBids = [];
  let clearingPrice = 0;

  for (const bid of sortedBids) {
    const bidQuantity = BigInt(bid.max_auction_tokens);
    
    if (remainingAllocation > 0) {
      const fillQuantity = bidQuantity > remainingAllocation ? remainingAllocation : bidQuantity;
      
      winningBids.push({
        ...bid,
        fillQuantity: fillQuantity.toString(),
      });

      clearingPrice = bid.effective_usdc_price;
      remainingAllocation -= fillQuantity;
    } else {
      losingBids.push(bid);
    }
  }

  return { winningBids, losingBids, clearingPrice };
};

/**
 * Submit winning orders to 1inch Fusion network
 */
const submitWinningOrdersToFusion = async (winningBids) => {
  const submissionResults = [];

  for (const bid of winningBids) {
    try {
      // Submit to 1inch Fusion API
      const fusionResult = await submit1inchFusionOrder({
        order: bid.fusion_order_data,
        signature: bid.fusion_signature,
      });

      submissionResults.push({
        ...bid,
        fusion_order_hash: fusionResult.orderHash,
        status: 'submitted',
      });

      // Monitor for fill (in production, use webhooks or polling)
      // For now, assume immediate fill for demo
      submissionResults[submissionResults.length - 1].status = 'filled';
      submissionResults[submissionResults.length - 1].usdc_received = bid.expected_usdc_amount;
      
    } catch (error) {
      console.error('Failed to submit Fusion order:', error);
      submissionResults.push({
        ...bid,
        status: 'failed',
        error: error.message,
      });
    }
  }

  return submissionResults;
};

/**
 * Execute smart contract distribution of auction tokens
 */
const executeSmartContractDistribution = async (launchId, filledOrders) => {
  if (filledOrders.length === 0) return [];

  try {
    // Initialize contract
    const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    const resolverContract = new ethers.Contract(
      AUCTION_FUSION_RESOLVER,
      require('./abis/AuctionFusionResolver.json').abi,
      wallet
    );

    const distributionResults = [];

    // Execute batch distribution
    const users = filledOrders.map(order => order.user_wallet);
    const sourceTokens = filledOrders.map(order => order.bid_token_address);
    const sourceAmounts = filledOrders.map(order => order.bid_token_amount);
    const auctionToken = filledOrders[0].auction_token_address; // All should be same
    const expectedTokens = filledOrders.map(order => order.fillQuantity);
    const usdcAmounts = filledOrders.map(order => order.usdc_received);

    const tx = await resolverContract.batchExecuteAuctionBids(
      users,
      sourceTokens,
      sourceAmounts,
      auctionToken,
      expectedTokens,
      usdcAmounts
    );

    const receipt = await tx.wait();

    // Mark all as successful
    for (const order of filledOrders) {
      distributionResults.push({
        ...order,
        distribution_tx: receipt.transactionHash,
        status: 'completed',
      });
    }

    console.log('✅ Smart contract distribution completed', {
      txHash: receipt.transactionHash,
      executedOrders: filledOrders.length,
    });

    return distributionResults;
  } catch (error) {
    console.error('Smart contract distribution failed:', error);
    throw error;
  }
};

// Helper functions
const getTokenPricesInUSDC = async (tokenAddresses) => {
  console.log('💰 Fetching token prices for settlement');
  
  // Mock prices for testing - in production, fetch from 1inch price API
  const mockPrices = {
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 1.0,    // USDC
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 3200.0, // WETH
    '0x912ce59144191c1204e64559fe8253a0e49e6548': 0.85,   // ARB
    '0xf97f4df75117a78c1a5a0dbb814af92458539fb4': 14.50,  // LINK
    '0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0': 8.5,    // UNI
  };
  
  const prices = {};
  for (const address of tokenAddresses) {
    const normalizedAddress = address.toLowerCase();
    prices[normalizedAddress] = mockPrices[normalizedAddress] || 1.0; // Default to $1 if unknown
  }
  
  console.log('📊 Token prices:', prices);
  return prices;
};

const getTokenDecimals = (tokenAddress) => {
  const decimalsMap = {
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 6,  // USDC
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 18, // WETH
    '0x912ce59144191c1204e64559fe8253a0e49e6548': 18, // ARB
    '0xf97f4df75117a78c1a5a0dbb814af92458539fb4': 18, // LINK
    '0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0': 18, // UNI
  };
  
  return decimalsMap[tokenAddress.toLowerCase()] || 18; // Default to 18 decimals
};

const submit1inchFusionOrder = async ({ order, signature }) => {
  // Implementation: submit to 1inch Fusion API
  return { orderHash: '0x...', status: 'submitted' };
};

const updateResolverBidResults = async (supabaseClient, distributionResults) => {
  console.log('📝 Updating resolver bid results in database');
  
  for (const result of distributionResults) {
    try {
      const { error } = await supabaseClient
        .from('resolver_fusion_bids')
        .update({
          status: result.status,
          updated_at: new Date().toISOString(),
          distribution_tx: result.distribution_tx || null,
          usdc_received: result.usdc_received || null,
        })
        .eq('id', result.id);

      if (error) {
        console.error('Failed to update bid result:', error);
      }
    } catch (err) {
      console.error('Error updating bid result:', err);
    }
  }
};

const markLosingResolverBids = async (supabaseClient, losingBids) => {
  console.log('❌ Marking losing resolver bids');
  
  for (const bid of losingBids) {
    try {
      const { error } = await supabaseClient
        .from('resolver_fusion_bids')
        .update({
          status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', bid.id);

      if (error) {
        console.error('Failed to mark losing bid:', error);
      }
    } catch (err) {
      console.error('Error marking losing bid:', err);
    }
  }
};

const updateLaunchStatus = async (supabaseClient, launchId, clearingPrice, distributionResults) => {
  console.log('🚀 Updating launch status to completed');
  
  const totalRaised = distributionResults.reduce((sum, result) => {
    return sum + (parseFloat(result.usdc_received) || 0);
  }, 0);
  
  try {
    const { error } = await supabaseClient
      .from('launches')
      .update({
        status: 'completed',
        is_launched: true,
        clearing_price: clearingPrice > 0.000001 ? clearingPrice : 0.000001, // Handle tiny values that cause overflow
        total_raised: totalRaised,
        updated_at: new Date().toISOString(),
      })
      .eq('id', launchId);

    if (error) {
      console.error('Failed to update launch status:', error);
    } else {
      console.log('✅ Launch status updated successfully');
    }
  } catch (err) {
    console.error('Error updating launch status:', err);
  }
};

module.exports = {
  createResolverFusionBid,
  settleResolverFusionAuction,
  FUSION_DOMAIN,
  FUSION_ORDER_TYPES,
  USDC_ADDRESS,
};