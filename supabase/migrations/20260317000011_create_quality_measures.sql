CREATE TABLE quality_measures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  measure_code VARCHAR NOT NULL,
  measure_name VARCHAR,
  score DECIMAL(8,2),
  national_avg DECIMAL(8,2),
  state_avg DECIMAL(8,2),
  period VARCHAR,
  data_source VARCHAR,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_quality_measures_provider_measure
  ON quality_measures(provider_id, measure_code);

CREATE INDEX idx_quality_measures_measure_code
  ON quality_measures(measure_code);

CREATE TRIGGER quality_measures_updated_at
  BEFORE UPDATE ON quality_measures
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
