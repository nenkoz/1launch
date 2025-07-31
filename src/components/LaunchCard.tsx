import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingDown, TrendingUp, Clock, Users, Coins } from "lucide-react";

interface Bid {
  id: string;
  userId: string;
  price: number;
  quantity: number;
  timestamp: Date;
}

interface LaunchCardProps {
  id: string;
  tokenName: string;
  tokenSymbol: string;
  description: string;
  endTime: Date;
  totalSupply: number;
  targetAllocation: number; // 40% of total supply
  participants: number;
  isLaunched: boolean;
  bids?: Bid[]; // Only visible after launch ends
  imageUrl?: string;
  onBidClick?: () => void; // Optional callback for bid button
}

export function LaunchCard({
  tokenName,
  tokenSymbol,
  description,
  endTime,
  totalSupply,
  targetAllocation,
  participants,
  isLaunched,
  bids,
  onBidClick,
}: LaunchCardProps) {
  const [timeLeft, setTimeLeft] = useState<string>("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const timeDiff = endTime.getTime() - now.getTime();

      if (timeDiff <= 0) {
        setTimeLeft("ENDED");
        setIsActive(false);
        return;
      }

      const hours = Math.floor(timeDiff / (1000 * 60 * 60));
      const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((timeDiff % (1000 * 60)) / 1000);

      setTimeLeft(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [endTime]);

  // Calculate filled allocation if launch ended
  const filledTokens = isLaunched && bids ?
    bids.sort((a, b) => b.price - a.price)
      .reduce((total, bid, index) => {
        if (total >= targetAllocation) return total;
        const remaining = targetAllocation - total;
        return total + Math.min(bid.quantity, remaining);
      }, 0) : 0;

  const allocationProgress = isLaunched ? (filledTokens / targetAllocation) * 100 : 0;

  // Calculate clearing price (price of the last filled bid)
  const clearingPrice = isLaunched && bids && filledTokens > 0 ?
    bids.sort((a, b) => b.price - a.price).find((_, i, arr) => {
      const cumulative = arr.slice(0, i + 1).reduce((sum, bid) => sum + bid.quantity, 0);
      return cumulative >= targetAllocation;
    })?.price : null;

  // Calculate bid statistics for completed auctions
  const totalBids = isLaunched && bids ? bids.length : 0;
  const filledBids = isLaunched && bids ?
    bids.sort((a, b) => b.price - a.price).filter((_, i, arr) => {
      const cumulative = arr.slice(0, i + 1).reduce((sum, bid) => sum + bid.quantity, 0);
      return cumulative <= targetAllocation;
    }).length : 0;

  return (
    <div className="bg-gradient-card backdrop-blur-sm border border-accent/20 rounded-xl p-6 hover:border-accent/40 transition-all duration-300 hover:shadow-auction h-full flex flex-col min-h-[400px]">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center">
            <Coins className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground">{tokenName}</h3>
            <p className="text-sm text-muted-foreground">${tokenSymbol}</p>
          </div>
        </div>
        <Badge variant={isActive ? "default" : "secondary"} className="animate-countdown-pulse">
          {isActive ? "LIVE" : isLaunched ? "LAUNCHED" : "ENDED"}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground mb-4 line-clamp-2 h-10">{description}</p>

      <div className="flex-grow flex flex-col">
        <div className="space-y-4">
          {/* Price Section - Only show after launch */}
          {isLaunched && clearingPrice && (
            <div className="bg-secondary/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Clearing Price</span>
                <span className="text-sm text-success font-medium">Final</span>
              </div>
              <div className="text-2xl font-bold text-foreground mb-1">
                ${clearingPrice.toFixed(4)}
              </div>
              <div className="text-xs text-muted-foreground">
                Price paid by all successful bidders
              </div>
            </div>
          )}

          {/* Allocation Progress (only shown after launch) */}
          {isLaunched ? (
            <div className="min-h-[100px] flex flex-col justify-center">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Allocation Filled</span>
                <span className="text-foreground font-medium">{allocationProgress.toFixed(1)}%</span>
              </div>
              <Progress value={allocationProgress} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>{filledTokens.toLocaleString()} tokens allocated</span>
                <span>{targetAllocation.toLocaleString()} target</span>
              </div>
            </div>
          ) : (
            <div className="bg-secondary/20 rounded-lg p-4 text-center min-h-[100px] flex flex-col justify-center">
              <div className="text-sm text-muted-foreground mb-2">Private Bidding Phase</div>
              <div className="text-lg font-semibold text-foreground">
                {targetAllocation.toLocaleString()} tokens available
              </div>
              <div className="text-xs text-muted-foreground">
                40% of total supply • Bids filled from highest price
              </div>
            </div>
          )}
        </div>

        {/* Bottom section - always at bottom */}
        <div className="space-y-4 mt-4">
          {/* Stats */}
          <div className="flex justify-between py-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span className={`font-mono ${isActive ? 'animate-countdown-pulse' : ''}`}>
                {timeLeft}
              </span>
            </div>
            {isLaunched ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="w-4 h-4" />
                <span>{totalBids} total • {filledBids} filled</span>
              </div>
            ) : (
              // Hide participant count during active auctions for privacy
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingUp className="w-4 h-4" />
                <span>Private Auction</span>
              </div>
            )}
          </div>

          {/* Action Button */}
          <Button
            variant={isActive ? "bid" : "secondary"}
            className="w-full"
            disabled={!isActive}
            onClick={isActive ? onBidClick : undefined}
          >
            {isActive ? "Place Private Bid" : isLaunched ? "Launch Complete" : "Bidding Closed"}
          </Button>
        </div>
      </div>
    </div>
  );
}