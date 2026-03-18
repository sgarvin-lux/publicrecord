-- Update unique constraint to include data_source, preventing silent overwrites
-- when the same measure_code appears across different provider types (e.g. cms-mds vs cms-hospice-claims)
DROP INDEX idx_quality_measures_provider_measure;
CREATE UNIQUE INDEX idx_quality_measures_provider_measure ON quality_measures(provider_id, measure_code, data_source);
