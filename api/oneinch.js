const ONE_INCH_BASE_URL = 'https://api.1inch.dev/orderbook/v4.0';
const CHAIN_ID = '42161';
const ONE_INCH_API_KEY = process.env.VITE_ONE_INCH_API_KEY;

const logEvent = (level, message, data) => {
  console.log(
    `[${level}] ${new Date().toISOString()} - ${message}`,
    data ? JSON.stringify(data) : ''
  );
};

const submitOrder = async (orderHash, orderData, extension, signature) => {
  const reqObj = {
    orderHash,
    signature,
    data: {
      makerAsset: orderData.makerAsset.toLowerCase(),
      takerAsset: orderData.takerAsset.toLowerCase(),
      salt: orderData.salt.toString(),
      receiver: orderData.receiver.toLowerCase(),
      makingAmount: orderData.makingAmount.toString(),
      takingAmount: orderData.takingAmount.toString(),
      maker: orderData.maker.toLowerCase(),
      extension: extension,
      makerTraits:
        '0x' + BigInt(orderData.makerTraits).toString(16).padStart(64, '0'),
    },
  };
  console.log('📤 Submitting to 1inch API:', JSON.stringify(reqObj, null, 2));
  const response = await new FetchProviderConnector().post(
    `${ONE_INCH_BASE_URL}/${CHAIN_ID}`,
    reqObj,
    { Authorization: `Bearer ${ONE_INCH_API_KEY}` }
  );
  const resultString = await response.text();
  console.log('🔍 Response:', resultString);
  const result = JSON.parse(resultString);
  return result;
};

const {
  fillPrivateAuctionOrder,
  fillBatchPrivateAuctionOrders,
  isOrderFilled,
} = require('./resolver');

const executeOrder = async (orderHash, orderData, signature) => {
  try {
    logEvent('INFO', 'Executing private auction order with resolver', {
      orderHash,
    });

    // Get private key from environment (for authorized filler)
    const privateKey = process.env.RESOLVER_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('RESOLVER_PRIVATE_KEY not found in environment');
    }

    // Extract order details
    const maker = orderData.maker;
    const makerAsset = orderData.makerAsset;
    const takerAsset = orderData.takerAsset;
    const makingAmount = BigInt(orderData.makingAmount);
    const takingAmount = BigInt(orderData.takingAmount);

    logEvent('INFO', 'Filling private auction order', {
      orderHash,
      maker,
      makingAmount: makingAmount.toString(),
      takingAmount: takingAmount.toString(),
    });

    const { error, result } = await fillPrivateAuctionOrder(
      orderHash,
      maker,
      makerAsset,
      takerAsset,
      makingAmount,
      takingAmount,
      JSON.stringify(orderData),
      signature,
      privateKey
    );

    if (error) {
      logEvent('ERROR', 'Failed to fill private auction order', {
        error,
        orderHash,
      });
      return { error, result: null };
    }

    logEvent('INFO', 'Private auction order filled successfully', {
      orderHash,
      txHash: result.txHash,
    });

    return { error: null, result };
  } catch (error) {
    logEvent('ERROR', 'Failed to execute private auction order', {
      error: error.message,
      orderHash,
    });
    return { error: error.message, result: null };
  }
};

const getOrderStatus = async orderHash => {
  try {
    logEvent('INFO', 'Fetching order status from 1inch', { orderHash });
    const response = await fetch(
      `${ONE_INCH_BASE_URL}/${CHAIN_ID}/order/${orderHash}`,
      {
        headers: {
          Authorization: `Bearer ${ONE_INCH_API_KEY}`,
          Accept: 'application/json',
        },
      }
    );
    const resultString = await response.text();
    console.log('🔍 Response:', resultString);
    const result = JSON.parse(resultString);
    if (!response.ok) {
      if (response.status === 404) {
        logEvent('WARN', 'Order not found on 1inch', { orderHash });
      }
      return {
        error: response.statusText,
        result: null,
      };
    }

    logEvent('INFO', 'Order status fetched successfully', {
      orderHash,
      status: result.status,
    });
    return { error: null, result };
  } catch (error) {
    logEvent('ERROR', 'Failed to fetch order status', {
      error: error.message,
      orderHash,
    });
    return {
      error: error.message,
      result: null,
    };
  }
};

const settleAuction = async (supabaseClient, launchId) => {
  try {
    logEvent('INFO', 'Settling auction', { launchId });

    // Get launch details
    const { data: launch, error: launchError } = await supabaseClient
      .from('launches')
      .select('*')
      .eq('id', launchId)
      .single();

    if (launchError || !launch) {
      throw new Error(`Launch not found: ${launchId}`);
    }

    // Get all active orders for this launch that need to be executed
    const { data: activeOrders, error: ordersError } = await supabaseClient
      .from('limit_orders')
      .select(
        `
        *,
        bids!inner(launch_id)
      `
      )
      .eq('bids.launch_id', launchId)
      .eq('status', 'active');

    if (ordersError) {
      logEvent('ERROR', 'Failed to fetch active orders', ordersError);
    }

    // STEP 1: Calculate clearing price first
    const { data: clearingResult, error: clearingError } =
      await supabaseClient.rpc('calculate_clearing_price', {
        p_launch_id: launchId,
        p_target_allocation: launch.target_allocation,
      });

    if (clearingError) {
      throw new Error(
        `Failed to calculate clearing price: ${clearingError.message}`
      );
    }

    const { clearing_price, filled_quantity, successful_bids_count } =
      clearingResult[0];

    logEvent('INFO', 'Clearing price calculated', {
      clearingPrice: clearing_price,
      filledQuantity: filled_quantity,
      successfulBids: successful_bids_count,
    });

    // STEP 2: Execute 1inch orders that meet the clearing price
    let executedOrders = 0;
    let totalExecutedAmount = 0;

    if (activeOrders && activeOrders.length > 0) {
      logEvent(
        'INFO',
        `Processing ${activeOrders.length} private auction bids for launch ${launchId}`
      );

      // Sort orders by price (highest first) to match smart contract logic
      const sortedOrders = activeOrders.sort((a, b) => {
        const priceA =
          parseFloat(a.making_amount) / parseFloat(a.taking_amount);
        const priceB =
          parseFloat(b.making_amount) / parseFloat(b.taking_amount);
        return priceB - priceA;
      });

      for (const order of sortedOrders) {
        try {
          const orderPrice =
            parseFloat(order.making_amount) / parseFloat(order.taking_amount);

          // Execute orders that meet or exceed the clearing price
          if (orderPrice >= clearing_price) {
            logEvent(
              'INFO',
              `Executing private auction bid ${order.order_hash} at price ${orderPrice} (clearing: ${clearing_price})`
            );

            const { error: execError, result: execResult } = await executeOrder(
              order.order_hash,
              order.order_data,
              order.signature
            );

            if (!execError && execResult) {
              executedOrders++;
              totalExecutedAmount += parseFloat(order.taking_amount);

              // Update order status to 'filled' so smart contract recognizes it
              await supabaseClient
                .from('limit_orders')
                .update({
                  status: 'filled',
                  filled_at: new Date().toISOString(),
                  execution_tx_hash: execResult.txHash,
                })
                .eq('order_hash', order.order_hash);

              // Update corresponding bid status
              await supabaseClient
                .from('bids')
                .update({
                  order_status: 'filled',
                  filled_amount: order.taking_amount,
                })
                .eq('order_hash', order.order_hash);

              logEvent(
                'INFO',
                `Private auction bid ${order.order_hash} executed successfully`,
                {
                  txHash: execResult.txHash,
                  price: orderPrice,
                  amount: order.taking_amount,
                }
              );
            } else {
              logEvent(
                'ERROR',
                `Failed to execute private auction bid ${order.order_hash}`,
                execError
              );
            }
          } else {
            logEvent(
              'INFO',
              `Private auction bid ${order.order_hash} below clearing price (${orderPrice} < ${clearing_price}), cancelling`
            );

            // Mark as cancelled
            await supabaseClient
              .from('limit_orders')
              .update({
                status: 'cancelled',
                cancelled_at: new Date().toISOString(),
              })
              .eq('order_hash', order.order_hash);

            // Update corresponding bid status
            await supabaseClient
              .from('bids')
              .update({
                order_status: 'cancelled',
              })
              .eq('order_hash', order.order_hash);
          }
        } catch (orderError) {
          logEvent(
            'ERROR',
            `Error processing private auction bid ${order.order_hash}`,
            orderError
          );
        }
      }
    }

    // Update launch with settlement results
    const { error: updateLaunchError } = await supabaseClient
      .from('launches')
      .update({
        status: 'completed',
        is_launched: true,
        clearing_price,
        total_raised: clearing_price * filled_quantity,
      })
      .eq('id', launchId);

    if (updateLaunchError) {
      throw new Error(`Failed to update launch: ${updateLaunchError.message}`);
    }

    // Record settlement
    const { error: settlementError } = await supabaseClient
      .from('auction_settlements')
      .insert({
        launch_id: launchId,
        clearing_price,
        total_filled_quantity: filled_quantity,
        total_raised_amount: clearing_price * filled_quantity,
        successful_bids_count,
        executed_orders_count: executedOrders,
        total_executed_amount: totalExecutedAmount,
      });

    if (settlementError) {
      logEvent('WARN', 'Failed to record settlement', settlementError);
    }

    logEvent('INFO', 'Private auction settlement completed', {
      launchId,
      clearingPrice: clearing_price,
      filledQuantity: filled_quantity,
      successfulBids: successful_bids_count,
      executedOrders,
      totalExecutedAmount,
    });

    return {
      error: null,
      result: {
        success: true,
        clearingPrice: clearing_price,
        filledQuantity: filled_quantity,
        successfulBids: successful_bids_count,
        executedOrders,
        totalExecutedAmount,
        message: `Successfully executed ${executedOrders} private auction bids. Funds have been transferred from winning bidders' wallets.`,
      },
    };
  } catch (error) {
    logEvent('ERROR', 'Failed to settle auction', {
      error: error.message,
      launchId,
    });
    return {
      error: error.message,
      result: null,
    };
  }
};

module.exports = {
  getOrderStatus,
  submitOrder,
  executeOrder,
  settleAuction,
};
