-- DesiVibe Migration 004: Post-Registration Auto-Follow Admin Trigger & App Ratings
-- Super Admin Email: rishabhjaiswal335@gmail.com

-- 1. App Ratings Table (post-signup rating gate)
CREATE TABLE IF NOT EXISTS public.app_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  tags TEXT[] NOT NULL DEFAULT '{}',
  feedback TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own rating or admin reads all" ON public.app_ratings;
CREATE POLICY "Users can read own rating or admin reads all"
ON public.app_ratings FOR SELECT
USING (
  auth.uid() = user_id OR
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
  )
);

DROP POLICY IF EXISTS "Users can insert own rating" ON public.app_ratings;
CREATE POLICY "Users can insert own rating"
ON public.app_ratings FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own rating" ON public.app_ratings;
CREATE POLICY "Users can update own rating"
ON public.app_ratings FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 2. Post-Registration Trigger: New users automatically follow Super Admin (rishabhjaiswal335@gmail.com)
CREATE OR REPLACE FUNCTION public.auto_follow_super_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_profile_id UUID;
BEGIN
  IF NEW.is_demo = TRUE OR LOWER(COALESCE(NEW.email, '')) = 'rishabhjaiswal335@gmail.com' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO admin_profile_id
  FROM public.profiles
  WHERE LOWER(email) = 'rishabhjaiswal335@gmail.com' OR role = 'super_admin'
  ORDER BY CASE WHEN LOWER(email) = 'rishabhjaiswal335@gmail.com' THEN 0 ELSE 1 END
  LIMIT 1;

  IF admin_profile_id IS NOT NULL AND admin_profile_id <> NEW.id THEN
    INSERT INTO public.follows (follower_id, following_id, status)
    VALUES (NEW.id, admin_profile_id, 'accepted')
    ON CONFLICT (follower_id, following_id) DO NOTHING;

    UPDATE public.profiles
    SET following_count = (
      SELECT COUNT(*) FROM public.follows WHERE follower_id = NEW.id AND status = 'accepted'
    )
    WHERE id = NEW.id;

    UPDATE public.profiles
    SET followers_count = (
      SELECT COUNT(*) FROM public.follows WHERE following_id = admin_profile_id AND status = 'accepted'
    )
    WHERE id = admin_profile_id;

    INSERT INTO public.notifications (user_id, actor_id, type, entity_id, message)
    VALUES (
      admin_profile_id,
      NEW.id,
      'new_follower',
      NEW.id::text,
      '@' || NEW.username || ' joined DesiVibe and started following you.'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_auto_follow_admin ON public.profiles;
CREATE TRIGGER on_profile_created_auto_follow_admin
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.auto_follow_super_admin();
