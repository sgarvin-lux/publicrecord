-- Make deficiency_tag NOT NULL for upsert natural key
ALTER TABLE deficiencies ALTER COLUMN deficiency_tag SET NOT NULL;

-- Unique constraint for upsert on (provider_id, survey_date, deficiency_tag)
ALTER TABLE deficiencies ADD CONSTRAINT uq_deficiencies_natural_key
  UNIQUE (provider_id, survey_date, deficiency_tag);
