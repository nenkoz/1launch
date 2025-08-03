-- Resolver-Based Fusion Bidding System
-- This migration creates tables for the smart contract intermediary approach

-- Create resolver_fusion_bids table
CREATE TABLE IF NOT EXISTS resolver_fusion_bids (
    id TEXT PRIMARY KEY, -- Hash of the fusion order signature
    launch_id TEXT NOT NULL,
    user_wallet TEXT NOT NULL,
    bid_token_address TEXT NOT NULL,
    bid_token_amount TEXT NOT NULL,
    bid_token_symbol TEXT NOT NULL,
    auction_token_address TEXT NOT NULL,
    max_auction_tokens TEXT NOT NULL,
    max_effective_price_usdc DECIMAL(20, 6) NOT NULL,
    
    -- 1inch Fusion order details (always converts to USDC)
    expected_usdc_amount TEXT NOT NULL, -- Expected USDC from 1inch swap
    fusion_order JSONB NOT NULL, -- Complete 1inch Fusion order (→ USDC, receiver = our contract)
    fusion_signature TEXT NOT NULL, -- User's signature of the order
    salt TEXT NOT NULL, -- Order salt for uniqueness
    
    -- Execution tracking
    status TEXT NOT NULL DEFAULT 'pending',
    failure_reason TEXT,
    
    -- 1inch Fusion execution
    fusion_order_hash TEXT, -- 1inch order hash
    fusion_submission_tx TEXT, -- Transaction when submitted to 1inch
    fusion_fill_tx TEXT, -- Transaction when 1inch filled the order
    usdc_received TEXT, -- Actual USDC received by our contract
    
    -- Smart contract distribution
    distribution_tx TEXT, -- Transaction hash of our contract distributing auction tokens
    auction_tokens_distributed TEXT, -- Actual auction tokens given to user
    
    -- Pricing at settlement
    current_token_price_usdc DECIMAL(20, 6),
    effective_usdc_value DECIMAL(20, 6),
    effective_usdc_price DECIMAL(20, 6),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_resolver_fusion_bids_launch_id ON resolver_fusion_bids(launch_id);
CREATE INDEX IF NOT EXISTS idx_resolver_fusion_bids_user_wallet ON resolver_fusion_bids(user_wallet);
CREATE INDEX IF NOT EXISTS idx_resolver_fusion_bids_status ON resolver_fusion_bids(status);
CREATE INDEX IF NOT EXISTS idx_resolver_fusion_bids_effective_price ON resolver_fusion_bids(effective_usdc_price DESC);
CREATE INDEX IF NOT EXISTS idx_resolver_fusion_bids_salt ON resolver_fusion_bids(salt);

-- Create unique constraint on salt to prevent replay attacks
CREATE UNIQUE INDEX IF NOT EXISTS idx_resolver_fusion_bids_salt_unique ON resolver_fusion_bids(salt);

-- Add check constraints
ALTER TABLE resolver_fusion_bids ADD CONSTRAINT chk_resolver_fusion_status 
    CHECK (status IN ('pending', 'fusion_submitted', 'fusion_filled', 'tokens_distributed', 'failed', 'expired'));

-- Add triggers for updated_at
CREATE TRIGGER update_resolver_fusion_bids_updated_at 
    BEFORE UPDATE ON resolver_fusion_bids 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create resolver_executions table for tracking batch settlements
CREATE TABLE IF NOT EXISTS resolver_executions (
    id SERIAL PRIMARY KEY,
    launch_id TEXT NOT NULL,
    execution_batch_id TEXT NOT NULL,
    total_bids INTEGER NOT NULL,
    fusion_submitted INTEGER NOT NULL,
    fusion_filled INTEGER NOT NULL,
    tokens_distributed INTEGER NOT NULL,
    failed_bids INTEGER NOT NULL,
    clearing_price DECIMAL(20, 6),
    total_usdc_collected DECIMAL(20, 2),
    total_auction_tokens_distributed TEXT,
    
    -- Transaction hashes
    fusion_submission_txs TEXT[], -- Array of 1inch submission transactions
    distribution_tx TEXT, -- Our smart contract distribution transaction
    
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resolver_executions_launch_id ON resolver_executions(launch_id);
CREATE INDEX IF NOT EXISTS idx_resolver_executions_batch_id ON resolver_executions(execution_batch_id);

-- Add comments for documentation
COMMENT ON TABLE resolver_fusion_bids IS 'Stores 1inch Fusion orders that use AuctionFusionResolver as intermediary';
COMMENT ON COLUMN resolver_fusion_bids.fusion_order IS '1inch Fusion order: bidToken → USDC, receiver = AuctionFusionResolver';
COMMENT ON COLUMN resolver_fusion_bids.expected_usdc_amount IS 'Expected USDC amount from 1inch Fusion swap';
COMMENT ON COLUMN resolver_fusion_bids.usdc_received IS 'Actual USDC received by AuctionFusionResolver contract';
COMMENT ON COLUMN resolver_fusion_bids.auction_tokens_distributed IS 'Auction tokens distributed to user by resolver contract';

COMMENT ON TABLE resolver_executions IS 'Tracks execution of resolver-based Fusion auctions with two-step process';