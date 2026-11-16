import { Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import type { PostItem, UserProfile } from '../types.ts';
import { Avatar } from './Avatar.tsx';

interface ShareToChatModalProps {
  post: PostItem;
  onClose: () => void;
  onShared: (conversationId: string) => void;
}

export function ShareToChatModal({ post, onClose, onShared }: ShareToChatModalProps) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    apiFetch<{ users: UserProfile[] }>('/api/profiles/suggested')
      .then((res) => setUsers(res.users || []))
      .catch((err: any) => setError(err?.message || 'Unable to load contacts.'))
      .finally(() => setLoading(false));
  }, []);

  const handleShare = async (targetUserId: string) => {
    setSendingId(targetUserId);
    setError('');
    try {
      const convRes = await apiFetch<{ conversationId: string }>('/api/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({ memberIds: [targetUserId], isGroup: false }),
      });
      await apiFetch(`/api/chat/conversations/${convRes.conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          mediaType: post.media_type === 'reel' ? 'reel_share' : 'post_share',
          sharedPostId: post.id,
          content: `Shared @${post.username}'s ${post.media_type === 'reel' ? 'VibeReel' : 'post'}`,
        }),
      });
      await apiFetch(`/api/posts/${post.id}/share`, { method: 'POST' }).catch(() => {});
      onShared(convRes.conversationId);
    } catch (err: any) {
      setError(err?.message || 'Unable to send post to VibeChat.');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel rounded-3xl p-5 w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold text-white">Share to VibeChat</h3>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-200">
            {error}
          </div>
        )}

        <div className="space-y-2 max-h-72 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-white/50 text-center py-6">Loading creators...</p>
          ) : users.length === 0 ? (
            <p className="text-xs text-white/50 text-center py-6">No creators available to share with yet.</p>
          ) : (
            users.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 p-2 rounded-xl bg-white/[0.03]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar src={u.avatar_url} name={u.full_name} size="sm" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate">@{u.username}</p>
                    <p className="text-[11px] text-white/50 truncate">{u.full_name}</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={sendingId === u.id}
                  onClick={() => handleShare(u.id)}
                  className="px-3 py-1.5 rounded-xl vibe-gradient-cta text-xs font-semibold text-white flex items-center gap-1 shrink-0 disabled:opacity-50"
                >
                  <Send size={12} /> {sendingId === u.id ? 'Sending' : 'Send'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
