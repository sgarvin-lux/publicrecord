-- Make penalty_type and amount NOT NULL to support unique constraint
-- penalty_type is always present in CMS data; amount defaults to 0 for Payment Denials
ALTER TABLE penalties ALTER COLUMN penalty_type SET NOT NULL;
ALTER TABLE penalties ALTER COLUMN amount SET NOT NULL;
ALTER TABLE penalties ALTER COLUMN amount SET DEFAULT 0;

-- Add unique constraint for penalty upserts
ALTER TABLE penalties
  ADD CONSTRAINT uq_penalties_natural_key
  UNIQUE (provider_id, penalty_date, penalty_type, amount);
