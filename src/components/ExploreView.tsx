import { Film, Hash, Heart, MessageCircle, Music2, Play, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { isVideoMedia } from '../lib/media.ts';
import type { PostItem, UserProfile } from '../types.ts';
import { Avatar, RoleAndVerifiedBadge } from './Avatar.tsx';
import { FullScreenPostModal } from './FullScreenPostModal.tsx';

interface ExploreViewProps {
  currentUser: UserProfile | null;
  onOpenProfile: (username: string) => void;
  onOpenReels: () => void;
  onRequireAuth: () => void;
  onPostMutated?: (postId: string, patch: Partial<PostItem>) => void;
  onPostDeleted?: (postId: string) => void;
  onShareToChat?: (post: PostItem) => void;
}

export function ExploreView({
  currentUser,
  onOpenProfile,
  onOpenReels,
  onRequireAuth,
  onPostMutated,
  onPostDeleted,
  onShareToChat,
}: ExploreViewProps) {
  const [query, setQuery] = useState('');
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [hashtags, setHashtags] = useState<{ id: string; tag: string; usage_count: number }[]>([]);
  const [audioTracks, setAudioTracks] = useState<{ id: string; title: string; artist: string; usage_count: number }[]>([]);
  const [searchResults, setSearchResults] = useState<{
    users: UserProfile[];
    hashtags: any[];
    audioTracks: any[];
    posts: PostItem[];
  } | null>(null);
  const [fullScreenState, setFullScreenState] = useState<{ source: 'trending' | 'search'; index: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ posts: PostItem[]; hashtags: any[]; audioTracks: any[] }>('/api/explore')
      .then((res) => {
        setPosts(res.posts || []);
        setHashtags(res.hashtags || []);
        setAudioTracks(res.audioTracks || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch<{ users: UserProfile[]; hashtags: any[]; audioTracks: any[]; posts: PostItem[] }>(
        `/api/explore/search?q=${encodeURIComponent(query.trim())}`
      )
        .then((res) => setSearchResults(res))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const activeFullScreenList =
    fullScreenState?.source === 'search' ? searchResults?.posts || [] : posts;
  const activeFullScreenPost =
    fullScreenState !== null ? activeFullScreenList[fullScreenState.index] || null : null;

  return (
    <div className="space-y-6">
      {/* Search Bar */}
      <div className="glass-panel rounded-2xl p-3 flex items-center gap-3">
        <Search size={18} className="text-white/50 ml-2 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search creators, #hashtags, or audio tracks..."
          className="flex-1 bg-transparent text-sm text-white placeholder:text-white/45 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-xs text-white/60 hover:text-white px-2.5 py-1 rounded-lg bg-white/5"
          >
            Clear
          </button>
        )}
      </div>

      {searchResults ? (
        <div className="space-y-6">
          {searchResults.users.length > 0 && (
            <section className="glass-panel rounded-2xl p-5">
              <h3 className="font-display text-sm font-semibold text-white mb-3">Accounts</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {searchResults.users.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => onOpenProfile(u.username)}
                    className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-left"
                  >
                    <Avatar src={u.avatar_url} name={u.full_name} size="md" online={u.online} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <p className="text-sm font-semibold text-white truncate">{u.username}</p>
                        <RoleAndVerifiedBadge role={u.role} isVerified={u.is_verified} size={13} />
                      </div>
                      <p className="text-xs text-white/55 truncate">{u.full_name}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {searchResults.hashtags.length > 0 && (
            <section className="glass-panel rounded-2xl p-5">
              <h3 className="font-display text-sm font-semibold text-white mb-3">Hashtags</h3>
              <div className="flex flex-wrap gap-2">
                {searchResults.hashtags.map((h: any) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setQuery(h.tag)}
                    className="px-3 py-1.5 rounded-xl bg-[#00F0FF]/10 border border-[#00F0FF]/25 text-xs font-medium text-[#00F0FF]"
                  >
                    #{h.tag} · {h.usage_count}
                  </button>
                ))}
              </div>
            </section>
          )}

          {searchResults.audioTracks.length > 0 && (
            <section className="glass-panel rounded-2xl p-5">
              <h3 className="font-display text-sm font-semibold text-white mb-3">Audio Tracks</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {searchResults.audioTracks.map((a: any) => (
                  <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/10">
                    <Music2 size={18} className="text-[#FF6B00] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate">{a.title}</p>
                      <p className="text-xs text-white/55 truncate">{a.artist}</p>
                    </div>
                    <span className="text-xs font-mono-tabular text-white/50">{a.usage_count} reels</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {searchResults.posts.length > 0 && (
            <section>
              <h3 className="font-display text-sm font-semibold text-white mb-3">Matching Posts</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {searchResults.posts.map((p, idx) => {
                  const previewUrl = p.thumbnail_url || p.media_urls[0];
                  const isVid = isVideoMedia(previewUrl, p.media_type);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setFullScreenState({ source: 'search', index: idx })}
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
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {searchResults.users.length === 0 &&
            searchResults.hashtags.length === 0 &&
            searchResults.audioTracks.length === 0 &&
            searchResults.posts.length === 0 && (
              <div className="glass-panel rounded-2xl p-8 text-center text-sm text-white/55">
                No matching accounts, hashtags, audio, or posts found for &ldquo;{query}&rdquo;.
              </div>
            )}
        </div>
      ) : (
        <>
          {/* Trending Hashtags + Audio */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="glass-panel rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Hash size={16} className="text-[#00F0FF]" />
                <h3 className="font-display text-sm font-semibold text-white">Trending Hashtags</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {hashtags.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setQuery(h.tag)}
                    className="px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/10 border border-white/10 text-xs font-medium text-white/85"
                  >
                    #{h.tag} <span className="text-white/45 font-mono-tabular ml-1">{h.usage_count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="glass-panel rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Music2 size={16} className="text-[#FF6B00]" />
                  <h3 className="font-display text-sm font-semibold text-white">Popular Audio Tracks</h3>
                </div>
                <button type="button" onClick={onOpenReels} className="text-xs text-[#00F0FF] hover:underline">
                  Open VibeReels
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {audioTracks.slice(0, 4).map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white truncate">{a.title}</p>
                      <p className="text-[11px] text-white/50 truncate">{a.artist}</p>
                    </div>
                    <span className="text-[11px] font-mono-tabular text-white/50 shrink-0">{a.usage_count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bento / Masonry Trending Grid */}
          <div>
            <h3 className="font-display text-base font-semibold text-white mb-3">Explore Trending</h3>
            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <div key={n} className="aspect-square rounded-2xl glass-panel animate-pulse" />
                ))}
              </div>
            ) : posts.length === 0 ? (
              <div className="glass-panel rounded-2xl p-8 text-center text-sm text-white/55">
                No trending posts yet. Share the first photo or VibeReel from DesiVibe Studio!
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 auto-rows-[200px]">
                {posts.map((p, idx) => {
                  const isHeroCell = idx === 0 || idx === 5;
                  const previewUrl = p.thumbnail_url || p.media_urls[0];
                  const isVid = isVideoMedia(previewUrl, p.media_type);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setFullScreenState({ source: 'trending', index: idx })}
                      className={`relative rounded-2xl overflow-hidden bg-[#15151F] border border-white/10 group text-left ${
                        isHeroCell ? 'md:col-span-2 md:row-span-2' : ''
                      }`}
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
                      {(p.media_type === 'reel' || p.media_type === 'video' || isVid) && (
                        <span className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center text-white">
                          <Film size={14} />
                        </span>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-3 flex flex-col justify-end">
                        <div className="flex items-center justify-between text-xs text-white font-medium">
                          <span className="truncate">@{p.username}</span>
                          <span className="flex items-center gap-2 font-mono-tabular shrink-0">
                            <Heart size={13} /> {p.likes_count}
                            <MessageCircle size={13} /> {p.comments_count}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Full Screen Post Modal */}
      {fullScreenState !== null && activeFullScreenPost && (
        <FullScreenPostModal
          post={activeFullScreenPost}
          currentUser={currentUser}
          onClose={() => setFullScreenState(null)}
          onOpenProfile={onOpenProfile}
          onRequireAuth={onRequireAuth}
          onShareToChat={onShareToChat}
          onPostMutated={(postId, patch) => {
            setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...patch } : p)));
            setSearchResults((prev) =>
              prev
                ? { ...prev, posts: prev.posts.map((p) => (p.id === postId ? { ...p, ...patch } : p)) }
                : prev
            );
            onPostMutated?.(postId, patch);
          }}
          onPostDeleted={(postId) => {
            setPosts((prev) => prev.filter((p) => p.id !== postId));
            setSearchResults((prev) =>
              prev ? { ...prev, posts: prev.posts.filter((p) => p.id !== postId) } : prev
            );
            onPostDeleted?.(postId);
            setFullScreenState(null);
          }}
          onPrevPost={
            fullScreenState.index > 0
              ? () => setFullScreenState({ ...fullScreenState, index: fullScreenState.index - 1 })
              : undefined
          }
          onNextPost={
            fullScreenState.index < activeFullScreenList.length - 1
              ? () => setFullScreenState({ ...fullScreenState, index: fullScreenState.index + 1 })
              : undefined
          }
        />
      )}
    </div>
  );
}
