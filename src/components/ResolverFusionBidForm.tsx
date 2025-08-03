import React, { useState, useEffect } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Info } from 'lucide-react';

// Arbitrum token list (subset for testing) - all lowercase addresses
const ARBITRUM_TOKENS = [
  { symbol: 'USDC', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6 },
  { symbol: 'WETH', address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', decimals: 18 },
  { symbol: 'ARB', address: '0x912ce59144191c1204e64559fe8253a0e49e6548', decimals: 18 },
  { symbol: 'LINK', address: '0xf97f4df75117a78c1a5a0dbb814af92458539fb4', decimals: 18 },
  { symbol: 'UNI', address: '0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0', decimals: 18 },
];

const AUCTION_FUSION_RESOLVER_ADDRESS = '0xC3ce44B2E68c11fF7e80Cc997Dd28f79A2EA41Ea';

interface ResolverFusionBidFormProps {
  launchId: string;
  auctionTokenSymbol: string;
  auctionTokenAddress: string;
  onBidSubmitted: () => void;
}

export function ResolverFusionBidForm({ 
  launchId, 
  auctionTokenSymbol, 
  auctionTokenAddress,
  onBidSubmitted 
}: ResolverFusionBidFormProps) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const [selectedToken, setSelectedToken] = useState('');
  const [bidAmount, setBidAmount] = useState('');
  const [indicativeUSDCValue, setIndicativeUSDCValue] = useState('0');
  const [targetPricePerToken, setTargetPricePerToken] = useState('');
  const [estimatedAuctionTokens, setEstimatedAuctionTokens] = useState('0');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Calculate indicative USDC value when bid amount or token changes
  useEffect(() => {
    const calculateIndicativeValues = async () => {
      if (!selectedToken || !bidAmount || isNaN(parseFloat(bidAmount))) {
        setIndicativeUSDCValue('0');
        setEstimatedAuctionTokens('0');
        return;
      }

      try {
        console.log('🔍 Calculating USDC value for:', { selectedToken, bidAmount });
        
        const response = await fetch('/token_prices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenAddress: selectedToken,
            amount: bidAmount
          })
        });

        console.log('📡 Price API response status:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('💰 Price data received:', data);
          setIndicativeUSDCValue(data.usdcValue || '0');
          
          // Calculate estimated auction tokens if target price is set
          if (targetPricePerToken && !isNaN(parseFloat(targetPricePerToken))) {
            const usdcValue = parseFloat(data.usdcValue || '0');
            const targetPrice = parseFloat(targetPricePerToken);
            const estimatedTokens = targetPrice > 0 ? (usdcValue / targetPrice).toFixed(2) : '0';
            setEstimatedAuctionTokens(estimatedTokens);
            console.log('🎯 Estimated auction tokens:', estimatedTokens);
          }
        } else {
          console.error('❌ Price API error:', response.status, response.statusText);
          const errorText = await response.text();
          console.error('Error details:', errorText);
        }
      } catch (err) {
        console.error('❌ Failed to calculate indicative values:', err);
      }
    };

    calculateIndicativeValues();
  }, [selectedToken, bidAmount, targetPricePerToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!address) {
      setError('Please connect your wallet');
      return;
    }

    if (!selectedToken || !bidAmount || !targetPricePerToken) {
      setError('Please fill in all fields');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const token = ARBITRUM_TOKENS.find(t => t.address === selectedToken);
      if (!token) throw new Error('Invalid token selected');

      // Convert amounts to proper decimals
      const bidAmountWei = BigInt(Math.floor(parseFloat(bidAmount) * Math.pow(10, token.decimals)));
      const targetPriceWei = BigInt(Math.floor(parseFloat(targetPricePerToken) * 1e6)); // USDC has 6 decimals
      const expectedAuctionTokensWei = BigInt(Math.floor(parseFloat(estimatedAuctionTokens) * 1e18)); // Assuming 18 decimals for auction tokens

      console.log('Creating 1inch Fusion order with:', {
        launchId,
        bidder: address,
        sourceToken: selectedToken,
        sourceAmount: bidAmountWei.toString(),
        auctionToken: auctionTokenAddress,
        targetPricePerToken: targetPriceWei.toString(),
        expectedAuctionTokens: expectedAuctionTokensWei.toString(),
        currentUSDCValue: indicativeUSDCValue
      });

      // Create 1inch Fusion order
      const response = await fetch('/create_fusion_resolver_bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          launchId,
          bidder: address,
          sourceToken: selectedToken,
          sourceAmount: bidAmountWei.toString(),
          auctionToken: auctionTokenAddress,
          targetPricePerToken: targetPriceWei.toString(),
          expectedAuctionTokens: expectedAuctionTokensWei.toString(),
          resolverAddress: AUCTION_FUSION_RESOLVER_ADDRESS
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to create Fusion order: ${errorData}`);
      }

      const { fusionOrder, orderHash } = await response.json();

      console.log('Fusion order created:', { fusionOrder, orderHash });

      // Sign the 1inch Fusion order
      const signature = await signTypedDataAsync({
        domain: fusionOrder.domain,
        types: fusionOrder.types,
        primaryType: 'Order',
        message: fusionOrder.message
      });

      console.log('Signed Fusion order:', signature);

      // Submit the signed bid
      const submitResponse = await fetch('/submit_fusion_resolver_bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          launchId,
          bidder: address,
          sourceToken: selectedToken,
          sourceAmount: bidAmountWei.toString(),
          auctionToken: auctionTokenAddress,
          targetPricePerToken: targetPriceWei.toString(),
          expectedAuctionTokens: expectedAuctionTokensWei.toString(),
          fusionOrder,
          orderHash,
          signature,
          resolverAddress: AUCTION_FUSION_RESOLVER_ADDRESS
        })
      });

      if (!submitResponse.ok) {
        const errorData = await submitResponse.text();
        throw new Error(`Failed to submit bid: ${errorData}`);
      }

      console.log('✅ Resolver Fusion bid submitted successfully!');
      onBidSubmitted();

    } catch (err) {
      console.error('❌ Error submitting resolver fusion bid:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit bid');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedTokenInfo = ARBITRUM_TOKENS.find(t => t.address === selectedToken);

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Fusion Resolver Bid</CardTitle>
        <CardDescription>
          Bid with ANY token and set your target price! We'll swap your tokens automatically if you win.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Token Selection */}
          <div className="space-y-2">
            <Label htmlFor="token">Bid Token</Label>
            <Select value={selectedToken} onValueChange={setSelectedToken}>
              <SelectTrigger>
                <SelectValue placeholder="Select token to bid with" />
              </SelectTrigger>
              <SelectContent>
                {ARBITRUM_TOKENS.map((token) => (
                  <SelectItem key={token.address} value={token.address}>
                    {token.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Bid Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">
              Amount {selectedTokenInfo ? `(${selectedTokenInfo.symbol})` : ''}
            </Label>
            <Input
              id="amount"
              type="number"
              step="any"
              placeholder="0.0"
              value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value)}
              disabled={!selectedToken}
            />
          </div>

          {/* Current USDC Value (Indicative) */}
          <div className="space-y-2">
            <Label htmlFor="currentValue">Current USDC Value</Label>
            <Input
              id="currentValue"
              type="text"
              value={`≈ $${indicativeUSDCValue}`}
              disabled
              className="bg-gray-50"
            />
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Info size={16} />
              <span>Real-time value - will change until settlement</span>
            </div>
          </div>

          {/* Target Price Per Auction Token */}
          <div className="space-y-2">
            <Label htmlFor="targetPrice">
              Target Price per {auctionTokenSymbol} (USD)
            </Label>
            <Input
              id="targetPrice"
              type="number"
              step="0.01"
              placeholder="0.50"
              value={targetPricePerToken}
              onChange={(e) => setTargetPricePerToken(e.target.value)}
            />
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Info size={16} />
              <span>Maximum price you're willing to pay per token</span>
            </div>
          </div>

          {/* Estimated Auction Tokens */}
          <div className="space-y-2">
            <Label htmlFor="estimated">
              Estimated {auctionTokenSymbol} Tokens
            </Label>
            <Input
              id="estimated"
              type="text"
              value={`≈ ${estimatedAuctionTokens}`}
              disabled
              className="bg-gray-50"
            />
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Info size={16} />
              <span>Based on current prices - final amount determined at settlement</span>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Submit Button */}
          <Button 
            type="submit" 
            className="w-full" 
            disabled={isSubmitting || !address}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing Fusion Order...
              </>
            ) : (
              'Submit Resolver Bid'
            )}
          </Button>
        </form>

        {/* Info Alert */}
        <Alert className="mt-4">
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>How it works:</strong> You set your bid amount and target price. 
            We sign a 1inch Fusion order off-chain. If you win, our resolver automatically 
            swaps your tokens to USDC at market rate and gives you {auctionTokenSymbol} tokens 
            at your target price (if market conditions allow)!
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}