const { ethers } = require('ethers');

/**
 * Intent-Based Auction System
 * 
 * This system allows users to bid with ANY token (not just permit-enabled ones)
 * by signing intents off-chain and executing them via 1inch Fusion at settlement.
 */

const INTENT_DOMAIN = {
  name: '1Launch Intent System',
  version: '1',
  chainId: 42161,
  verifyingContract: '0x0000000000000000000000000000000000000000', // Our intent contract
};

const INTENT_TYPES = {
  BidIntent: [
    { name: 'bidder', type: 'address' },
    { name: 'bidToken', type: 'address' },
    { name: 'bidAmount', type: 'uint256' },
    { name: 'auctionToken', type: 'address' },
    { name: 'maxAuctionTokens', type: 'uint256' },
    { name: 'maxEffectivePrice', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

/**
 * Create an intent-based bid (works with ANY token)
 */
const createIntentBid = async (supabaseClient, bidData) => {
  try {
    const {
      launchId,
      userWallet,
      bidTokenAddress,
      bidTokenAmount,
      bidTokenSymbol,
      auctionTokenAddress,
      maxAuctionTokens,
      maxEffectivePriceUSDC,
      intentSignature,
      intent,
    } = bidData;

    // Verify the intent signature
    const recoveredAddress = ethers.verifyTypedData(
      INTENT_DOMAIN,
      INTENT_TYPES,
      intent,
      intentSignature
    );

    if (recoveredAddress.toLowerCase() !== userWallet.toLowerCase()) {
      throw new Error('Invalid intent signature');
    }

    // Validate intent parameters
    if (intent.deadline < Math.floor(Date.now() / 1000)) {
      throw new Error('Intent has expired');
    }

    // Store the intent bid in database
    const { data, error } = await supabaseClient
      .from('intent_bids')
      .insert({
        id: ethers.keccak256(intentSignature), // Use signature hash as ID
        launch_id: launchId,
        user_wallet: userWallet,
        bid_token_address: bidTokenAddress.toLowerCase(),
        bid_token_amount: bidTokenAmount,
        bid_token_symbol: bidTokenSymbol,
        auction_token_address: auctionTokenAddress.toLowerCase(),
        max_auction_tokens: maxAuctionTokens,
        max_effective_price_usdc: maxEffectivePriceUSDC,
        intent_signature: intentSignature,
        intent_data: JSON.stringify(intent),
        deadline: new Date(intent.deadline * 1000),
        nonce: intent.nonce.toString(),
        status: 'pending',
        created_at: new Date(),
      });

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    console.log('✅ Intent bid created successfully', {
      intentId: ethers.keccak256(intentSignature),
      bidder: userWallet,
      bidToken: bidTokenSymbol,
      bidAmount: bidTokenAmount,
    });

    return {
      error: null,
      result: {
        intentId: ethers.keccak256(intentSignature),
        status: 'pending',
        message: `Intent bid created with ${bidTokenSymbol}. Will be executed automatically if winning.`,
      },
    };
  } catch (error) {
    console.error('Error creating intent bid:', error);
    return { error: error.message, result: null };
  }
};

/**
 * Settle auction using intent-based system
 */
const settleIntentAuction = async (supabaseClient, launchId) => {
  try {
    console.log('🚀 Starting intent-based auction settlement', { launchId });

    // Get all pending intent bids
    const { data: intentBids, error: bidsError } = await supabaseClient
      .from('intent_bids')
      .select('*')
      .eq('launch_id', launchId)
      .eq('status', 'pending')
      .gte('deadline', new Date().toISOString()); // Only non-expired intents

    if (bidsError) {
      throw new Error(`Database error: ${bidsError.message}`);
    }

    if (!intentBids || intentBids.length === 0) {
      return { error: null, result: { settledBids: 0, clearingPrice: 0 } };
    }

    // Get current token prices for accurate valuation
    const tokenAddresses = [...new Set(intentBids.map(bid => bid.bid_token_address))];
    const tokenPrices = await getTokenPricesInUSDC(tokenAddresses);

    // Calculate effective USDC values for each intent
    const bidsWithUSDCValues = intentBids.map(bid => {
      const tokenPrice = tokenPrices[bid.bid_token_address.toLowerCase()];
      const tokenDecimals = getTokenDecimals(bid.bid_token_address);
      const effectiveUSDCValue = (parseFloat(bid.bid_token_amount) * tokenPrice) / Math.pow(10, tokenDecimals);
      const effectiveUSDCPrice = effectiveUSDCValue / parseFloat(bid.max_auction_tokens);

      return {
        ...bid,
        current_token_price_usdc: tokenPrice,
        effective_usdc_value: effectiveUSDCValue,
        effective_usdc_price: effectiveUSDCPrice,
        intent_data: JSON.parse(bid.intent_data),
      };
    });

    // Filter out bids that exceed their max effective price
    const validBids = bidsWithUSDCValues.filter(bid => 
      bid.effective_usdc_price <= bid.max_effective_price_usdc
    );

    // Sort by effective USDC price (highest first)
    const sortedBids = validBids.sort((a, b) => b.effective_usdc_price - a.effective_usdc_price);

    // Get launch allocation details
    const { data: launch, error: launchError } = await supabaseClient
      .from('launches')
      .select('*')
      .eq('id', launchId)
      .single();

    if (launchError) throw new Error('Launch not found');

    // Determine winners
    const targetAllocation = BigInt(launch.target_allocation);
    let remainingAllocation = targetAllocation;
    const winningIntents = [];
    const losingIntents = [];
    let clearingPrice = 0;

    for (const bid of sortedBids) {
      const bidQuantity = BigInt(bid.max_auction_tokens);
      
      if (remainingAllocation > 0) {
        const fillQuantity = bidQuantity > remainingAllocation ? remainingAllocation : bidQuantity;
        
        winningIntents.push({
          ...bid,
          fillQuantity: fillQuantity.toString(),
          usdcNeeded: Number(fillQuantity) * bid.effective_usdc_price,
        });

        clearingPrice = bid.effective_usdc_price;
        remainingAllocation -= fillQuantity;
      } else {
        losingIntents.push(bid);
      }
    }

    // Execute winning intents via 1inch Fusion
    const executionResults = await executeWinningIntentsViaFusion(winningIntents);

    // Mark losing intents as failed
    await markLosingIntentsAsFailed(supabaseClient, losingIntents);

    // Update winning intents status
    await updateWinningIntentsStatus(supabaseClient, executionResults);

    console.log('✅ Intent-based auction settlement completed', {
      launchId,
      totalIntents: intentBids.length,
      validIntents: validBids.length,
      winningIntents: winningIntents.length,
      losingIntents: losingIntents.length,
      clearingPrice,
    });

    return {
      error: null,
      result: {
        settledBids: executionResults.length,
        clearingPrice,
        totalIntents: intentBids.length,
        winningIntents: winningIntents.length,
        losingIntents: losingIntents.length,
      },
    };
  } catch (error) {
    console.error('Intent auction settlement failed:', error);
    return { error: error.message, result: null };
  }
};

/**
 * Execute winning intents via 1inch Fusion
 */
const executeWinningIntentsViaFusion = async (winningIntents) => {
  const executionResults = [];

  for (const intent of winningIntents) {
    try {
      // Create 1inch Fusion order for this intent
      const fusionOrder = await create1inchFusionOrder({
        srcToken: intent.bid_token_address,
        dstToken: intent.auction_token_address, // Direct swap to auction token
        amount: intent.bid_token_amount,
        from: intent.user_wallet,
        // Add other 1inch Fusion parameters
      });

      // Submit to 1inch Fusion network
      const fusionResult = await submit1inchFusionOrder(fusionOrder, intent.intent_signature);

      executionResults.push({
        ...intent,
        fusionOrderHash: fusionResult.orderHash,
        status: 'executed',
        executionTxHash: fusionResult.txHash,
      });

      console.log('✅ Intent executed via Fusion', {
        intentId: intent.id,
        bidder: intent.user_wallet,
        orderHash: fusionResult.orderHash,
      });
    } catch (error) {
      console.error('Failed to execute intent via Fusion:', error);
      executionResults.push({
        ...intent,
        status: 'failed',
        error: error.message,
      });
    }
  }

  return executionResults;
};

/**
 * Mark losing intents as failed
 */
const markLosingIntentsAsFailed = async (supabaseClient, losingIntents) => {
  if (losingIntents.length === 0) return;

  const losingIds = losingIntents.map(intent => intent.id);
  
  const { error } = await supabaseClient
    .from('intent_bids')
    .update({ 
      status: 'failed',
      failure_reason: 'bid_too_low',
      updated_at: new Date(),
    })
    .in('id', losingIds);

  if (error) {
    console.error('Failed to mark losing intents:', error);
  } else {
    console.log(`✅ Marked ${losingIntents.length} losing intents as failed`);
  }
};

/**
 * Update winning intents status based on execution results
 */
const updateWinningIntentsStatus = async (supabaseClient, executionResults) => {
  for (const result of executionResults) {
    const updateData = {
      status: result.status,
      updated_at: new Date(),
    };

    if (result.status === 'executed') {
      updateData.fusion_order_hash = result.fusionOrderHash;
      updateData.execution_tx_hash = result.executionTxHash;
      updateData.tokens_received = result.fillQuantity;
    } else if (result.status === 'failed') {
      updateData.failure_reason = result.error;
    }

    const { error } = await supabaseClient
      .from('intent_bids')
      .update(updateData)
      .eq('id', result.id);

    if (error) {
      console.error('Failed to update intent status:', error);
    }
  }
};

// Helper functions (would need to be implemented)
const getTokenPricesInUSDC = async (tokenAddresses) => {
  // Implementation needed - fetch from 1inch price API
  return {};
};

const getTokenDecimals = (tokenAddress) => {
  // Implementation needed - get token decimals
  return 18;
};

const create1inchFusionOrder = async (params) => {
  // Implementation needed - create 1inch Fusion order
  return { orderHash: '0x...' };
};

const submit1inchFusionOrder = async (order, signature) => {
  // Implementation needed - submit to 1inch Fusion
  return { orderHash: '0x...', txHash: '0x...' };
};

module.exports = {
  createIntentBid,
  settleIntentAuction,
  INTENT_DOMAIN,
  INTENT_TYPES,
};