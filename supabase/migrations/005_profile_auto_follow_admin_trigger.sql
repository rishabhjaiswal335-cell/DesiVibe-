-- DesiVibe Migration 005: PostgreSQL Function & Trigger for Auto-Following Admin on Profile Creation
-- Admin Email: rishabhjaiswal335@gmail.com

-- Ensure required index exists for fast admin email lookup
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower ON public.profiles (LOWER(email));

-- PostgreSQL trigger function: automatically inserts a 'follows' record
-- so every newly created profile immediately follows rishabhjaiswal335@gmail.com
CREATE OR REPLACE FUNCTION public.auto_follow_super_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_profile_id UUID;
  admin_email CONSTANT TEXT := 'rishabhjaiswal335@gmail.com';
BEGIN
  -- Skip demo rows and skip when the admin profile itself is being created
  IF COALESCE(NEW.is_demo, FALSE) = TRUE
     OR LOWER(COALESCE(NEW.email, '')) = admin_email THEN
    RETURN NEW;
  END IF;

  -- Locate the admin profile by exact email (fallback to super_admin role)
  SELECT id INTO admin_profile_id
  FROM public.profiles
  WHERE LOWER(email) = admin_email
     OR role = 'super_admin'
  ORDER BY CASE WHEN LOWER(email) = admin_email THEN 0 ELSE 1 END
  LIMIT 1;

  IF admin_profile_id IS NOT NULL AND admin_profile_id <> NEW.id THEN
    INSERT INTO public.follows (follower_id, following_id, status)
    VALUES (NEW.id, admin_profile_id, 'accepted')
    ON CONFLICT (follower_id, following_id) DO NOTHING;

    -- Keep follower/following counters accurate
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

    -- Notify admin of the new follower
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
FOR EACH ROW
EXECUTE FUNCTION public.auto_follow_super_admin();
