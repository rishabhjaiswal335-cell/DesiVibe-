import { Bell, Check, CheckCheck, UserCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch, wsClient } from '../lib/api.ts';
import type { FollowRequestItem, NotificationItem } from '../types.ts';
import { Avatar, RoleAndVerifiedBadge, timeAgo } from './Avatar.tsx';

interface NotificationsViewProps {
  onOpenProfile: (username: string) => void;
  onUnreadChange: (count: number) => void;
}

export function NotificationsView({ onOpenProfile, onUnreadChange }: NotificationsViewProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [followRequests, setFollowRequests] = useState<FollowRequestItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await apiFetch<{ notifications: NotificationItem[]; followRequests: FollowRequestItem[] }>(
        '/api/notifications'
      );
      setNotifications(res.notifications || []);
      setFollowRequests(res.followRequests || []);
      const unread = (res.notifications || []).filter((n) => !n.is_read).length;
      onUnreadChange(unread);
    } catch {
      // Keep current notifications state
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const off = wsClient.on('notification:new', (notif: NotificationItem) => {
      setNotifications((prev) => (prev.some((n) => n.id === notif.id) ? prev : [notif, ...prev]));
    });
    return () => off();
  }, []);

  const markAllRead = async () => {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
      onUnreadChange(0);
    } catch {
      // Ignore
    }
  };

  const markOneRead = async (id: string) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
      setNotifications((prev) => {
        const next = prev.map((n) => (n.id === id ? { ...n, is_read: 1 } : n));
        onUnreadChange(next.filter((n) => !n.is_read).length);
        return next;
      });
    } catch {
      // Ignore
    }
  };

  const handleFollowRequest = async (followId: string, action: 'accept' | 'decline') => {
    try {
      await apiFetch(`/api/profiles/follow-requests/${followId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      setFollowRequests((prev) => prev.filter((r) => r.follow_id !== followId));
    } catch {
      // Ignore
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Bell size={20} className="text-[#FF6B00]" />
          <h2 className="font-display text-xl font-bold text-white">Notifications</h2>
        </div>
        {notifications.some((n) => !n.is_read) && (
          <button
            type="button"
            onClick={markAllRead}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 text-xs font-semibold text-[#00F0FF]"
          >
            <CheckCheck size={14} /> Mark all read
          </button>
        )}
      </div>

      {/* Pending Follow Requests */}
      {followRequests.length > 0 && (
        <div className="glass-panel rounded-2xl p-4 space-y-3">
          <h3 className="font-display text-sm font-semibold text-white flex items-center gap-2">
            <UserCheck size={16} className="text-[#00F0FF]" /> Follow Requests ({followRequests.length})
          </h3>
          <div className="space-y-2.5">
            {followRequests.map((req) => (
              <div key={req.follow_id} className="flex items-center justify-between gap-3">
                <div
                  onClick={() => onOpenProfile(req.username)}
                  className="flex items-center gap-3 min-w-0 cursor-pointer"
                >
                  <Avatar src={req.avatar_url} name={req.full_name} size="sm" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="text-sm font-semibold text-white truncate">{req.username}</p>
                      <RoleAndVerifiedBadge isVerified={req.is_verified} size={13} />
                    </div>
                    <p className="text-xs text-white/55 truncate">{req.full_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleFollowRequest(req.follow_id, 'accept')}
                    className="px-3 py-1.5 rounded-xl vibe-gradient-cta text-xs font-semibold text-white flex items-center gap-1"
                  >
                    <Check size={14} /> Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFollowRequest(req.follow_id, 'decline')}
                    className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white/80 flex items-center gap-1"
                  >
                    <X size={14} /> Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Feed */}
      <div className="glass-panel rounded-2xl divide-y divide-white/[0.06] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-white/50">Loading activity...</div>
        ) : notifications.length === 0 ? (
          <div className="p-10 text-center text-sm text-white/55">
            No notifications yet. Likes, comments, follows, and announcements appear here in real time.
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => {
                if (!n.is_read) markOneRead(n.id);
                if (n.actor_username) onOpenProfile(n.actor_username);
              }}
              className={`p-4 flex items-center gap-3.5 cursor-pointer transition-colors ${
                n.is_read ? 'hover:bg-white/[0.03]' : 'bg-[#FF6B00]/[0.06] hover:bg-[#FF6B00]/[0.1]'
              }`}
            >
              <Avatar src={n.actor_avatar} name={n.actor_name || 'DesiVibe'} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white/90 leading-snug">{n.message}</p>
                <p className="text-xs text-white/45 mt-1">{timeAgo(n.created_at)}</p>
              </div>
              {!n.is_read && <span className="w-2.5 h-2.5 rounded-full bg-[#FF007F] shrink-0" />}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
