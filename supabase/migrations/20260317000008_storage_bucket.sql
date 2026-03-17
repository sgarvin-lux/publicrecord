-- Create storage bucket for submission photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'submissions',
  'submissions',
  true,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
);

-- Storage policies: authenticated upload, public read
CREATE POLICY "submissions_storage_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'submissions');

CREATE POLICY "submissions_storage_auth_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'submissions' AND auth.role() = 'authenticated');

CREATE POLICY "submissions_storage_own_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'submissions' AND auth.uid()::text = (storage.foldername(name))[1]);
