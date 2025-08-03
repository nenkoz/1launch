const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const {
  Sdk,
  LimitOrder,
  MakerTraits,
  Address,
  randBigInt,
  FetchProviderConnector,
} = require('@1inch/limit-order-sdk');

require('dotenv').config({ path: '../.env.local' }); // load env from the root or adjust path if needed

const CONTRACTS = {
  USDC:
    process.env.USDC_ADDRESS ?? '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum USDC
  AUCTION_CONTROLLER:
    process.env.AUCTION_CONTROLLER_ADDRESS ??
    '0x4ac231577d984859127cB3Ee3aaf1d7d1C6F9161', // Live Arbitrum deployment
  TOKEN_FACTORY:
    process.env.TOKEN_FACTORY_ADDRESS ??
    '0x23b87525f7e6D9FAEBe595459C084193047d72Be', // Updated efficient deployment
};

const app = express();
const PORT = process.env.PORT || 4999;

const fromChainId = process.env.VITE_CHAIN_ID;
if (!fromChainId) {
  console.error(
    'VITE_CHAIN_ID not found. Please set it in your ../.env.local file.'
  );
  process.exit(1);
}

// Validate chain ID for Arbitrum
if (fromChainId !== '42161') {
  console.warn(
    '⚠️  Warning: Chain ID is not Arbitrum mainnet (42161). Current:',
    fromChainId
  );
}

const API_KEY = process.env.VITE_ONE_INCH_API_KEY || '';
if (!API_KEY) {
  console.error(
    'One Inch API key not found. Please set it in your ../.env.local file.'
  );
  process.exit(1);
}

console.log('🔧 API Configuration:', {
  chainId: fromChainId,
  apiKey: API_KEY.substring(0, 10) + '...',
  contracts: CONTRACTS,
});

// Use JSON body parser
app.use(express.json());

//  cors all origin
const cors = require('cors');
const {
  getOrderStatus,
  submitOrder,
  executeOrder,
  settleAuction,
} = require('./oneinch');
const {
  fillPrivateAuctionOrder,
  fillBatchPrivateAuctionOrders,
  isOrderFilled,
} = require('./resolver');
const {
  createPrivateBid,
  submitPendingBidsTo1inch,
  getPrivateBids,
  cancelPrivateBid,
} = require('./private-bids');

const {
  createMultiTokenBid,
  settleMultiTokenAuction,
} = require('./multi-token-auction');

const {
  executeWinningBidsWithSmartContract,
  batchExecuteWinningBids,
} = require('./corrected-multi-token-settlement');

const {
  createIntentBid,
  settleIntentAuction,
} = require('./intent-auction');

const {
  createResolverFusionBid,
  settleResolverFusionAuction,
} = require('./fusion-resolver-auction');

app.use(cors());

// Token symbol mapping for Arbitrum
const getTokenSymbol = (tokenAddress) => {
  const TOKEN_SYMBOLS = {
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 'WETH', 
    '0x912ce59144191c1204e64559fe8253a0e49e6548': 'ARB',
    '0xf97f4df75117a78c1a5a0dbb814af92458539fb4': 'LINK',
    '0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0': 'UNI',
  };
  return TOKEN_SYMBOLS[tokenAddress.toLowerCase()] || 'UNKNOWN';
};

// Configure Supabase
const supabaseClient = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

app.post('/create_order', async (req, res) => {
  try {
    // Expect body to provide these fields directly
    const {
      launchId,
      auctionEndTime,
      takerAsset,
      quantity,
      price,
      userWallet,
    } = req.body;

    // Validate required fields
    if (
      !launchId ||
      !auctionEndTime ||
      !takerAsset ||
      !quantity ||
      !price ||
      !userWallet
    ) {
      return res.status(400).json({
        error:
          'Missing required fields: takerAsset, quantity, price, userWallet',
      });
    }

    console.log('📋 Creating order with parameters:', {
      launchId,
      takerAsset,
      quantity,
      price,
      userWallet,
      chainId: fromChainId,
    });

    const MAKER_ASSET = CONTRACTS.USDC; // USDC address on ARB
    const TAKER_ASSET = takerAsset; // e.g., project token

    const sdk = new Sdk({
      authKey: API_KEY,
      networkId: fromChainId,
      httpConnector: new FetchProviderConnector(),
    });
    console.log('/create_order: ✅ SDK v5.x initialized successfully');

    // Calculate amounts (assuming 18 decimals for tokens, 6 for USDC)
    const makingAmountBigInt = BigInt(Math.floor(price * quantity * 1e6));
    const takingAmountBigInt = BigInt(Math.floor(quantity * 1e18));

    console.log('💰 Amount calculations:', {
      price,
      quantity,
      makingAmount: makingAmountBigInt.toString(),
      takingAmount: takingAmountBigInt.toString(),
    });

    const expiresIn = 3600n;
    const expiration = BigInt(Math.floor(Date.now() / 1000)) + expiresIn;
    const UINT_40_MAX = (1n << 40n) - 1n;
    const nonce = randBigInt(UINT_40_MAX);

    const makerTraits = MakerTraits.default()
      .withExpiration(expiration)
      .withNonce(nonce)
      .allowPartialFills()
      .allowMultipleFills();

    const order = await sdk.createOrder(
      {
        makerAsset: new Address(MAKER_ASSET),
        takerAsset: new Address(TAKER_ASSET),
        makingAmount: makingAmountBigInt,
        takingAmount: takingAmountBigInt,
        maker: new Address(userWallet),
        receiver: new Address(userWallet),
      },
      makerTraits
    );

    const orderHash = order.getOrderHash(fromChainId);
    const typedData = order.getTypedData();

    console.log("✍️  Signing order with SDK's EIP-712 data...");
    console.log('🔗 Order Hash:', orderHash);
    console.log('🔗 Order Hash type:', typeof orderHash);

    // Ensure domain has the correct chainId for signature validation
    const domain = {
      ...typedData.domain,
      chainId: parseInt(fromChainId),
    };

    // Use the complete types structure from SDK
    const types = typedData.types;

    const orderData = order.build();

    // Get extension data separately
    let extensionData = '0x';

    const extensionObject = order.extension;
    if (extensionObject && typeof extensionObject.encode === 'function') {
      extensionData = extensionObject.encode();
    } else if (
      extensionObject &&
      typeof extensionObject.toString === 'function'
    ) {
      extensionData = extensionObject.toString();
    }

    console.log('📦 Order data prepared:', {
      orderHash,
      nonce: nonce.toString(),
      expiration: expiration.toString(),
      extensionData,
    });

    res.json({
      orderHash,
      orderData,
      extensionData,
      nonce: nonce.toString(),
      expiration: expiration.toString(),
      domain,
      types,
      typedDataMessage: typedData.message,
    });
  } catch (error) {
    console.error('❌ Error in create_order:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/finalize_order', async (req, res) => {
  try {
    // Expect body to provide these fields directly
    const {
      orderHash,
      orderData,
      extensionData,
      nonce,
      expiration,
      typedDataSignature,
      walletSignature,
    } = req.body;

    // Validate required fields
    if (!orderData || !nonce || !expiration) {
      return res.status(400).json({
        error:
          '/finalize_order: Missing required fields: orderData, nonce, expiration',
      });
    }

    // Validate signature format
    if (!typedDataSignature || !typedDataSignature.startsWith('0x')) {
      return res
        .status(400)
        .json({ error: '/finalize_order: Invalid signature format' });
    }

    console.log('/finalize_order: ✅ Processing order submission...');
    console.log('🔍 Signature validation:', {
      signatureLength: typedDataSignature.length,
      signaturePrefix: typedDataSignature.substring(0, 10) + '...',
    });

    // Build final API payload following 1inch format
    const orderObject = {
      orderHash: orderHash,
      signature: typedDataSignature,
      data: {
        makerAsset: orderData.makerAsset.toLowerCase(),
        takerAsset: orderData.takerAsset.toLowerCase(),
        salt: orderData.salt.toString(),
        receiver: orderData.receiver.toLowerCase(),
        makingAmount: orderData.makingAmount.toString(),
        takingAmount: orderData.takingAmount.toString(),
        maker: orderData.maker.toLowerCase(),
        extension: extensionData,
        makerTraits:
          '0x' + BigInt(orderData.makerTraits).toString(16).padStart(64, '0'),
      },
    };

    console.log('\n📋 Complete Order Data for HTTP Testing:');
    console.log(JSON.stringify(orderObject, null, 2));

    // Validate order structure
    console.log('🔍 Order validation:', {
      orderHashLength: orderHash.length,
      signatureLength: typedDataSignature.length,
      extensionLength: extensionData.length,
      makerTraitsLength: orderObject.data.makerTraits.length,
    });

    let orderResult = null;
    try {
      orderResult = await submitOrder(
        orderHash,
        orderData,
        extensionData,
        typedDataSignature
      );
      console.log('✅ Order submitted successfully to 1inch API');
    } catch (err) {
      console.error('❌ Error submitting order to 1inch API:', err);
      throw err; // Re-throw to handle in the response
    }

    // Store bid in database with order information
    const { data: bidData, error: bidError } = await supabaseClient
      .from('private_bids')
      .insert({
        launch_id: launchId,
        user_wallet: orderData.maker,
        price,
        quantity,
        taker_asset: orderData.takerAsset,
        auction_end_time: new Date().toISOString(),
        status: 'submitted',
        order_hash: orderHash,
        submitted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (bidError) {
      logEvent('ERROR', 'Failed to store bid in database', bidError);
      throw new Error(`Database error: ${bidError.message}`);
    }

    // Store detailed order information with IOrderMixin structure
    const { error: orderError } = await supabaseClient
      .from('limit_orders')
      .insert({
        bid_id: bidData.id,
        order_hash: orderResult.orderHash,
        maker_address: orderData.maker,
        maker_asset: CONTRACTS.USDC,
        taker_asset: orderData.takerAsset,
        making_amount: orderData.makingAmount,
        taking_amount: orderData.takingAmount,
        salt: orderData.salt,
        expiration: orderData.expiration,
        allowed_sender: CONTRACTS.AUCTION_CONTROLLER,
        order_data: orderResult,
        signature: typedDataSignature, // Store the signature for later execution
        status: 'active',
      });

    if (orderError) {
      logEvent('ERROR', 'Failed to store limit order', orderError);
    }

    logEvent(
      'INFO',
      'Bid order created successfully with IOrderMixin structure',
      {
        bidId: bidData.id,
        orderHash: orderResult.orderHash,
      }
    );

    res.json({
      bidId: bidData.id,
      orderHash: orderResult.orderHash,
      orderId: orderResult.orderId,
      orderData: orderResult.data,
      success: true,
    });
  } catch (error) {
    console.error('❌ Error in finalize_order:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/sync_order_status', async (req, res) => {
  const { orderHash } = req.query;
  const { error, result } = await getOrderStatus(orderHash);
  if (error || !result) {
    console.error('❌ Error in sync_order_status:', error);
    res.status(500).json({ error: error });
  }
  console.log('🔍 Order status:', result);

  // Update local database
  const { error: updateError } = await supabaseClient
    .from('limit_orders')
    .update({
      status: result.status,
      filled_amount: result.filledAmount || 0,
      updated_at: new Date().toISOString(),
    })
    .eq('order_hash', orderHash);

  if (updateError) {
    console.error('❌ Error in sync_order_status:', updateError);
  }

  res.json(result);
});

app.post('/settle_auction', async (req, res) => {
  const { launchId } = req.body;
  const { error, result } = await settleAuction(supabaseClient, launchId);
  if (error || !result) {
    console.error('❌ Error in settle_auction:', error);
    res.status(500).json({ error: error });
  }
  res.json(result);
});

app.post('/execute_order', async (req, res) => {
  try {
    const { orderHash } = req.body;

    if (!orderHash) {
      return res.status(400).json({ error: 'Missing orderHash parameter' });
    }

    // Get order details from database
    const { data: order, error: orderError } = await supabaseClient
      .from('limit_orders')
      .select('*')
      .eq('order_hash', orderHash)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    console.log('🚀 Executing order:', orderHash);

    const { error, result } = await executeOrder(
      orderHash,
      order.order_data,
      order.signature
    );

    if (error) {
      console.error('❌ Error executing order:', error);
      return res.status(500).json({ error });
    }

    // Update order status
    await supabaseClient
      .from('limit_orders')
      .update({
        status: 'filled',
        filled_at: new Date().toISOString(),
        execution_tx_hash: result.txHash,
      })
      .eq('order_hash', orderHash);

    res.json({
      success: true,
      txHash: result.txHash,
      message:
        'Order executed successfully - funds have been transferred from your wallet!',
    });
  } catch (error) {
    console.error('❌ Error in execute_order:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/orders', async (req, res) => {
  try {
    const { launchId } = req.query;

    if (!launchId) {
      return res.status(400).json({ error: 'Missing launchId parameter' });
    }

    // Get orders for this launch
    const { data: orders, error: ordersError } = await supabaseClient
      .from('limit_orders')
      .select(
        `
        order_hash,
        status,
        maker_address,
        making_amount,
        taking_amount,
        created_at,
        filled_at,
        execution_tx_hash
      `
      )
      .eq('private_bids.launch_id', launchId)
      .order('created_at', { ascending: false });

    if (ordersError) {
      console.error('❌ Error fetching orders:', ordersError);
      return res.status(500).json({ error: ordersError.message });
    }

    res.json({ orders: orders || [] });
  } catch (error) {
    console.error('❌ Error in /orders:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/fill_private_order', async (req, res) => {
  try {
    const {
      orderHash,
      maker,
      makerAsset,
      takerAsset,
      makingAmount,
      takingAmount,
      orderData,
      signature,
    } = req.body;

    if (
      !orderHash ||
      !maker ||
      !makerAsset ||
      !takerAsset ||
      !makingAmount ||
      !takingAmount
    ) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Get private key from environment
    const privateKey = process.env.RESOLVER_PRIVATE_KEY;
    if (!privateKey) {
      return res
        .status(500)
        .json({ error: 'RESOLVER_PRIVATE_KEY not configured' });
    }

    console.log('🚀 Filling private auction order:', orderHash);

    const { error, result } = await fillPrivateAuctionOrder(
      orderHash,
      maker,
      makerAsset,
      takerAsset,
      BigInt(makingAmount),
      BigInt(takingAmount),
      orderData,
      signature,
      privateKey
    );

    if (error) {
      console.error('❌ Error filling private order:', error);
      return res.status(500).json({ error });
    }

    res.json({
      success: true,
      txHash: result.txHash,
      message:
        'Private auction order filled successfully - funds have been transferred!',
    });
  } catch (error) {
    console.error('❌ Error in /fill_private_order:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/batch_fill_private_orders', async (req, res) => {
  try {
    const { orders } = req.body;

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid orders array' });
    }

    // Get private key from environment
    const privateKey = process.env.RESOLVER_PRIVATE_KEY;
    if (!privateKey) {
      return res
        .status(500)
        .json({ error: 'RESOLVER_PRIVATE_KEY not configured' });
    }

    console.log('🚀 Batch filling private auction orders:', orders.length);

    const { error, result } = await fillBatchPrivateAuctionOrders(
      orders,
      privateKey
    );

    if (error) {
      console.error('❌ Error batch filling private orders:', error);
      return res.status(500).json({ error });
    }

    res.json({
      success: true,
      txHash: result.txHash,
      orderCount: result.orderCount,
      message: `Successfully filled ${result.orderCount} private auction orders!`,
    });
  } catch (error) {
    console.error('❌ Error in /batch_fill_private_orders:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/order_status/:orderHash', async (req, res) => {
  try {
    const { orderHash } = req.params;

    if (!orderHash) {
      return res.status(400).json({ error: 'Missing orderHash parameter' });
    }

    console.log('🔍 Checking order status:', orderHash);

    const { error, result } = await isOrderFilled(orderHash);

    if (error) {
      console.error('❌ Error checking order status:', error);
      return res.status(500).json({ error });
    }

    res.json({
      orderHash,
      isFilled: result.isFilled,
    });
  } catch (error) {
    console.error('❌ Error in /order_status/:orderHash:', error);
    res.status(500).json({ error: error.message });
  }
});

// Private Bids API Endpoints

app.post('/create_private_bid', async (req, res) => {
  try {
    const {
      launchId,
      userWallet,
      price,
      quantity,
      takerAsset,
      auctionEndTime,
    } = req.body;

    if (
      !launchId ||
      !userWallet ||
      !price ||
      !quantity ||
      !takerAsset ||
      !auctionEndTime
    ) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log('📋 Creating private bid:', {
      launchId,
      userWallet,
      price,
      quantity,
    });

    const { error, result } = await createPrivateBid(supabaseClient, {
      launchId,
      userWallet,
      price,
      quantity,
      takerAsset,
      auctionEndTime,
    });

    if (error) {
      console.error('❌ Error creating private bid:', error);
      return res.status(500).json({ error });
    }

    res.json({
      success: true,
      bidId: result.bidId,
      status: result.status,
      message: result.message,
    });
  } catch (error) {
    console.error('❌ Error in /create_private_bid:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/submit_pending_bids', async (req, res) => {
  try {
    const { launchId } = req.body;

    if (!launchId) {
      return res.status(400).json({ error: 'Missing launchId parameter' });
    }

    console.log('🚀 Submitting pending bids for launch:', launchId);

    const { error, result } = await submitPendingBidsTo1inch(
      supabaseClient,
      launchId
    );

    if (error) {
      console.error('❌ Error submitting pending bids:', error);
      return res.status(500).json({ error });
    }

    res.json({
      success: true,
      submittedCount: result.submittedCount,
      submittedBids: result.submittedBids,
      message: result.message,
    });
  } catch (error) {
    console.error('❌ Error in /submit_pending_bids:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/private_bids/:launchId', async (req, res) => {
  try {
    const { launchId } = req.params;

    if (!launchId) {
      return res.status(400).json({ error: 'Missing launchId parameter' });
    }

    console.log('📋 Getting private bids for launch:', launchId);

    const { error, result } = await getPrivateBids(supabaseClient, launchId);

    if (error) {
      console.error('❌ Error getting private bids:', error);
      return res.status(500).json({ error });
    }

    res.json({
      success: true,
      bids: result.bids,
    });
  } catch (error) {
    console.error('❌ Error in /private_bids/:launchId:', error);
    res.status(500).json({ error: error.message });
  }
});

// Multi-token bidding endpoints
app.post('/create_multi_token_bid', async (req, res) => {
  try {
    const result = await createMultiTokenBid(supabaseClient, req.body);
    
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.result);
  } catch (error) {
    console.error('Error creating multi-token bid:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/settle_multi_token_auction', async (req, res) => {
  try {
    const { launchId, useBatchExecution = false } = req.body;
    
    if (!launchId) {
      return res.status(400).json({ error: 'Launch ID is required' });
    }

    console.log('🔄 Starting smart contract multi-token auction settlement for:', launchId);

    // Phase 1: Determine winners using existing logic (no token conversion)
    const winnerSelection = await settleMultiTokenAuction(supabaseClient, launchId);
    
    if (winnerSelection.error) {
      return res.status(400).json({ error: winnerSelection.error });
    }

    const { winningBids, losingBids } = winnerSelection.result;

    if (winningBids === 0) {
      return res.json({ 
        message: 'No winning bids to execute',
        totalBids: winnerSelection.result.totalBids,
        winningBids: 0,
        losingBids: winnerSelection.result.losingBids,
      });
    }

    // Phase 2: Get winning bid details from database
    const { data: winningBidDetails, error: bidsError } = await supabaseClient
      .from('multi_token_bids')
      .select('*')
      .eq('launch_id', launchId)
      .eq('status', 'winning'); // Assumes winner selection marks bids as 'winning'

    if (bidsError || !winningBidDetails || winningBidDetails.length === 0) {
      return res.status(400).json({ error: 'Could not fetch winning bid details' });
    }

    // Phase 3: Get auction token address
    const { data: launch, error: launchError } = await supabaseClient
      .from('launches')
      .select('token_address')
      .eq('id', launchId)
      .single();

    if (launchError || !launch?.token_address) {
      return res.status(400).json({ error: 'Could not fetch auction token address' });
    }

    // Phase 4: Execute smart contract settlement
    let executionResult;
    
    if (useBatchExecution && winningBidDetails.length > 1) {
      console.log('📦 Using batch execution for', winningBidDetails.length, 'winning bids');
      executionResult = await batchExecuteWinningBids(winningBidDetails, launch.token_address);
    } else {
      console.log('⚡ Using individual execution for', winningBidDetails.length, 'winning bids');
      executionResult = await executeWinningBidsWithSmartContract(winningBidDetails, launch.token_address);
    }

    // Phase 5: Update database with execution results
    for (const executedBid of executionResult.executedBids || executionResult) {
      await supabaseClient
        .from('multi_token_bids')
        .update({
          status: 'executed',
          conversion_tx_hash: executedBid.txHash,
          conversion_method: executedBid.conversionMethod,
          executed_at: new Date().toISOString(),
        })
        .eq('id', executedBid.id);
    }

    console.log('✅ Smart contract multi-token auction settled successfully:', {
      launchId,
      totalBids: winnerSelection.result.totalBids,
      winners: winningBidDetails.length,
      losers: winnerSelection.result.losingBids,
      executedBids: executionResult.executedBids?.length || executionResult.length,
      batchExecution: useBatchExecution,
    });

    res.json({
      settledBids: executionResult.executedBids?.length || executionResult.length,
      clearingPrice: winnerSelection.result.clearingPrice,
      totalBids: winnerSelection.result.totalBids,
      winningBids: winningBidDetails.length,
      losingBids: winnerSelection.result.losingBids,
      executionTxHash: executionResult.txHash,
      usedBatchExecution: useBatchExecution,
    });
  } catch (error) {
    console.error('❌ Error settling multi-token auction with smart contract:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Intent-based bidding endpoints (works with ANY token!)
app.post('/create_intent_bid', async (req, res) => {
  try {
    console.log('🎯 Creating intent-based bid...');
    const result = await createIntentBid(supabaseClient, req.body);
    
    if (result.error) {
      console.error('❌ Intent bid creation failed:', result.error);
      return res.status(400).json({ error: result.error });
    }

    console.log('✅ Intent bid created successfully');
    res.json(result.result);
  } catch (error) {
    console.error('❌ Error creating intent bid:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/settle_intent_auction', async (req, res) => {
  try {
    const { launchId } = req.body;
    
    if (!launchId) {
      return res.status(400).json({ error: 'Launch ID is required' });
    }

    console.log('🎯 Starting intent-based auction settlement for:', launchId);

    const result = await settleIntentAuction(supabaseClient, launchId);
    
    if (result.error) {
      console.error('❌ Intent auction settlement failed:', result.error);
      return res.status(400).json({ error: result.error });
    }

    console.log('✅ Intent auction settled successfully');
    res.json({ 
      message: 'Intent-based auction settled successfully',
      ...result.result,
    });
  } catch (error) {
    console.error('❌ Error settling intent auction:', error);
    res.status(500).json({ error: error.message });
  }
});

// Token prices endpoint for frontend
app.get('/token_prices', async (req, res) => {
  try {
    // Mock token prices for now - in production, fetch from 1inch price API
    const mockPrices = {
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 1.0,    // USDC
      '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 3200.0, // WETH
      '0x912ce59144191c1204e64559fe8253a0e49e6548': 0.85,   // ARB
      '0xf97f4df75117a78c1a5a0dbb814af92458539fb4': 14.50,  // LINK
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 1.0,    // USDT
    };
    
    res.json(mockPrices);
  } catch (error) {
    console.error('Error fetching token prices:', error);
    res.status(500).json({ error: 'Failed to fetch token prices' });
  }
});

app.post('/cancel_private_bid', async (req, res) => {
  try {
    const { bidId, userWallet } = req.body;

    if (!bidId || !userWallet) {
      return res.status(400).json({ error: 'Missing bidId or userWallet' });
    }

    console.log('❌ Cancelling private bid:', { bidId, userWallet });

    const { error, result } = await cancelPrivateBid(
      supabaseClient,
      bidId,
      userWallet
    );

    if (error) {
      console.error('❌ Error cancelling private bid:', error);
      return res.status(500).json({ error });
    }

    res.json({
      success: true,
      bidId: result.bidId,
      status: result.status,
      message: result.message,
    });
  } catch (error) {
    console.error('❌ Error in /cancel_private_bid:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/settle_private_auction', async (req, res) => {
  try {
    const { launchId } = req.body;

    if (!launchId) {
      return res.status(400).json({ error: 'Missing launchId parameter' });
    }

    console.log('🚀 Settling resolver fusion auction:', launchId);

    // Use the new resolver fusion settlement process
    const { error: settleError, result: settleResult } = await settleResolverFusionAuction(
      supabaseClient,
      launchId
    );

    if (settleError) {
      console.error('❌ Error settling resolver fusion auction:', settleError);
      return res.status(500).json({ error: settleError });
    }

    res.json({
      success: true,
      totalBids: settleResult.totalBids,
      winningBids: settleResult.winningBids,
      settledBids: settleResult.settledBids,
      clearingPrice: settleResult.clearingPrice,
      message: `Resolver fusion auction settled successfully. ${settleResult.settledBids} bids settled with clearing price ${settleResult.clearingPrice}.`,
    });
  } catch (error) {
    console.error('❌ Error in /settle_private_auction:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== DEBUGGING ENDPOINTS ==========

// Check launch statuses  
app.get('/debug/launches', async (req, res) => {
  try {
    const { data: launches, error } = await supabaseClient
      .from('launches')
      .select('id, token_name, token_symbol, status, is_launched, end_time, created_at')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json(launches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fix stuck auctions (manual override)
app.post('/debug/fix_auction_status', async (req, res) => {
  try {
    const { launchId, newStatus } = req.body;
    
    const { error } = await supabaseClient
      .from('launches')
      .update({ 
        status: newStatus,
        is_launched: newStatus === 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', launchId);
    
    if (error) throw error;
    
    res.json({ success: true, message: `Launch ${launchId} status updated to ${newStatus}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== RESOLVER FUSION AUCTION ENDPOINTS ==========

// Create fusion resolver bid
app.post('/create_fusion_resolver_bid', async (req, res) => {
  try {
    const {
      launchId,
      bidder,
      sourceToken,
      sourceAmount,
      auctionToken,
      expectedAuctionTokens,
      resolverAddress
    } = req.body;

    console.log('🎯 Creating Fusion resolver bid:', {
      launchId,
      bidder,
      sourceToken,
      sourceAmount,
      auctionToken,
      expectedAuctionTokens,
      resolverAddress
    });

    // For now, create a simplified Fusion order structure
    // In production, this would integrate with 1inch Fusion API
    const salt = Math.floor(Math.random() * 1000000);
    const orderHash = `0x${Buffer.from(`${bidder}-${sourceToken}-${sourceAmount}-${salt}`).toString('hex').slice(0, 64)}`;
    
    const fusionOrder = {
      domain: {
        name: '1inch Limit Order Protocol',
        version: '4',
        chainId: 42161,
        verifyingContract: '0x1111111254EEB25477B68fb85Ed929f73A960582'
      },
      types: {
        Order: [
          { name: 'salt', type: 'uint256' },
          { name: 'maker', type: 'address' },
          { name: 'receiver', type: 'address' },
          { name: 'makerAsset', type: 'address' },
          { name: 'takerAsset', type: 'address' },
          { name: 'makingAmount', type: 'uint256' },
          { name: 'takingAmount', type: 'uint256' },
          { name: 'makerTraits', type: 'uint256' }
        ]
      },
      message: {
        salt: salt.toString(),
        maker: bidder,
        receiver: resolverAddress, // KEY: Resolver gets the USDC
        makerAsset: sourceToken,
        takerAsset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
        makingAmount: sourceAmount,
        takingAmount: Math.floor(parseFloat(sourceAmount) * 0.98).toString(), // 2% slippage
        makerTraits: '0'
      }
    };

    res.json({
      fusionOrder,
      orderHash,
      message: 'Fusion order created successfully'
    });

  } catch (error) {
    console.error('❌ Error creating fusion resolver bid:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit signed fusion resolver bid
app.post('/submit_fusion_resolver_bid', async (req, res) => {
  try {
    console.log('📥 Received bid submission request:', JSON.stringify(req.body, null, 2));
    
    const {
      launchId,
      bidder,
      sourceToken,
      sourceAmount,
      auctionToken,
      targetPricePerToken,
      expectedAuctionTokens,
      fusionOrder,
      orderHash,
      signature,
      resolverAddress
    } = req.body;

    console.log('📝 Submitting signed Fusion resolver bid:', {
      launchId,
      bidder,
      sourceToken,
      sourceAmount,
      auctionToken,
      targetPricePerToken,
      expectedAuctionTokens,
      orderHash,
      signature: signature.slice(0, 20) + '...',
      resolverAddress
    });

    console.log('🔄 Mapping parameters for createResolverFusionBid...');
    
    const mappedData = {
      launchId,
      userWallet: bidder,
      bidTokenAddress: sourceToken,
      bidTokenAmount: sourceAmount,
      bidTokenSymbol: getTokenSymbol(sourceToken), // Get actual token symbol
      auctionTokenAddress: auctionToken,
      maxAuctionTokens: expectedAuctionTokens,
      maxEffectivePriceUSDC: targetPricePerToken || '0',
      fusionOrder,
      fusionSignature: signature,
      resolverAddress
    };
    
    console.log('🗂️ Mapped data:', JSON.stringify(mappedData, null, 2));
    
    const result = await createResolverFusionBid(supabaseClient, mappedData);

    if (result.error) {
      console.error('❌ Error storing resolver fusion bid:', result.error);
      return res.status(400).json({ error: result.error });
    }

    console.log('✅ Resolver fusion bid stored successfully');
    res.json({
      message: 'Resolver fusion bid submitted successfully',
      bidId: result.result.bidId
    });

  } catch (error) {
    console.error('❌ Error submitting resolver fusion bid:', error);
    res.status(500).json({ error: error.message });
  }
});

// Token prices endpoint (POST variant for frontend)
app.post('/token_prices', async (req, res) => {
  try {
    const { tokenAddress, amount } = req.body;
    
    console.log('💰 Price request for:', { tokenAddress, amount });
    
    if (!tokenAddress || !amount) {
      return res.status(400).json({ error: 'Missing tokenAddress or amount' });
    }

    const normalizedAddress = tokenAddress.toLowerCase();
    const USDC_ADDRESS = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
    
    // If requesting USDC price, return 1:1
    if (normalizedAddress === USDC_ADDRESS) {
      const usdcValue = parseFloat(amount).toFixed(2);
      return res.json({
        tokenAddress: normalizedAddress,
        amount,
        pricePerToken: 1.0,
        usdcValue
      });
    }

    try {
      // Use 1inch price API for real prices
      const priceUrl = `https://api.1inch.dev/price/v1.1/${fromChainId}/${normalizedAddress}?currency=USD`;
      
      console.log('🔍 Fetching price from 1inch:', priceUrl);
      
      const priceResponse = await fetch(priceUrl, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Accept': 'application/json',
        },
      });

      if (priceResponse.ok) {
        const priceData = await priceResponse.json();
        console.log('📊 1inch price data:', priceData);
        
        const pricePerToken = parseFloat(priceData[normalizedAddress] || 0);
        const usdcValue = (parseFloat(amount) * pricePerToken).toFixed(2);
        
        return res.json({
          tokenAddress: normalizedAddress,
          amount,
          pricePerToken,
          usdcValue,
          source: '1inch_api'
        });
      } else {
        console.warn('⚠️ 1inch API failed, falling back to mock prices');
        // Fall back to mock prices if 1inch API fails
      }
    } catch (apiError) {
      console.warn('⚠️ 1inch API error, falling back to mock:', apiError.message);
    }

    // Fallback mock prices for testing
    const mockPrices = {
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 1.0,    // USDC
      '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 3200.0, // WETH
      '0x912ce59144191c1204e64559fe8253a0e49e6548': 0.85,   // ARB
      '0xf97f4df75117a78c1a5a0dbb814af92458539fb4': 14.50,  // LINK
      '0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0': 8.5,    // UNI
    };
    
    const pricePerToken = mockPrices[normalizedAddress] || 0;
    const usdcValue = (parseFloat(amount) * pricePerToken).toFixed(2);
    
    console.log('💰 Calculated price:', { pricePerToken, usdcValue, source: 'mock' });
    
    res.json({
      tokenAddress: normalizedAddress,
      amount,
      pricePerToken,
      usdcValue,
      source: 'mock_fallback'
    });

  } catch (error) {
    console.error('❌ Error calculating token price:', error);
    res.status(500).json({ error: error.message });
  }
});

// Settle resolver fusion auction
app.post('/settle_fusion_resolver_auction', async (req, res) => {
  try {
    const { launchId } = req.body;

    if (!launchId) {
      return res.status(400).json({ error: 'Missing launchId parameter' });
    }

    console.log('🚀 Settling resolver fusion auction:', launchId);

    const result = await settleResolverFusionAuction(supabaseClient, launchId);

    if (result.error) {
      console.error('❌ Resolver fusion auction settlement failed:', result.error);
      return res.status(400).json({ error: result.error });
    }

    console.log('✅ Resolver fusion auction settled successfully');
    res.json({
      message: 'Resolver fusion auction settled successfully',
      ...result.result
    });

  } catch (error) {
    console.error('❌ Error settling resolver fusion auction:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
