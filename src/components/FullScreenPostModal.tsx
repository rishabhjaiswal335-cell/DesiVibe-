import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Flag,
  Heart,
  Image as ImageIcon,
  MapPin,
  MessageCircle,
  Music2,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { IMAGE_FILTER_CSS, isVideoMedia } from '../lib/media.ts';
import type { CommentItem, PostItem, UserProfile } from '../types.ts';
import { Avatar, RoleAndVerifiedBadge, timeAgo } from './Avatar.tsx';

interface FullScreenPostModalProps {
  post: PostItem;
  currentUser: UserProfile | null;
  onClose: () => void;
  onOpenProfile: (username: string) => void;
  onRequireAuth: () => void;
  onPostMutated: (postId: string, patch: Partial<PostItem>) => void;
  onPostDeleted?: (postId: string) => void;
  onShareToChat?: (post: PostItem) => void;
  onPrevPost?: () => void;
  onNextPost?: () => void;
}

export function FullScreenPostModal({
  post,
  currentUser,
  onClose,
  onOpenProfile,
  onRequireAuth,
  onPostMutated,
  onPostDeleted,
  onShareToChat,
  onPrevPost,
  onNextPost,
}: FullScreenPostModalProps) {
  const [slideIdx, setSlideIdx] = useState(0);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [replyTarget, setReplyTarget] = useState<CommentItem | null>(null);
  const [commentError, setCommentError] = useState('');
  const [heartBurst, setHeartBurst] = useState(false);
  const [imgFailed, setImgFailed] = useState<Record<number, boolean>>({});
  const [reportDone, setReportDone] = useState(false);
  const lastTapRef = useRef(0);

  const mediaList = post.media_urls?.length ? post.media_urls : [post.thumbnail_url].filter(Boolean);
  const currentMedia = mediaList[slideIdx] || mediaList[0] || '';
  const isVideo = isVideoMedia(currentMedia, post.media_type);
  const posterUrl = !isVideoMedia(post.thumbnail_url) ? post.thumbnail_url : undefined;
  const filterCss = IMAGE_FILTER_CSS[post.filter_name] || 'none';

  useEffect(() => {
    setSlideIdx(0);
    setImgFailed({});
    setReplyTarget(null);
    setCommentError('');
    setReportDone(false);
    setLoadingComments(true);

    apiFetch<{ comments: CommentItem[] }>(`/api/posts/${post.id}/comments`)
      .then((res) => setComments(res.comments || []))
      .catch(() => setComments([]))
      .finally(() => setLoadingComments(false));
  }, [post.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && onPrevPost) {
        onPrevPost();
      } else if (e.key === 'ArrowRight' && onNextPost) {
        onNextPost();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, onPrevPost, onNextPost]);

  const handleToggleLike = async (forceLike = false) => {
    if (!currentUser) return onRequireAuth();
    if (forceLike && post.is_liked) return;

    const optimisticLiked = !post.is_liked;
    onPostMutated(post.id, {
      is_liked: optimisticLiked,
      likes_count: Math.max(0, post.likes_count + (optimisticLiked ? 1 : -1)),
    });

    try {
      const res = await apiFetch<{ liked: boolean; likes_count: number }>(`/api/posts/${post.id}/like`, {
        method: 'POST',
      });
      onPostMutated(post.id, { is_liked: res.liked, likes_count: res.likes_count });
    } catch {
      onPostMutated(post.id, { is_liked: post.is_liked, likes_count: post.likes_count });
    }
  };

  const handleToggleSave = async () => {
    if (!currentUser) return onRequireAuth();
    const optimistic = !post.is_saved;
    onPostMutated(post.id, { is_saved: optimistic });
    try {
      const res = await apiFetch<{ saved: boolean }>(`/api/posts/${post.id}/save`, { method: 'POST' });
      onPostMutated(post.id, { is_saved: res.saved });
    } catch {
      onPostMutated(post.id, { is_saved: post.is_saved });
    }
  };

  const handleFollow = async () => {
    if (!currentUser) return onRequireAuth();
    try {
      const res = await apiFetch<{ followStatus: 'accepted' | 'pending' | null }>(
        `/api/profiles/${post.user_id}/follow`,
        { method: 'POST' }
      );
      onPostMutated(post.id, { follow_status: res.followStatus });
    } catch {
      // Ignore transient follow failure
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return onRequireAuth();
    if (!commentText.trim()) return;
    setCommentError('');
    try {
      const res = await apiFetch<{ comment: CommentItem; comments_count: number }>(
        `/api/posts/${post.id}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({ content: commentText.trim(), parentId: replyTarget?.id || null }),
        }
      );
      setComments((prev) => (prev.some((c) => c.id === res.comment.id) ? prev : [...prev, res.comment]));
      onPostMutated(post.id, { comments_count: res.comments_count });
      setCommentText('');
      setReplyTarget(null);
    } catch (err: any) {
      setCommentError(err?.message || 'Unable to post comment.');
    }
  };

  const handleDelete = async () => {
    try {
      await apiFetch(`/api/posts/${post.id}`, { method: 'DELETE' });
      onPostDeleted?.(post.id);
      onClose();
    } catch (err: any) {
      setCommentError(err?.message || 'Failed to delete post.');
    }
  };

  const handleReport = async () => {
    if (!currentUser) return onRequireAuth();
    try {
      await apiFetch('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          targetType: post.media_type === 'reel' ? 'reel' : 'post',
          targetId: post.id,
          reason: 'Reported from full-screen viewer',
        }),
      });
      setReportDone(true);
      setTimeout(() => setReportDone(false), 1800);
    } catch {
      // Ignore
    }
  };

  const handleMediaTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      setHeartBurst(true);
      setTimeout(() => setHeartBurst(false), 650);
      handleToggleLike(true);
    }
    lastTapRef.current = now;
  };

  const canDelete =
    currentUser &&
    (currentUser.id === post.user_id || currentUser.role === 'admin' || currentUser.role === 'super_admin');

  const topComments = comments.filter((c) => !c.parent_id);
  const repliesByParent = comments.reduce<Record<string, CommentItem[]>>((acc, c) => {
    if (c.parent_id) {
      acc[c.parent_id] = acc[c.parent_id] || [];
      acc[c.parent_id].push(c);
    }
    return acc;
  }, {});

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex flex-col lg:flex-row"
    >
      {/* Close Button */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close full screen post"
        className="fixed top-4 right-4 z-[60] w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center text-white"
      >
        <X size={20} />
      </button>

      {/* Media Stage */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          if (!isVideo) handleMediaTap();
        }}
        className="relative flex-1 min-h-[48vh] lg:min-h-screen bg-black flex items-center justify-center overflow-hidden select-none"
      >
        {onPrevPost && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPrevPost();
            }}
            aria-label="Previous post"
            className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/15 text-white flex items-center justify-center"
          >
            <ChevronLeft size={20} />
          </button>
        )}

        {onNextPost && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNextPost();
            }}
            aria-label="Next post"
            className="absolute right-3 sm:right-5 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/15 text-white flex items-center justify-center"
          >
            <ChevronRight size={20} />
          </button>
        )}

        {isVideo ? (
          <video
            key={currentMedia}
            src={currentMedia}
            poster={posterUrl}
            controls
            autoPlay
            loop
            playsInline
            className="max-h-full max-w-full w-full h-full object-contain"
          />
        ) : imgFailed[slideIdx] || !currentMedia ? (
          <div className="flex flex-col items-center justify-center text-white/55 p-8">
            <ImageIcon size={44} className="mb-2 text-[#FF6B00]/70" />
            <p className="text-sm">{post.location || 'DesiVibe Media'}</p>
          </div>
        ) : (
          <img
            src={currentMedia}
            alt={post.caption || post.username}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed((prev) => ({ ...prev, [slideIdx]: true }))}
            style={{ filter: filterCss }}
            className="max-h-full max-w-full w-full h-full object-contain"
          />
        )}

        {/* Carousel Slide Switcher */}
        {mediaList.length > 1 && (
          <>
            {slideIdx > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSlideIdx((i) => i - 1);
                }}
                aria-label="Previous slide"
                className="absolute left-4 bottom-6 z-20 w-9 h-9 rounded-full bg-black/65 border border-white/15 text-white flex items-center justify-center"
              >
                <ChevronLeft size={17} />
              </button>
            )}
            {slideIdx < mediaList.length - 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSlideIdx((i) => i + 1);
                }}
                aria-label="Next slide"
                className="absolute right-4 bottom-6 z-20 w-9 h-9 rounded-full bg-black/65 border border-white/15 text-white flex items-center justify-center"
              >
                <ChevronRight size={17} />
              </button>
            )}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex gap-1.5 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-md">
              {mediaList.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSlideIdx(i);
                  }}
                  aria-label={`Slide ${i + 1}`}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === slideIdx ? 'bg-[#FF6B00]' : 'bg-white/40'
                  }`}
                />
              ))}
            </div>
          </>
        )}

        <AnimatePresence>
          {heartBurst && (
            <motion.div
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1.2, opacity: 1 }}
              exit={{ scale: 1.6, opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <Heart size={92} className="text-[#FF007F] fill-[#FF007F] drop-shadow-[0_0_24px_rgba(255,0,127,0.8)]" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Right / Bottom Details & Live Comments Panel */}
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full lg:w-[400px] xl:w-[430px] max-h-[50vh] lg:max-h-screen lg:h-screen bg-[#101018] border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col"
      >
        {/* Creator Header */}
        <div className="px-4 py-3.5 pr-16 lg:pr-16 border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar
              src={post.avatar_url}
              name={post.full_name}
              size="sm"
              onClick={() => {
                onClose();
                onOpenProfile(post.username);
              }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenProfile(post.username);
                  }}
                  className="text-sm font-semibold text-white hover:text-[#00F0FF] truncate"
                >
                  {post.username}
                </button>
                <RoleAndVerifiedBadge role={post.author_role} isVerified={post.is_verified} size={13} />
              </div>
              <p className="text-[11px] text-white/50 flex items-center gap-1 truncate">
                {post.location && (
                  <>
                    <MapPin size={10} /> {post.location} ·
                  </>
                )}
                {timeAgo(post.created_at)}
              </p>
            </div>
          </div>

          {currentUser?.id !== post.user_id && (
            <button
              type="button"
              onClick={handleFollow}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 ${
                post.follow_status === 'accepted'
                  ? 'bg-white/10 text-white/80'
                  : post.follow_status === 'pending'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'vibe-gradient-cta text-white'
              }`}
            >
              {post.follow_status === 'accepted' ? 'Following' : post.follow_status === 'pending' ? 'Requested' : 'Follow'}
            </button>
          )}
        </div>

        {/* Caption & Comments Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {post.caption && (
            <p className="text-sm text-white/90 leading-relaxed">
              <span className="font-semibold text-white mr-2">{post.username}</span>
              {post.caption.split(/(#[A-Za-z0-9_]+)/g).map((part, idx) =>
                part.startsWith('#') ? (
                  <span key={idx} className="text-[#00F0FF] font-medium">
                    {part}
                  </span>
                ) : (
                  <span key={idx}>{part}</span>
                )
              )}
            </p>
          )}

          {post.audio_title && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white/80">
              <Music2 size={13} className="text-[#00F0FF]" />
              <span>
                {post.audio_title} · {post.audio_artist}
              </span>
            </div>
          )}

          <div className="pt-2 border-t border-white/10 space-y-3">
            {loadingComments ? (
              <p className="text-xs text-white/50">Loading comments...</p>
            ) : topComments.length === 0 ? (
              <p className="text-xs text-white/45 py-4 text-center">No comments yet. Start the conversation!</p>
            ) : (
              topComments.map((c) => (
                <div key={c.id} className="space-y-2">
                  <div className="flex items-start gap-2.5">
                    <Avatar src={c.avatar_url} name={c.full_name} size="xs" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white/90">
                        <span className="font-semibold text-white mr-1.5">{c.username}</span>
                        {c.content}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-white/45">
                        <span>{timeAgo(c.created_at)}</span>
                        <button
                          type="button"
                          onClick={() => setReplyTarget(c)}
                          className="hover:text-[#00F0FF] font-medium"
                        >
                          Reply
                        </button>
                      </div>
                    </div>
                  </div>
                  {repliesByParent[c.id]?.map((rep) => (
                    <div key={rep.id} className="pl-8 flex items-start gap-2">
                      <Avatar src={rep.avatar_url} name={rep.full_name} size="xs" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white/85">
                          <span className="font-semibold text-white mr-1.5">{rep.username}</span>
                          {rep.content}
                        </p>
                        <span className="text-[11px] text-white/40">{timeAgo(rep.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Actions + Comment Composer */}
        <div className="p-3.5 border-t border-white/10 space-y-2.5 bg-[#0C0C14] shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleToggleLike(false)}
                className="px-2.5 py-1.5 rounded-xl hover:bg-white/[0.06] flex items-center gap-1.5 text-xs font-mono-tabular text-white"
              >
                <Heart size={19} className={post.is_liked ? 'text-[#FF007F] fill-[#FF007F]' : 'text-white/85'} />
                {post.likes_count}
              </button>
              <span className="px-2 py-1.5 flex items-center gap-1.5 text-xs font-mono-tabular text-white/80">
                <MessageCircle size={19} /> {post.comments_count}
              </span>
              {onShareToChat && (
                <button
                  type="button"
                  onClick={() => onShareToChat(post)}
                  aria-label="Share to VibeChat"
                  className="p-2 rounded-xl hover:bg-white/[0.06] text-white/85"
                >
                  <Send size={18} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleReport}
                aria-label="Report post"
                className="p-2 rounded-xl hover:bg-white/[0.06] text-white/65 hover:text-amber-300"
              >
                <Flag size={16} />
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={handleDelete}
                  aria-label="Delete post"
                  className="p-2 rounded-xl hover:bg-rose-500/15 text-rose-400"
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={handleToggleSave}
                aria-label="Save post"
                className="p-2 rounded-xl hover:bg-white/[0.06]"
              >
                <Bookmark
                  size={19}
                  className={post.is_saved ? 'text-[#FF6B00] fill-[#FF6B00]' : 'text-white/85'}
                />
              </button>
            </div>
          </div>

          {reportDone && <p className="text-[11px] text-amber-300">Reported to moderation queue.</p>}
          {commentError && <p className="text-[11px] text-rose-300">{commentError}</p>}
          {replyTarget && (
            <div className="flex items-center justify-between text-[11px] text-[#00F0FF] bg-[#00F0FF]/10 px-3 py-1 rounded-lg">
              <span>Replying to @{replyTarget.username}</span>
              <button type="button" onClick={() => setReplyTarget(null)} className="text-white/70 hover:text-white">
                Cancel
              </button>
            </div>
          )}

          <form onSubmit={handleSubmitComment} className="flex items-center gap-2">
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={replyTarget ? `Reply to @${replyTarget.username}...` : 'Add a comment...'}
              className="flex-1 px-3.5 py-2 rounded-xl bg-[#0A0A0F] border border-white/12 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-[#00F0FF]"
            />
            <button
              type="submit"
              className="px-3.5 py-2 rounded-xl vibe-gradient-cta text-white text-xs font-semibold shrink-0"
            >
              Post
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}
