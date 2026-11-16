import {
  Bookmark,
  Film,
  Grid,
  Heart,
  Lock,
  MessageCircle,
  Play,
  Plus,
  Settings,
  ShieldAlert,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch, getActiveToken } from '../lib/api.ts';
import { compressImageFile, isVideoMedia, uploadMediaWithProgress } from '../lib/media.ts';
import type { CollectionItem, PostItem, UserProfile } from '../types.ts';
import { Avatar, RoleAndVerifiedBadge } from './Avatar.tsx';
import { FullScreenPostModal } from './FullScreenPostModal.tsx';

interface ProfileViewProps {
  username: string;
  currentUser: UserProfile | null;
  onRequireAuth: () => void;
  onStartChat: (userId: string) => void;
  onOpenSettings: () => void;
  onProfileUpdated: (user: UserProfile) => void;
  onOpenProfile: (username: string) => void;
  onPostMutated?: (postId: string, patch: Partial<PostItem>) => void;
  onPostDeleted?: (postId: string) => void;
  onShareToChat?: (post: PostItem) => void;
}

export function ProfileView({
  username,
  currentUser,
  onRequireAuth,
  onStartChat,
  onOpenSettings,
  onProfileUpdated,
  onOpenProfile,
  onPostMutated,
  onPostDeleted,
  onShareToChat,
}: ProfileViewProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [followStatus, setFollowStatus] = useState<'accepted' | 'pending' | null>(null);
  const [canView, setCanView] = useState(true);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [reels, setReels] = useState<PostItem[]>([]);
  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [savedPosts, setSavedPosts] = useState<PostItem[]>([]);
  const [tab, setTab] = useState<'posts' | 'reels' | 'saved'>('posts');
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [listModal, setListModal] = useState<'followers' | 'following' | null>(null);
  const [listUsers, setListUsers] = useState<UserProfile[]>([]);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [fullScreenState, setFullScreenState] = useState<{ list: 'posts' | 'reels' | 'saved'; index: number } | null>(
    null
  );

  // Edit state
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editPrivate, setEditPrivate] = useState(false);
  const [editAvatar, setEditAvatar] = useState('');

  const isSelf = Boolean(currentUser && profile && currentUser.id === profile.id);

  const loadProfile = async () => {
    if (!username) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{
        profile: UserProfile;
        followStatus: 'accepted' | 'pending' | null;
        canViewContent: boolean;
        posts: PostItem[];
        reels: PostItem[];
      }>(`/api/profiles/${encodeURIComponent(username)}`);
      setProfile(res.profile);
      setFollowStatus(res.followStatus);
      setCanView(res.canViewContent);
      setPosts(res.posts || []);
      setReels(res.reels || []);

      if (currentUser && currentUser.id === res.profile.id) {
        const colRes = await apiFetch<{ collections: CollectionItem[]; savedPosts: PostItem[] }>('/api/collections');
        setCollections(colRes.collections || []);
        setSavedPosts(colRes.savedPosts || []);
      }
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [username, currentUser?.id]);

  const handleFollow = async () => {
    if (!currentUser) return onRequireAuth();
    if (!profile) return;
    try {
      const res = await apiFetch<{ followStatus: 'accepted' | 'pending' | null; counts: any }>(
        `/api/profiles/${profile.id}/follow`,
        { method: 'POST' }
      );
      setFollowStatus(res.followStatus);
      if (res.counts) {
        setProfile((p) => (p ? { ...p, followers_count: res.counts.followers_count } : p));
      }
    } catch {
      // Ignore transient follow errors
    }
  };

  const handleBlock = async () => {
    if (!currentUser || !profile) return onRequireAuth();
    try {
      await apiFetch(`/api/profiles/${profile.id}/block`, { method: 'POST' });
      loadProfile();
    } catch {
      // Ignore
    }
  };

  const openList = async (kind: 'followers' | 'following') => {
    if (!profile) return;
    setListModal(kind);
    const res = await apiFetch<{ users: UserProfile[] }>(`/api/profiles/${profile.id}/${kind}`).catch(() => ({
      users: [],
    }));
    setListUsers(res.users || []);
  };

  const openEditModal = () => {
    if (!profile) return;
    setEditName(profile.full_name);
    setEditBio(profile.bio);
    setEditStatus(profile.vibe_status);
    setEditPrivate(Boolean(profile.is_private));
    setEditAvatar(profile.avatar_url);
    setEditOpen(true);
  };

  const handleAvatarUpload = async (file: File) => {
    const token = getActiveToken();
    if (!token) return;
    try {
      const compressed = await compressImageFile(file, { maxWidth: 640, quality: 0.85 });
      const uploaded = await uploadMediaWithProgress(compressed, 'avatars', token, () => {}).promise;
      setEditAvatar(uploaded.url);
    } catch {
      // Ignore upload failure
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ user: UserProfile }>('/api/profiles/me', {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: editName,
          bio: editBio,
          vibeStatus: editStatus,
          isPrivate: editPrivate,
          avatarUrl: editAvatar,
        }),
      });
      setProfile(res.user);
      onProfileUpdated(res.user);
      setEditOpen(false);
    } catch {
      // Keep modal open if save fails
    }
  };

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim()) return;
    try {
      await apiFetch('/api/collections', {
        method: 'POST',
        body: JSON.stringify({ name: newCollectionName.trim() }),
      });
      setNewCollectionName('');
      loadProfile();
    } catch {
      // Ignore
    }
  };

  if (loading) {
    return <div className="glass-panel rounded-3xl h-72 animate-pulse" />;
  }

  if (!profile) {
    return (
      <div className="glass-panel rounded-3xl p-10 text-center text-sm text-white/60">
        Creator profile not found.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Profile Header Card */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <Avatar src={profile.avatar_url} name={profile.full_name} size="xl" online={profile.online} />

          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-2xl font-bold text-white truncate">{profile.username}</h1>
                  <RoleAndVerifiedBadge role={profile.role} isVerified={profile.is_verified} size={18} />
                </div>
                <p className="text-sm text-white/65">{profile.full_name}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isSelf ? (
                  <>
                    <button
                      type="button"
                      onClick={openEditModal}
                      className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white"
                    >
                      Edit Profile
                    </button>
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      aria-label="Account settings"
                      className="w-10 h-10 rounded-xl bg-white/[0.06] hover:bg-white/10 flex items-center justify-center text-white"
                    >
                      <Settings size={17} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleFollow}
                      className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 ${
                        followStatus === 'accepted'
                          ? 'bg-white/10 text-white'
                          : followStatus === 'pending'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'vibe-gradient-cta text-white'
                      }`}
                    >
                      {followStatus === 'accepted' ? (
                        <>
                          <UserCheck size={14} /> Following
                        </>
                      ) : followStatus === 'pending' ? (
                        'Requested'
                      ) : (
                        <>
                          <UserPlus size={14} /> Follow
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => (currentUser ? onStartChat(profile.id) : onRequireAuth())}
                      className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white flex items-center gap-1.5"
                    >
                      <MessageCircle size={14} /> Message
                    </button>
                    <button
                      type="button"
                      onClick={handleBlock}
                      title="Block user"
                      className="w-10 h-10 rounded-xl bg-white/[0.05] hover:bg-rose-500/20 text-white/60 hover:text-rose-300 flex items-center justify-center"
                    >
                      <ShieldAlert size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>

            {profile.vibe_status && (
              <p className="text-xs font-medium text-[#00F0FF]">Status: {profile.vibe_status}</p>
            )}
            {profile.bio && <p className="text-sm text-white/85 max-w-xl leading-relaxed">{profile.bio}</p>}

            {/* Metrics */}
            <div className="flex items-center gap-6 pt-1">
              <div>
                <span className="font-mono-tabular font-bold text-white">{profile.posts_count}</span>{' '}
                <span className="text-xs text-white/60">Posts</span>
              </div>
              <button type="button" onClick={() => openList('followers')} className="hover:text-[#00F0FF] transition-colors">
                <span className="font-mono-tabular font-bold text-white">{profile.followers_count}</span>{' '}
                <span className="text-xs text-white/60">Followers</span>
              </button>
              <button type="button" onClick={() => openList('following')} className="hover:text-[#00F0FF] transition-colors">
                <span className="font-mono-tabular font-bold text-white">{profile.following_count}</span>{' '}
                <span className="text-xs text-white/60">Following</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content Tabs */}
      {!canView ? (
        <div className="glass-panel rounded-3xl p-10 text-center space-y-2">
          <Lock size={28} className="mx-auto text-[#FF6B00]" />
          <h3 className="font-display font-semibold text-white">This account is private</h3>
          <p className="text-xs text-white/55">Follow @{profile.username} and wait for approval to view their posts and reels.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-white/10 pb-3">
            <button
              type="button"
              onClick={() => setTab('posts')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 ${
                tab === 'posts' ? 'vibe-gradient-cta text-white' : 'text-white/65 hover:text-white'
              }`}
            >
              <Grid size={14} /> Posts ({posts.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('reels')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 ${
                tab === 'reels' ? 'vibe-gradient-cta text-white' : 'text-white/65 hover:text-white'
              }`}
            >
              <Film size={14} /> Reels ({reels.length})
            </button>
            {isSelf && (
              <button
                type="button"
                onClick={() => setTab('saved')}
                className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 ${
                  tab === 'saved' ? 'vibe-gradient-cta text-white' : 'text-white/65 hover:text-white'
                }`}
              >
                <Bookmark size={14} /> Saved Collections ({savedPosts.length})
              </button>
            )}
          </div>

          {tab === 'posts' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {posts.length === 0 ? (
                <p className="col-span-full text-center text-sm text-white/50 py-10">No posts yet.</p>
              ) : (
                posts.map((p, idx) => {
                  const previewUrl = p.thumbnail_url || p.media_urls[0];
                  const isVid = isVideoMedia(previewUrl, p.media_type);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setFullScreenState({ list: 'posts', index: idx })}
                      className="relative aspect-square rounded-2xl overflow-hidden bg-[#15151F] border border-white/10 group text-left"
                    >
                      {isVid ? (
                        <video
                          src={previewUrl}
                          muted
                          playsInline
                          preload="metadata"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <img
                          src={previewUrl}
                          alt={p.caption || p.username}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      )}
                      {isVid && (
                        <span className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center text-white">
                          <Play size={13} className="fill-white ml-0.5" />
                        </span>
                      )}
                      <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4 text-xs font-mono-tabular font-semibold text-white">
                        <span className="flex items-center gap-1">
                          <Heart size={14} className="fill-white" /> {p.likes_count}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageCircle size={14} /> {p.comments_count}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {tab === 'reels' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {reels.length === 0 ? (
                <p className="col-span-full text-center text-sm text-white/50 py-10">No reels published yet.</p>
              ) : (
                reels.map((r, idx) => {
                  const previewUrl = r.thumbnail_url || r.media_urls[0];
                  const isVid = isVideoMedia(previewUrl, r.media_type);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setFullScreenState({ list: 'reels', index: idx })}
                      className="relative aspect-[9/16] rounded-2xl overflow-hidden bg-[#15151F] border border-white/10 group text-left"
                    >
                      {isVid ? (
                        <video
                          src={previewUrl}
                          muted
                          playsInline
                          preload="metadata"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <img
                          src={previewUrl}
                          alt={r.caption || r.username}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      )}
                      <span className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center text-white">
                        <Play size={13} className="fill-white ml-0.5" />
                      </span>
                      <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between text-[11px] font-mono-tabular text-white">
                        <span className="flex items-center gap-1">
                          <Heart size={12} /> {r.likes_count}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageCircle size={12} /> {r.comments_count}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {tab === 'saved' && isSelf && (
            <div className="space-y-5">
              <form onSubmit={handleCreateCollection} className="flex gap-2 max-w-sm">
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="New collection name..."
                  className="flex-1 px-3.5 py-2 rounded-xl bg-[#15151F] border border-white/12 text-xs text-white"
                />
                <button type="submit" className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white flex items-center gap-1">
                  <Plus size={14} /> Add
                </button>
              </form>

              {collections.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {collections.map((c) => (
                    <div key={c.id} className="glass-panel rounded-2xl p-4 flex items-center gap-4">
                      <div className="w-16 h-16 rounded-xl bg-white/5 overflow-hidden shrink-0">
                        {c.cover_url ? (
                          isVideoMedia(c.cover_url) ? (
                            <video src={c.cover_url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                          ) : (
                            <img src={c.cover_url} alt={c.name} className="w-full h-full object-cover" />
                          )
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white/30">
                            <Bookmark size={20} />
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-display font-semibold text-white">{c.name}</p>
                        <p className="text-xs text-white/55 font-mono-tabular">{c.items.length} saved items</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {savedPosts.length === 0 ? (
                <p className="text-center text-sm text-white/50 py-8">No saved posts yet.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {savedPosts.map((sp, idx) => {
                    const previewUrl = sp.thumbnail_url || sp.media_urls[0];
                    const isVid = isVideoMedia(previewUrl, sp.media_type);
                    return (
                      <button
                        key={sp.id}
                        type="button"
                        onClick={() => setFullScreenState({ list: 'saved', index: idx })}
                        className="relative aspect-square rounded-2xl overflow-hidden bg-[#15151F] border border-white/10 group text-left"
                      >
                        {isVid ? (
                          <video
                            src={previewUrl}
                            muted
                            playsInline
                            preload="metadata"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <img
                            src={previewUrl}
                            alt={sp.caption || sp.username}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        )}
                        {isVid && (
                          <span className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center text-white">
                            <Play size={13} className="fill-white ml-0.5" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Edit Profile Modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleSaveProfile} className="glass-panel rounded-3xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-display text-lg font-bold text-white">Edit Profile</h3>
            <div className="flex items-center gap-4">
              <Avatar src={editAvatar} name={editName} size="lg" />
              <label className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer">
                Change Avatar
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => e.target.files?.[0] && handleAvatarUpload(e.target.files[0])}
                  className="hidden"
                />
              </label>
            </div>
            <div>
              <label className="block text-xs text-white/65 mb-1">Full Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F] border border-white/15 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-white/65 mb-1">Vibe Status</label>
              <input
                type="text"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F] border border-white/15 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-white/65 mb-1">Bio</label>
              <textarea
                rows={3}
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F] border border-white/15 text-sm text-white resize-none"
              />
            </div>
            <label className="flex items-center gap-2.5 text-xs text-white/85 cursor-pointer">
              <input
                type="checkbox"
                checked={editPrivate}
                onChange={(e) => setEditPrivate(e.target.checked)}
                className="rounded accent-[#FF6B00]"
              />
              Private account (require follow approval)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/10 text-xs text-white"
              >
                Cancel
              </button>
              <button type="submit" className="px-5 py-2 rounded-xl vibe-gradient-cta text-xs font-semibold text-white">
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Followers / Following Modal */}
      {listModal && (
        <div
          onClick={() => setListModal(null)}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div onClick={(e) => e.stopPropagation()} className="glass-panel rounded-3xl p-5 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-display font-semibold text-white capitalize">{listModal}</h4>
              <button type="button" onClick={() => setListModal(null)} className="text-xs text-white/60">
                Close
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-2.5">
              {listUsers.length === 0 ? (
                <p className="text-xs text-white/50 text-center py-6">No users yet.</p>
              ) : (
                listUsers.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setListModal(null);
                      onOpenProfile(u.username);
                    }}
                    className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.05] text-left"
                  >
                    <Avatar src={u.avatar_url} name={u.full_name} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{u.username}</p>
                      <p className="text-xs text-white/55 truncate">{u.full_name}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      {/* Full Screen Post / Reel Modal */}
      {fullScreenState &&
        (() => {
          const activeList =
            fullScreenState.list === 'reels'
              ? reels
              : fullScreenState.list === 'saved'
                ? savedPosts
                : posts;
          const activeItem = activeList[fullScreenState.index];
          if (!activeItem) return null;
          return (
            <FullScreenPostModal
              post={activeItem}
              currentUser={currentUser}
              onClose={() => setFullScreenState(null)}
              onOpenProfile={onOpenProfile}
              onRequireAuth={onRequireAuth}
              onShareToChat={onShareToChat}
              onPostMutated={(postId, patch) => {
                setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...patch } : p)));
                setReels((prev) => prev.map((r) => (r.id === postId ? { ...r, ...patch } : r)));
                setSavedPosts((prev) => prev.map((s) => (s.id === postId ? { ...s, ...patch } : s)));
                onPostMutated?.(postId, patch);
              }}
              onPostDeleted={(postId) => {
                setPosts((prev) => prev.filter((p) => p.id !== postId));
                setReels((prev) => prev.filter((r) => r.id !== postId));
                setSavedPosts((prev) => prev.filter((s) => s.id !== postId));
                onPostDeleted?.(postId);
                setFullScreenState(null);
              }}
              onPrevPost={
                fullScreenState.index > 0
                  ? () => setFullScreenState({ ...fullScreenState, index: fullScreenState.index - 1 })
                  : undefined
              }
              onNextPost={
                fullScreenState.index < activeList.length - 1
                  ? () => setFullScreenState({ ...fullScreenState, index: fullScreenState.index + 1 })
                  : undefined
              }
            />
          );
        })()}
    </div>
  );
}
