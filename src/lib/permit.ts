import { keccak256, toBytes, encodePacked, getAddress } from 'viem';

// EIP-712 domain for USDC on Arbitrum
export const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: 42161, // Arbitrum
  verifyingContract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as `0x${string}`, // USDC on Arbitrum
};

// EIP-712 types for permit
export const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

// Generate permit message for USDC spending
export function generatePermitMessage(
  owner: string,
  spender: string,
  value: bigint,
  nonce: bigint,
  deadline: bigint
) {
  return {
    owner: getAddress(owner),
    spender: getAddress(spender),
    value: value.toString(),
    nonce: nonce.toString(),
    deadline: deadline.toString(),
  };
}

// Generate bid commit hash for privacy
export function generateBidCommit(
  launchId: string,
  price: number,
  quantity: number,
  userAddress: string,
  nonce: string
): string {
  const bidData = encodePacked(
    ['string', 'uint256', 'uint256', 'address', 'string'],
    [launchId, BigInt(Math.floor(price * 1e6)), BigInt(quantity), getAddress(userAddress), nonce]
  );
  return keccak256(bidData);
}

// Calculate maximum USDC amount needed for bid
export function calculateMaxUSDCAmount(price: number, quantity: number): bigint {
  // Add 10% buffer for price volatility and fees
  const baseAmount = price * quantity;
  const bufferedAmount = baseAmount * 1.1;
  return BigInt(Math.floor(bufferedAmount * 1e6)); // USDC has 6 decimals
}

// Generate deadline (1 week from now)
export function generateDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
}