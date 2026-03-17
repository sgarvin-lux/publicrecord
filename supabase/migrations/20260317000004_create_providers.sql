-- CMS-certified healthcare providers
CREATE TABLE providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cms_id VARCHAR UNIQUE NOT NULL,
  name VARCHAR NOT NULL,
  provider_type TEXT CHECK (provider_type IN ('nursing_home', 'home_health', 'hospice')),
  address VARCHAR,
  city VARCHAR,
  state VARCHAR(2),
  zip VARCHAR(10),
  lat DECIMAL(9,6),
  lng DECIMAL(9,6),
  geom extensions.GEOMETRY(POINT, 4326),
  phone VARCHAR,
  ownership_type VARCHAR,
  operator_id UUID REFERENCES operators(id),
  star_rating_overall INT,
  star_rating_health INT,
  star_rating_staffing INT,
  star_rating_quality INT,
  is_sff BOOLEAN DEFAULT FALSE,
  is_sff_candidate BOOLEAN DEFAULT FALSE,
  annual_medicare_payments DECIMAL(14,2),
  payment_data_year INT,
  payment_data_source VARCHAR,
  charge_to_payment_ratio DECIMAL(6,2),
  risk_score INT,
  ete DECIMAL(14,2),
  cms_data_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_providers_state ON providers(state);
CREATE INDEX idx_providers_risk_score ON providers(risk_score);
CREATE INDEX idx_providers_ete ON providers(ete);
CREATE INDEX idx_providers_operator_id ON providers(operator_id);
CREATE INDEX idx_providers_geom ON providers USING GIST(geom);

CREATE TRIGGER providers_updated_at
  BEFORE UPDATE ON providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
