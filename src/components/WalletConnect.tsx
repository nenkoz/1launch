import React from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Wallet, LogOut, ExternalLink, Copy, Check } from 'lucide-react';
import { useWeb3Modal } from '@web3modal/wagmi/react';
import { useState } from 'react';

export function WalletConnect() {
  const { open } = useWeb3Modal();
  const { address, isConnected, chain } = useAccount();
  const { disconnect } = useDisconnect();
  const [copied, setCopied] = useState(false);

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  const openBlockExplorer = () => {
    if (address && chain) {
      const explorerUrl = chain.blockExplorers?.default?.url;
      if (explorerUrl) {
        window.open(`${explorerUrl}/address/${address}`, '_blank');
      }
    }
  };

  if (isConnected && address) {
    return (
      <Card className="w-full max-w-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-success" />
              <span className="text-sm font-medium text-foreground">Connected</span>
            </div>
            <Badge variant="secondary" className="text-xs">
              {chain?.name || 'Unknown'}
            </Badge>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 bg-secondary/20 p-2 rounded-lg">
              <span className="text-sm font-mono text-foreground flex-1">
                {formatAddress(address)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => copyToClipboard(address)}
              >
                {copied ? (
                  <Check className="w-3 h-3 text-success" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={openBlockExplorer}
              >
                <ExternalLink className="w-3 h-3" />
              </Button>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => open({ view: 'Account' })}
              >
                Account
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => disconnect()}
                className="px-3"
              >
                <LogOut className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Button
      onClick={() => open()}
      variant="outline"
      className="flex items-center gap-2"
    >
      <Wallet className="w-4 h-4" />
      Connect Wallet
    </Button>
  );
}

export default WalletConnect;