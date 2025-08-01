import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useAccount, useSignMessage, useSignTypedData } from "wagmi";
import { supabase, type Database } from "@/lib/supabase";
import { useWeb3 } from "./Web3Context";
import { useToast } from "@/hooks/use-toast";

export interface Launch {
    id: string;
    tokenName: string;
    tokenSymbol: string;
    description: string;
    endTime: Date;
    totalSupply: number;
    targetAllocation: number;
    participants: number;
    isLaunched: boolean;
    status: "live" | "ending_soon" | "completed";
    // New blockchain fields
    tokenAddress?: string;
    chainId?: number;
    clearingPrice?: number;
    totalRaised?: number;
    auctionControllerAddress?: string;
    isSettling?: boolean; // Track if settlement is in progress
    bids?: Array<{
        id: string;
        userId: string;
        price: number;
        quantity: number;
        timestamp: Date;
        // New blockchain fields
        orderHash?: string;
        orderStatus?: "pending" | "active" | "filled" | "cancelled" | "expired";
        filledAmount?: number;
    }>;
}

interface LaunchContextType {
    launches: Launch[];
    isLoading: boolean;
    addLaunch: (launch: Omit<Launch, "id" | "participants" | "isLaunched" | "status" | "isSettling">) => Promise<void>;
    submitBid: (launchId: string, price: number, quantity: number) => Promise<void>;
    settleAuction: (launchId: string) => Promise<void>;
}

const LaunchContext = createContext<LaunchContextType | undefined>(undefined);

export const useLaunch = () => {
    const context = useContext(LaunchContext);
    if (!context) {
        throw new Error("useLaunch must be used within a LaunchProvider");
    }
    return context;
};

interface LaunchProviderProps {
    children: ReactNode;
}

const BACKEND_API_BASE_URL = import.meta.env.VITE_BACKEND_API_BASE_URL as string;

export const LaunchProvider: React.FC<LaunchProviderProps> = ({ children }) => {
    const [launches, setLaunches] = useState<Launch[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { address } = useAccount();
    const { signMessageAsync } = useSignMessage();
    const { signTypedDataAsync } = useSignTypedData();
    const { contracts } = useWeb3();
    const { toast } = useToast();

    // Load launches from Supabase with new blockchain fields
    useEffect(() => {
        const loadLaunches = async () => {
            try {
                setIsLoading(true);
                const { data: launchesData, error } = await supabase
                    .from("launches")
                    .select(
                        `
            *,
            bids (
              id,
              price,
              quantity,
              wallet_address,
              created_at,
              order_hash,
              order_status,
              filled_amount
            )
          `
                    )
                    .order("created_at", { ascending: false });

                if (error) {
                    console.error("Error loading launches:", error);
                    toast({
                        title: "Error",
                        description: "Failed to load launches",
                        variant: "destructive",
                    });
                    return;
                }

                const formattedLaunches: Launch[] =
                    launchesData?.map((launch) => ({
                        id: launch.id,
                        tokenName: launch.token_name,
                        tokenSymbol: launch.token_symbol,
                        description: launch.description || "",
                        endTime: new Date(launch.end_time),
                        totalSupply: launch.total_supply,
                        targetAllocation: launch.target_allocation,
                        participants: launch.participants,
                        isLaunched: launch.is_launched,
                        status: launch.status as "live" | "ending_soon" | "completed",
                        // New blockchain fields
                        tokenAddress: launch.token_address || undefined,
                        chainId: launch.chain_id,
                        clearingPrice: launch.clearing_price || undefined,
                        totalRaised: launch.total_raised || undefined,
                        auctionControllerAddress: launch.auction_controller_address || undefined,
                        isSettling: false, // Initialize as false since this is a frontend-only field
                        bids:
                            launch.bids?.map((bid) => ({
                                id: bid.id,
                                userId: bid.wallet_address || "anonymous",
                                price: bid.price,
                                quantity: bid.quantity,
                                timestamp: new Date(bid.created_at),
                                orderHash: bid.order_hash || undefined,
                                orderStatus: bid.order_status as "pending" | "active" | "filled" | "cancelled" | "expired",
                                filledAmount: bid.filled_amount,
                            })) || [],
                    })) || [];

                setLaunches(formattedLaunches);
            } catch (error) {
                console.error("Error loading launches:", error);
                toast({
                    title: "Error",
                    description: "Failed to load launches",
                    variant: "destructive",
                });
            } finally {
                setIsLoading(false);
            }
        };

        loadLaunches();
    }, [toast]);

    // Check for expired launches and update status
    useEffect(() => {
        const checkExpiredLaunches = async () => {
            setLaunches((prev) => {
                const now = new Date();
                const updated = prev.map((launch) => {
                    // Skip already completed launches
                    if (launch.status === "completed") return launch;

                    const timeUntilEnd = launch.endTime.getTime() - now.getTime();

                    if (timeUntilEnd <= 0) {
                        // Only trigger settlement once and don't update state until it's done
                        if (!launch.isLaunched && !launch.isSettling) {
                            // Mark as settling to prevent multiple settlement attempts
                            const launchWithSettlement = { ...launch, isSettling: true };

                            // Trigger settlement asynchronously but don't wait
                            settleAuction(launch.id).catch((error) => {
                                console.error("Auto-settlement failed:", error);
                                // If settlement fails, revert to live status
                                setLaunches((prevLaunches) => prevLaunches.map((l) => (l.id === launch.id ? { ...l, status: "live" as const, isSettling: false } : l)));
                            });

                            return launchWithSettlement;
                        }

                        // Return current state if already settling or completed
                        return launch;
                    }

                    if (timeUntilEnd <= 60 * 60 * 1000 && launch.status === "live") {
                        return {
                            ...launch,
                            status: "ending_soon" as const,
                        };
                    }

                    return launch;
                });

                return updated;
            });
        };

        checkExpiredLaunches();
        const interval = setInterval(checkExpiredLaunches, 60000);

        return () => clearInterval(interval);
    }, []);

    const addLaunch = async (launchData: Omit<Launch, "id" | "participants" | "isLaunched" | "status" | "isSettling">) => {
        try {
            const { data, error } = await supabase
                .from("launches")
                .insert({
                    token_name: launchData.tokenName,
                    token_symbol: launchData.tokenSymbol,
                    description: launchData.description,
                    total_supply: launchData.totalSupply,
                    target_allocation: launchData.targetAllocation,
                    end_time: launchData.endTime.toISOString(),
                    status: "live",
                    // New blockchain fields
                    token_address: launchData.tokenAddress,
                    chain_id: launchData.chainId || 1,
                    auction_controller_address: contracts.AUCTION_CONTROLLER,
                })
                .select()
                .single();

            if (error) {
                console.error("Error adding launch:", error);
                toast({
                    title: "Error",
                    description: "Failed to create launch",
                    variant: "destructive",
                });
                return;
            }

            const newLaunch: Launch = {
                id: data.id,
                tokenName: data.token_name,
                tokenSymbol: data.token_symbol,
                description: data.description || "",
                endTime: new Date(data.end_time),
                totalSupply: data.total_supply,
                targetAllocation: data.target_allocation,
                participants: data.participants,
                isLaunched: data.is_launched,
                status: data.status as "live" | "ending_soon" | "completed",
                tokenAddress: data.token_address || undefined,
                chainId: data.chain_id,
                auctionControllerAddress: data.auction_controller_address || undefined,
                isSettling: false,
            };

            setLaunches((prev) => [newLaunch, ...prev]);

            toast({
                title: "Launch Created",
                description: `${launchData.tokenName} launch has been scheduled`,
            });
        } catch (error) {
            console.error("Error adding launch:", error);
            toast({
                title: "Error",
                description: "Failed to create launch",
                variant: "destructive",
            });
        }
    };

    const submitBid = async (launchId: string, price: number, quantity: number) => {
        if (!address) {
            toast({
                title: "Error",
                description: "Please connect your wallet to submit a bid",
                variant: "destructive",
            });
            return;
        }

        try {
            const launch = launches.find((l) => l.id === launchId);
            if (!launch || !launch.tokenAddress) {
                throw new Error("Launch not found or missing token address");
            }

            const orderObject = {
                launchId,
                takerAsset: launch.tokenAddress,
                price,
                quantity,
                userWallet: address,
                auctionEndTime: launch.endTime.getTime(),
            };

            // Call backend to create orderHash
            const resp = await fetch(`${BACKEND_API_BASE_URL}/create_order`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(orderObject),
            });
            if (!resp.ok) {
                const { error } = await resp.json();
                throw new Error(error || "Failed to create order in backend");
            }

            const { orderHash, orderData, extensionData, nonce, expiration, domain, types, typedDataMessage } = await resp.json();

            console.log("📋 Received order data from backend:", {
                orderHash,
                nonce,
                expiration,
                domain,
                types: Object.keys(types),
                userWallet: address,
                orderMaker: typedDataMessage.maker
            });

            // Verify the order maker matches the user's wallet
            if (typedDataMessage.maker.toLowerCase() !== address.toLowerCase()) {
                throw new Error("Order maker does not match user wallet address");
            }

            // 1. User signs typed data with wallet (trigger wallet popup)
            console.log("✍️  Signing typed data with wallet...");
            const typedDataSignature = await signTypedDataAsync({
                domain: domain,
                types: types,
                primaryType: 'Order',
                message: typedDataMessage,
                account: address as `0x${string}`,
            });

            console.log("✅ Typed data signature received:", typedDataSignature.substring(0, 20) + "...");
            console.log("🔍 Signature details:", {
                length: typedDataSignature.length,
                startsWith0x: typedDataSignature.startsWith('0x'),
                walletAddress: address,
                orderMaker: typedDataMessage.maker
            });

            // 2. User signs order hash with wallet (trigger wallet popup)
            // const walletSignature = await signMessageAsync({
            //     message: {
            //         raw: orderHash as `0x${string}`,
            //     },
            //     account: address as `0x${string}`,
            // });

            const finalOrderData = {
                orderHash,
                orderData,
                extensionData,
                nonce,
                expiration,
                typedDataSignature,
                // walletSignature,
            };

            // Finalize to create bid order
            const createBidResp = await fetch(`${BACKEND_API_BASE_URL}/finalize_order`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(finalOrderData),
            });
            if (!createBidResp.ok) {
                const { error } = await createBidResp.json();
                throw new Error(error || "Failed to create order in backend");
            }

            const v = await createBidResp.json();
            console.log("Bid", v);
            // Update local state
            setLaunches((prev) =>
                prev.map((l) => {
                    if (l.id === launchId && !l.isLaunched) {
                        return {
                            ...l,
                            participants: l.participants + 1,
                        };
                    }
                    return l;
                })
            );

            // Reload the launch to get updated bid data
            await reloadLaunch(launchId);

            toast({
                title: "Bid Submitted",
                description: `Successfully submitted bid for ${quantity} ${launch.tokenSymbol} at $${price}`,
            });

            console.log("Bid submitted successfully:", {
                launchId,
                price,
                quantity,
                orderHash,
                // todo
                // orderId: data.orderId,
            });
        } catch (error) {
            console.error("Error submitting bid:", error);
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to submit bid",
                variant: "destructive",
            });
        }
    };

    // Helper function to reload a specific launch with bids
    const reloadLaunch = async (launchId: string) => {
        try {
            const { data: launchData, error } = await supabase
                .from("launches")
                .select(
                    `
          *,
          bids (
            id,
            price,
            quantity,
            wallet_address,
            created_at,
            order_hash,
            order_status,
            filled_amount
          )
        `
                )
                .eq("id", launchId)
                .single();

            if (error) {
                console.error("Error reloading launch:", error);
                return;
            }

            const updatedLaunch: Launch = {
                id: launchData.id,
                tokenName: launchData.token_name,
                tokenSymbol: launchData.token_symbol,
                description: launchData.description || "",
                endTime: new Date(launchData.end_time),
                totalSupply: launchData.total_supply,
                targetAllocation: launchData.target_allocation,
                participants: launchData.participants,
                isLaunched: launchData.is_launched,
                status: launchData.status as "live" | "ending_soon" | "completed",
                tokenAddress: launchData.token_address || undefined,
                chainId: launchData.chain_id,
                clearingPrice: launchData.clearing_price || undefined,
                totalRaised: launchData.total_raised || undefined,
                auctionControllerAddress: launchData.auction_controller_address || undefined,
                isSettling: false,
                bids:
                    launchData.bids?.map((bid) => ({
                        id: bid.id,
                        userId: bid.wallet_address || "anonymous",
                        price: bid.price,
                        quantity: bid.quantity,
                        timestamp: new Date(bid.created_at),
                        orderHash: bid.order_hash || undefined,
                        orderStatus: bid.order_status as "pending" | "active" | "filled" | "cancelled" | "expired",
                        filledAmount: bid.filled_amount,
                    })) || [],
            };

            // Update the specific launch in state
            setLaunches((prev) => prev.map((l) => (l.id === launchId ? updatedLaunch : l)));
        } catch (error) {
            console.error("Error reloading launch:", error);
        }
    };

    const settleAuction = async (launchId: string) => {
        try {
            const { data, error } = await supabase.functions.invoke("one-inch-integration", {
                body: {
                    action: "settle_auction",
                    launchId,
                },
            });

            if (error) {
                throw error;
            }

            if (!data.success) {
                throw new Error(data.error || "Failed to settle auction");
            }

            // Reload the complete launch data including bids from database
            await reloadLaunch(launchId);

            toast({
                title: "Auction Settled",
                description: `Clearing price: $${data.clearingPrice.toFixed(4)}`,
            });

            console.log("Auction settled successfully:", {
                launchId,
                clearingPrice: data.clearingPrice,
                filledQuantity: data.filledQuantity,
                successfulBids: data.successfulBids,
            });
        } catch (error) {
            console.error("Error settling auction:", error);
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to settle auction",
                variant: "destructive",
            });
        }
    };

    return (
        <LaunchContext.Provider
            value={{
                launches,
                isLoading,
                addLaunch,
                submitBid,
                settleAuction,
            }}>
            {children}
        </LaunchContext.Provider>
    );
};
