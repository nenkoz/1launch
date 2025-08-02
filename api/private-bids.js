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
  USDC:
    process.env.USDC_ADDRESS ?? '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  AUCTION_CONTROLLER: process.env.AUCTION_CONTROLLER_ADDRESS,
  AUCTION_RESOLVER: process.env.AUCTION_RESOLVER_ADDRESS,
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
 * Create a private bid (stored in database, not submitted to 1inch yet)
 */
const createPrivateBid = async (supabaseClient, bidData) => {
  try {
    const {
      launchId,
      userWallet,
      price,
      quantity,
      takerAsset,
      auctionEndTime,
    } = bidData;

    logEvent('INFO', 'Creating private bid', {
      launchId,
      userWallet,
      price,
      quantity,
    });

    // Generate a unique bid ID
    const bidId = ethers.keccak256(
      ethers.toUtf8Bytes(`${launchId}-${userWallet}-${Date.now()}`)
    );

    // Store bid in database (not submitted to 1inch yet)
    const { data: bid, error: bidError } = await supabaseClient
      .from('private_bids')
      .insert({
        id: bidId,
        launch_id: launchId,
        user_wallet: userWallet,
        price: price,
        quantity: quantity,
        taker_asset: takerAsset,
        auction_end_time: auctionEndTime,
        status: 'pending', // Not submitted to 1inch yet
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (bidError) {
      logEvent('ERROR', 'Failed to store private bid', bidError);
      throw new Error(`Database error: ${bidError.message}`);
    }

    logEvent('INFO', 'Private bid created successfully', {
      bidId,
      launchId,
      userWallet,
    });

    return {
      error: null,
      result: {
        bidId,
        status: 'pending',
        message:
          'Private bid created and stored. Will be submitted to 1inch when auction ends.',
      },
    };
  } catch (error) {
    logEvent('ERROR', 'Failed to create private bid', {
      error: error.message,
      bidData,
    });
    return { error: error.message, result: null };
  }
};

/**
 * Submit all pending bids to 1inch when auction ends
 */
const submitPendingBidsTo1inch = async (supabaseClient, launchId) => {
  try {
    logEvent('INFO', 'Submitting pending bids to 1inch', { launchId });

    // Get all pending bids for this launch
    const { data: pendingBids, error: bidsError } = await supabaseClient
      .from('private_bids')
      .select('*')
      .eq('launch_id', launchId)
      .eq('status', 'pending');

    if (bidsError) {
      logEvent('ERROR', 'Failed to fetch pending bids', bidsError);
      throw new Error(`Database error: ${bidsError.message}`);
    }

    if (!pendingBids || pendingBids.length === 0) {
      logEvent('INFO', 'No pending bids found', { launchId });
      return { error: null, result: { submittedCount: 0 } };
    }

    logEvent('INFO', `Found ${pendingBids.length} pending bids to submit`);

    // Initialize 1inch SDK
    const sdk = new Sdk({
      authKey: API_KEY,
      networkId: CHAIN_ID,
      httpConnector: new FetchProviderConnector(),
    });

    let submittedCount = 0;
    const submittedBids = [];

    for (const bid of pendingBids) {
      try {
        // Calculate amounts
        const makingAmountBigInt = BigInt(
          Math.floor(bid.price * bid.quantity * 1e6)
        );
        const takingAmountBigInt = BigInt(Math.floor(bid.quantity * 1e18));

        // Create order parameters
        const expiresIn = 3600n;
        const expiration = BigInt(Math.floor(Date.now() / 1000)) + expiresIn;
        const UINT_40_MAX = (1n << 40n) - 1n;
        const nonce = randBigInt(UINT_40_MAX);

        const makerTraits = MakerTraits.default()
          .withExpiration(expiration)
          .withNonce(nonce)
          .allowPartialFills()
          .allowMultipleFills();

        // Create the order
        const order = await sdk.createOrder(
          {
            makerAsset: new Address(CONTRACTS.USDC),
            takerAsset: new Address(bid.taker_asset),
            makingAmount: makingAmountBigInt,
            takingAmount: takingAmountBigInt,
            maker: new Address(bid.user_wallet),
            receiver: new Address(bid.user_wallet),
          },
          makerTraits
        );

        const orderHash = order.getOrderHash(CHAIN_ID);
        const typedData = order.getTypedData();
        const orderData = order.build();

        // Get extension data
        let extensionData = '0x';
        const extensionObject = order.extension;
        if (extensionObject && typeof extensionObject.encode === 'function') {
          extensionData = extensionObject.encode();
        }

        // Store order data in database (ready for execution)
        const { error: orderError } = await supabaseClient
          .from('limit_orders')
          .insert({
            bid_id: bid.id,
            order_hash: orderHash,
            maker_address: bid.user_wallet,
            maker_asset: CONTRACTS.USDC,
            taker_asset: bid.taker_asset,
            making_amount: makingAmountBigInt.toString(),
            taking_amount: takingAmountBigInt.toString(),
            salt: orderData.salt,
            expiration: orderData.expiration,
            order_data: {
              orderHash,
              orderData,
              extensionData,
              nonce: nonce.toString(),
              expiration: expiration.toString(),
              domain: typedData.domain,
              types: typedData.types,
              typedDataMessage: typedData.message,
            },
            status: 'ready', // Ready for execution
          });

        if (orderError) {
          logEvent('ERROR', 'Failed to store order data', orderError);
          continue;
        }

        // Update bid status
        await supabaseClient
          .from('private_bids')
          .update({
            status: 'submitted',
            order_hash: orderHash,
            submitted_at: new Date().toISOString(),
          })
          .eq('id', bid.id);

        submittedBids.push({
          bidId: bid.id,
          orderHash,
          userWallet: bid.user_wallet,
          price: bid.price,
          quantity: bid.quantity,
        });

        submittedCount++;

        logEvent('INFO', 'Bid submitted to 1inch', {
          bidId: bid.id,
          orderHash,
          userWallet: bid.user_wallet,
        });
      } catch (bidError) {
        logEvent('ERROR', 'Failed to submit bid to 1inch', {
          error: bidError.message,
          bidId: bid.id,
        });
      }
    }

    logEvent('INFO', 'Bid submission completed', {
      totalBids: pendingBids.length,
      submittedCount,
      failedCount: pendingBids.length - submittedCount,
    });

    return {
      error: null,
      result: {
        submittedCount,
        submittedBids,
        message: `Successfully submitted ${submittedCount} bids to 1inch`,
      },
    };
  } catch (error) {
    logEvent('ERROR', 'Failed to submit pending bids', {
      error: error.message,
      launchId,
    });
    return { error: error.message, result: null };
  }
};

/**
 * Get private bids for a launch
 */
const getPrivateBids = async (supabaseClient, launchId) => {
  try {
    const { data: bids, error: bidsError } = await supabaseClient
      .from('private_bids')
      .select('*')
      .eq('launch_id', launchId)
      .order('created_at', { ascending: false });

    if (bidsError) {
      logEvent('ERROR', 'Failed to fetch private bids', bidsError);
      return { error: bidsError.message, result: null };
    }

    return { error: null, result: { bids: bids || [] } };
  } catch (error) {
    logEvent('ERROR', 'Failed to get private bids', {
      error: error.message,
      launchId,
    });
    return { error: error.message, result: null };
  }
};

/**
 * Cancel a private bid (before auction ends)
 */
const cancelPrivateBid = async (supabaseClient, bidId, userWallet) => {
  try {
    logEvent('INFO', 'Cancelling private bid', { bidId, userWallet });

    // Check if bid exists and belongs to user
    const { data: bid, error: bidError } = await supabaseClient
      .from('private_bids')
      .select('*')
      .eq('id', bidId)
      .eq('user_wallet', userWallet)
      .eq('status', 'pending')
      .single();

    if (bidError || !bid) {
      return { error: 'Bid not found or cannot be cancelled', result: null };
    }

    // Update bid status to cancelled
    const { error: updateError } = await supabaseClient
      .from('private_bids')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', bidId);

    if (updateError) {
      logEvent('ERROR', 'Failed to cancel bid', updateError);
      return { error: 'Failed to cancel bid', result: null };
    }

    logEvent('INFO', 'Private bid cancelled successfully', { bidId });

    return {
      error: null,
      result: {
        bidId,
        status: 'cancelled',
        message: 'Private bid cancelled successfully',
      },
    };
  } catch (error) {
    logEvent('ERROR', 'Failed to cancel private bid', {
      error: error.message,
      bidId,
    });
    return { error: error.message, result: null };
  }
};

module.exports = {
  createPrivateBid,
  submitPendingBidsTo1inch,
  getPrivateBids,
  cancelPrivateBid,
};
