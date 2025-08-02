const { ethers } = require('ethers');

require('dotenv').config({ path: '../.env.local' });

const CONTRACTS = {
  USDC: process.env.USDC_ADDRESS ?? '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  AUCTION_CONTROLLER: process.env.AUCTION_CONTROLLER_ADDRESS,
};

const CHAIN_ID = process.env.VITE_CHAIN_ID;
const PRIVATE_KEY = process.env.RESOLVER_PRIVATE_KEY;

const logEvent = (level, message, data) => {
  console.log(
    `[${level}] ${new Date().toISOString()} - ${message}`,
    data ? JSON.stringify(data) : ''
  );
};

/**
 * Execute permit-based auction settlement
 * This function reveals bids, sorts them, and executes winning bids using permit signatures
 */
const executePermitBasedSettlement = async (supabaseClient, launchId) => {
  try {
    logEvent('INFO', 'Starting permit-based auction settlement', { launchId });

    // Get all pending bids for this launch
    const { data: pendingBids, error: bidsError } = await supabaseClient
      .from('private_bids')
      .select('*')
      .eq('launch_id', launchId)
      .eq('status', 'pending')
      .order('price', { ascending: false }); // Sort by price descending

    if (bidsError) {
      logEvent('ERROR', 'Failed to fetch pending bids', bidsError);
      throw new Error(`Database error: ${bidsError.message}`);
    }

    if (!pendingBids || pendingBids.length === 0) {
      logEvent('INFO', 'No pending bids found for settlement', { launchId });
      return { error: null, result: { settledBids: 0, clearingPrice: 0 } };
    }

    logEvent('INFO', `Found ${pendingBids.length} bids to process for settlement`);

    // Get launch details to determine target allocation
    const { data: launch, error: launchError } = await supabaseClient
      .from('launches')
      .select('*')
      .eq('id', launchId)
      .single();

    if (launchError || !launch) {
      throw new Error('Launch not found');
    }

    const targetAllocation = BigInt(launch.target_allocation);
    let remainingAllocation = targetAllocation;
    let totalRaised = 0;
    let clearingPrice = 0;
    const winningBids = [];

    // Process bids from highest price to lowest
    for (const bid of pendingBids) {
      if (remainingAllocation <= 0) break;

      const bidQuantity = BigInt(bid.quantity);
      const fillQuantity = bidQuantity > remainingAllocation ? remainingAllocation : bidQuantity;
      
      if (fillQuantity > 0) {
        winningBids.push({
          ...bid,
          fillQuantity: fillQuantity.toString(),
        });

        const bidValue = Number(fillQuantity) * bid.price;
        totalRaised += bidValue;
        clearingPrice = bid.price;
        remainingAllocation -= fillQuantity;

        logEvent('INFO', 'Bid selected for execution', {
          bidId: bid.id,
          price: bid.price,
          requestedQuantity: bid.quantity,
          fillQuantity: fillQuantity.toString(),
          bidder: bid.user_wallet,
        });
      }
    }

    logEvent('INFO', 'Settlement calculation completed', {
      totalBids: pendingBids.length,
      winningBids: winningBids.length,
      clearingPrice,
      totalRaised,
      targetAllocation: targetAllocation.toString(),
      remainingAllocation: remainingAllocation.toString(),
    });

    // Execute winning bids using permit signatures
    let executedBids = 0;
    for (const winningBid of winningBids) {
      try {
        await executePermitBid(winningBid);
        
        // Update bid status in database
        await supabaseClient
          .from('private_bids')
          .update({
            status: 'executed',
            filled_amount: winningBid.fillQuantity,
            executed_at: new Date().toISOString(),
          })
          .eq('id', winningBid.id);

        executedBids++;
        logEvent('INFO', 'Bid executed successfully', {
          bidId: winningBid.id,
          fillQuantity: winningBid.fillQuantity,
        });
      } catch (execError) {
        logEvent('ERROR', 'Failed to execute bid', {
          bidId: winningBid.id,
          error: execError.message,
        });

        // Mark bid as failed
        await supabaseClient
          .from('private_bids')
          .update({
            status: 'failed',
            error_message: execError.message,
          })
          .eq('id', winningBid.id);
      }
    }

    // Update launch status
    await supabaseClient
      .from('launches')
      .update({
        status: 'completed',
        is_launched: true,
        clearing_price: clearingPrice,
        total_raised: totalRaised,
        settled_at: new Date().toISOString(),
      })
      .eq('id', launchId);

    logEvent('INFO', 'Permit-based settlement completed', {
      launchId,
      executedBids,
      totalWinningBids: winningBids.length,
      clearingPrice,
      totalRaised,
    });

    return {
      error: null,
      result: {
        settledBids: executedBids,
        clearingPrice,
        totalRaised,
        winningBids: winningBids.length,
      },
    };
  } catch (error) {
    logEvent('ERROR', 'Settlement failed', {
      error: error.message,
      launchId,
    });
    return { error: error.message, result: null };
  }
};

/**
 * Execute a single bid using permit signature
 */
const executePermitBid = async (bid) => {
  // Setup provider and signer
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);

  // Auction Controller ABI (minimal for permit execution)
  const auctionControllerABI = [
    'function executePermitBid(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s, uint256 tokenAmount, address tokenAddress) external',
  ];

  const auctionController = new ethers.Contract(
    CONTRACTS.AUCTION_CONTROLLER,
    auctionControllerABI,
    signer
  );

  // Execute the permit and transfer in a single transaction
  const tx = await auctionController.executePermitBid(
    bid.permit_owner,
    bid.permit_spender,
    bid.permit_value,
    bid.permit_deadline,
    bid.permit_v,
    bid.permit_r,
    bid.permit_s,
    bid.fillQuantity,
    bid.taker_asset
  );

  const receipt = await tx.wait();
  logEvent('INFO', 'Permit bid executed on-chain', {
    txHash: receipt.hash,
    bidId: bid.id,
    gasUsed: receipt.gasUsed.toString(),
  });

  return receipt;
};

module.exports = {
  executePermitBasedSettlement,
  executePermitBid,
};