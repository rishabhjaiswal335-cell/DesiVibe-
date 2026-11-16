import { ChevronLeft, ChevronRight, Eye, Pause, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import type { StoryGroup, UserProfile } from '../types.ts';
import { Avatar, RoleAndVerifiedBadge, timeAgo } from './Avatar.tsx';

interface StoryViewerModalProps {
  groups: StoryGroup[];
  initialGroupIndex: number;
  currentUser: UserProfile | null;
  onClose: () => void;
  onStorySeen: (storyId: string) => void;
  onRequireAuth: () => void;
}

const QUICK_EMOJIS = ['🔥', '❤️', '🙌', '✨', '😍', '👏'];

export function StoryViewerModal({
  groups,
  initialGroupIndex,
  currentUser,
  onClose,
  onStorySeen,
  onRequireAuth,
}: StoryViewerModalProps) {
  const [groupIdx, setGroupIdx] = useState(initialGroupIndex);
  const [storyIdx, setStoryIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [reactionFeedback, setReactionFeedback] = useState<string | null>(null);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewers, setViewers] = useState<any[]>([]);
  const timerRef = useRef<number | null>(null);

  const activeGroup = groups[groupIdx];
  const activeStory = activeGroup?.stories[storyIdx];

  const goNext = () => {
    if (!activeGroup) return onClose();
    if (storyIdx < activeGroup.stories.length - 1) {
      setStoryIdx((s) => s + 1);
      setProgress(0);
    } else if (groupIdx < groups.length - 1) {
      setGroupIdx((g) => g + 1);
      setStoryIdx(0);
      setProgress(0);
    } else {
      onClose();
    }
  };

  const goPrev = () => {
    if (storyIdx > 0) {
      setStoryIdx((s) => s - 1);
      setProgress(0);
    } else if (groupIdx > 0) {
      const prevGroup = groups[groupIdx - 1];
      setGroupIdx((g) => g - 1);
      setStoryIdx(Math.max(0, prevGroup.stories.length - 1));
      setProgress(0);
    }
  };

  // Mark story viewed
  useEffect(() => {
    if (!activeStory) return;
    setViewersOpen(false);
    setViewers([]);
    if (currentUser) {
      apiFetch(`/api/stories/${activeStory.id}/view`, { method: 'POST' })
        .then(() => onStorySeen(activeStory.id))
        .catch(() => {});
    }
  }, [activeStory?.id]);

  // 5-second progress timer (pauses on hold or while typing/viewing list)
  useEffect(() => {
    if (!activeStory || paused || viewersOpen) return;
    timerRef.current = window.setInterval(() => {
      setProgress((prev) => (prev >= 100 ? 100 : prev + 2));
    }, 100);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeStory?.id, paused, viewersOpen, groupIdx, storyIdx]);

  useEffect(() => {
    if (progress >= 100) {
      goNext();
    }
  }, [progress]);

  if (!activeGroup || !activeStory) return null;

  const isOwner = currentUser?.id === activeStory.user_id;

  const sendReaction = async (emoji: string) => {
    if (!currentUser) return onRequireAuth();
    try {
      await apiFetch(`/api/stories/${activeStory.id}/react`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
      setReactionFeedback(`Sent ${emoji}`);
      setTimeout(() => setReactionFeedback(null), 1400);
    } catch {
      // Ignore
    }
  };

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return onRequireAuth();
    if (!replyText.trim()) return;
    try {
      await apiFetch(`/api/stories/${activeStory.id}/react`, {
        method: 'POST',
        body: JSON.stringify({ replyText: replyText.trim() }),
      });
      setReplyText('');
      setReactionFeedback('Reply sent to VibeChat');
      setTimeout(() => setReactionFeedback(null), 1600);
    } catch {
      // Ignore
    }
  };

  const loadViewers = async () => {
    if (!isOwner) return;
    setViewersOpen(true);
    try {
      const res = await apiFetch<{ viewers: any[] }>(`/api/stories/${activeStory.id}/views`);
      setViewers(res.viewers || []);
    } catch {
      setViewers([]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close stories"
        className="absolute top-4 right-4 z-30 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
      >
        <X size={20} />
      </button>

      {groupIdx > 0 && (
        <button
          type="button"
          onClick={goPrev}
          aria-label="Previous user story"
          className="hidden sm:flex absolute left-6 z-30 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 items-center justify-center text-white"
        >
          <ChevronLeft size={22} />
        </button>
      )}

      {groupIdx < groups.length - 1 && (
        <button
          type="button"
          onClick={goNext}
          aria-label="Next user story"
          className="hidden sm:flex absolute right-6 z-30 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 items-center justify-center text-white"
        >
          <ChevronRight size={22} />
        </button>
      )}

      <div
        className="relative w-full max-w-[430px] h-full sm:h-[86vh] sm:max-h-[820px] sm:rounded-3xl overflow-hidden bg-[#15151F] border border-white/10 flex flex-col justify-between select-none"
        onMouseDown={() => setPaused(true)}
        onMouseUp={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
        onTouchEnd={() => setPaused(false)}
      >
        {/* Media layer */}
        <div className="absolute inset-0">
          {activeStory.media_type === 'video' ? (
            <video src={activeStory.media_url} autoPlay loop playsInline className="w-full h-full object-cover" />
          ) : (
            <img
              src={activeStory.media_url}
              alt={activeStory.overlay_text || activeGroup.username}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-transparent to-black/80" />
        </div>

        {/* Left / Right tap navigation zones */}
        <div className="absolute inset-y-16 left-0 w-1/3 z-10 cursor-pointer" onClick={goPrev} />
        <div className="absolute inset-y-16 right-0 w-2/3 z-10 cursor-pointer" onClick={goNext} />

        {/* Header + Progress bars */}
        <div className="relative z-20 p-4 space-y-3">
          <div className="flex gap-1.5">
            {activeGroup.stories.map((st, idx) => {
              const pct = idx < storyIdx ? 100 : idx === storyIdx ? progress : 0;
              return (
                <div key={st.id} className="h-1 flex-1 rounded-full bg-white/25 overflow-hidden">
                  <div className="h-full bg-white transition-all duration-100" style={{ width: `${pct}%` }} />
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Avatar src={activeGroup.avatar_url} name={activeGroup.full_name} size="sm" />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-white">{activeGroup.username}</span>
                  <RoleAndVerifiedBadge isVerified={activeGroup.is_verified} size={13} />
                </div>
                <p className="text-[11px] text-white/65">{timeAgo(activeStory.created_at)}</p>
              </div>
            </div>
            {paused && (
              <span className="inline-flex items-center gap-1 text-xs text-white/80">
                <Pause size={13} /> Paused
              </span>
            )}
          </div>
        </div>

        {/* Center Overlays & Stickers */}
        <div className="relative z-20 px-6 text-center pointer-events-none">
          {activeStory.overlay_text && (
            <p className="inline-block px-4 py-2 rounded-2xl bg-black/55 backdrop-blur-md text-white font-display font-semibold text-lg shadow-lg">
              {activeStory.overlay_text}
            </p>
          )}
          {activeStory.stickers?.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {activeStory.stickers.map((st, i) => (
                <span
                  key={i}
                  className="px-3 py-1 rounded-xl bg-white/15 backdrop-blur-md text-xs font-medium text-white border border-white/20"
                >
                  {st}
                </span>
              ))}
            </div>
          )}
          {reactionFeedback && (
            <div className="mt-4 inline-block px-3.5 py-1.5 rounded-xl bg-[#FF6B00] text-white text-xs font-semibold">
              {reactionFeedback}
            </div>
          )}
        </div>

        {/* Footer Reactions / Reply / Creator Views */}
        <div
          className="relative z-20 p-4 space-y-3"
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          {isOwner ? (
            <button
              type="button"
              onClick={loadViewers}
              className="w-full py-2.5 px-4 rounded-xl bg-white/15 backdrop-blur-md text-white text-xs font-semibold flex items-center justify-center gap-2"
            >
              <Eye size={15} />
              <span className="font-mono-tabular">{activeStory.views_count}</span> Views · See Viewer List
            </button>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2">
                {QUICK_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => sendReaction(em)}
                    className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-lg flex items-center justify-center transition-transform active:scale-90"
                  >
                    {em}
                  </button>
                ))}
              </div>
              <form onSubmit={sendReply} className="flex items-center gap-2">
                <input
                  type="text"
                  value={replyText}
                  onFocus={() => setPaused(true)}
                  onBlur={() => setPaused(false)}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Reply to ${activeGroup.username}...`}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-black/50 backdrop-blur-md border border-white/20 text-sm text-white placeholder:text-white/50 focus:outline-none focus:border-[#00F0FF]"
                />
                <button
                  type="submit"
                  className="w-11 h-11 rounded-xl vibe-gradient-cta text-white flex items-center justify-center shrink-0"
                  aria-label="Send story reply"
                >
                  <Send size={16} />
                </button>
              </form>
            </>
          )}
        </div>

        {/* Story Views Sheet */}
        {viewersOpen && (
          <div
            className="absolute inset-x-0 bottom-0 z-30 bg-[#15151F] border-t border-white/15 rounded-t-3xl p-5 max-h-[60%] overflow-y-auto"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-display font-semibold text-white">Story Viewers ({viewers.length})</h4>
              <button type="button" onClick={() => setViewersOpen(false)} className="text-xs text-white/60 hover:text-white">
                Close
              </button>
            </div>
            {viewers.length === 0 ? (
              <p className="text-xs text-white/50 py-4 text-center">No views recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {viewers.map((v) => (
                  <div key={v.id} className="flex items-center gap-3">
                    <Avatar src={v.avatar_url} name={v.full_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate">{v.username}</p>
                      <p className="text-xs text-white/50 truncate">{v.full_name}</p>
                    </div>
                    <span className="text-xs text-white/45">{timeAgo(v.viewed_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
