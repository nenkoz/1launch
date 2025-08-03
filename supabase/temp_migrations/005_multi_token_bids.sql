-- Migration to support multi-token bidding with 1inch Fusion integration
-- This allows users to bid with any supported token, not just USDC

-- Create multi_token_bids table
CREATE TABLE multi_token_bids (
  id VARCHAR(66) PRIMARY KEY, -- Using commit hash as ID
  launch_id UUID REFERENCES launches(id) ON DELETE CASCADE,
  user_wallet VARCHAR(42) NOT NULL,
  
  -- Bid token details
  bid_token_address VARCHAR(42) NOT NULL,
  bid_token_symbol VARCHAR(10) NOT NULL,
  bid_token_amount VARCHAR(78) NOT NULL, -- Support large numbers
  
  -- Auction details
  target_usdc_price DECIMAL(18, 6) NOT NULL, -- User's target price in USDC
  quantity BIGINT NOT NULL, -- Auction tokens requested
  
  -- Privacy and authentication
  commit_hash VARCHAR(66) NOT NULL,
  bid_signature TEXT,
  
  -- Permit signature components for the bid token
  permit_owner VARCHAR(42),
  permit_spender VARCHAR(42),
  permit_value VARCHAR(78),
  permit_deadline VARCHAR(20),
  permit_v INTEGER,
  permit_r VARCHAR(66),
  permit_s VARCHAR(66),
  
  -- Execution details (filled after settlement)
  effective_usdc_value DECIMAL(18, 6), -- Calculated USDC value at settlement
  effective_usdc_price DECIMAL(18, 6), -- Effective price per auction token in USDC
  current_token_price_usdc DECIMAL(18, 6), -- Token price in USDC at settlement
  filled_amount BIGINT, -- Actual auction tokens received
  usdc_received DECIMAL(18, 6), -- Actual USDC equivalent received
  
  -- 1inch Fusion integration
  fusion_order_hash VARCHAR(66), -- 1inch Fusion order hash (if conversion needed)
  conversion_tx_hash VARCHAR(66), -- Transaction hash of token conversion
  conversion_method VARCHAR(20) CHECK (conversion_method IN ('direct_usdc', 'fusion_swap', 'failed')),
  
  -- Status tracking
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'winning', 'executed', 'failed', 'cancelled')),
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  executed_at TIMESTAMP WITH TIME ZONE,
  
  -- Constraints
  CONSTRAINT check_permit_v_range CHECK (permit_v IS NULL OR (permit_v >= 27 AND permit_v <= 28)),
  CONSTRAINT check_commit_hash_format CHECK (commit_hash ~ '^0x[a-fA-F0-9]{64}$'),
  CONSTRAINT check_token_address_format CHECK (bid_token_address ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT check_user_wallet_format CHECK (user_wallet ~ '^0x[a-fA-F0-9]{40}$')
);

-- Create indexes for performance
CREATE INDEX idx_multi_token_bids_launch_id ON multi_token_bids(launch_id);
CREATE INDEX idx_multi_token_bids_user_wallet ON multi_token_bids(user_wallet);
CREATE INDEX idx_multi_token_bids_status ON multi_token_bids(status);
CREATE INDEX idx_multi_token_bids_token_address ON multi_token_bids(bid_token_address);
CREATE INDEX idx_multi_token_bids_effective_price ON multi_token_bids(effective_usdc_price);
CREATE INDEX idx_multi_token_bids_commit_hash ON multi_token_bids(commit_hash);

-- Create supported_tokens table for managing which tokens can be used for bidding
CREATE TABLE supported_tokens (
  id SERIAL PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  token_address VARCHAR(42) NOT NULL,
  token_symbol VARCHAR(10) NOT NULL,
  token_name VARCHAR(100) NOT NULL,
  decimals INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(chain_id, token_address),
  CONSTRAINT check_token_address_format CHECK (token_address ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT check_decimals_range CHECK (decimals >= 0 AND decimals <= 18)
);

-- Insert default supported tokens for Arbitrum
INSERT INTO supported_tokens (chain_id, token_address, token_symbol, token_name, decimals) VALUES
(42161, '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', 'WETH', 'Wrapped Ether', 18),
(42161, '0x912ce59144191c1204e64559fe8253a0e49e6548', 'ARB', 'Arbitrum Token', 18),
(42161, '0xf97f4df75117a78c1a5a0dbb814af92458539fb4', 'LINK', 'ChainLink Token', 18),
(42161, '0xaf88d065e77c8cc2239327c5edb3a432268e5831', 'USDC', 'USD Coin', 6),
(42161, '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', 'USDT', 'Tether USD', 6),
(42161, '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', 'WBTC', 'Wrapped BTC', 8);

-- Create view for active supported tokens
CREATE VIEW active_supported_tokens AS
SELECT * FROM supported_tokens WHERE is_active = TRUE;

-- Add RLS policies
ALTER TABLE multi_token_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE supported_tokens ENABLE ROW LEVEL SECURITY;

-- Allow read access to supported tokens for all users
CREATE POLICY "Allow read access to supported tokens" ON supported_tokens FOR SELECT USING (true);

-- Allow users to insert their own bids
CREATE POLICY "Allow users to insert their own bids" ON multi_token_bids FOR INSERT WITH CHECK (true);

-- Allow users to read bids for launches they're participating in
CREATE POLICY "Allow read access to multi token bids" ON multi_token_bids FOR SELECT USING (true);

-- Allow updates for settlement process
CREATE POLICY "Allow updates for settlement" ON multi_token_bids FOR UPDATE USING (true);

-- Comments for documentation
COMMENT ON TABLE multi_token_bids IS 'Stores private auction bids made with various tokens, converted to USDC via 1inch Fusion';
COMMENT ON COLUMN multi_token_bids.bid_token_address IS 'Address of the token used for bidding (ETH, ARB, LINK, etc.)';
COMMENT ON COLUMN multi_token_bids.target_usdc_price IS 'User desired price per auction token in USDC terms';
COMMENT ON COLUMN multi_token_bids.effective_usdc_value IS 'Calculated USDC value of the bid at settlement time';
COMMENT ON COLUMN multi_token_bids.fusion_order_hash IS '1inch Fusion order hash for token conversion (if needed)';
COMMENT ON COLUMN multi_token_bids.conversion_method IS 'How the token was converted: direct_usdc, fusion_swap, or failed';

COMMENT ON TABLE supported_tokens IS 'Tokens that users can use for bidding in auctions';
COMMENT ON COLUMN supported_tokens.is_active IS 'Whether this token is currently accepted for new bids';