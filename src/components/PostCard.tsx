import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Flag,
  Heart,
  Image as ImageIcon,
  Maximize2,
  MessageCircle,
  MoreHorizontal,
  Send,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { IMAGE_FILTER_CSS, isVideoMedia } from '../lib/media.ts';
import type { CommentItem, PostItem, UserProfile } from '../types.ts';
import { Avatar, RoleAndVerifiedBadge, timeAgo } from './Avatar.tsx';
import { FullScreenPostModal } from './FullScreenPostModal.tsx';

interface PostCardProps {
  post: PostItem;
  currentUser: UserProfile | null;
  onOpenProfile: (username: string) => void;
  onRequireAuth: () => void;
  onPostMutated: (postId: string, patch: Partial<PostItem>) => void;
  onPostDeleted?: (postId: string) => void;
  onShareToChat: (post: PostItem) => void;
}

export function PostCard({
  post,
  currentUser,
  onOpenProfile,
  onRequireAuth,
  onPostMutated,
  onPostDeleted,
  onShareToChat,
}: PostCardProps) {
  const [slideIdx, setSlideIdx] = useState(0);
  const [heartBurst, setHeartBurst] = useState(false);
  const [imgFailed, setImgFailed] = useState<Record<number, boolean>>({});
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replyTarget, setReplyTarget] = useState<CommentItem | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('Spam or misleading');
  const [reportDone, setReportDone] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [fullScreenOpen, setFullScreenOpen] = useState(false);

  const lastTapRef = useRef(0);
  const singleTapTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    };
  }, []);

  const mediaList = post.media_urls?.length ? post.media_urls : [post.thumbnail_url].filter(Boolean);
  const currentMedia = mediaList[slideIdx] || mediaList[0] || '';
  const isVideo = isVideoMedia(currentMedia, post.media_type);
  const posterUrl = !isVideoMedia(post.thumbnail_url) ? post.thumbnail_url : undefined;
  const filterCss = IMAGE_FILTER_CSS[post.filter_name] || 'none';

  const loadComments = async () => {
    setLoadingComments(true);
    try {
      const res = await apiFetch<{ comments: CommentItem[] }>(`/api/posts/${post.id}/comments`);
      setComments(res.comments || []);
    } catch {
      // Ignore
    } finally {
      setLoadingComments(false);
    }
  };

  useEffect(() => {
    if (commentsOpen) loadComments();
  }, [commentsOpen, post.id]);

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
      // Revert on failure
      onPostMutated(post.id, { is_liked: post.is_liked, likes_count: post.likes_count });
    }
  };

  const handleMediaTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      setHeartBurst(true);
      setTimeout(() => setHeartBurst(false), 700);
      handleToggleLike(true);
    } else if (!isVideo) {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = window.setTimeout(() => {
        setFullScreenOpen(true);
      }, 280);
    }
    lastTapRef.current = now;
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
      const res = await apiFetch<{ followStatus: 'accepted' | 'pending' | null }>(`/api/profiles/${post.user_id}/follow`, {
        method: 'POST',
      });
      onPostMutated(post.id, { follow_status: res.followStatus });
    } catch {
      // Ignore
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return onRequireAuth();
    if (!commentText.trim()) return;
    setCommentError('');
    try {
      const res = await apiFetch<{ comment: CommentItem; comments_count: number }>(`/api/posts/${post.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: commentText.trim(), parentId: replyTarget?.id || null }),
      });
      setComments((prev) => (prev.some((c) => c.id === res.comment.id) ? prev : [...prev, res.comment]));
      onPostMutated(post.id, { comments_count: res.comments_count });
      setCommentText('');
      setReplyTarget(null);
    } catch (err: any) {
      setCommentError(err?.message || 'Unable to post comment.');
    }
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    try {
      await apiFetch(`/api/posts/${post.id}`, { method: 'DELETE' });
      onPostDeleted?.(post.id);
    } catch {
      // Ignore
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return onRequireAuth();
    try {
      await apiFetch('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          targetType: post.media_type === 'reel' ? 'reel' : 'post',
          targetId: post.id,
          reason: reportReason,
        }),
      });
      setReportDone(true);
      setTimeout(() => {
        setReportOpen(false);
        setReportDone(false);
      }, 1200);
    } catch {
      // Ignore
    }
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
    <article className="glass-panel rounded-3xl overflow-hidden transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar
            src={post.avatar_url}
            name={post.full_name}
            size="md"
            onClick={() => onOpenProfile(post.username)}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onOpenProfile(post.username)}
                className="text-sm font-semibold text-white hover:text-[#00F0FF] transition-colors truncate"
              >
                {post.username}
              </button>
              <RoleAndVerifiedBadge role={post.author_role} isVerified={post.is_verified} size={14} />
            </div>
            <p className="text-xs text-white/55 truncate">
              {post.location ? `${post.location} · ` : ''}
              {timeAgo(post.created_at)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 relative">
          {currentUser?.id !== post.user_id && (
            <button
              type="button"
              onClick={handleFollow}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                post.follow_status === 'accepted'
                  ? 'bg-white/10 text-white/80 hover:bg-white/15'
                  : post.follow_status === 'pending'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'text-[#00F0FF] hover:bg-[#00F0FF]/10'
              }`}
            >
              {post.follow_status === 'accepted' ? 'Following' : post.follow_status === 'pending' ? 'Requested' : 'Follow'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Post options"
            className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white"
          >
            <MoreHorizontal size={18} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-11 z-30 w-44 glass-panel rounded-2xl p-1.5 shadow-2xl">
              {canDelete && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="w-full px-3 py-2 text-left text-xs text-rose-400 hover:bg-rose-500/10 rounded-xl flex items-center gap-2"
                >
                  <Trash2 size={14} /> Delete Post
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setReportOpen(true);
                }}
                className="w-full px-3 py-2 text-left text-xs text-white/80 hover:bg-white/10 rounded-xl flex items-center gap-2"
              >
                <Flag size={14} /> Report Content
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Media Viewport */}
      <div
        onClick={handleMediaTap}
        className="relative w-full bg-[#0A0A0F] overflow-hidden select-none cursor-pointer aspect-[4/3] sm:aspect-[4/4]"
      >
        {isVideo && currentMedia ? (
          <video
            src={currentMedia}
            poster={posterUrl}
            controls
            playsInline
            preload="metadata"
            onClick={(e) => e.stopPropagation()}
            className="w-full h-full object-cover"
          />
        ) : imgFailed[slideIdx] || !currentMedia ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#15151F] via-[#1C1428] to-[#0A0A0F] text-white/50 p-6 text-center">
            <ImageIcon size={36} className="mb-2 text-[#FF6B00]/60" />
            <p className="text-xs">{post.location || 'DesiVibe Media'}</p>
          </div>
        ) : (
          <img
            src={currentMedia}
            alt={post.caption || `Post by ${post.username}`}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed((prev) => ({ ...prev, [slideIdx]: true }))}
            style={{ filter: filterCss }}
            className="w-full h-full object-cover"
          />
        )}

        {/* Full Screen Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setFullScreenOpen(true);
          }}
          aria-label="View post full screen"
          className="absolute top-3 right-3 z-20 w-9 h-9 rounded-full bg-black/55 hover:bg-black/75 backdrop-blur-md border border-white/15 text-white flex items-center justify-center transition-colors"
        >
          <Maximize2 size={15} />
        </button>

        {/* Carousel controls */}
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
                className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/55 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/75"
              >
                <ChevronLeft size={18} />
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
                className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/55 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/75"
              >
                <ChevronRight size={18} />
              </button>
            )}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 px-2.5 py-1 rounded-full bg-black/45 backdrop-blur-md">
              {mediaList.map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i === slideIdx ? 'bg-[#FF6B00]' : 'bg-white/40'
                  }`}
                />
              ))}
            </div>
          </>
        )}

        {/* Animated Heart Burst */}
        <AnimatePresence>
          {heartBurst && (
            <motion.div
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1.2, opacity: 1 }}
              exit={{ scale: 1.6, opacity: 0 }}
              transition={{ duration: 0.45 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <Heart size={88} className="text-[#FF007F] fill-[#FF007F] drop-shadow-[0_0_24px_rgba(255,0,127,0.8)]" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Actions & Caption */}
      <div className="p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleToggleLike(false)}
              aria-label="Like post"
              className="min-w-[44px] min-h-[44px] px-2 rounded-xl hover:bg-white/[0.05] flex items-center gap-1.5 transition-colors"
            >
              <Heart
                size={22}
                className={post.is_liked ? 'text-[#FF007F] fill-[#FF007F]' : 'text-white/85'}
              />
              <span className="text-xs font-mono-tabular font-semibold text-white/90">{post.likes_count}</span>
            </button>

            <button
              type="button"
              onClick={() => setCommentsOpen((o) => !o)}
              aria-label="Comments"
              className="min-w-[44px] min-h-[44px] px-2 rounded-xl hover:bg-white/[0.05] flex items-center gap-1.5 transition-colors"
            >
              <MessageCircle size={22} className="text-white/85" />
              <span className="text-xs font-mono-tabular font-semibold text-white/90">{post.comments_count}</span>
            </button>

            <button
              type="button"
              onClick={() => onShareToChat(post)}
              aria-label="Share to VibeChat"
              className="min-w-[44px] min-h-[44px] px-2 rounded-xl hover:bg-white/[0.05] flex items-center gap-1.5 transition-colors"
            >
              <Send size={20} className="text-white/85" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleToggleSave}
            aria-label="Bookmark post"
            className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-white/[0.05] flex items-center justify-center transition-colors"
          >
            <Bookmark
              size={22}
              className={post.is_saved ? 'text-[#FF6B00] fill-[#FF6B00]' : 'text-white/85'}
            />
          </button>
        </div>

        {post.caption && (
          <p className="text-sm text-white/90 leading-relaxed">
            <button
              type="button"
              onClick={() => onOpenProfile(post.username)}
              className="font-semibold text-white mr-2 hover:text-[#00F0FF]"
            >
              {post.username}
            </button>
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

        {/* Inline Nested Comments Drawer */}
        {commentsOpen && (
          <div className="pt-3 mt-2 border-t border-white/10 space-y-3">
            {loadingComments ? (
              <p className="text-xs text-white/50">Loading comments...</p>
            ) : topComments.length === 0 ? (
              <p className="text-xs text-white/50">Be the first to drop a vibe.</p>
            ) : (
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {topComments.map((c) => (
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
                ))}
              </div>
            )}

            {replyTarget && (
              <div className="flex items-center justify-between text-xs text-[#00F0FF] bg-[#00F0FF]/10 px-3 py-1.5 rounded-xl">
                <span>Replying to @{replyTarget.username}</span>
                <button type="button" onClick={() => setReplyTarget(null)} className="text-white/70 hover:text-white">
                  Cancel
                </button>
              </div>
            )}

            {commentError && <p className="text-xs text-rose-300">{commentError}</p>}

            <form onSubmit={handleSubmitComment} className="flex items-center gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={replyTarget ? `Reply to @${replyTarget.username}...` : 'Add a comment...'}
                className="flex-1 px-3.5 py-2 rounded-xl bg-[#0A0A0F]/80 border border-white/10 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-[#00F0FF]"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-xl vibe-gradient-cta text-white text-xs font-semibold whitespace-nowrap shrink-0"
              >
                Post
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Report Dialog */}
      {reportOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleSubmitReport} className="glass-panel rounded-2xl p-5 w-full max-w-sm space-y-4">
            <h4 className="font-display font-semibold text-white">Report Content</h4>
            {reportDone ? (
              <p className="text-xs text-emerald-400">Report submitted to Moderation Queue. Thank you.</p>
            ) : (
              <>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-[#0A0A0F] border border-white/15 text-xs text-white"
                >
                  <option>Spam or misleading</option>
                  <option>Harassment or hate speech</option>
                  <option>Inappropriate or explicit media</option>
                  <option>Copyright infringement</option>
                </select>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    className="px-4 py-2 rounded-xl bg-white/10 text-xs text-white"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="px-4 py-2 rounded-xl bg-rose-500 text-xs font-semibold text-white">
                    Submit Report
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}

      {fullScreenOpen && (
        <FullScreenPostModal
          post={post}
          currentUser={currentUser}
          onClose={() => setFullScreenOpen(false)}
          onOpenProfile={onOpenProfile}
          onRequireAuth={onRequireAuth}
          onPostMutated={onPostMutated}
          onPostDeleted={onPostDeleted}
          onShareToChat={onShareToChat}
        />
      )}
    </article>
  );
}
