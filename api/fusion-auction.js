const { ethers } = require('ethers');

/**
 * Pure 1inch Fusion Auction System
 * 
 * Users create 1inch Fusion orders directly, which we store privately
 * and only submit to the Fusion network if they win the auction.
 */

// 1inch Fusion Order Types (simplified)
const FUSION_ORDER_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'receiver', type: 'address' },
    { name: 'makerAsset', type: 'address' },
    { name: 'takerAsset', type: 'address' },
    { name: 'makingAmount', type: 'uint256' },
    { name: 'takingAmount', type: 'uint256' },
    { name: 'makerTraits', type: 'uint256' },
  ],
};

const FUSION_DOMAIN = {
  name: '1inch Limit Order Protocol',
  version: '4',
  chainId: 42161,
  verifyingContract: '0x1111111254EEB25477B68fb85Ed929f73A960582', // 1inch Limit Order Protocol v4
};

/**
 * Create a Fusion-based bid (works with ANY token, fully private)
 */
const createFusionBid = async (supabaseClient, bidData) => {
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
      fusionOrder,
      fusionSignature,
    } = bidData;

    // Verify the Fusion order signature
    const recoveredAddress = ethers.verifyTypedData(
      FUSION_DOMAIN,
      FUSION_ORDER_TYPES,
      fusionOrder,
      fusionSignature
    );

    if (recoveredAddress.toLowerCase() !== userWallet.toLowerCase()) {
      throw new Error('Invalid Fusion order signature');
    }

    // Validate order parameters
    if (fusionOrder.maker.toLowerCase() !== userWallet.toLowerCase()) {
      throw new Error('Order maker must be the bidder');
    }

    if (fusionOrder.makerAsset.toLowerCase() !== bidTokenAddress.toLowerCase()) {
      throw new Error('Maker asset must match bid token');
    }

    // Store the Fusion bid privately
    const bidId = ethers.keccak256(fusionSignature);
    const { data, error } = await supabaseClient
      .from('fusion_bids')
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
        fusion_order: JSON.stringify(fusionOrder),
        fusion_signature: fusionSignature,
        salt: fusionOrder.salt.toString(),
        status: 'pending',
        created_at: new Date(),
      });

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    console.log('✅ Fusion bid created successfully', {
      bidId,
      bidder: userWallet,
      bidToken: bidTokenSymbol,
      bidAmount: bidTokenAmount,
    });

    return {
      error: null,
      result: {
        bidId,
        status: 'pending',
        message: `Fusion bid created with ${bidTokenSymbol}. Will be submitted to 1inch if winning.`,
      },
    };
  } catch (error) {
    console.error('Error creating Fusion bid:', error);
    return { error: error.message, result: null };
  }
};

/**
 * Settle auction using pure 1inch Fusion orders
 */
const settleFusionAuction = async (supabaseClient, launchId) => {
  try {
    console.log('🎯 Starting Fusion-based auction settlement', { launchId });

    // Get all pending Fusion bids
    const { data: fusionBids, error: bidsError } = await supabaseClient
      .from('fusion_bids')
      .select('*')
      .eq('launch_id', launchId)
      .eq('status', 'pending');

    if (bidsError) {
      throw new Error(`Database error: ${bidsError.message}`);
    }

    if (!fusionBids || fusionBids.length === 0) {
      return { error: null, result: { settledBids: 0, clearingPrice: 0 } };
    }

    // Calculate effective USDC values
    const tokenAddresses = [...new Set(fusionBids.map(bid => bid.bid_token_address))];
    const tokenPrices = await getTokenPricesInUSDC(tokenAddresses);

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

    // Filter valid bids and sort by effective USDC price
    const validBids = bidsWithUSDCValues.filter(bid => 
      bid.effective_usdc_price <= bid.max_effective_price_usdc
    );

    const sortedBids = validBids.sort((a, b) => b.effective_usdc_price - a.effective_usdc_price);

    // Determine winners (same logic as before)
    const { winningBids, losingBids, clearingPrice } = await selectWinners(
      supabaseClient, 
      launchId, 
      sortedBids
    );

    // Submit winning Fusion orders to 1inch network
    const submissionResults = await submitWinningFusionOrders(winningBids);

    // Mark losing bids as failed (no submission to 1inch)
    await markLosingFusionBids(supabaseClient, losingBids);

    // Update winning bids with submission results
    await updateFusionBidResults(supabaseClient, submissionResults);

    console.log('✅ Fusion auction settlement completed', {
      launchId,
      totalBids: fusionBids.length,
      winningBids: winningBids.length,
      losingBids: losingBids.length,
      clearingPrice,
    });

    return {
      error: null,
      result: {
        settledBids: submissionResults.length,
        clearingPrice,
        totalBids: fusionBids.length,
        winningBids: winningBids.length,
        losingBids: losingBids.length,
      },
    };
  } catch (error) {
    console.error('Fusion auction settlement failed:', error);
    return { error: error.message, result: null };
  }
};

/**
 * Submit winning Fusion orders to 1inch network
 */
const submitWinningFusionOrders = async (winningBids) => {
  const submissionResults = [];

  for (const bid of winningBids) {
    try {
      // Submit this Fusion order to 1inch network
      const submissionResult = await submit1inchFusionOrder({
        order: bid.fusion_order_data,
        signature: bid.fusion_signature,
        // Additional 1inch Fusion API parameters
      });

      submissionResults.push({
        ...bid,
        fusion_order_hash: submissionResult.orderHash,
        submission_tx: submissionResult.txHash,
        status: 'submitted',
      });

      console.log('✅ Fusion order submitted', {
        bidId: bid.id,
        orderHash: submissionResult.orderHash,
      });
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
 * Submit a single order to 1inch Fusion network
 */
const submit1inchFusionOrder = async ({ order, signature }) => {
  // This would integrate with 1inch Fusion API
  // https://docs.1inch.io/docs/fusion-swap/introduction
  
  const fusionApiUrl = 'https://api.1inch.dev/fusion';
  
  const response = await fetch(`${fusionApiUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.ONEINCH_API_KEY}`,
    },
    body: JSON.stringify({
      order,
      signature,
      // Additional Fusion parameters
    }),
  });

  if (!response.ok) {
    throw new Error(`1inch Fusion API error: ${response.statusText}`);
  }

  return await response.json();
};

// Helper functions (would need actual implementations)
const getTokenPricesInUSDC = async (tokenAddresses) => {
  // Fetch real prices from 1inch price API
  return {};
};

const getTokenDecimals = (tokenAddress) => {
  // Get actual token decimals
  return 18;
};

const selectWinners = async (supabaseClient, launchId, sortedBids) => {
  // Same winner selection logic as before
  return { winningBids: [], losingBids: [], clearingPrice: 0 };
};

const markLosingFusionBids = async (supabaseClient, losingBids) => {
  // Mark losing bids as failed in database
};

const updateFusionBidResults = async (supabaseClient, submissionResults) => {
  // Update database with submission results
};

module.exports = {
  createFusionBid,
  settleFusionAuction,
  FUSION_DOMAIN,
  FUSION_ORDER_TYPES,
};