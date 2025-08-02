-- Migration to support permit-based private bids
-- This adds the necessary fields for storing ERC20 permit signatures and bid commits

-- Update private_bids table to include permit signature components
ALTER TABLE private_bids ADD COLUMN IF NOT EXISTS commit_hash VARCHAR(66); -- 0x + 64 hex chars
ALTER TABLE private_bids ADD COLUMN IF NOT EXISTS bid_nonce VARCHAR(255);
ALTER TABLE private_bids ADD COLUMN IF NOT EXISTS permit_owner VARCHAR(42);
ALTER TABLE private_bids ADD COLUMN IF NOT EXISTS permit_spender VARCHAR(42);
ALTER TABLE private_bids ADD COLUMN IF NOT EXISTS permit_value VARCHAR(78); -- Support very large numbers
ALTER TABLE private_bids ADD COLUMN IF NOT EXISTS permit_deadline VARCHAR(20); -- Unix timestamp
ALTER TABLE private_bids ADD COLUMN IF NOT EXISTS permit_v INTEGER;
ALTER TABLE private_bids ADD COLUMN IF NOT EXISTS permit_r VARCHAR(66);
ALTER TABLE private_bids ADD COLUMN IF NOT EXISTS permit_s VARCHAR(66);
ALTER TABLE private_bids ADD COLUMN IF NOT EXISTS bid_signature TEXT;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_private_bids_commit_hash ON private_bids(commit_hash);
CREATE INDEX IF NOT EXISTS idx_private_bids_permit_owner ON private_bids(permit_owner);
CREATE INDEX IF NOT EXISTS idx_private_bids_status ON private_bids(status);

-- Add constraints for permit signature validation
ALTER TABLE private_bids ADD CONSTRAINT check_permit_v_range CHECK (permit_v IS NULL OR (permit_v >= 27 AND permit_v <= 28));
ALTER TABLE private_bids ADD CONSTRAINT check_commit_hash_format CHECK (commit_hash IS NULL OR commit_hash ~ '^0x[a-fA-F0-9]{64}$');
ALTER TABLE private_bids ADD CONSTRAINT check_permit_r_format CHECK (permit_r IS NULL OR permit_r ~ '^0x[a-fA-F0-9]{64}$');
ALTER TABLE private_bids ADD CONSTRAINT check_permit_s_format CHECK (permit_s IS NULL OR permit_s ~ '^0x[a-fA-F0-9]{64}$');

-- Update the table comment
COMMENT ON TABLE private_bids IS 'Stores private auction bids with ERC20 permit signatures for deferred execution';
COMMENT ON COLUMN private_bids.commit_hash IS 'Hash of the bid details for privacy during auction period';
COMMENT ON COLUMN private_bids.bid_nonce IS 'Random nonce used in commit hash generation';
COMMENT ON COLUMN private_bids.permit_owner IS 'Address that owns the USDC tokens (bidder)';
COMMENT ON COLUMN private_bids.permit_spender IS 'Address authorized to spend USDC (auction controller)';
COMMENT ON COLUMN private_bids.permit_value IS 'Maximum USDC amount authorized for spending';
COMMENT ON COLUMN private_bids.permit_deadline IS 'Unix timestamp when permit expires';
COMMENT ON COLUMN private_bids.permit_v IS 'Recovery parameter of permit signature';
COMMENT ON COLUMN private_bids.permit_r IS 'R component of permit signature';
COMMENT ON COLUMN private_bids.permit_s IS 'S component of permit signature';
COMMENT ON COLUMN private_bids.bid_signature IS 'Signature of the bid commitment for authenticity';