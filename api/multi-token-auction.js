const { ethers } = require('ethers');
const axios = require('axios');

require('dotenv').config({ path: '../.env.local' });

const CHAIN_ID = process.env.VITE_CHAIN_ID;
const FUSION_API_BASE = 'https://api.1inch.dev/fusion';
const API_KEY = process.env.VITE_ONE_INCH_API_KEY;

const logEvent = (level, message, data) => {
  console.log(
    `[${level}] ${new Date().toISOString()} - ${message}`,
    data ? JSON.stringify(data) : ''
  );
};

/**
 * MULTI-TOKEN AUCTION SYSTEM WITH 1INCH FUSION
 * 
 * Phase 1: Users bid with any token (ETH, ARB, LINK, USDC, etc.)
 * Phase 2: At auction end, calculate USDC values and select winners
 * Phase 3: Use 1inch Fusion to convert non-USDC winning bids to USDC
 * Phase 4: Distribute auction tokens to winners
 */

/**
 * Create a multi-token bid with permit signature
 */
const createMultiTokenBid = async (supabaseClient, bidData) => {
  try {
    const {
      launchId,
      userWallet,
      bidTokenAddress,
      bidTokenAmount,
      bidTokenSymbol,
      targetUSDCPrice, // User's target price in USDC
      quantity, // Auction tokens requested
      permit, // Permit signature for the bid token
      bidSignature,
    } = bidData;

    logEvent('INFO', 'Creating multi-token bid', {
      launchId,
      userWallet,
      bidTokenSymbol,
      bidTokenAmount,
      targetUSDCPrice,
      quantity,
    });

    // Validate the bid token is supported
    const supportedTokens = await getSupportedTokens();
    if (!supportedTokens.includes(bidTokenAddress.toLowerCase())) {
      throw new Error(`Token ${bidTokenSymbol} is not supported for bidding`);
    }

    // Generate bid commit hash for privacy
    const commitHash = ethers.keccak256(
      ethers.defaultAbiCoder.encode(
        ['string', 'address', 'uint256', 'uint256', 'uint256', 'address'],
        [launchId, bidTokenAddress, bidTokenAmount, targetUSDCPrice, quantity, userWallet]
      )
    );

    // Store multi-token bid in database
    const { data: bid, error: bidError } = await supabaseClient
      .from('multi_token_bids')
      .insert({
        id: commitHash,
        launch_id: launchId,
        user_wallet: userWallet,
        bid_token_address: bidTokenAddress,
        bid_token_symbol: bidTokenSymbol,
        bid_token_amount: bidTokenAmount,
        target_usdc_price: targetUSDCPrice,
        quantity: quantity,
        commit_hash: commitHash,
        // Permit signature for the bid token
        permit_owner: permit.owner,
        permit_spender: permit.spender,
        permit_value: permit.value,
        permit_deadline: permit.deadline,
        permit_v: permit.v,
        permit_r: permit.r,
        permit_s: permit.s,
        bid_signature: bidSignature,
        status: 'pending',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (bidError) {
      logEvent('ERROR', 'Failed to store multi-token bid', bidError);
      throw new Error(`Database error: ${bidError.message}`);
    }

    logEvent('INFO', 'Multi-token bid created successfully', {
      bidId: commitHash,
      bidTokenSymbol,
      targetUSDCPrice,
    });

    return {
      error: null,
      result: {
        bidId: commitHash,
        status: 'pending',
        message: `Multi-token bid created with ${bidTokenSymbol}. Will be converted to USDC if winning.`,
      },
    };
  } catch (error) {
    logEvent('ERROR', 'Failed to create multi-token bid', {
      error: error.message,
      bidData,
    });
    return { error: error.message, result: null };
  }
};

/**
 * Settle auction with multi-token bids using 1inch Fusion
 * OPTIMIZED: Only convert tokens for actual winners, leave losers untouched
 */
const settleMultiTokenAuction = async (supabaseClient, launchId) => {
  try {
    logEvent('INFO', 'Starting optimized multi-token auction settlement', { launchId });

    // Phase 1: Get all pending bids
    const { data: pendingBids, error: bidsError } = await supabaseClient
      .from('multi_token_bids')
      .select('*')
      .eq('launch_id', launchId)
      .eq('status', 'pending');

    if (bidsError) {
      throw new Error(`Database error: ${bidsError.message}`);
    }

    if (!pendingBids || pendingBids.length === 0) {
      return { error: null, result: { settledBids: 0, clearingPrice: 0 } };
    }

    // Phase 2: Calculate theoretical USDC values for ALL bids (no conversion yet)
    const bidsWithUSDCValues = await calculateTheoreticalUSDCValues(pendingBids);

    // Phase 3: Determine winners based on theoretical values (no token movement)
    const { winningBids, losingBids, clearingPrice } = await selectWinnersAndLosers(
      supabaseClient,
      launchId,
      bidsWithUSDCValues
    );

    if (winningBids.length === 0) {
      return { error: null, result: { settledBids: 0, clearingPrice: 0 } };
    }

    // Phase 4: ONLY convert tokens for actual winners
    const executedWinningBids = await executeTokenConversionsForWinnersOnly(winningBids);

    // Phase 5: Mark losing bids as failed (no token conversion)
    await markLosingBidsAsFailed(supabaseClient, losingBids);

    // Phase 6: Distribute auction tokens to successful winners
    await distributeAuctionTokens(supabaseClient, launchId, executedWinningBids);

    logEvent('INFO', 'Optimized multi-token auction settlement completed', {
      launchId,
      totalBids: pendingBids.length,
      winningBids: winningBids.length,
      losingBids: losingBids.length,
      successfulConversions: executedWinningBids.length,
      clearingPrice,
    });

    return {
      error: null,
      result: {
        settledBids: executedWinningBids.length,
        clearingPrice,
        totalUSDCRaised: executedWinningBids.reduce((sum, bid) => sum + bid.usdcReceived, 0),
        totalBids: pendingBids.length,
        winningBids: winningBids.length,
        losingBids: losingBids.length,
      },
    };
  } catch (error) {
    logEvent('ERROR', 'Multi-token auction settlement failed', {
      error: error.message,
      launchId,
    });
    return { error: error.message, result: null };
  }
};

/**
 * Phase 2: Calculate theoretical USDC values for comparison (NO TOKEN CONVERSION)
 * This is just for determining winners - no actual tokens are moved
 */
const calculateTheoreticalUSDCValues = async (bids) => {
  logEvent('INFO', 'Calculating theoretical USDC values for bid comparison', { 
    totalBids: bids.length 
  });

  // Get current token prices from 1inch API for estimation
  const tokenAddresses = [...new Set(bids.map(bid => bid.bid_token_address))];
  const tokenPrices = await getTokenPricesInUSDC(tokenAddresses);

  const bidsWithEstimatedValues = bids.map(bid => {
    const tokenPrice = tokenPrices[bid.bid_token_address.toLowerCase()];
    
    // Get proper decimals for the token
    const tokenDecimals = getTokenDecimals(bid.bid_token_address);
    const effectiveUSDCValue = (parseFloat(bid.bid_token_amount) * tokenPrice) / Math.pow(10, tokenDecimals);
    const effectiveUSDCPrice = effectiveUSDCValue / bid.quantity;

    return {
      ...bid,
      estimated_token_price_usdc: tokenPrice,
      estimated_usdc_value: effectiveUSDCValue,
      estimated_usdc_price: effectiveUSDCPrice,
    };
  });

  logEvent('INFO', 'Theoretical USDC values calculated (no conversions yet)', {
    samplePrices: Object.fromEntries(
      Object.entries(tokenPrices).slice(0, 3)
    ),
  });

  return bidsWithEstimatedValues;
};

/**
 * Phase 3: Determine winners and losers based on estimated USDC values
 * CRITICAL: No token conversions happen here - just selection
 */
const selectWinnersAndLosers = async (supabaseClient, launchId, bidsWithEstimatedValues) => {
  // Get launch allocation details
  const { data: launch, error: launchError } = await supabaseClient
    .from('launches')
    .select('*')
    .eq('id', launchId)
    .single();

  if (launchError) throw new Error('Launch not found');

  // Sort by estimated USDC price (highest first)
  const sortedBids = bidsWithEstimatedValues.sort((a, b) => b.estimated_usdc_price - a.estimated_usdc_price);

  const targetAllocation = BigInt(launch.target_allocation);
  let remainingAllocation = targetAllocation;
  const winningBids = [];
  const losingBids = [];
  let clearingPrice = 0;

  for (const bid of sortedBids) {
    const bidQuantity = BigInt(bid.quantity);
    
    if (remainingAllocation > 0) {
      // This bid can win (at least partially)
      const fillQuantity = bidQuantity > remainingAllocation ? remainingAllocation : bidQuantity;
      
      winningBids.push({
        ...bid,
        fillQuantity: fillQuantity.toString(),
        estimatedUSDCNeeded: (Number(fillQuantity) * bid.estimated_usdc_price),
      });

      clearingPrice = bid.estimated_usdc_price;
      remainingAllocation -= fillQuantity;
    } else {
      // This bid loses - no token conversion needed
      losingBids.push(bid);
    }
  }

  logEvent('INFO', 'Winners and losers determined (no tokens converted yet)', {
    totalBids: bidsWithEstimatedValues.length,
    winningBids: winningBids.length,
    losingBids: losingBids.length,
    clearingPrice,
  });

  return { winningBids, losingBids, clearingPrice };
};

/**
 * Phase 4: Execute token conversions ONLY for winning bids
 * OPTIMIZED: Losing bidders' tokens are never touched
 */
const executeTokenConversionsForWinnersOnly = async (winningBids) => {
  logEvent('INFO', 'Starting token conversions for winners only', {
    winningBids: winningBids.length,
  });

  const successfulConversions = [];
  const failedConversions = [];

  for (const bid of winningBids) {
    try {
      logEvent('INFO', 'Converting tokens for winning bid', {
        bidId: bid.id,
        userWallet: bid.user_wallet,
        tokenSymbol: bid.bid_token_symbol,
        amount: bid.bid_token_amount,
      });

      // Handle USDC bids (no conversion needed)
      if (bid.bid_token_symbol.toUpperCase() === 'USDC') {
        const usdcResult = await executeUSDCPermitForWinner(bid);
        successfulConversions.push({
          ...bid,
          usdcReceived: usdcResult.usdcAmount,
          conversionMethod: 'direct_usdc',
          txHash: usdcResult.txHash,
        });
        continue;
      }

      // Handle non-USDC tokens using 1inch Fusion
      const fusionResult = await executeTokenToUSDCConversion(bid);
      
      successfulConversions.push({
        ...bid,
        usdcReceived: fusionResult.usdcReceived,
        conversionMethod: 'fusion_swap',
        fusionOrderHash: fusionResult.orderHash,
        txHash: fusionResult.txHash,
      });

      logEvent('INFO', 'Token conversion successful for winner', {
        bidId: bid.id,
        fromToken: bid.bid_token_symbol,
        fromAmount: bid.bid_token_amount,
        usdcReceived: fusionResult.usdcReceived,
        method: 'fusion_swap',
      });

    } catch (error) {
      logEvent('ERROR', 'Token conversion failed for winning bid', {
        bidId: bid.id,
        userWallet: bid.user_wallet,
        error: error.message,
      });
      
      failedConversions.push({
        ...bid,
        conversionError: error.message,
      });
    }
  }

  logEvent('INFO', 'Token conversions completed for winners', {
    totalWinners: winningBids.length,
    successfulConversions: successfulConversions.length,
    failedConversions: failedConversions.length,
  });

  return successfulConversions;
};

/**
 * Create 1inch Fusion order for token → USDC conversion
 */
const createFusionSwapOrder = async (bid) => {
  const fusionOrderRequest = {
    fromTokenAddress: bid.bid_token_address,
    toTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
    amount: bid.bid_token_amount,
    from: bid.user_wallet,
    // Use preset for faster execution
    preset: 'fast', // 3-minute auction window
  };

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

  return response.data;
};

/**
 * Execute fusion order using stored permit
 */
const executeFusionOrder = async (fusionOrder) => {
  // This would integrate with your resolver or use 1inch's resolver network
  // The key is that the permit allows the fusion resolver to spend the user's tokens
  
  logEvent('INFO', 'Executing fusion order', {
    orderHash: fusionOrder.orderHash,
  });

  // Execute permit + fusion swap
  // Returns the actual USDC received after conversion
  return {
    orderHash: fusionOrder.orderHash,
    txHash: '0x...', // Actual transaction hash
    usdcReceived: fusionOrder.expectedUSDC, // Actual USDC received
  };
};

/**
 * Get supported tokens for bidding
 */
const getSupportedTokens = async () => {
  // Return list of supported token addresses on Arbitrum
  return [
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', // WETH
    '0x912ce59144191c1204e64559fe8253a0e49e6548', // ARB
    '0xf97f4df75117a78c1a5a0dbb814af92458539fb4', // LINK
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT
    // Add more supported tokens
  ];
};

/**
 * Get current token prices in USDC
 */
const getTokenPricesInUSDC = async (tokenAddresses) => {
  // Use 1inch price API or other price oracle
  const response = await axios.get(
    `https://api.1inch.dev/price/v1.1/${CHAIN_ID}`,
    {
      params: {
        tokens: tokenAddresses.join(','),
        currency: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC
      },
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
    }
  );

  return response.data;
};

/**
 * Mark losing bids as failed (no token conversion needed)
 */
const markLosingBidsAsFailed = async (supabaseClient, losingBids) => {
  if (losingBids.length === 0) return;

  logEvent('INFO', 'Marking losing bids as failed (no token conversion)', {
    losingBids: losingBids.length,
  });

  for (const bid of losingBids) {
    try {
      await supabaseClient
        .from('multi_token_bids')
        .update({
          status: 'failed',
          error_message: 'Bid was not high enough to win allocation',
          executed_at: new Date().toISOString(),
        })
        .eq('id', bid.id);
    } catch (error) {
      logEvent('ERROR', 'Failed to update losing bid status', {
        bidId: bid.id,
        error: error.message,
      });
    }
  }
};

/**
 * Execute USDC permit for winning bid (direct transfer)
 */
const executeUSDCPermitForWinner = async (bid) => {
  logEvent('INFO', 'Executing USDC permit for winner', {
    bidId: bid.id,
    amount: bid.estimatedUSDCNeeded,
  });

  // Execute the permit to transfer USDC directly
  // This would integrate with your smart contract
  return {
    usdcAmount: bid.estimatedUSDCNeeded,
    txHash: '0x...', // Actual transaction hash
  };
};

/**
 * Execute token to USDC conversion using 1inch Fusion for winner
 */
const executeTokenToUSDCConversion = async (bid) => {
  logEvent('INFO', 'Creating Fusion order for token conversion', {
    bidId: bid.id,
    fromToken: bid.bid_token_symbol,
    toToken: 'USDC',
  });

  // Create and execute 1inch Fusion order
  const fusionOrder = await createFusionSwapOrder(bid);
  const executionResult = await executeFusionOrder(fusionOrder);

  return executionResult;
};

/**
 * Get token decimals for proper calculation
 */
const getTokenDecimals = (tokenAddress) => {
  const decimalsMap = {
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 6,  // USDC
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 6,  // USDT
    '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': 8,  // WBTC
    // Default to 18 for most tokens
  };
  
  return decimalsMap[tokenAddress.toLowerCase()] || 18;
};

module.exports = {
  createMultiTokenBid,
  settleMultiTokenAuction,
  calculateTheoreticalUSDCValues,
  selectWinnersAndLosers,
  executeTokenConversionsForWinnersOnly,
  markLosingBidsAsFailed,
};