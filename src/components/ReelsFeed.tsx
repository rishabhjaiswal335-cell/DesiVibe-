import {
  ChevronDown,
  ChevronUp,
  Flag,
  Heart,
  Maximize2,
  MessageCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Send,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { isVideoMedia } from '../lib/media.ts';
import type { CommentItem, PostItem, UserProfile } from '../types.ts';
import { Avatar, RoleAndVerifiedBadge, timeAgo } from './Avatar.tsx';
import { FullScreenPostModal } from './FullScreenPostModal.tsx';

interface ReelsFeedProps {
  currentUser: UserProfile | null;
  onOpenProfile: (username: string) => void;
  onRequireAuth: () => void;
  onShareToChat: (post: PostItem) => void;
  onUploadReel: () => void;
}

export function ReelsFeed({
  currentUser,
  onOpenProfile,
  onRequireAuth,
  onShareToChat,
  onUploadReel,
}: ReelsFeedProps) {
  const [reels, setReels] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [muted, setMuted] = useState(true);
  const [pausedByUser, setPausedByUser] = useState<Record<string, boolean>>({});
  const [heartBurst, setHeartBurst] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState('');
  const [reportDone, setReportDone] = useState(false);
  const [fullScreenIndex, setFullScreenIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const lastTapRef = useRef(0);
  const singleTapTimerRef = useRef<number | null>(null);

  const loadReels = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ reels: PostItem[] }>('/api/reels');
      setReels(res.reels || []);
    } catch {
      setReels([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReels();
  }, []);

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    };
  }, []);

  // IntersectionObserver: tracks whichever reel is centered (>= 65% visible) in the snap viewport
  useEffect(() => {
    const rootEl = containerRef.current;
    if (!rootEl || reels.length === 0 || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        let bestIdx = -1;
        let bestRatio = 0;

        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idxAttr = (entry.target as HTMLElement).dataset.reelIndex;
          const idx = idxAttr !== undefined ? Number(idxAttr) : -1;
          if (idx >= 0 && entry.intersectionRatio >= 0.6 && entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestIdx = idx;
          }
        }

        if (bestIdx !== -1) {
          setActiveIdx(bestIdx);
        }
      },
      {
        root: rootEl,
        threshold: [0.25, 0.6, 0.75, 0.9],
      }
    );

    slideRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [reels.length]);

  // Play ONLY the centered active reel and pause every other video for smooth performance
  useEffect(() => {
    const isFullScreenActive = fullScreenIndex !== null;
    videoRefs.current.forEach((videoEl, idx) => {
      if (!videoEl) return;
      const reel = reels[idx];
      const shouldPlay =
        !isFullScreenActive &&
        idx === activeIdx &&
        Boolean(reel) &&
        !pausedByUser[reel.id] &&
        !document.hidden;

      videoEl.muted = muted;
      if (shouldPlay) {
        if (videoEl.paused) {
          videoEl.play().catch(() => {});
        }
      } else if (!videoEl.paused) {
        videoEl.pause();
      }
    });
  }, [activeIdx, reels, muted, pausedByUser, fullScreenIndex]);

  // Pause active video when browser tab loses focus, resume when returning
  useEffect(() => {
    const onVisibilityChange = () => {
      const activeVideo = videoRefs.current[activeIdx];
      const active = reels[activeIdx];
      if (!activeVideo || !active) return;
      if (document.hidden || fullScreenIndex !== null) {
        activeVideo.pause();
      } else if (!pausedByUser[active.id]) {
        activeVideo.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [activeIdx, reels, pausedByUser, fullScreenIndex]);

  const activeReel = reels[activeIdx];

  useEffect(() => {
    if (!commentsOpen || !activeReel) return;
    setCommentError('');
    apiFetch<{ comments: CommentItem[] }>(`/api/posts/${activeReel.id}/comments`)
      .then((res) => setComments(res.comments || []))
      .catch(() => setComments([]));
  }, [commentsOpen, activeReel?.id]);

  const scrollToReel = (idx: number) => {
    const clamped = Math.max(0, Math.min(reels.length - 1, idx));
    setActiveIdx(clamped);
    const el = slideRefs.current[clamped];
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const handleLike = async (reel: PostItem, forceLike = false) => {
    if (!currentUser) return onRequireAuth();
    if (forceLike && reel.is_liked) return;
    try {
      const res = await apiFetch<{ liked: boolean; likes_count: number }>(`/api/posts/${reel.id}/like`, {
        method: 'POST',
      });
      setReels((prev) =>
        prev.map((r) => (r.id === reel.id ? { ...r, is_liked: res.liked, likes_count: res.likes_count } : r))
      );
    } catch {
      // Ignore transient like error
    }
  };

  const handleFollow = async (reel: PostItem) => {
    if (!currentUser) return onRequireAuth();
    try {
      const res = await apiFetch<{ followStatus: 'accepted' | 'pending' | null }>(`/api/profiles/${reel.user_id}/follow`, {
        method: 'POST',
      });
      setReels((prev) =>
        prev.map((r) => (r.user_id === reel.user_id ? { ...r, follow_status: res.followStatus } : r))
      );
    } catch {
      // Ignore
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return onRequireAuth();
    if (!activeReel || !commentText.trim()) return;
    setCommentError('');
    try {
      const res = await apiFetch<{ comment: CommentItem; comments_count: number }>(
        `/api/posts/${activeReel.id}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({ content: commentText.trim() }),
        }
      );
      setComments((prev) => [...prev, res.comment]);
      setReels((prev) =>
        prev.map((r) => (r.id === activeReel.id ? { ...r, comments_count: res.comments_count } : r))
      );
      setCommentText('');
    } catch (err: any) {
      setCommentError(err?.message || 'Unable to post comment.');
    }
  };

  const handleReport = async (reel: PostItem) => {
    if (!currentUser) return onRequireAuth();
    try {
      await apiFetch('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ targetType: 'reel', targetId: reel.id, reason: 'Inappropriate reel content' }),
      });
      setReportDone(true);
      setTimeout(() => setReportDone(false), 1600);
    } catch {
      // Ignore
    }
  };

  const handleReelSurfaceTap = (reel: PostItem, isVideo: boolean) => {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      setHeartBurst(true);
      setTimeout(() => setHeartBurst(false), 700);
      handleLike(reel, true);
    } else if (isVideo) {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = window.setTimeout(() => {
        setPausedByUser((prev) => ({ ...prev, [reel.id]: !prev[reel.id] }));
      }, 280);
    }
    lastTapRef.current = now;
  };

  if (loading) {
    return (
      <div className="h-[calc(100vh-10rem)] flex items-center justify-center">
        <div className="w-full max-w-[400px] h-full rounded-3xl glass-panel animate-pulse" />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center">
      <div className="w-full max-w-[420px] flex items-center justify-between mb-3">
        <div>
          <h2 className="font-display text-lg font-bold text-white">VibeReels</h2>
          <p className="text-xs text-white/55">Public reels from all creators</p>
        </div>
        <button
          type="button"
          onClick={onUploadReel}
          className="px-3.5 py-2 rounded-xl vibe-gradient-cta text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <Plus size={15} /> Upload Reel
        </button>
      </div>

      {reels.length === 0 ? (
        <div className="glass-panel rounded-3xl p-10 max-w-md w-full text-center space-y-3">
          <p className="font-display font-semibold text-white">No public reels yet</p>
          <p className="text-xs text-white/60">Be the first creator to publish a 9:16 VibeReel.</p>
          <button
            type="button"
            onClick={onUploadReel}
            className="px-5 py-2.5 rounded-xl vibe-gradient-cta text-xs font-semibold text-white"
          >
            Create Reel
          </button>
        </div>
      ) : (
        <div className="relative flex items-center gap-4">
          <div
            ref={containerRef}
            className="w-full max-w-[420px] h-[74vh] sm:h-[78vh] max-h-[780px] snap-y snap-mandatory overflow-y-scroll no-scrollbar rounded-3xl border border-white/10 bg-black relative"
          >
            {reels.map((reel, idx) => {
              const mediaUrl = reel.media_urls[0] || reel.thumbnail_url;
              const isVideo = isVideoMedia(mediaUrl, reel.media_type);
              const posterUrl = !isVideoMedia(reel.thumbnail_url) ? reel.thumbnail_url : undefined;
              const isPaused = Boolean(pausedByUser[reel.id]);

              return (
                <div
                  key={reel.id}
                  ref={(el) => {
                    slideRefs.current[idx] = el;
                  }}
                  data-reel-index={idx}
                  onClick={() => handleReelSurfaceTap(reel, isVideo)}
                  className="relative w-full h-full snap-start shrink-0 overflow-hidden bg-[#0A0A0F] flex items-center justify-center select-none cursor-pointer"
                >
                  {isVideo ? (
                    <video
                      ref={(el) => {
                        videoRefs.current[idx] = el;
                      }}
                      src={mediaUrl}
                      poster={posterUrl}
                      loop
                      muted={muted}
                      playsInline
                      preload={Math.abs(idx - activeIdx) <= 1 ? 'auto' : 'metadata'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img
                      src={mediaUrl}
                      alt={reel.caption || reel.username}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/35 pointer-events-none" />

                  {/* Paused indicator */}
                  {isVideo && isPaused && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-16 h-16 rounded-full bg-black/55 backdrop-blur-md border border-white/20 flex items-center justify-center text-white">
                        <Play size={28} className="ml-0.5 fill-white" />
                      </div>
                    </div>
                  )}

                  {/* Top-right Controls: Full-Screen & Sound */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-4 right-4 z-20 flex items-center gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => setFullScreenIndex(idx)}
                      aria-label="Open reel full screen"
                      className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/70"
                    >
                      <Maximize2 size={17} />
                    </button>
                    {isVideo && (
                      <button
                        type="button"
                        onClick={() => setPausedByUser((prev) => ({ ...prev, [reel.id]: !prev[reel.id] }))}
                        aria-label={isPaused ? 'Play reel' : 'Pause reel'}
                        className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/70"
                      >
                        {isPaused ? <Play size={17} /> : <Pause size={17} />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setMuted((m) => !m)}
                      aria-label="Toggle sound"
                      className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/70"
                    >
                      {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    </button>
                  </div>

                  {/* Double-tap burst */}
                  <AnimatePresence>
                    {heartBurst && idx === activeIdx && (
                      <motion.div
                        initial={{ scale: 0.4, opacity: 0 }}
                        animate={{ scale: 1.25, opacity: 1 }}
                        exit={{ scale: 1.6, opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center pointer-events-none"
                      >
                        <Heart size={84} className="text-[#FF007F] fill-[#FF007F]" />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Right Vertical Action Rail */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-3 bottom-6 z-20 flex flex-col items-center gap-4"
                  >
                    <button
                      type="button"
                      onClick={() => handleLike(reel)}
                      className="flex flex-col items-center gap-1 min-w-[44px]"
                    >
                      <span className="w-11 h-11 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center">
                        <Heart
                          size={22}
                          className={reel.is_liked ? 'text-[#FF007F] fill-[#FF007F]' : 'text-white'}
                        />
                      </span>
                      <span className="text-[11px] font-mono-tabular font-semibold text-white">
                        {reel.likes_count}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCommentsOpen(true)}
                      className="flex flex-col items-center gap-1 min-w-[44px]"
                    >
                      <span className="w-11 h-11 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center text-white">
                        <MessageCircle size={22} />
                      </span>
                      <span className="text-[11px] font-mono-tabular font-semibold text-white">
                        {reel.comments_count}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onShareToChat(reel)}
                      className="flex flex-col items-center gap-1 min-w-[44px]"
                    >
                      <span className="w-11 h-11 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center text-white">
                        <Send size={20} />
                      </span>
                      <span className="text-[11px] font-medium text-white">Share</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleReport(reel)}
                      aria-label="Report reel"
                      className="w-10 h-10 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center text-white/80 hover:text-rose-400"
                    >
                      <Flag size={16} />
                    </button>
                  </div>

                  {/* Bottom Creator Overlay */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-4 right-16 bottom-6 z-20 space-y-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <Avatar
                        src={reel.avatar_url}
                        name={reel.full_name}
                        size="sm"
                        onClick={() => onOpenProfile(reel.username)}
                      />
                      <button
                        type="button"
                        onClick={() => onOpenProfile(reel.username)}
                        className="text-sm font-semibold text-white flex items-center gap-1"
                      >
                        @{reel.username}
                        <RoleAndVerifiedBadge role={reel.author_role} isVerified={reel.is_verified} size={13} />
                      </button>
                      {currentUser?.id !== reel.user_id && (
                        <button
                          type="button"
                          onClick={() => handleFollow(reel)}
                          className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold text-white"
                        >
                          {reel.follow_status === 'accepted' ? 'Following' : 'Follow'}
                        </button>
                      )}
                    </div>

                    {reel.caption && <p className="text-xs text-white/90 line-clamp-2">{reel.caption}</p>}

                    <div className="flex items-center gap-2 text-xs text-white/75">
                      <Music2 size={13} className="text-[#00F0FF] shrink-0" />
                      <span className="truncate">
                        {reel.audio_title
                          ? `${reel.audio_title} · ${reel.audio_artist}`
                          : `Original Audio · ${reel.username}`}
                      </span>
                    </div>

                    {reportDone && (
                      <p className="text-xs text-amber-300 font-medium">Reel reported for moderation review.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Up/Down Stepper */}
          <div className="hidden md:flex flex-col gap-3">
            <button
              type="button"
              onClick={() => scrollToReel(activeIdx - 1)}
              disabled={activeIdx === 0}
              aria-label="Previous reel"
              className="w-11 h-11 rounded-full glass-panel flex items-center justify-center text-white disabled:opacity-30"
            >
              <ChevronUp size={20} />
            </button>
            <button
              type="button"
              onClick={() => scrollToReel(activeIdx + 1)}
              disabled={activeIdx >= reels.length - 1}
              aria-label="Next reel"
              className="w-11 h-11 rounded-full glass-panel flex items-center justify-center text-white disabled:opacity-30"
            >
              <ChevronDown size={20} />
            </button>
          </div>
        </div>
      )}

      {/* Comments Sheet */}
      {commentsOpen && activeReel && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="glass-panel w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 max-h-[75vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="font-display font-semibold text-white">Reel Comments</h3>
              <button type="button" onClick={() => setCommentsOpen(false)} className="text-xs text-white/60 hover:text-white">
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {comments.length === 0 ? (
                <p className="text-xs text-white/50 text-center py-6">No comments yet.</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5">
                    <Avatar src={c.avatar_url} name={c.full_name} size="xs" />
                    <div>
                      <p className="text-xs text-white/90">
                        <span className="font-semibold text-white mr-1.5">{c.username}</span>
                        {c.content}
                      </p>
                      <span className="text-[11px] text-white/40">{timeAgo(c.created_at)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            {commentError && <p className="text-xs text-rose-300 pb-2">{commentError}</p>}
            <form onSubmit={handlePostComment} className="pt-3 border-t border-white/10 flex gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a comment..."
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#0A0A0F] border border-white/15 text-xs text-white"
              />
              <button type="submit" className="px-4 py-2.5 rounded-xl vibe-gradient-cta text-xs font-semibold text-white">
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Full Screen Reel Modal */}
      {fullScreenIndex !== null && reels[fullScreenIndex] && (
        <FullScreenPostModal
          post={reels[fullScreenIndex]}
          currentUser={currentUser}
          onClose={() => setFullScreenIndex(null)}
          onOpenProfile={onOpenProfile}
          onRequireAuth={onRequireAuth}
          onPostMutated={(postId, patch) =>
            setReels((prev) => prev.map((r) => (r.id === postId ? { ...r, ...patch } : r)))
          }
          onPostDeleted={(postId) => {
            setReels((prev) => prev.filter((r) => r.id !== postId));
            setFullScreenIndex(null);
          }}
          onShareToChat={onShareToChat}
          onPrevPost={fullScreenIndex > 0 ? () => setFullScreenIndex(fullScreenIndex - 1) : undefined}
          onNextPost={
            fullScreenIndex < reels.length - 1 ? () => setFullScreenIndex(fullScreenIndex + 1) : undefined
          }
        />
      )}
    </div>
  );
}
