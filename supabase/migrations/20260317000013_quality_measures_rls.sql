ALTER TABLE quality_measures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quality_measures_public_read" ON quality_measures
  FOR SELECT USING (true);
