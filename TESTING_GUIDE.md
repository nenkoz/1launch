# Multi-Token Auction Testing Guide

## 🚀 Setup Instructions

### 1. Deploy Smart Contract
```bash
# Deploy the MultiTokenAuctionResolver contract
npx hardhat run scripts/deploy-multi-token-resolver.cjs --network arbitrum

# Note the deployed address and update your .env file
```

### 2. Update Environment Variables
```bash
# Add to your .env.local file:
VITE_MULTI_TOKEN_RESOLVER_ADDRESS=0x... # From deployment
MULTI_TOKEN_RESOLVER_ADDRESS=0x...      # Same address for backend
```

### 3. Apply Database Migration
```bash
# Run the multi-token bids migration
supabase migration up
# or manually apply: supabase/migrations/005_multi_token_bids.sql
```

### 4. Install Dependencies & Start Services
```bash
# Frontend
npm install
npm run dev

# Backend (in separate terminal)
cd api
npm install
node index.js
```

## 🧪 Testing Scenarios

### Scenario 1: USDC Bid (Direct)
1. Connect wallet with USDC balance
2. Create a new auction launch
3. Submit bid using USDC
4. ✅ **Expected**: Direct USDC transfer, no conversion needed

### Scenario 2: ETH Bid (Fusion Conversion)
1. Connect wallet with ETH balance
2. Submit bid using WETH
3. ✅ **Expected**: 1inch Fusion converts WETH → USDC → Auction tokens

### Scenario 3: Multiple Token Bids
1. Have users submit bids with different tokens:
   - User A: 1000 USDC @ $0.50/token
   - User B: 1 ETH @ $0.45/token (effective)
   - User C: 100 ARB @ $0.40/token (effective)
2. End auction
3. Settle with smart contract
4. ✅ **Expected**: Only winners' tokens get converted

### Scenario 4: Batch Settlement
1. Create auction with many multi-token bids (5+)
2. End auction
3. Settle with `useBatchExecution: true`
4. ✅ **Expected**: All winners executed in single transaction

## 🔍 Testing Endpoints

### Create Multi-Token Bid
```javascript
POST /create_multi_token_bid
{
  "launchId": "uuid",
  "userWallet": "0x...",
  "bidTokenAddress": "0x...", // WETH, ARB, LINK, etc.
  "bidTokenAmount": "1000000000000000000", // 1 ETH in wei
  "bidTokenSymbol": "WETH",
  "targetUSDCPrice": 0.5,
  "quantity": 2000,
  "permit": {
    "owner": "0x...",
    "spender": "0x...", // MultiTokenAuctionResolver address
    "value": "1000000000000000000",
    "deadline": "1234567890",
    "v": 27,
    "r": "0x...",
    "s": "0x..."
  },
  "bidSignature": "0x..."
}
```

### Settle Multi-Token Auction
```javascript
POST /settle_multi_token_auction
{
  "launchId": "uuid",
  "useBatchExecution": false // or true for batch
}
```

### Get Token Prices
```javascript
GET /token_prices
// Returns current token prices in USDC
```

## 🎯 Success Criteria

### ✅ Frontend Integration
- [ ] MultiTokenBidForm appears on auction pages
- [ ] Token selection dropdown works
- [ ] Permit signatures are generated correctly
- [ ] Real-time USDC value calculations display
- [ ] Bid submission succeeds

### ✅ Backend Processing  
- [ ] Multi-token bids stored in database
- [ ] Winner selection based on effective USDC prices
- [ ] Only winners' tokens get converted
- [ ] Losers marked as failed (no conversion)
- [ ] Smart contract execution succeeds

### ✅ Smart Contract Execution
- [ ] Permit allows contract to spend user tokens
- [ ] 1inch Fusion conversion works (non-USDC tokens)
- [ ] USDC bids execute directly
- [ ] Auction tokens distributed to users
- [ ] Batch execution works for multiple winners

### ✅ Database Consistency
- [ ] Bids stored with permit signatures
- [ ] Winner/loser status updated correctly
- [ ] Execution details recorded (tx hashes, methods)
- [ ] No orphaned or inconsistent records

## 🐛 Common Issues & Debugging

### Issue: Permit Signature Invalid
**Solution**: Check that spender address is MultiTokenAuctionResolver, not AuctionController

### Issue: Fusion Conversion Fails
**Solution**: Verify 1inch API key and that token has sufficient liquidity on Arbitrum

### Issue: Smart Contract Reverts
**Solution**: Check contract has sufficient gas, proper approvals, and correct calldata

### Issue: Winners Not Determined Correctly
**Solution**: Verify token price API returns accurate USDC values

## 📊 Monitoring & Logs

Monitor these logs during testing:

```bash
# Backend logs
🔄 Starting optimized multi-token auction settlement
📝 Calculating theoretical USDC values for bid comparison  
🏆 Winners and losers determined (no tokens converted yet)
⚡ Starting token conversions for winners only
✅ Smart contract multi-token auction settled successfully

# Frontend logs  
🔐 Signing permit for token: WETH
📝 Creating multi-token bid...
✅ Private bid created
🎉 Multi-Token Auction Settled!
```

## 🎉 Success Confirmation

You'll know it's working when:
1. Users can bid with any supported token (ETH, ARB, LINK, USDC, USDT)
2. Only winning bidders' tokens get converted (losers' tokens untouched)
3. 1inch Fusion provides competitive conversion rates
4. All happens gaslessly for users
5. Auction tokens are distributed correctly to winners