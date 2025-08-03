# AuctionFusionResolver Testing Setup

## Required Database Migrations (in order)

```bash
# Apply these migrations only:
1. 001_initial_schema.sql          # Basic schema
2. 002_blockchain_integration.sql  # Blockchain integration  
3. 003_private_bids.sql            # Private bids (baseline)
4. 008_resolver_fusion_bids.sql    # Resolver Fusion approach
```

## Skip These Migrations (for other approaches)
```bash
# DO NOT apply these for resolver testing:
004_permit_based_bids.sql     # Permit approach
005_multi_token_bids.sql      # Multi-token approach  
006_intent_based_bids.sql     # Intent approach
007_fusion_based_bids.sql     # Pure Fusion approach
```

## Required Smart Contracts

```bash
# Deploy these contracts:
1. TokenFactory.sol               # Create auction tokens
2. AuctionController.sol          # Main auction logic
3. AuctionFusionResolver.sol      # NEW: Intermediary contract
```

## Required Backend Files

```bash
# Primary file:
api/fusion-resolver-auction.js   # Main resolver logic

# Integration:
api/index.js                     # Add resolver endpoints
```

## Required Frontend Components

```bash
# Need to create:
src/components/ResolverFusionBidForm.tsx  # New form for resolver approach
src/lib/resolver-fusion.ts               # Utilities for Fusion orders

# Update:
src/components/BidDialog.tsx             # Use new form
```

## Environment Variables

```bash
# Add to .env.local:
AUCTION_FUSION_RESOLVER_ADDRESS=0x...   # After deployment
ARBITRUM_RPC_URL=https://...            # For contract interactions
PRIVATE_KEY=0x...                       # For backend transactions
```