import { Plus, RefreshCw, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import type { PostItem, StoryGroup, UserProfile } from '../types.ts';
import { Avatar, RoleAndVerifiedBadge } from './Avatar.tsx';
import { PostCard } from './PostCard.tsx';
import { StoriesBar } from './StoriesBar.tsx';

interface HomeFeedProps {
  posts: PostItem[];
  loading: boolean;
  hasMore: boolean;
  storyGroups: StoryGroup[];
  suggestedUsers: UserProfile[];
  currentUser: UserProfile | null;
  onRefresh: () => void;
  onLoadMore: () => void;
  onSelectStoryGroup: (idx: number) => void;
  onCreateStory: () => void;
  onCreatePost: () => void;
  onOpenProfile: (username: string) => void;
  onRequireAuth: () => void;
  onPostMutated: (postId: string, patch: Partial<PostItem>) => void;
  onPostDeleted: (postId: string) => void;
  onShareToChat: (post: PostItem) => void;
  onSuggestedFollowChange: (userId: string, status: 'accepted' | 'pending' | null) => void;
}

export function HomeFeed({
  posts,
  loading,
  hasMore,
  storyGroups,
  suggestedUsers,
  currentUser,
  onRefresh,
  onLoadMore,
  onSelectStoryGroup,
  onCreateStory,
  onCreatePost,
  onOpenProfile,
  onRequireAuth,
  onPostMutated,
  onPostDeleted,
  onShareToChat,
  onSuggestedFollowChange,
}: HomeFeedProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setTimeout(() => setRefreshing(false), 400);
  };

  const handleFollowSuggested = async (userId: string) => {
    if (!currentUser) return onRequireAuth();
    try {
      const res = await apiFetch<{ followStatus: 'accepted' | 'pending' | null }>(`/api/profiles/${userId}/follow`, {
        method: 'POST',
      });
      onSuggestedFollowChange(userId, res.followStatus);
    } catch {
      // Ignore
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-7 items-start">
      {/* Main Feed Column */}
      <div className="xl:col-span-8 max-w-2xl w-full mx-auto">
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 text-xs font-medium text-white/80"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin text-[#00F0FF]' : ''} />
            Refresh Feed
          </button>
        </div>

        <StoriesBar
          storyGroups={storyGroups}
          currentUser={currentUser}
          onSelectGroup={onSelectStoryGroup}
          onCreateStory={onCreateStory}
        />

        {loading && posts.length === 0 ? (
          <div className="space-y-5">
            {[1, 2].map((n) => (
              <div key={n} className="glass-panel rounded-3xl p-4 animate-pulse space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-white/10" />
                  <div className="space-y-2 flex-1">
                    <div className="h-3 w-32 bg-white/10 rounded" />
                    <div className="h-2.5 w-24 bg-white/5 rounded" />
                  </div>
                </div>
                <div className="w-full h-72 rounded-2xl bg-white/5" />
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="glass-panel rounded-3xl p-10 text-center space-y-4">
            <h3 className="font-display text-lg font-semibold text-white">No posts yet</h3>
            <p className="text-sm text-white/60 max-w-md mx-auto">
              {currentUser
                ? 'Share the first real photo, carousel, or video post from DesiVibe Studio.'
                : 'Sign in or create an account to share posts and follow real creators on DesiVibe.'}
            </p>
            <button
              type="button"
              onClick={currentUser ? onCreatePost : onRequireAuth}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl vibe-gradient-cta text-xs font-semibold text-white"
            >
              <Plus size={15} />
              {currentUser ? 'Upload VibeReel / Post' : 'Sign In / Create Account'}
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                currentUser={currentUser}
                onOpenProfile={onOpenProfile}
                onRequireAuth={onRequireAuth}
                onPostMutated={onPostMutated}
                onPostDeleted={onPostDeleted}
                onShareToChat={onShareToChat}
              />
            ))}

            {hasMore && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={onLoadMore}
                  className="px-6 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white"
                >
                  Load More Posts
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop Right Discovery Sidebar */}
      <aside className="hidden xl:block xl:col-span-4 space-y-5 sticky top-6">
        {currentUser && (
          <div
            onClick={() => onOpenProfile(currentUser.username)}
            className="glass-panel rounded-2xl p-4 flex items-center gap-3 cursor-pointer hover:border-white/20 transition-colors"
          >
            <Avatar src={currentUser.avatar_url} name={currentUser.full_name} size="md" online />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-white truncate">{currentUser.username}</p>
                <RoleAndVerifiedBadge role={currentUser.role} isVerified={currentUser.is_verified} size={14} />
              </div>
              <p className="text-xs text-white/55 truncate">{currentUser.vibe_status || currentUser.full_name}</p>
            </div>
          </div>
        )}

        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-sm font-semibold text-white">Creators to Follow</h3>
          </div>
          {suggestedUsers.length === 0 ? (
            <p className="text-xs text-white/50">Registered creators will appear here as members join DesiVibe.</p>
          ) : (
            <div className="space-y-3.5">
              {suggestedUsers.slice(0, 6).map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3">
                  <div
                    onClick={() => onOpenProfile(u.username)}
                    className="flex items-center gap-2.5 min-w-0 cursor-pointer"
                  >
                    <Avatar src={u.avatar_url} name={u.full_name} size="sm" online={u.online} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <p className="text-xs font-semibold text-white truncate">{u.username}</p>
                        <RoleAndVerifiedBadge role={u.role} isVerified={u.is_verified} size={12} />
                      </div>
                      <p className="text-[11px] text-white/50 truncate">{u.full_name}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleFollowSuggested(u.id)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold whitespace-nowrap shrink-0 flex items-center gap-1 ${
                      u.follow_status === 'accepted'
                        ? 'bg-white/10 text-white/75'
                        : u.follow_status === 'pending'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'vibe-gradient-cta text-white'
                    }`}
                  >
                    {u.follow_status === 'accepted' ? (
                      'Following'
                    ) : u.follow_status === 'pending' ? (
                      'Requested'
                    ) : (
                      <>
                        <UserPlus size={12} /> Follow
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
