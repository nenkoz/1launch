import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calculator, DollarSign, Hash, Wallet, AlertCircle, CheckCircle } from "lucide-react";
import { useAccount } from 'wagmi';

interface BidFormProps {
  tokenName: string;
  tokenSymbol: string;
  onSubmitBid: (price: number, quantity: number) => Promise<void>;
  disabled?: boolean;
}

export function BidForm({ tokenName, tokenSymbol, onSubmitBid, disabled }: BidFormProps) {
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { address, isConnected } = useAccount();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isConnected || !address) {
      return;
    }

    const bidPrice = parseFloat(price);
    const bidQuantity = parseInt(quantity);

    if (bidPrice > 0 && bidQuantity > 0) {
      try {
        setIsSubmitting(true);
        await onSubmitBid(bidPrice, bidQuantity);
        setPrice("");
        setQuantity("");
      } catch (error) {
        console.error('Error submitting bid:', error);
        // Error handling is done in the context
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const totalCost = parseFloat(price) * parseInt(quantity) || 0;

  // Show wallet connection prompt if not connected
  if (!isConnected) {
    return (
      <Card className="p-6 text-center space-y-4">
        <div className="w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center mx-auto">
          <Wallet className="w-6 h-6 text-primary-foreground" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Connect Wallet to Bid</h3>
          <p className="text-sm text-muted-foreground">
            Connect your wallet to participate in this token launch
          </p>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Connected Wallet Info */}
      <Alert>
        <CheckCircle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <span>Wallet connected</span>
          <span className="font-mono text-xs">
            {address?.slice(0, 6)}...{address?.slice(-4)}
          </span>
        </AlertDescription>
      </Alert>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="price" className="flex items-center gap-2">
            <Calculator className="w-4 h-4" />
            Bid Price (USD per token)
          </Label>
          <Input
            id="price"
            type="number"
            step="0.0001"
            min="0"
            placeholder="Enter your bid price per token"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            disabled={disabled || isSubmitting}
            required
          />
          <p className="text-xs text-muted-foreground">
            Higher bids have priority in the clearing mechanism
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="quantity" className="flex items-center gap-2">
            <Hash className="w-4 h-4" />
            Quantity (tokens)
          </Label>
          <Input
            id="quantity"
            type="number"
            min="1"
            placeholder="Number of tokens to bid for"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={disabled || isSubmitting}
            required
          />
          <p className="text-xs text-muted-foreground">
            Minimum quantity may apply based on token decimals
          </p>
        </div>
      </div>

      {totalCost > 0 && (
        <Card className="p-4 bg-secondary/20">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Cost:</span>
              <span className="font-bold text-foreground">${totalCost.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 6
              })}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Token:</span>
              <span className="text-foreground">{tokenSymbol}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Payment Token:</span>
              <span className="text-foreground">USDC</span>
            </div>
            <div className="text-xs text-muted-foreground mt-3 p-2 bg-background/50 rounded border">
              <AlertCircle className="w-3 h-3 inline mr-1" />
              Your bid will only be filled if it's among the highest bids and there are sufficient tokens in the 40% allocation.
            </div>
          </div>
        </Card>
      )}

      <Button
        type="submit"
        variant="bid"
        className="w-full"
        disabled={!parseFloat(price) || !parseInt(quantity) || disabled || isSubmitting || !isConnected}
      >
        {isSubmitting ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
            Creating Order...
          </>
        ) : (
          <>
            <DollarSign className="w-4 h-4 mr-2" />
            Submit Private Bid
          </>
        )}
      </Button>

      {isSubmitting && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Creating your limit order on 1inch protocol. This may take a few moments...
          </AlertDescription>
        </Alert>
      )}
    </form>
  );
}