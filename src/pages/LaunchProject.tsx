import { useState } from "react";
import { Navigation } from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon, Rocket, Info, DollarSign, Hash, Clock, FileText, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useLaunch } from "@/contexts/LaunchContext";
import { useNavigate } from "react-router-dom";
import { useTokenFactoryFixed } from "@/hooks/useContractsFixed";
import { useAccount, useSwitchChain } from "wagmi";
import { arbitrum } from "wagmi/chains";

const LaunchProject = () => {
    const [formData, setFormData] = useState({
        tokenName: "",
        tokenSymbol: "",
        description: "",
        totalSupply: "",
        targetAllocation: "",
        launchDuration: "120", // 2 hours in minutes
    });
    const [startDate, setStartDate] = useState<Date>();
    const [startTime, setStartTime] = useState("");
    const [endDate, setEndDate] = useState<Date>();
    const [endTime, setEndTime] = useState("");
    const [durationType, setDurationType] = useState<"datetime" | "duration">("datetime");
    const [isDeploying, setIsDeploying] = useState(false);
    const [deploymentStep, setDeploymentStep] = useState("");

    const { toast } = useToast();
    const { addLaunch } = useLaunch();
    const navigate = useNavigate();
    const { deployToken, waitForTransaction, getCreatorTokens, approveToken, createAuction } = useTokenFactoryFixed();
    const { address, isConnected, chain } = useAccount();
    const { switchChain } = useSwitchChain();

    const handleInputChange = (field: string, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!isConnected) {
            toast({
                title: "Wallet Not Connected",
                description: "Please connect your wallet to deploy a token",
                variant: "destructive",
            });
            return;
        }

        // Check if user is on the correct network (Arbitrum)
        if (chain?.id !== arbitrum.id) {
            toast({
                title: "Wrong Network",
                description: "Please switch to Arbitrum network to deploy tokens",
                variant: "destructive",
            });

            // Attempt to switch to Arbitrum
            try {
                await switchChain({ chainId: arbitrum.id });
            } catch (error) {
                console.error("Failed to switch network:", error);
            }
            return;
        }

        let finalEndDate: Date;

        if (durationType === "datetime") {
            if (!startDate || !startTime || !endDate || !endTime) {
                toast({
                    title: "Error",
                    description: "Please select start and end date/time for your launch",
                    variant: "destructive",
                });
                return;
            }

            // Combine date and time for start
            const [startHours, startMinutes] = startTime.split(":").map(Number);
            const startDateTime = new Date(startDate);
            startDateTime.setHours(startHours, startMinutes, 0, 0);

            // Combine date and time for end
            const [endHours, endMinutes] = endTime.split(":").map(Number);
            finalEndDate = new Date(endDate);
            finalEndDate.setHours(endHours, endMinutes, 0, 0);

            // Validate that end is after start
            if (finalEndDate <= startDateTime) {
                toast({
                    title: "Error",
                    description: "End time must be after start time",
                    variant: "destructive",
                });
                return;
            }
        } else {
            // Duration mode - use current time as start and add duration
            if (!formData.launchDuration) {
                toast({
                    title: "Error",
                    description: "Please specify launch duration",
                    variant: "destructive",
                });
                return;
            }

            const durationMinutes = parseInt(formData.launchDuration);
            if (durationMinutes < 1) {
                toast({
                    title: "Error",
                    description: "Auction duration must be at least 1 minute",
                    variant: "destructive",
                });
                return;
            }

            if (durationMinutes > 10080) {
                // 7 days = 10080 minutes
                toast({
                    title: "Error",
                    description: "Auction duration cannot exceed 7 days (10080 minutes)",
                    variant: "destructive",
                });
                return;
            }

            finalEndDate = new Date(Date.now() + durationMinutes * 60 * 1000); // Convert minutes to milliseconds
        }

        // Debug logging
        console.log("Form data before validation:", formData);
        console.log("Token name:", formData.tokenName);
        console.log("Token symbol:", formData.tokenSymbol);
        console.log("Total supply:", formData.totalSupply);

        // Validate form data
        if (!formData.tokenName.trim()) {
            toast({
                title: "Error",
                description: "Please enter a token name",
                variant: "destructive",
            });
            return;
        }

        if (!formData.tokenSymbol.trim()) {
            toast({
                title: "Error",
                description: "Please enter a token symbol",
                variant: "destructive",
            });
            return;
        }

        if (!formData.totalSupply || parseInt(formData.totalSupply) <= 0) {
            toast({
                title: "Error",
                description: "Please enter a valid total supply",
                variant: "destructive",
            });
            return;
        }

        if (!formData.targetAllocation || parseInt(formData.targetAllocation) <= 0) {
            toast({
                title: "Error",
                description: "Please enter a valid target allocation",
                variant: "destructive",
            });
            return;
        }

        try {
            setIsDeploying(true);
            setDeploymentStep("Deploying token contract...");

            // 🚀 DEPLOY REAL TOKEN using TokenFactory!
            const totalSupplyNumber = parseInt(formData.totalSupply);
            if (isNaN(totalSupplyNumber)) {
                toast({
                    title: "Error",
                    description: "Invalid total supply number",
                    variant: "destructive",
                });
                return;
            }

            const totalSupplyBigInt = BigInt(totalSupplyNumber) * BigInt(10 ** 18); // 18 decimals
            console.log("Total supply conversion:", {
                original: formData.totalSupply,
                parsed: totalSupplyNumber,
                bigint: totalSupplyBigInt.toString(),
            });

            // Create a simple metadata object
            const metadata = {
                name: formData.tokenName.trim(),
                symbol: formData.tokenSymbol.trim(),
                description: formData.description.trim() || "Auction token",
            };

            // Debug: Log what we're sending to the contract
            const deployParams = {
                name: formData.tokenName.trim(),
                symbol: formData.tokenSymbol.trim(),
                totalSupply: totalSupplyBigInt,
                decimals: 18, // Must be a number, not a string
            };

            console.log("Deployment parameters:", deployParams);
            console.log("Total supply as BigInt:", totalSupplyBigInt.toString());

            const deploymentResult = await deployToken(deployParams);

            // The fixed hook returns an object with transaction info
            console.log("Deployment transaction:", deploymentResult);

            if (deploymentResult.isError) {
                throw new Error(deploymentResult.error?.message || "Transaction failed");
            }

            if (!deploymentResult.hash) {
                throw new Error("Transaction was not sent. Please try again.");
            }

            console.log("Transaction hash received:", deploymentResult.hash);

            toast({
                title: "Token Deployment In Progress",
                description: `Transaction submitted! Hash: ${deploymentResult.hash.slice(0, 10)}...`,
            });

            // Wait for transaction confirmation
            setDeploymentStep("Waiting for token deployment confirmation...");
            await waitForTransaction(deploymentResult.hash);

            // Get the deployed token address by calling the factory's getCreatorTokens function
            setDeploymentStep("Getting deployed token address...");
            if (!address) {
                throw new Error("Wallet not connected");
            }

            const creatorTokens = await getCreatorTokens(address);
            if (creatorTokens.length === 0) {
                throw new Error("No tokens found for this address");
            }

            // Get the most recently deployed token (last in the array)
            const tokenAddress = creatorTokens[creatorTokens.length - 1];

            console.log("Token deployed at address:", tokenAddress);

            // Step 2: Approve the auction controller to spend tokens
            setDeploymentStep("Approving auction controller...");
            const approvalResult = await approveToken(tokenAddress, totalSupplyBigInt);

            if (approvalResult.isError) {
                throw new Error(approvalResult.error?.message || "Token approval failed");
            }

            console.log("Token approval transaction:", approvalResult.hash);

            // Wait for approval confirmation
            await waitForTransaction(approvalResult.hash);

            // Step 3: Create the auction
            setDeploymentStep("Creating auction...");
            const auctionResult = await createAuction({
                tokenAddress: tokenAddress,
                totalSupply: totalSupplyBigInt,
                targetAllocation: (totalSupplyBigInt * BigInt(40)) / BigInt(100), // 40% of total supply
                duration: parseInt(formData.launchDuration) * 60, // Convert minutes to seconds
                metadataURI: JSON.stringify(metadata), // Use the metadata we created earlier
            });

            if (auctionResult.isError) {
                throw new Error(auctionResult.error?.message || "Auction creation failed");
            }

            console.log("Auction creation transaction:", auctionResult.hash);

            // Wait for auction creation confirmation
            await waitForTransaction(auctionResult.hash);

            // Step 4: Add launch to database
            setDeploymentStep("Saving launch to database...");
            await addLaunch({
                tokenName: formData.tokenName.trim(),
                tokenSymbol: formData.tokenSymbol.trim(),
                description: formData.description.trim() || "Auction token",
                totalSupply: parseInt(formData.totalSupply),
                targetAllocation: parseInt(formData.targetAllocation),
                endTime: finalEndDate,
                tokenAddress: tokenAddress,
                chainId: chain?.id || 1,
            });

            console.log("Real token deployed and auction created:", {
                ...formData,
                finalEndDate,
                tokenAddress: tokenAddress,
                deploymentResult,
                auctionResult,
            });

            // Show final success message
            toast({
                title: "Launch Created Successfully!",
                description: `${formData.tokenName} auction is now live and accepting bids.`,
            });

            // Reset form
            setFormData({
                tokenName: "",
                tokenSymbol: "",
                description: "",
                totalSupply: "",
                targetAllocation: "",
                launchDuration: "120",
            });
            setStartDate(undefined);
            setStartTime("");
            setEndDate(undefined);
            setEndTime("");

            // Navigate to auctions page
            setTimeout(() => {
                navigate("/auctions");
            }, 2000);
        } catch (error) {
            console.error("Token deployment failed:", error);
            toast({
                title: "Deployment Failed",
                description: error?.message || "Failed to deploy token. Please try again.",
                variant: "destructive",
            });
        } finally {
            setIsDeploying(false);
            setDeploymentStep("");
        }
    };

    const allocationPercentage = formData.totalSupply && formData.targetAllocation ? ((parseInt(formData.targetAllocation) / parseInt(formData.totalSupply)) * 100).toFixed(1) : "0";

    return (
        <div className="min-h-screen bg-background">
            <Navigation />

            <main className="pt-16">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
                    {/* Header */}
                    <div className="text-center mb-12">
                        <div className="flex items-center justify-center gap-3 mb-4">
                            <Rocket className="w-8 h-8 text-primary" />
                            <h1 className="text-4xl font-bold text-foreground">Launch Your Project</h1>
                        </div>
                        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">Create a private bid launch for your token. Set your parameters and let the community participate through private bidding.</p>

                        {/* Network Status */}
                        {isConnected && chain && (
                            <div className="mt-4">
                                {chain.id === arbitrum.id ? (
                                    <Badge className="bg-green-500/10 text-green-500 border-green-500/20">✓ Connected to Arbitrum</Badge>
                                ) : (
                                    <Badge className="bg-red-500/10 text-red-500 border-red-500/20 cursor-pointer" onClick={() => switchChain({ chainId: arbitrum.id })}>
                                        ⚠️ Wrong Network - Click to switch to Arbitrum
                                    </Badge>
                                )}
                            </div>
                        )}
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-8">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* Left Column - Token Details */}
                            <div className="space-y-6">
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2">
                                            <Info className="w-5 h-5" />
                                            Token Information
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="tokenName">Token Name</Label>
                                            <Input id="tokenName" placeholder="e.g., EcoToken" value={formData.tokenName} onChange={(e) => handleInputChange("tokenName", e.target.value)} required />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="tokenSymbol">Token Symbol</Label>
                                            <Input id="tokenSymbol" placeholder="e.g., ECO" value={formData.tokenSymbol} onChange={(e) => handleInputChange("tokenSymbol", e.target.value.toUpperCase())} maxLength={10} required />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="description">Project Description</Label>
                                            <Textarea id="description" placeholder="Describe your project, its goals, and utility..." value={formData.description} onChange={(e) => handleInputChange("description", e.target.value)} rows={4} required />
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2">
                                            <Hash className="w-5 h-5" />
                                            Token Economics
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="totalSupply">Total Supply</Label>
                                            <Input id="totalSupply" type="number" placeholder="e.g., 1000000" value={formData.totalSupply} onChange={(e) => handleInputChange("totalSupply", e.target.value)} required />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="targetAllocation">Target Allocation (40% recommended)</Label>
                                            <Input id="targetAllocation" type="number" placeholder="e.g., 400000" value={formData.targetAllocation} onChange={(e) => handleInputChange("targetAllocation", e.target.value)} required />
                                            {formData.totalSupply && formData.targetAllocation && <p className="text-sm text-muted-foreground">This represents {allocationPercentage}% of total supply</p>}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Right Column - Launch Settings */}
                            <div className="space-y-6">
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2">
                                            <Clock className="w-5 h-5" />
                                            Launch Schedule
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="space-y-2">
                                            <Label>Schedule Type</Label>
                                            <Select value={durationType} onValueChange={(value: "datetime" | "duration") => setDurationType(value)}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select scheduling method" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="datetime">Specific Start & End Times</SelectItem>
                                                    <SelectItem value="duration">Start Now + Duration</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {durationType === "datetime" ? (
                                            <>
                                                <div className="space-y-2">
                                                    <Label>Start Date & Time</Label>
                                                    <div className="flex gap-2">
                                                        <Popover>
                                                            <PopoverTrigger asChild>
                                                                <Button variant="outline" className={cn("flex-1 justify-start text-left font-normal", !startDate && "text-muted-foreground")}>
                                                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                                                    {startDate ? format(startDate, "MMM dd") : "Start date"}
                                                                </Button>
                                                            </PopoverTrigger>
                                                            <PopoverContent className="w-auto p-0">
                                                                <Calendar
                                                                    mode="single"
                                                                    selected={startDate}
                                                                    onSelect={setStartDate}
                                                                    disabled={(date) => {
                                                                        const today = new Date();
                                                                        today.setHours(0, 0, 0, 0);
                                                                        return date < today;
                                                                    }}
                                                                    initialFocus
                                                                    className="p-3 pointer-events-auto"
                                                                />
                                                            </PopoverContent>
                                                        </Popover>
                                                        <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="flex-1" />
                                                    </div>
                                                </div>

                                                <div className="space-y-2">
                                                    <Label>End Date & Time</Label>
                                                    <div className="flex gap-2">
                                                        <Popover>
                                                            <PopoverTrigger asChild>
                                                                <Button variant="outline" className={cn("flex-1 justify-start text-left font-normal", !endDate && "text-muted-foreground")}>
                                                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                                                    {endDate ? format(endDate, "MMM dd") : "End date"}
                                                                </Button>
                                                            </PopoverTrigger>
                                                            <PopoverContent className="w-auto p-0">
                                                                <Calendar
                                                                    mode="single"
                                                                    selected={endDate}
                                                                    onSelect={setEndDate}
                                                                    disabled={(date) => {
                                                                        const today = new Date();
                                                                        today.setHours(0, 0, 0, 0);
                                                                        return date < today;
                                                                    }}
                                                                    initialFocus
                                                                    className="p-3 pointer-events-auto"
                                                                />
                                                            </PopoverContent>
                                                        </Popover>
                                                        <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="flex-1" />
                                                    </div>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="space-y-2">
                                                <Label htmlFor="launchDuration">Duration (minutes)</Label>
                                                <Select value={formData.launchDuration} onValueChange={(value) => handleInputChange("launchDuration", value)}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select duration" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="1">1 minute</SelectItem>
                                                        <SelectItem value="2">2 minutes</SelectItem>
                                                        <SelectItem value="5">5 minutes</SelectItem>
                                                        <SelectItem value="10">10 minutes</SelectItem>
                                                        <SelectItem value="15">15 minutes</SelectItem>
                                                        <SelectItem value="30">30 minutes</SelectItem>
                                                        <SelectItem value="60">1 hour</SelectItem>
                                                        <SelectItem value="120">2 hours</SelectItem>
                                                        <SelectItem value="360">6 hours</SelectItem>
                                                        <SelectItem value="720">12 hours</SelectItem>
                                                        <SelectItem value="1440">24 hours (1 day)</SelectItem>
                                                        <SelectItem value="2880">48 hours (2 days)</SelectItem>
                                                        <SelectItem value="4320">72 hours (3 days)</SelectItem>
                                                        <SelectItem value="10080">168 hours (7 days)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2">
                                            <FileText className="w-5 h-5" />
                                            Launch Summary
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="space-y-3">
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Token:</span>
                                                <span className="font-medium">
                                                    {formData.tokenName || "Not set"} ({formData.tokenSymbol || "N/A"})
                                                </span>
                                            </div>

                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Total Supply:</span>
                                                <span className="font-medium">{formData.totalSupply ? parseInt(formData.totalSupply).toLocaleString() : "Not set"}</span>
                                            </div>

                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">For Bidding:</span>
                                                <span className="font-medium">
                                                    {formData.targetAllocation ? parseInt(formData.targetAllocation).toLocaleString() : "Not set"}
                                                    {formData.targetAllocation && ` (${allocationPercentage}%)`}
                                                </span>
                                            </div>

                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Schedule:</span>
                                                <span className="font-medium">{durationType === "datetime" ? (startDate && startTime && endDate && endTime ? `${format(startDate, "MMM dd")} ${startTime} - ${format(endDate, "MMM dd")} ${endTime}` : "Not set") : `Start now + ${formData.launchDuration} min`}</span>
                                            </div>
                                        </div>

                                        <div className="border-t pt-4 space-y-3">
                                            <div className="bg-secondary/20 p-3 rounded-lg">
                                                <p className="text-sm text-muted-foreground">
                                                    <strong>Timezone:</strong> All times are in your local timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})<br />
                                                    Bids will be filled from highest price until the target allocation is reached. Remaining tokens and collected funds will form the initial liquidity pool.
                                                </p>
                                            </div>

                                            {isConnected && (
                                                <div className="bg-primary/10 p-3 rounded-lg border border-primary/20">
                                                    <p className="text-sm text-foreground">
                                                        <strong>🚀 Real Token Deployment:</strong> This will deploy a real ERC20 token on Arbitrum mainnet.
                                                        <br />
                                                        <strong>Cost:</strong> ~0.01 ETH deployment fee + gas fees (~$0.50 total)
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>

                        {/* Submit Button */}
                        <div className="flex justify-center pt-8">
                            <Button type="submit" size="lg" className="px-12" disabled={isDeploying || !isConnected || !formData.tokenName || !formData.tokenSymbol || !formData.totalSupply || !formData.targetAllocation || (durationType === "datetime" && (!startDate || !startTime || !endDate || !endTime)) || (durationType === "duration" && !formData.launchDuration)}>
                                {isDeploying ? (
                                    <>
                                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                        {deploymentStep || "Deploying..."}
                                    </>
                                ) : (
                                    <>
                                        <Rocket className="w-5 h-5 mr-2" />
                                        {isConnected ? "Deploy Token & Create Launch" : "Connect Wallet to Continue"}
                                    </>
                                )}
                            </Button>
                        </div>
                    </form>
                </div>
            </main>
        </div>
    );
};

export default LaunchProject;
