-- Intent-Based Bidding System
-- This migration creates tables for intent-based bids that work with ANY token
-- (not just permit-enabled tokens)

-- Create intent_bids table
CREATE TABLE IF NOT EXISTS intent_bids (
    id TEXT PRIMARY KEY, -- Hash of the intent signature
    launch_id TEXT NOT NULL,
    user_wallet TEXT NOT NULL,
    bid_token_address TEXT NOT NULL,
    bid_token_amount TEXT NOT NULL,
    bid_token_symbol TEXT NOT NULL,
    auction_token_address TEXT NOT NULL,
    max_auction_tokens TEXT NOT NULL,
    max_effective_price_usdc DECIMAL(20, 6) NOT NULL,
    intent_signature TEXT NOT NULL,
    intent_data JSONB NOT NULL, -- Structured intent data
    deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    nonce TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    failure_reason TEXT,
    
    -- Execution details
    fusion_order_hash TEXT,
    execution_tx_hash TEXT,
    tokens_received TEXT,
    
    -- Pricing at settlement
    current_token_price_usdc DECIMAL(20, 6),
    effective_usdc_value DECIMAL(20, 6),
    effective_usdc_price DECIMAL(20, 6),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_intent_bids_launch_id ON intent_bids(launch_id);
CREATE INDEX IF NOT EXISTS idx_intent_bids_user_wallet ON intent_bids(user_wallet);
CREATE INDEX IF NOT EXISTS idx_intent_bids_status ON intent_bids(status);
CREATE INDEX IF NOT EXISTS idx_intent_bids_deadline ON intent_bids(deadline);
CREATE INDEX IF NOT EXISTS idx_intent_bids_effective_price ON intent_bids(effective_usdc_price DESC);

-- Create unique constraint on nonce per user to prevent replay attacks
CREATE UNIQUE INDEX IF NOT EXISTS idx_intent_bids_user_nonce ON intent_bids(user_wallet, nonce);

-- Add check constraints
ALTER TABLE intent_bids ADD CONSTRAINT chk_intent_status 
    CHECK (status IN ('pending', 'executed', 'failed', 'expired'));

-- Add triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_intent_bids_updated_at 
    BEFORE UPDATE ON intent_bids 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create intent_executions table for tracking batch executions
CREATE TABLE IF NOT EXISTS intent_executions (
    id SERIAL PRIMARY KEY,
    launch_id TEXT NOT NULL,
    execution_batch_id TEXT NOT NULL,
    total_intents INTEGER NOT NULL,
    successful_intents INTEGER NOT NULL,
    failed_intents INTEGER NOT NULL,
    clearing_price DECIMAL(20, 6),
    total_usdc_raised DECIMAL(20, 2),
    execution_method TEXT NOT NULL DEFAULT 'fusion', -- 'fusion', 'direct', etc.
    execution_tx_hash TEXT,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intent_executions_launch_id ON intent_executions(launch_id);
CREATE INDEX IF NOT EXISTS idx_intent_executions_batch_id ON intent_executions(execution_batch_id);

-- Add comments for documentation
COMMENT ON TABLE intent_bids IS 'Stores intent-based bids that work with any token (no permit required)';
COMMENT ON COLUMN intent_bids.intent_signature IS 'EIP-712 signature of the bid intent';
COMMENT ON COLUMN intent_bids.intent_data IS 'Structured intent data matching EIP-712 schema';
COMMENT ON COLUMN intent_bids.max_effective_price_usdc IS 'Maximum price per auction token in USDC the bidder is willing to pay';
COMMENT ON COLUMN intent_bids.nonce IS 'Unique nonce to prevent replay attacks';
COMMENT ON COLUMN intent_bids.fusion_order_hash IS '1inch Fusion order hash if executed via Fusion';

COMMENT ON TABLE intent_executions IS 'Tracks batch execution of intent-based auctions';