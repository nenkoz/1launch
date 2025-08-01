-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create launches table
CREATE TABLE launches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_name VARCHAR(255) NOT NULL,
  token_symbol VARCHAR(10) NOT NULL,
  description TEXT,
  total_supply BIGINT NOT NULL,
  target_allocation BIGINT NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  status VARCHAR(20) DEFAULT 'live' CHECK (status IN ('live', 'ending_soon', 'completed')),
  participants INTEGER DEFAULT 0,
  is_launched BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create bids table
CREATE TABLE bids (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  launch_id UUID REFERENCES launches(id) ON DELETE CASCADE,
  price DECIMAL(18, 6) NOT NULL,
  quantity BIGINT NOT NULL,
  wallet_address VARCHAR(42),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_launches_status ON launches(status);
CREATE INDEX idx_launches_end_time ON launches(end_time);
CREATE INDEX idx_bids_launch_id ON bids(launch_id);
CREATE INDEX idx_bids_wallet_address ON bids(wallet_address);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for launches table
CREATE TRIGGER update_launches_updated_at 
    BEFORE UPDATE ON launches 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE launches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids ENABLE ROW LEVEL SECURITY;

-- Create policies (allow all operations for now, can be restricted later)
CREATE POLICY "Allow all operations on launches" ON launches FOR ALL USING (true);
CREATE POLICY "Allow all operations on bids" ON bids FOR ALL USING (true);