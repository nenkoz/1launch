import React, { useState, useEffect } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Coins, Zap, Shield } from 'lucide-react';
import { generateBidIntent, INTENT_DOMAIN, INTENT_TYPES, type BidIntent } from '@/lib/intents';

interface IntentBidFormProps {
  launchId: string;
  auctionTokenSymbol: string;
  auctionTokenAddress: string;
  onBidSubmitted: () => void;
}

const BACKEND_API_BASE_URL = import.meta.env.VITE_BACKEND_API_BASE_URL as string;

// Supported tokens on Arbitrum for intent-based bidding (works with ANY token!)
const SUPPORTED_TOKENS = [
  {
    address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },
  {
    address: '0x912ce59144191c1204e64559fe8253a0e49e6548',
    symbol: 'ARB',
    name: 'Arbitrum Token',
    decimals: 18,
  },
  {
    address: '0xf97f4df75117a78c1a5a0dbb814af92458539fb4',
    symbol: 'LINK',
    name: 'ChainLink Token',
    decimals: 18,
  },
  {
    address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
  },
];

export const IntentBidForm: React.FC<IntentBidFormProps> = ({
  launchId,
  auctionTokenSymbol,
  auctionTokenAddress,
  onBidSubmitted,
}) => {
  const [selectedToken, setSelectedToken] = useState<typeof SUPPORTED_TOKENS[0] | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [maxAuctionTokens, setMaxAuctionTokens] = useState('');
  const [maxPriceUSDC, setMaxPriceUSDC] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const [estimatedUSDCValue, setEstimatedUSDCValue] = useState<number>(0);

  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { toast } = useToast();

  // Load token prices on component mount
  useEffect(() => {
    loadTokenPrices();
  }, []);

  // Calculate estimated values when inputs change
  useEffect(() => {
    if (selectedToken && bidAmount && tokenPrices[selectedToken.address]) {
      const tokenPrice = tokenPrices[selectedToken.address];
      const estimated = parseFloat(bidAmount) * tokenPrice;
      setEstimatedUSDCValue(estimated);
      
      // Auto-calculate max price if max tokens is set
      if (maxAuctionTokens) {
        const autoPrice = estimated / parseFloat(maxAuctionTokens);
        setMaxPriceUSDC(autoPrice.toFixed(6));
      }
    }
  }, [selectedToken, bidAmount, maxAuctionTokens, tokenPrices]);

  const loadTokenPrices = async () => {
    try {
      if (!BACKEND_API_BASE_URL) {
        console.warn('VITE_BACKEND_API_BASE_URL not set, skipping token price loading');
        return;
      }
      
      const response = await fetch(`${BACKEND_API_BASE_URL}/token_prices`);
      const prices = await response.json();
      setTokenPrices(prices);
    } catch (error) {
      console.error('Failed to load token prices:', error);
    }
  };

  const handleSubmitIntentBid = async () => {
    if (!address || !selectedToken || !bidAmount || !maxAuctionTokens || !maxPriceUSDC) {
      toast({
        title: 'Missing Information',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      console.log('🔐 Creating intent-based bid for token:', selectedToken.symbol);

      // Generate the bid intent
      const intent = generateBidIntent(
        address,
        selectedToken.address,
        bidAmount,
        selectedToken.decimals,
        auctionTokenAddress,
        maxAuctionTokens,
        parseFloat(maxPriceUSDC)
      );

      console.log('🔍 Debug - Generated intent:', intent);

      // Sign the intent using EIP-712
      const intentSignature = await signTypedDataAsync({
        domain: INTENT_DOMAIN,
        types: INTENT_TYPES,
        primaryType: 'BidIntent',
        message: intent,
        account: address,
      });

      console.log('📝 Creating intent bid...');

      // Submit intent bid to backend
      const bidData = {
        launchId,
        userWallet: address,
        bidTokenAddress: selectedToken.address,
        bidTokenAmount: intent.bidAmount.toString(),
        bidTokenSymbol: selectedToken.symbol,
        auctionTokenAddress,
        maxAuctionTokens: intent.maxAuctionTokens.toString(),
        maxEffectivePriceUSDC: parseFloat(maxPriceUSDC),
        intentSignature,
        intent: {
          bidder: intent.bidder,
          bidToken: intent.bidToken,
          bidAmount: intent.bidAmount.toString(),
          auctionToken: intent.auctionToken,
          maxAuctionTokens: intent.maxAuctionTokens.toString(),
          maxEffectivePrice: intent.maxEffectivePrice.toString(),
          deadline: intent.deadline.toString(),
          nonce: intent.nonce.toString(),
        },
      };

      console.log('🔍 Debug - Submitting intent bid data:', bidData);

      const response = await fetch(`${BACKEND_API_BASE_URL}/create_intent_bid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bidData),
      });

      if (!response.ok) {
        let errorText;
        try {
          const errorData = await response.json();
          errorText = errorData.error || 'Failed to submit intent bid';
        } catch (parseError) {
          errorText = await response.text();
        }
        throw new Error(errorText);
      }

      const result = await response.json();

      toast({
        title: 'Intent Bid Submitted! 🎯',
        description: `Intent bid placed with ${bidAmount} ${selectedToken.symbol}. Will be executed automatically if winning.`,
      });

      // Reset form
      setBidAmount('');
      setMaxAuctionTokens('');
      setMaxPriceUSDC('');
      setSelectedToken(null);

      onBidSubmitted();
    } catch (error) {
      console.error('Error submitting intent bid:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to submit intent bid',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Intent-Based Bid
        </CardTitle>
        <CardDescription>
          Bid with ANY token! Sign an intent off-chain - we'll execute it automatically if you win.
          <Badge variant="secondary" className="ml-2">
            <Zap className="h-3 w-3 mr-1" />
            Works with ALL tokens
          </Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Token Selection */}
        <div className="space-y-2">
          <Label htmlFor="token-select">Bid Token</Label>
          <Select onValueChange={(value) => {
            const token = SUPPORTED_TOKENS.find(t => t.address === value);
            setSelectedToken(token || null);
          }}>
            <SelectTrigger>
              <SelectValue placeholder="Select token to bid with" />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_TOKENS.map((token) => (
                <SelectItem key={token.address} value={token.address}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{token.symbol}</span>
                    <span className="text-sm text-muted-foreground">{token.name}</span>
                    <Badge variant="outline" className="text-xs">
                      <Shield className="h-3 w-3 mr-1" />
                      Intent
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedToken && (
          <>
            {/* Bid Amount */}
            <div className="space-y-2">
              <Label htmlFor="bid-amount">
                Bid Amount ({selectedToken.symbol})
              </Label>
              <Input
                id="bid-amount"
                type="number"
                step="any"
                placeholder={`Enter ${selectedToken.symbol} amount`}
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
              />
              {selectedToken.address in tokenPrices && bidAmount && (
                <p className="text-sm text-muted-foreground">
                  ≈ ${estimatedUSDCValue.toFixed(2)} USDC
                  <span className="ml-1">(via 1inch Fusion)</span>
                </p>
              )}
            </div>

            {/* Max Auction Tokens */}
            <div className="space-y-2">
              <Label htmlFor="max-tokens">
                Max {auctionTokenSymbol} Tokens Wanted
              </Label>
              <Input
                id="max-tokens"
                type="number"
                placeholder={`Max ${auctionTokenSymbol} quantity`}
                value={maxAuctionTokens}
                onChange={(e) => setMaxAuctionTokens(e.target.value)}
              />
            </div>

            {/* Max Price */}
            <div className="space-y-2">
              <Label htmlFor="max-price">
                Max Price (USDC per {auctionTokenSymbol})
              </Label>
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted">
                <span className="text-muted-foreground">$</span>
                <span className="font-mono">{maxPriceUSDC || '0.000000'}</span>
                <span className="text-muted-foreground">USDC</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Maximum effective price you're willing to pay. Based on current {selectedToken.symbol} price.
              </p>
            </div>

            {/* Intent Summary */}
            {bidAmount && maxAuctionTokens && maxPriceUSDC && (
              <div className="p-3 bg-muted rounded-lg space-y-1">
                <p className="text-sm font-medium">Intent Summary:</p>
                <p className="text-sm">
                  • Willing to swap: {bidAmount} {selectedToken.symbol}
                </p>
                <p className="text-sm">
                  • For up to: {maxAuctionTokens} {auctionTokenSymbol}
                </p>
                <p className="text-sm">
                  • Max price: ${maxPriceUSDC} USDC per token
                </p>
                <div className="border-t pt-2 mt-2">
                  <p className="text-xs text-muted-foreground">
                    🎯 This intent will be executed automatically via 1inch Fusion if you win
                  </p>
                  <p className="text-xs text-muted-foreground">
                    🔒 Completely private - no on-chain activity until settlement
                  </p>
                </div>
              </div>
            )}

            <Button 
              onClick={handleSubmitIntentBid} 
              disabled={!bidAmount || !maxAuctionTokens || !maxPriceUSDC || isSubmitting}
              className="w-full"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSubmitting ? 'Creating Intent...' : `Create ${selectedToken.symbol} Intent`}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};