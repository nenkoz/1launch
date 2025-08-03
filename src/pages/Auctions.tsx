import { Navigation } from "@/components/Navigation";
import { LaunchCard } from "@/components/LaunchCard";
import { BidDistribution } from "@/components/BidDistribution";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Clock, TrendingUp, CheckCircle } from "lucide-react";
import { Launch, useLaunch } from "@/contexts/LaunchContext";

const Auctions = () => {
    const { launches } = useLaunch();

    const liveAuctions = launches.filter((auction) => auction.status === "live" || auction.status === "ending_soon" || (auction.isSettling && auction.status !== "completed"));
    const completedAuctions = launches.filter((auction) => auction.status === "completed");

    const getStatusBadge = (auction: Launch) => {
        if (auction.isSettling) {
            return (
                <Badge variant="secondary" className="ml-2">
                    Settling...
                </Badge>
            );
        }
        if (auction.status === "ending_soon") {
            return (
                <Badge variant="destructive" className="ml-2">
                    Ending Soon
                </Badge>
            );
        }
        if (auction.status === "live") {
            return null;
        }
        if (auction.status === "completed") {
            return (
                <Badge variant="secondary" className="ml-2">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Completed
                </Badge>
            );
        }
        return null;
    };

    return (
        <div className="min-h-screen bg-background">
            <Navigation />

            <main className="pt-16">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
                    {/* Header */}
                    <div className="text-center mb-12">
                        <h1 className="text-4xl font-bold text-foreground mb-4">Token Auctions</h1>
                        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">Participate in live token launches through private bidding. View completed auctions and their results.</p>
                    </div>

                    <Tabs defaultValue="live" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 max-w-md mx-auto mb-8">
                            <TabsTrigger value="live" className="flex items-center gap-2">
                                <TrendingUp className="w-4 h-4" />
                                Live Auctions ({liveAuctions.length})
                            </TabsTrigger>
                            <TabsTrigger value="completed" className="flex items-center gap-2">
                                <CheckCircle className="w-4 h-4" />
                                Completed ({completedAuctions.length})
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="live" className="space-y-8">
                            {liveAuctions.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {liveAuctions.map((auction) => (
                                        <div key={auction.id} className="space-y-4">
                                            <div className="relative">
                                                <LaunchCard {...auction} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-16">
                                    <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                                        <Clock className="w-8 h-8 text-muted-foreground" />
                                    </div>
                                    <h3 className="text-xl font-semibold text-foreground mb-2">No Live Auctions</h3>
                                    <p className="text-muted-foreground">Check back later for new token launches.</p>
                                </div>
                            )}
                        </TabsContent>

                        <TabsContent value="completed" className="space-y-8">
                            {completedAuctions.length > 0 ? (
                                <div className="space-y-8">
                                    {completedAuctions.map((auction) => (
                                        <div key={auction.id} className="space-y-6">
                                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                                <div className="lg:col-span-1">
                                                    <LaunchCard {...auction} />
                                                </div>
                                                <div className="lg:col-span-2">{auction.bids && auction.bids.length > 0 && <BidDistribution bids={auction.bids} targetAllocation={auction.targetAllocation} tokenSymbol={auction.tokenSymbol} />}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-16">
                                    <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                                        <CheckCircle className="w-8 h-8 text-muted-foreground" />
                                    </div>
                                    <h3 className="text-xl font-semibold text-foreground mb-2">No Completed Auctions</h3>
                                    <p className="text-muted-foreground">Completed auctions will appear here.</p>
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>
                </div>
            </main>
        </div>
    );
};

export default Auctions;
