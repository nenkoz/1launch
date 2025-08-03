import { Address } from 'viem';

// Intent-based bid system that works with ANY token (no permit required)

export interface BidIntent {
  bidder: Address;
  bidToken: Address;           // LINK, ARB, WETH, etc.
  bidAmount: bigint;           // Amount in bid token
  auctionToken: Address;       // The token being auctioned
  maxAuctionTokens: bigint;    // Max auction tokens they want
  maxEffectivePrice: bigint;   // Max price per auction token in USDC (with 6 decimals)
  deadline: bigint;            // When this intent expires
  nonce: bigint;               // Unique nonce for this bidder
}

// EIP-712 domain for intent signatures
export const INTENT_DOMAIN = {
  name: '1Launch Intent System',
  version: '1',
  chainId: 42161, // Arbitrum
  verifyingContract: '0x0000000000000000000000000000000000000000' as Address, // Will be our intent contract
};

// EIP-712 types for bid intents
export const INTENT_TYPES = {
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

export const generateBidIntent = (
  bidder: Address,
  bidTokenAddress: Address,
  bidAmount: string,
  bidTokenDecimals: number,
  auctionTokenAddress: Address,
  maxAuctionTokens: string,
  maxEffectivePriceUSDC: number
): BidIntent => {
  const bidAmountWei = BigInt(Math.floor(parseFloat(bidAmount) * Math.pow(10, bidTokenDecimals)));
  const maxAuctionTokensWei = BigInt(maxAuctionTokens);
  const maxEffectivePriceWei = BigInt(Math.floor(maxEffectivePriceUSDC * 1e6)); // USDC has 6 decimals
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60); // 1 week
  const nonce = BigInt(Date.now()); // Simple nonce based on timestamp

  return {
    bidder,
    bidToken: bidTokenAddress,
    bidAmount: bidAmountWei,
    auctionToken: auctionTokenAddress,
    maxAuctionTokens: maxAuctionTokensWei,
    maxEffectivePrice: maxEffectivePriceWei,
    deadline,
    nonce,
  };
};

// Validate that a bid intent is properly formed
export const validateBidIntent = (intent: BidIntent): boolean => {
  return (
    intent.bidAmount > 0n &&
    intent.maxAuctionTokens > 0n &&
    intent.maxEffectivePrice > 0n &&
    intent.deadline > BigInt(Math.floor(Date.now() / 1000)) &&
    intent.bidder !== '0x0000000000000000000000000000000000000000'
  );
};