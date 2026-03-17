-- CMS ownership records
CREATE TABLE provider_ownership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  operator_id UUID REFERENCES operators(id),
  owner_name VARCHAR NOT NULL,
  owner_type VARCHAR,
  ownership_pct DECIMAL(5,2),
  effective_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Annual payment records
CREATE TABLE payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  fiscal_year INT NOT NULL,
  medicare_payments DECIMAL(14,2),
  total_charges DECIMAL(14,2),
  total_days INT,
  total_patients INT,
  data_source VARCHAR,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_payment_history_provider_year
  ON payment_history(provider_id, fiscal_year);

-- Inspection deficiency records
CREATE TABLE deficiencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  survey_date DATE NOT NULL,
  deficiency_tag VARCHAR,
  deficiency_desc TEXT,
  scope_severity VARCHAR,
  category VARCHAR,
  corrected BOOLEAN,
  correction_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deficiencies_provider_survey
  ON deficiencies(provider_id, survey_date);

-- Financial penalties
CREATE TABLE penalties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  penalty_date DATE NOT NULL,
  penalty_type VARCHAR,
  amount DECIMAL(14,2),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_penalties_provider ON penalties(provider_id);
