-- Fusion-Based Bidding System
-- This migration creates tables for pure 1inch Fusion order based bids

-- Create fusion_bids table
CREATE TABLE IF NOT EXISTS fusion_bids (
    id TEXT PRIMARY KEY, -- Hash of the fusion order signature
    launch_id TEXT NOT NULL,
    user_wallet TEXT NOT NULL,
    bid_token_address TEXT NOT NULL,
    bid_token_amount TEXT NOT NULL,
    bid_token_symbol TEXT NOT NULL,
    auction_token_address TEXT NOT NULL,
    max_auction_tokens TEXT NOT NULL,
    max_effective_price_usdc DECIMAL(20, 6) NOT NULL,
    
    -- 1inch Fusion order details
    fusion_order JSONB NOT NULL, -- Complete 1inch Fusion order
    fusion_signature TEXT NOT NULL, -- User's signature of the order
    salt TEXT NOT NULL, -- Order salt for uniqueness
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending',
    failure_reason TEXT,
    
    -- Execution details (after submission to 1inch)
    fusion_order_hash TEXT, -- 1inch order hash
    submission_tx TEXT, -- Transaction hash when submitted to 1inch
    fill_tx TEXT, -- Transaction hash when order was filled
    
    -- Pricing at settlement
    current_token_price_usdc DECIMAL(20, 6),
    effective_usdc_value DECIMAL(20, 6),
    effective_usdc_price DECIMAL(20, 6),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_fusion_bids_launch_id ON fusion_bids(launch_id);
CREATE INDEX IF NOT EXISTS idx_fusion_bids_user_wallet ON fusion_bids(user_wallet);
CREATE INDEX IF NOT EXISTS idx_fusion_bids_status ON fusion_bids(status);
CREATE INDEX IF NOT EXISTS idx_fusion_bids_effective_price ON fusion_bids(effective_usdc_price DESC);
CREATE INDEX IF NOT EXISTS idx_fusion_bids_salt ON fusion_bids(salt);

-- Create unique constraint on salt to prevent replay attacks
CREATE UNIQUE INDEX IF NOT EXISTS idx_fusion_bids_salt_unique ON fusion_bids(salt);

-- Add check constraints
ALTER TABLE fusion_bids ADD CONSTRAINT chk_fusion_status 
    CHECK (status IN ('pending', 'submitted', 'filled', 'failed', 'expired'));

-- Add triggers for updated_at
CREATE TRIGGER update_fusion_bids_updated_at 
    BEFORE UPDATE ON fusion_bids 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create fusion_executions table for tracking batch settlements
CREATE TABLE IF NOT EXISTS fusion_executions (
    id SERIAL PRIMARY KEY,
    launch_id TEXT NOT NULL,
    execution_batch_id TEXT NOT NULL,
    total_fusion_bids INTEGER NOT NULL,
    submitted_orders INTEGER NOT NULL,
    failed_submissions INTEGER NOT NULL,
    clearing_price DECIMAL(20, 6),
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fusion_executions_launch_id ON fusion_executions(launch_id);
CREATE INDEX IF NOT EXISTS idx_fusion_executions_batch_id ON fusion_executions(execution_batch_id);

-- Add comments for documentation
COMMENT ON TABLE fusion_bids IS 'Stores 1inch Fusion order based bids that work with any token';
COMMENT ON COLUMN fusion_bids.fusion_order IS 'Complete 1inch Fusion order data matching their API schema';
COMMENT ON COLUMN fusion_bids.fusion_signature IS 'User signature of the Fusion order, authorizing the token swap';
COMMENT ON COLUMN fusion_bids.salt IS 'Unique salt from the Fusion order to prevent replay attacks';
COMMENT ON COLUMN fusion_bids.max_effective_price_usdc IS 'Maximum price per auction token in USDC the bidder is willing to pay';

COMMENT ON TABLE fusion_executions IS 'Tracks batch execution of Fusion-based auctions';