-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE deficiencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_photos ENABLE ROW LEVEL SECURITY;

-- Profiles: public read, own update
CREATE POLICY "profiles_public_read" ON profiles
  FOR SELECT USING (true);

CREATE POLICY "profiles_own_update" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Public data tables: public read
CREATE POLICY "operators_public_read" ON operators
  FOR SELECT USING (true);

CREATE POLICY "providers_public_read" ON providers
  FOR SELECT USING (true);

CREATE POLICY "provider_ownership_public_read" ON provider_ownership
  FOR SELECT USING (true);

CREATE POLICY "payment_history_public_read" ON payment_history
  FOR SELECT USING (true);

CREATE POLICY "deficiencies_public_read" ON deficiencies
  FOR SELECT USING (true);

CREATE POLICY "penalties_public_read" ON penalties
  FOR SELECT USING (true);

-- Submissions: read approved only, auth insert, moderator update
CREATE POLICY "submissions_read_approved" ON submissions
  FOR SELECT USING (
    status = 'approved'
    OR auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('moderator', 'admin'))
  );

CREATE POLICY "submissions_auth_insert" ON submissions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "submissions_moderator_update" ON submissions
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('moderator', 'admin'))
  );

-- Submission photos: same visibility as parent submission
CREATE POLICY "submission_photos_read" ON submission_photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = submission_id
      AND (
        s.status = 'approved'
        OR s.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('moderator', 'admin'))
      )
    )
  );

CREATE POLICY "submission_photos_auth_insert" ON submission_photos
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = submission_id AND s.user_id = auth.uid()
    )
  );
