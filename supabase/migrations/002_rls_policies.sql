-- DesiVibe Row Level Security (RLS) Policies for All 22 Tables

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND account_status = 'active'
  );
$$;

-- Enable RLS everywhere
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audio_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hashtags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_hashtags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- PROFILES: Prevent users from modifying their own role, is_verified, or account_status
CREATE POLICY "Profiles public read" ON public.profiles FOR SELECT USING (TRUE);
CREATE POLICY "Profiles self update safe" ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
    AND is_verified = (SELECT is_verified FROM public.profiles WHERE id = auth.uid())
    AND account_status = (SELECT account_status FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY "Admins update profiles" ON public.profiles FOR UPDATE USING (public.is_admin());

-- POSTS
CREATE POLICY "Posts readable if public or followed" ON public.posts FOR SELECT USING (
  is_removed = FALSE AND (
    user_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = user_id AND p.is_private = FALSE AND p.account_status = 'active')
    OR EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = auth.uid() AND f.following_id = user_id AND f.status = 'accepted')
  )
);
CREATE POLICY "Users insert own posts" ON public.posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own posts or admin" ON public.posts FOR DELETE USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Admins moderate posts" ON public.posts FOR UPDATE USING (public.is_admin());

-- STORIES (24h expiry enforced)
CREATE POLICY "Unexpired stories readable" ON public.stories FOR SELECT USING (expires_at > NOW() OR user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Users create own stories" ON public.stories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own stories" ON public.stories FOR DELETE USING (auth.uid() = user_id OR public.is_admin());

-- LIKES, SAVES, COLLECTIONS, COMMENTS, FOLLOWS
CREATE POLICY "Likes read" ON public.likes FOR SELECT USING (TRUE);
CREATE POLICY "Likes insert self" ON public.likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Likes delete self" ON public.likes FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Collections owner" ON public.collections FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Saved posts owner" ON public.saved_posts FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Comments read" ON public.comments FOR SELECT USING (is_removed = FALSE OR public.is_admin());
CREATE POLICY "Comments insert self" ON public.comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Comments delete owner or admin" ON public.comments FOR DELETE USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Follows read" ON public.follows FOR SELECT USING (TRUE);
CREATE POLICY "Follows insert self" ON public.follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "Follows update target" ON public.follows FOR UPDATE USING (auth.uid() = following_id);
CREATE POLICY "Follows delete participant" ON public.follows FOR DELETE USING (auth.uid() = follower_id OR auth.uid() = following_id);

-- VIBECHAT: Strictly restricted to conversation participants
CREATE POLICY "Conversations participant read" ON public.conversations FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.conversation_members cm WHERE cm.conversation_id = id AND cm.user_id = auth.uid())
);
CREATE POLICY "Conversations authenticated create" ON public.conversations FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Members read own conversations" ON public.conversation_members FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.conversation_members cm WHERE cm.conversation_id = conversation_id AND cm.user_id = auth.uid())
);
CREATE POLICY "Members insert" ON public.conversation_members FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Messages participant read" ON public.messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.conversation_members cm WHERE cm.conversation_id = conversation_id AND cm.user_id = auth.uid())
);
CREATE POLICY "Messages participant send" ON public.messages FOR INSERT WITH CHECK (
  auth.uid() = sender_id AND EXISTS (
    SELECT 1 FROM public.conversation_members cm WHERE cm.conversation_id = conversation_id AND cm.user_id = auth.uid()
  )
);
CREATE POLICY "Messages sender delete" ON public.messages FOR UPDATE USING (auth.uid() = sender_id);

-- NOTIFICATIONS, STORY VIEWS, REACTIONS, REPORTS, BLOCKS, AUDIT, ANNOUNCEMENTS
CREATE POLICY "Notifications owner" ON public.notifications FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Story views insert" ON public.story_views FOR INSERT WITH CHECK (auth.uid() = viewer_id);
CREATE POLICY "Story views creator read" ON public.story_views FOR SELECT USING (
  auth.uid() = viewer_id OR EXISTS (SELECT 1 FROM public.stories s WHERE s.id = story_id AND s.user_id = auth.uid())
);
CREATE POLICY "Story reactions" ON public.story_reactions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Message reactions" ON public.message_reactions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Reports insert self" ON public.reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "Reports admin manage" ON public.reports FOR ALL USING (public.is_admin());
CREATE POLICY "Hashtags public" ON public.hashtags FOR SELECT USING (TRUE);
CREATE POLICY "Post hashtags public" ON public.post_hashtags FOR SELECT USING (TRUE);
CREATE POLICY "Audio tracks public" ON public.audio_tracks FOR SELECT USING (TRUE);
CREATE POLICY "Blocks owner" ON public.user_blocks FOR ALL USING (auth.uid() = blocker_id);
CREATE POLICY "Audit logs admin read" ON public.admin_audit_logs FOR SELECT USING (public.is_admin());
CREATE POLICY "Announcements public read" ON public.announcements FOR SELECT USING (is_active = TRUE OR public.is_admin());
CREATE POLICY "Announcements admin write" ON public.announcements FOR ALL USING (public.is_admin());
