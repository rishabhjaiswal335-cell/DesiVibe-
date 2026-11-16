-- DesiVibe Cloud Media Storage Buckets & Policies

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('posts', 'posts', true, 31457280, ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']),
  ('reels', 'reels', true, 52428800, ARRAY['video/mp4', 'video/webm', 'video/quicktime']),
  ('stories', 'stories', true, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
  ('chat-media', 'chat-media', false, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mp4'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read avatars posts reels stories"
ON storage.objects FOR SELECT
USING (bucket_id IN ('avatars', 'posts', 'reels', 'stories'));

CREATE POLICY "Authenticated upload to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id IN ('avatars', 'posts', 'reels', 'stories', 'chat-media')
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Owner delete own media"
ON storage.objects FOR DELETE
TO authenticated
USING ((storage.foldername(name))[1] = auth.uid()::text);
