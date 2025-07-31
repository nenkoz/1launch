import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { type Address, encodeFunctionData, parseEther, decodeEventLog } from 'viem';
import { useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';

// Contract addresses from environment
export const CONTRACT_ADDRESSES = {
    AUCTION_CONTROLLER: (import.meta.env.VITE_AUCTION_CONTROLLER_ADDRESS || '0x8D058Fb25D7005beA57923141620D7FeF3F037a4') as Address,
    TOKEN_FACTORY: (import.meta.env.VITE_TOKEN_FACTORY_ADDRESS || '0x17dc0102c32704a5cC42Eb3Ac3048fbA990fe55B') as Address,
    USDC: (import.meta.env.VITE_USDC_ADDRESS || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831') as Address,
} as const;

// Proper ABI for TokenFactory
const TOKEN_FACTORY_ABI = [
    {
        inputs: [
            { internalType: "string", name: "name", type: "string" },
            { internalType: "string", name: "symbol", type: "string" },
            { internalType: "uint256", name: "totalSupply", type: "uint256" },
            { internalType: "uint256", name: "decimals", type: "uint256" }
        ],
        name: "deployToken",
        outputs: [{ internalType: "address", name: "tokenAddress", type: "address" }],
        stateMutability: "payable",
        type: "function"
    },
    {
        anonymous: false,
        inputs: [
            { indexed: true, internalType: "address", name: "tokenAddress", type: "address" },
            { indexed: true, internalType: "address", name: "creator", type: "address" },
            { indexed: false, internalType: "string", name: "name", type: "string" },
            { indexed: false, internalType: "string", name: "symbol", type: "string" },
            { indexed: false, internalType: "uint256", name: "totalSupply", type: "uint256" }
        ],
        name: "TokenDeployed",
        type: "event"
    }
] as const;

// ABI for AuctionController
const AUCTION_CONTROLLER_ABI = [
    {
        inputs: [
            { internalType: "address", name: "tokenAddress", type: "address" },
            { internalType: "uint256", name: "totalSupply", type: "uint256" },
            { internalType: "uint256", name: "targetAllocation", type: "uint256" },
            { internalType: "uint256", name: "duration", type: "uint256" },
            { internalType: "string", name: "metadataURI", type: "string" }
        ],
        name: "createAuction",
        outputs: [{ internalType: "bytes32", name: "auctionId", type: "bytes32" }],
        stateMutability: "nonpayable",
        type: "function"
    }
] as const;

// ERC20 ABI for approve function
const ERC20_ABI = [
    {
        inputs: [
            { internalType: "address", name: "spender", type: "address" },
            { internalType: "uint256", name: "amount", type: "uint256" }
        ],
        name: "approve",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function"
    }
] as const;

// Add function to get creator's tokens
const GET_CREATOR_TOKENS_ABI = [
    {
        inputs: [{ internalType: "address", name: "creator", type: "address" }],
        name: "getCreatorTokens",
        outputs: [{ internalType: "address[]", name: "", type: "address[]" }],
        stateMutability: "view",
        type: "function"
    }
] as const;

export function useTokenFactoryFixed() {
    const { sendTransactionAsync, data: hash, error, isError, isPending } = useSendTransaction();
    const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
    const publicClient = usePublicClient();

    const deployToken = async (params: {
        name: string;
        symbol: string;
        totalSupply: bigint;
        decimals: number;
    }) => {
        try {
            const fee = BigInt('0'); // No fee for efficient contract

            // Manually encode the function data to ensure proper uint8 encoding
            const data = encodeFunctionData({
                abi: TOKEN_FACTORY_ABI,
                functionName: 'deployToken',
                args: [
                    params.name,
                    params.symbol,
                    params.totalSupply,
                    BigInt(params.decimals) // Convert to BigInt for uint256
                ]
            });

            console.log("Encoded function data:", data);
            console.log("Sending to address:", CONTRACT_ADDRESSES.TOKEN_FACTORY);
            console.log("With value:", fee.toString());

            // Send the transaction and wait for the hash
            const txHash = await sendTransactionAsync({
                to: CONTRACT_ADDRESSES.TOKEN_FACTORY,
                data,
                value: fee,
            });

            console.log("Transaction sent, hash:", txHash);

            return {
                hash: txHash,
                isConfirming: false,
                isSuccess: false,
                error: null,
                isError: false
            };
        } catch (err) {
            console.error("Transaction error:", err);
            return {
                hash: undefined,
                isConfirming: false,
                isSuccess: false,
                error: err,
                isError: true
            };
        }
    };

    const waitForTransaction = async (txHash: string) => {
        try {
            if (!publicClient) {
                throw new Error("Public client not available");
            }

            console.log("Waiting for transaction confirmation:", txHash);
            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });

            console.log("Transaction confirmed:", receipt);
            return receipt;
        } catch (err) {
            console.error("Error waiting for transaction:", err);
            throw err;
        }
    };

    const approveToken = async (tokenAddress: Address, amount: bigint) => {
        try {
            const data = encodeFunctionData({
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [CONTRACT_ADDRESSES.AUCTION_CONTROLLER, amount]
            });

            const txHash = await sendTransactionAsync({
                to: tokenAddress,
                data,
                value: BigInt('0'),
            });

            console.log("Token approval transaction sent, hash:", txHash);

            return {
                hash: txHash,
                isConfirming: false,
                isSuccess: false,
                error: null,
                isError: false
            };
        } catch (err) {
            console.error("Token approval error:", err);
            return {
                hash: undefined,
                isConfirming: false,
                isSuccess: false,
                error: err,
                isError: true
            };
        }
    };

    const createAuction = async (params: {
        tokenAddress: Address;
        totalSupply: bigint;
        targetAllocation: bigint;
        duration: number;
        metadataURI: string;
    }) => {
        try {
            const data = encodeFunctionData({
                abi: AUCTION_CONTROLLER_ABI,
                functionName: 'createAuction',
                args: [
                    params.tokenAddress,
                    params.totalSupply,
                    params.targetAllocation,
                    BigInt(params.duration),
                    params.metadataURI
                ]
            });

            const txHash = await sendTransactionAsync({
                to: CONTRACT_ADDRESSES.AUCTION_CONTROLLER,
                data,
                value: BigInt('0'),
            });

            console.log("Auction creation transaction sent, hash:", txHash);

            return {
                hash: txHash,
                isConfirming: false,
                isSuccess: false,
                error: null,
                isError: false
            };
        } catch (err) {
            console.error("Auction creation error:", err);
            return {
                hash: undefined,
                isConfirming: false,
                isSuccess: false,
                error: err,
                isError: true
            };
        }
    };

    const getCreatorTokens = async (creatorAddress: Address): Promise<Address[]> => {
        try {
            if (!publicClient) {
                throw new Error("Public client not available");
            }

            const result = await publicClient.readContract({
                address: CONTRACT_ADDRESSES.TOKEN_FACTORY,
                abi: GET_CREATOR_TOKENS_ABI,
                functionName: 'getCreatorTokens',
                args: [creatorAddress]
            });

            console.log("Creator tokens:", result);
            return result as Address[];
        } catch (err) {
            console.error("Error getting creator tokens:", err);
            return [];
        }
    };

    return {
        deployToken,
        waitForTransaction,
        getCreatorTokens,
        approveToken,
        createAuction,
        hash,
        isConfirming,
        isSuccess,
        error,
        isError
    };
} 