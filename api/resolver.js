const { ethers } = require('ethers');
require('dotenv').config({ path: '../.env.local' });

const CONTRACTS = {
  USDC:
    process.env.USDC_ADDRESS ?? '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  AUCTION_RESOLVER: process.env.AUCTION_RESOLVER_ADDRESS,
};

const logEvent = (level, message, data) => {
  console.log(
    `[${level}] ${new Date().toISOString()} - ${message}`,
    data ? JSON.stringify(data) : ''
  );
};

/**
 * Fill a private auction order using your resolver contract
 */
const fillPrivateAuctionOrder = async (
  orderHash,
  maker,
  makerAsset,
  takerAsset,
  makingAmount,
  takingAmount,
  orderData,
  signature,
  privateKey
) => {
  try {
    logEvent('INFO', 'Filling private auction order with resolver', {
      orderHash,
    });

    // Setup provider and wallet
    const provider = new ethers.JsonRpcProvider(process.env.VITE_RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);

    // Get resolver contract
    const resolverAbi = [
      'function fillPrivateAuctionOrder(bytes32 orderHash, address maker, address makerAsset, address takerAsset, uint256 makingAmount, uint256 takingAmount, bytes calldata orderData, bytes calldata signature) external',
      'function isOrderFilled(bytes32 orderHash) external view returns (bool)',
      'function isAuthorizedFiller(address filler) external view returns (bool)',
    ];

    const resolver = new ethers.Contract(
      CONTRACTS.AUCTION_RESOLVER,
      resolverAbi,
      wallet
    );

    // Check if order already filled
    const isFilled = await resolver.isOrderFilled(orderHash);
    if (isFilled) {
      logEvent('WARN', 'Order already filled', { orderHash });
      return { error: 'Order already filled', result: null };
    }

    // Check if wallet is authorized
    const isAuthorized = await resolver.isAuthorizedFiller(wallet.address);
    if (!isAuthorized) {
      logEvent('ERROR', 'Wallet not authorized to fill orders', {
        wallet: wallet.address,
      });
      return { error: 'Wallet not authorized to fill orders', result: null };
    }

    // Fill the order
    logEvent('INFO', 'Executing fill transaction', {
      orderHash,
      maker,
      makingAmount: makingAmount.toString(),
      takingAmount: takingAmount.toString(),
    });

    const tx = await resolver.fillPrivateAuctionOrder(
      orderHash,
      maker,
      makerAsset,
      takerAsset,
      makingAmount,
      takingAmount,
      orderData,
      signature,
      { gasLimit: 500000 }
    );

    logEvent('INFO', 'Fill transaction sent', { txHash: tx.hash });

    // Wait for transaction
    const receipt = await tx.wait();

    if (receipt.status === 1) {
      logEvent('INFO', 'Private auction order filled successfully', {
        orderHash,
        txHash: tx.hash,
        gasUsed: receipt.gasUsed.toString(),
      });

      return {
        error: null,
        result: {
          success: true,
          txHash: tx.hash,
          gasUsed: receipt.gasUsed.toString(),
          orderHash,
        },
      };
    } else {
      logEvent('ERROR', 'Fill transaction failed', { txHash: tx.hash });
      return { error: 'Fill transaction failed', result: null };
    }
  } catch (error) {
    logEvent('ERROR', 'Failed to fill private auction order', {
      error: error.message,
      orderHash,
    });
    return { error: error.message, result: null };
  }
};

/**
 * Batch fill multiple private auction orders
 */
const fillBatchPrivateAuctionOrders = async (orders, privateKey) => {
  try {
    logEvent('INFO', 'Batch filling private auction orders', {
      orderCount: orders.length,
    });

    // Setup provider and wallet
    const provider = new ethers.JsonRpcProvider(process.env.VITE_RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);

    // Get resolver contract
    const resolverAbi = [
      'function fillBatchPrivateAuctionOrders(bytes32[] calldata orderHashes, address[] calldata makers, address[] calldata makerAssets, address[] calldata takerAssets, uint256[] calldata makingAmounts, uint256[] calldata takingAmounts, bytes[] calldata orderData, bytes[] calldata signatures) external',
    ];

    const resolver = new ethers.Contract(
      CONTRACTS.AUCTION_RESOLVER,
      resolverAbi,
      wallet
    );

    // Prepare batch data
    const orderHashes = orders.map(o => o.orderHash);
    const makers = orders.map(o => o.maker);
    const makerAssets = orders.map(o => o.makerAsset);
    const takerAssets = orders.map(o => o.takerAsset);
    const makingAmounts = orders.map(o => o.makingAmount);
    const takingAmounts = orders.map(o => o.takingAmount);
    const orderData = orders.map(o => o.orderData);
    const signatures = orders.map(o => o.signature);

    logEvent('INFO', 'Executing batch fill transaction', {
      orderCount: orders.length,
      orderHashes,
    });

    const tx = await resolver.fillBatchPrivateAuctionOrders(
      orderHashes,
      makers,
      makerAssets,
      takerAssets,
      makingAmounts,
      takingAmounts,
      orderData,
      signatures,
      { gasLimit: 2000000 } // Higher gas limit for batch
    );

    logEvent('INFO', 'Batch fill transaction sent', { txHash: tx.hash });

    // Wait for transaction
    const receipt = await tx.wait();

    if (receipt.status === 1) {
      logEvent('INFO', 'Batch private auction orders filled successfully', {
        orderCount: orders.length,
        txHash: tx.hash,
        gasUsed: receipt.gasUsed.toString(),
      });

      return {
        error: null,
        result: {
          success: true,
          txHash: tx.hash,
          gasUsed: receipt.gasUsed.toString(),
          orderCount: orders.length,
        },
      };
    } else {
      logEvent('ERROR', 'Batch fill transaction failed', { txHash: tx.hash });
      return { error: 'Batch fill transaction failed', result: null };
    }
  } catch (error) {
    logEvent('ERROR', 'Failed to batch fill private auction orders', {
      error: error.message,
    });
    return { error: error.message, result: null };
  }
};

/**
 * Check if an order has been filled
 */
const isOrderFilled = async orderHash => {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.VITE_RPC_URL);
    const resolver = new ethers.Contract(
      CONTRACTS.AUCTION_RESOLVER,
      [
        'function isOrderFilled(bytes32 orderHash) external view returns (bool)',
      ],
      provider
    );

    const isFilled = await resolver.isOrderFilled(orderHash);
    return { error: null, result: { isFilled } };
  } catch (error) {
    logEvent('ERROR', 'Failed to check order fill status', {
      error: error.message,
      orderHash,
    });
    return { error: error.message, result: null };
  }
};

module.exports = {
  fillPrivateAuctionOrder,
  fillBatchPrivateAuctionOrders,
  isOrderFilled,
};
