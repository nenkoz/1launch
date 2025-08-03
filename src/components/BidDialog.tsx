import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ResolverFusionBidForm } from './ResolverFusionBidForm';
import { Button } from '@/components/ui/button';

interface BidDialogProps {
  launchId: string;
  tokenSymbol: string;
  auctionTokenAddress: string;
  isActive: boolean;
  onBidSubmitted: () => void;
}

export function BidDialog({ launchId, tokenSymbol, auctionTokenAddress, isActive, onBidSubmitted }: BidDialogProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant={isActive ? "bid" : "secondary"}
          className="w-full"
          disabled={!isActive}
        >
          {isActive ? "Place Private Bid" : "Bidding Closed"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Place Your Bid for {tokenSymbol}</DialogTitle>
          <DialogDescription>
            Sign a 1inch Fusion order with ANY token! Our smart contract resolver handles everything automatically if you win.
          </DialogDescription>
        </DialogHeader>
        <ResolverFusionBidForm
          launchId={launchId}
          auctionTokenSymbol={tokenSymbol}
          auctionTokenAddress={auctionTokenAddress}
          onBidSubmitted={() => {
            setIsOpen(false);
            onBidSubmitted();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}