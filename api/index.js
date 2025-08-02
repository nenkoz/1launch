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
app.use(cors());

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

    console.log('🚀 Settling private auction:', launchId);

    // Step 1: Submit all pending bids to 1inch
    const { error: submitError, result: submitResult } =
      await submitPendingBidsTo1inch(supabaseClient, launchId);

    if (submitError) {
      console.error('❌ Error submitting pending bids:', submitError);
      return res.status(500).json({ error: submitError });
    }

    // Step 2: Settle the auction using the resolver
    const { error: settleError, result: settleResult } = await settleAuction(
      supabaseClient,
      launchId
    );

    if (settleError) {
      console.error('❌ Error settling auction:', settleError);
      return res.status(500).json({ error: settleError });
    }

    res.json({
      success: true,
      submittedBids: submitResult.submittedCount,
      executedOrders: settleResult.executedOrders,
      clearingPrice: settleResult.clearingPrice,
      message: `Private auction settled successfully. ${submitResult.submittedCount} bids submitted, ${settleResult.executedOrders} orders executed.`,
    });
  } catch (error) {
    console.error('❌ Error in /settle_private_auction:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
