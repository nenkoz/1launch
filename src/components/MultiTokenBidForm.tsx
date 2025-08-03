import React, { useState, useEffect } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Coins, Zap } from 'lucide-react';

interface SupportedToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance?: string;
  priceUSD?: number;
}

interface MultiTokenBidFormProps {
  launchId: string;
  auctionTokenSymbol: string;
  onBidSubmitted: () => void;
}

const BACKEND_API_BASE_URL = import.meta.env.VITE_BACKEND_API_BASE_URL as string;

// Supported tokens on Arbitrum for bidding
const SUPPORTED_TOKENS: SupportedToken[] = [
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

export const MultiTokenBidForm: React.FC<MultiTokenBidFormProps> = ({
  launchId,
  auctionTokenSymbol,
  onBidSubmitted,
}) => {
  const [selectedToken, setSelectedToken] = useState<SupportedToken | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [quantity, setQuantity] = useState('');
  const [targetUSDCPrice, setTargetUSDCPrice] = useState('');
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

  // Calculate estimated USDC value when inputs change
  useEffect(() => {
    if (selectedToken && bidAmount && tokenPrices[selectedToken.address]) {
      const tokenPrice = tokenPrices[selectedToken.address];
      const estimated = parseFloat(bidAmount) * tokenPrice;
      setEstimatedUSDCValue(estimated);
      
      // Auto-calculate target USDC price if quantity is set
      if (quantity) {
        const autoPrice = estimated / parseFloat(quantity);
        setTargetUSDCPrice(autoPrice.toFixed(6));
      }
    }
  }, [selectedToken, bidAmount, quantity, tokenPrices]);

  const loadTokenPrices = async () => {
    try {
      if (!BACKEND_API_BASE_URL) {
        console.warn('VITE_BACKEND_API_BASE_URL not set, skipping token price loading');
        return;
      }
      
      console.log('🔍 Debug - Loading token prices from:', `${BACKEND_API_BASE_URL}/token_prices`);
      const response = await fetch(`${BACKEND_API_BASE_URL}/token_prices`);
      const prices = await response.json();
      console.log('🔍 Debug - Token prices loaded:', prices);
      setTokenPrices(prices);
    } catch (error) {
      console.error('Failed to load token prices:', error);
    }
  };

  const generatePermitDomain = (tokenAddress: string) => {
    console.log('🔍 Debug - Generating permit domain for token:', tokenAddress);
    
    // Generate permit domain based on token (most ERC20 tokens follow similar patterns)
    const commonDomains: Record<string, any> = {
      // USDC
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': {
        name: 'USD Coin',
        version: '2',
        chainId: 42161,
        verifyingContract: tokenAddress,
      },
      // WETH (usually doesn't have permit, would need different handling)
      '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': {
        name: 'Wrapped Ether',
        version: '1',
        chainId: 42161,
        verifyingContract: tokenAddress,
      },
    };

    // Generic ERC20 permit fallback
    const defaultDomain = {
      name: selectedToken?.name || 'ERC20',
      version: '1',
      chainId: 42161,
      verifyingContract: tokenAddress,
    };

    const domain = commonDomains[tokenAddress.toLowerCase()] || defaultDomain;
    console.log('🔍 Debug - Generated domain:', domain);
    return domain;
  };

  const handleSubmitBid = async () => {
    console.log('🔍 Debug - Starting bid submission with:', {
      address,
      selectedToken: selectedToken?.symbol,
      bidAmount,
      quantity,
      targetUSDCPrice,
    });

    if (!address || !selectedToken || !bidAmount || !quantity || !targetUSDCPrice) {
      toast({
        title: 'Missing Information',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Calculate amounts with proper decimals
      const bidAmountWei = BigInt(Math.floor(parseFloat(bidAmount) * Math.pow(10, selectedToken.decimals)));
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60); // 1 week

      console.log('🔐 Signing permit for token:', selectedToken.symbol);

      // Debug environment variables
      console.log('🔍 Debug - Environment variables:', {
        VITE_MULTI_TOKEN_RESOLVER_ADDRESS: import.meta.env.VITE_MULTI_TOKEN_RESOLVER_ADDRESS,
        VITE_BACKEND_API_BASE_URL: import.meta.env.VITE_BACKEND_API_BASE_URL,
      });

      // Generate permit signature for the selected token
      // IMPORTANT: Spender is our MultiTokenAuctionResolver contract
      const resolverAddress = import.meta.env.VITE_MULTI_TOKEN_RESOLVER_ADDRESS;
      if (!resolverAddress) {
        throw new Error('VITE_MULTI_TOKEN_RESOLVER_ADDRESS not set in environment variables');
      }

      const permitMessage = {
        owner: address as `0x${string}`,
        spender: resolverAddress as `0x${string}`,
        value: bidAmountWei,
        nonce: 0n, // Would need to fetch actual nonce from token contract
        deadline: deadline,
      };

      console.log('🔍 Debug - Permit message:', permitMessage);

      const permitDomain = generatePermitDomain(selectedToken.address);
      console.log('🔍 Debug - Permit domain:', permitDomain);

      const permitSignature = await signTypedDataAsync({
        domain: permitDomain,
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        message: permitMessage,
        account: address as `0x${string}`,
      });

      // Split permit signature
      const sig = permitSignature.slice(2);
      const r = `0x${sig.slice(0, 64)}`;
      const s = `0x${sig.slice(64, 128)}`;
      const v = parseInt(sig.slice(128, 130), 16);

      console.log('📝 Creating multi-token bid...');

      // Submit multi-token bid
      const bidData = {
        launchId,
        userWallet: address,
        bidTokenAddress: selectedToken.address,
        bidTokenAmount: bidAmountWei.toString(),
        bidTokenSymbol: selectedToken.symbol,
        targetUSDCPrice: parseFloat(targetUSDCPrice),
        quantity: parseInt(quantity),
        permit: {
          owner: address,
          spender: resolverAddress,
          value: bidAmountWei.toString(),
          deadline: deadline.toString(),
          v,
          r,
          s,
        },
        bidSignature: permitSignature, // For now, using same signature
      };

      console.log('🔍 Debug - Submitting bid data:', bidData);
      console.log('🔍 Debug - API URL:', `${BACKEND_API_BASE_URL}/create_multi_token_bid`);

      const response = await fetch(`${BACKEND_API_BASE_URL}/create_multi_token_bid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bidData),
      });

      console.log('🔍 Debug - Response status:', response.status);
      console.log('🔍 Debug - Response headers:', response.headers);

      if (!response.ok) {
        let errorText;
        try {
          const errorData = await response.json();
          console.log('🔍 Debug - Error response data:', errorData);
          errorText = errorData.error || 'Failed to submit bid';
        } catch (parseError) {
          console.log('🔍 Debug - Could not parse error response as JSON');
          errorText = await response.text();
          console.log('🔍 Debug - Error response text:', errorText);
        }
        throw new Error(errorText);
      }

      const result = await response.json();

      toast({
        title: 'Multi-Token Bid Submitted! 🎉',
        description: `Bid placed with ${bidAmount} ${selectedToken.symbol}. Will be converted to USDC if winning.`,
      });

      // Reset form
      setBidAmount('');
      setQuantity('');
      setTargetUSDCPrice('');
      setSelectedToken(null);

      onBidSubmitted();
    } catch (error) {
      console.error('Error submitting multi-token bid:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to submit bid',
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
          <Coins className="h-5 w-5" />
          Multi-Token Bid
        </CardTitle>
        <CardDescription>
          Bid with any supported token. We'll convert to USDC if you win using 1inch Fusion.
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
                    {token.symbol === 'USDC' && (
                      <Badge variant="secondary" className="text-xs">Direct</Badge>
                    )}
                    {token.symbol !== 'USDC' && (
                      <Badge variant="outline" className="text-xs">
                        <Zap className="h-3 w-3 mr-1" />
                        Fusion
                      </Badge>
                    )}
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
                  {selectedToken.symbol !== 'USDC' && (
                    <span className="ml-1">(via 1inch Fusion)</span>
                  )}
                </p>
              )}
            </div>

            {/* Quantity */}
            <div className="space-y-2">
              <Label htmlFor="quantity">
                {auctionTokenSymbol} Tokens Wanted
              </Label>
              <Input
                id="quantity"
                type="number"
                placeholder={`Enter ${auctionTokenSymbol} quantity`}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>

            {/* Target USDC Price */}
            <div className="space-y-2">
              <Label htmlFor="target-price">
                Indicative Price (USDC per {auctionTokenSymbol})
              </Label>
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted">
                <span className="text-muted-foreground">$</span>
                <span className="font-mono">{targetUSDCPrice || '0.000000'}</span>
                <span className="text-muted-foreground">USDC</span>
              </div>
              <p className="text-xs text-muted-foreground">
                This is your current effective price based on {selectedToken?.symbol} price. Final price at settlement may vary.
              </p>
            </div>

            {/* Summary */}
            {bidAmount && quantity && targetUSDCPrice && (
              <div className="p-3 bg-muted rounded-lg space-y-1">
                <p className="text-sm font-medium">Bid Summary:</p>
                <p className="text-sm">
                  • Bidding: {bidAmount} {selectedToken.symbol}
                </p>
                <p className="text-sm">
                  • For: {quantity} {auctionTokenSymbol}
                </p>
                <p className="text-sm">
                  • Effective price: ${targetUSDCPrice} USDC per token
                </p>
                {selectedToken.symbol !== 'USDC' && (
                  <p className="text-xs text-muted-foreground mt-2">
                    ⚡ Your {selectedToken.symbol} will be converted to USDC via 1inch Fusion if you win
                  </p>
                )}
              </div>
            )}

            <Button 
              onClick={handleSubmitBid} 
              disabled={!bidAmount || !quantity || !targetUSDCPrice || isSubmitting}
              className="w-full"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSubmitting ? 'Submitting Bid...' : `Submit ${selectedToken.symbol} Bid`}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};