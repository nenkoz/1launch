-- Create private_bids table
CREATE TABLE IF NOT EXISTS private_bids (
    id TEXT PRIMARY KEY,
    launch_id UUID NOT NULL REFERENCES launches(id) ON DELETE CASCADE,
    user_wallet TEXT NOT NULL,
    price DECIMAL(20, 6) NOT NULL,
    quantity DECIMAL(20, 18) NOT NULL,
    taker_asset TEXT NOT NULL,
    auction_end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'cancelled', 'executed')),
    order_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    submitted_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    executed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_private_bids_launch_id ON private_bids(launch_id);
CREATE INDEX IF NOT EXISTS idx_private_bids_user_wallet ON private_bids(user_wallet);
CREATE INDEX IF NOT EXISTS idx_private_bids_status ON private_bids(status);
CREATE INDEX IF NOT EXISTS idx_private_bids_created_at ON private_bids(created_at);

-- Create a function to get pending bids for a launch
CREATE OR REPLACE FUNCTION get_pending_bids_for_launch(p_launch_id TEXT)
RETURNS TABLE (
    id TEXT,
    user_wallet TEXT,
    price DECIMAL(20, 6),
    quantity DECIMAL(20, 18),
    taker_asset TEXT,
    auction_end_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pb.id,
        pb.user_wallet,
        pb.price,
        pb.quantity,
        pb.taker_asset,
        pb.auction_end_time,
        pb.created_at
    FROM private_bids pb
    WHERE pb.launch_id = p_launch_id
    AND pb.status = 'pending'
    ORDER BY pb.price DESC, pb.created_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Create a function to get bid statistics for a launch
CREATE OR REPLACE FUNCTION get_bid_statistics_for_launch(p_launch_id TEXT)
RETURNS TABLE (
    total_bids INTEGER,
    pending_bids INTEGER,
    submitted_bids INTEGER,
    cancelled_bids INTEGER,
    executed_bids INTEGER,
    total_quantity DECIMAL(20, 18),
    avg_price DECIMAL(20, 6),
    min_price DECIMAL(20, 6),
    max_price DECIMAL(20, 6)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::INTEGER as total_bids,
        COUNT(*) FILTER (WHERE status = 'pending')::INTEGER as pending_bids,
        COUNT(*) FILTER (WHERE status = 'submitted')::INTEGER as submitted_bids,
        COUNT(*) FILTER (WHERE status = 'cancelled')::INTEGER as cancelled_bids,
        COUNT(*) FILTER (WHERE status = 'executed')::INTEGER as executed_bids,
        COALESCE(SUM(quantity), 0) as total_quantity,
        COALESCE(AVG(price), 0) as avg_price,
        COALESCE(MIN(price), 0) as min_price,
        COALESCE(MAX(price), 0) as max_price
    FROM private_bids
    WHERE launch_id = p_launch_id;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS on private_bids table
ALTER TABLE private_bids ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own bids" ON private_bids
    FOR SELECT USING (auth.jwt() ->> 'wallet_address' = user_wallet);

CREATE POLICY "Users can create their own bids" ON private_bids
    FOR INSERT WITH CHECK (auth.jwt() ->> 'wallet_address' = user_wallet);

CREATE POLICY "Users can update their own pending bids" ON private_bids
    FOR UPDATE USING (auth.jwt() ->> 'wallet_address' = user_wallet AND status = 'pending');

-- Create a view for bid analytics
CREATE OR REPLACE VIEW bid_analytics AS
SELECT 
    l.id as launch_id,
    l.token_name as launch_name,
    l.status as launch_status,
    COUNT(pb.id) as total_bids,
    COUNT(pb.id) FILTER (WHERE pb.status = 'pending') as pending_bids,
    COUNT(pb.id) FILTER (WHERE pb.status = 'submitted') as submitted_bids,
    COUNT(pb.id) FILTER (WHERE pb.status = 'executed') as executed_bids,
    COALESCE(SUM(pb.quantity), 0) as total_quantity,
    COALESCE(AVG(pb.price), 0) as avg_price,
    COALESCE(MIN(pb.price), 0) as min_price,
    COALESCE(MAX(pb.price), 0) as max_price,
    l.created_at as launch_created_at,
    l.end_time as auction_end_time
FROM launches l
LEFT JOIN private_bids pb ON l.id = pb.launch_id
GROUP BY l.id, l.token_name, l.status, l.created_at, l.end_time;

-- Add comments for documentation
COMMENT ON TABLE private_bids IS 'Stores private auction bids before they are submitted to 1inch';
COMMENT ON COLUMN private_bids.id IS 'Unique bid identifier';
COMMENT ON COLUMN private_bids.launch_id IS 'Reference to the auction launch';
COMMENT ON COLUMN private_bids.user_wallet IS 'Wallet address of the bidder';
COMMENT ON COLUMN private_bids.price IS 'Bid price per token in USDC';
COMMENT ON COLUMN private_bids.quantity IS 'Number of tokens being bid for';
COMMENT ON COLUMN private_bids.taker_asset IS 'Token address being bid for';
COMMENT ON COLUMN private_bids.status IS 'Bid status: pending, submitted, cancelled, executed';
COMMENT ON COLUMN private_bids.order_hash IS '1inch order hash (set when submitted)';
COMMENT ON COLUMN private_bids.created_at IS 'When the bid was created';
COMMENT ON COLUMN private_bids.submitted_at IS 'When the bid was submitted to 1inch';
COMMENT ON COLUMN private_bids.cancelled_at IS 'When the bid was cancelled';
COMMENT ON COLUMN private_bids.executed_at IS 'When the bid was executed'; 