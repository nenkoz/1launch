-- Migration for 1inch Limit Order Protocol integration
-- Add blockchain-related fields to existing tables

-- Add token contract address and blockchain fields to launches table
ALTER TABLE launches ADD COLUMN IF NOT EXISTS token_address VARCHAR(42);
ALTER TABLE launches ADD COLUMN IF NOT EXISTS chain_id INTEGER DEFAULT 1;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS clearing_price DECIMAL(18, 6);
ALTER TABLE launches ADD COLUMN IF NOT EXISTS total_raised DECIMAL(18, 6);
ALTER TABLE launches ADD COLUMN IF NOT EXISTS auction_controller_address VARCHAR(42);

-- Add 1inch order related fields to bids table
ALTER TABLE bids ADD COLUMN IF NOT EXISTS order_hash VARCHAR(66);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS one_inch_order_id VARCHAR(255);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS order_status VARCHAR(20) DEFAULT 'pending' CHECK (order_status IN ('pending', 'active', 'filled', 'cancelled', 'expired'));
ALTER TABLE bids ADD COLUMN IF NOT EXISTS filled_amount BIGINT DEFAULT 0;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(66);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS block_number BIGINT;

-- Create new table for 1inch limit orders
CREATE TABLE IF NOT EXISTS limit_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bid_id UUID REFERENCES bids(id) ON DELETE CASCADE,
  order_hash VARCHAR(66) UNIQUE NOT NULL,
  maker_address VARCHAR(42) NOT NULL,
  maker_asset VARCHAR(42) NOT NULL,
  taker_asset VARCHAR(42) NOT NULL,
  making_amount DECIMAL(28, 0) NOT NULL,
  taking_amount DECIMAL(28, 0) NOT NULL,
  salt VARCHAR(78) NOT NULL,
  expiration BIGINT NOT NULL,
  allowed_sender VARCHAR(42),
  order_data JSONB NOT NULL,
  signature VARCHAR(132),
  status VARCHAR(20) DEFAULT 'created' CHECK (status IN ('created', 'active', 'filled', 'cancelled', 'expired')),
  filled_amount DECIMAL(28, 0) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create table for auction settlements
CREATE TABLE IF NOT EXISTS auction_settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  launch_id UUID REFERENCES launches(id) ON DELETE CASCADE,
  clearing_price DECIMAL(18, 6) NOT NULL,
  total_filled_quantity BIGINT NOT NULL,
  total_raised_amount DECIMAL(18, 6) NOT NULL,
  successful_bids_count INTEGER NOT NULL,
  settlement_tx_hash VARCHAR(66),
  settlement_block_number BIGINT,
  gas_used BIGINT,
  settled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_launches_token_address ON launches(token_address);
CREATE INDEX IF NOT EXISTS idx_launches_chain_id ON launches(chain_id);
CREATE INDEX IF NOT EXISTS idx_bids_order_hash ON bids(order_hash);
CREATE INDEX IF NOT EXISTS idx_bids_order_status ON bids(order_status);
CREATE INDEX IF NOT EXISTS idx_limit_orders_order_hash ON limit_orders(order_hash);
CREATE INDEX IF NOT EXISTS idx_limit_orders_maker_address ON limit_orders(maker_address);
CREATE INDEX IF NOT EXISTS idx_limit_orders_status ON limit_orders(status);
CREATE INDEX IF NOT EXISTS idx_auction_settlements_launch_id ON auction_settlements(launch_id);

-- Create trigger for limit_orders updated_at
CREATE TRIGGER update_limit_orders_updated_at 
    BEFORE UPDATE ON limit_orders 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to calculate auction clearing price
CREATE OR REPLACE FUNCTION calculate_clearing_price(
  p_launch_id UUID,
  p_target_allocation BIGINT
)
RETURNS TABLE(clearing_price DECIMAL(18, 6), filled_quantity BIGINT, successful_bids_count INTEGER) AS $$
DECLARE
  current_filled BIGINT := 0;
  current_price DECIMAL(18, 6) := 0;
  bid_count INTEGER := 0;
BEGIN
  -- Sort bids by price descending and calculate clearing
  FOR clearing_price, filled_quantity IN
    SELECT b.price, b.quantity
    FROM bids b
    WHERE b.launch_id = p_launch_id
    AND b.order_status = 'active'
    ORDER BY b.price DESC, b.created_at ASC
  LOOP
    IF current_filled + filled_quantity <= p_target_allocation THEN
      current_filled := current_filled + filled_quantity;
      current_price := clearing_price;
      bid_count := bid_count + 1;
    ELSE
      -- Partial fill for last bid
      IF current_filled < p_target_allocation THEN
        current_filled := p_target_allocation;
        current_price := clearing_price;
        bid_count := bid_count + 1;
      END IF;
      EXIT;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT current_price, current_filled, bid_count;
END;
$$ LANGUAGE plpgsql;

-- Update RLS policies to include new tables
CREATE POLICY "Allow all operations on limit_orders" ON limit_orders FOR ALL USING (true);
CREATE POLICY "Allow all operations on auction_settlements" ON auction_settlements FOR ALL USING (true);

-- Enable RLS on new tables
ALTER TABLE limit_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_settlements ENABLE ROW LEVEL SECURITY; 