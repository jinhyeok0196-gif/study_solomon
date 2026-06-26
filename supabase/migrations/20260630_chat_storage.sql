-- =========================================================================
-- 채팅 이미지 저장소
-- =========================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-images',
  'chat-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 인증된 사용자만 업로드
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'authenticated_upload_chat_images'
  ) THEN
    CREATE POLICY "authenticated_upload_chat_images"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'chat-images');
  END IF;
END $$;

-- 누구나 읽기
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'public_read_chat_images'
  ) THEN
    CREATE POLICY "public_read_chat_images"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'chat-images');
  END IF;
END $$;
