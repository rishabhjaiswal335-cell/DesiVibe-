import {
  Activity,
  Ban,
  CheckCircle2,
  Database,
  FileWarning,
  Megaphone,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import type { AnnouncementItem, PostItem, UserProfile } from '../types.ts';
import { Avatar, RoleAndVerifiedBadge, timeAgo } from './Avatar.tsx';

interface AdminDashboardProps {
  currentUser: UserProfile;
  onAnnouncementPosted: () => void;
}

type AdminSection = 'analytics' | 'users' | 'moderation' | 'announcements' | 'security';

export function AdminDashboard({ currentUser, onAnnouncementPosted }: AdminDashboardProps) {
  const [section, setSection] = useState<AdminSection>('analytics');
  const [analytics, setAnalytics] = useState<any>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [userQuery, setUserQuery] = useState('');
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [ratingsData, setRatingsData] = useState<{ totalRatings: number; averageRating: number; ratings: any[] }>({
    totalRatings: 0,
    averageRating: 0,
    ratings: [],
  });
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annType, setAnnType] = useState<'info' | 'warning' | 'festival'>('festival');
  const [error, setError] = useState('');

  const loadAnalytics = async () => {
    const [res, ratingsRes] = await Promise.all([
      apiFetch('/api/admin/analytics'),
      apiFetch('/api/admin/ratings'),
    ]);
    setAnalytics(res);
    setRatingsData(ratingsRes);
  };

  const loadUsers = async () => {
    const res = await apiFetch<{ users: UserProfile[] }>(
      `/api/admin/users?q=${encodeURIComponent(userQuery)}`
    );
    setUsers(res.users || []);
  };

  const loadModeration = async () => {
    const [contentRes, repRes] = await Promise.all([
      apiFetch('/api/admin/content'),
      apiFetch('/api/admin/reports'),
    ]);
    setPosts(contentRes.posts || []);
    setReports(repRes.reports || []);
  };

  const loadAnnouncements = async () => {
    const res = await apiFetch('/api/admin/announcements');
    setAnnouncements(res.announcements || []);
  };

  const loadAudit = async () => {
    const res = await apiFetch('/api/admin/audit-logs');
    setAuditLogs(res.logs || []);
  };

  useEffect(() => {
    setError('');
    if (section === 'analytics') loadAnalytics().catch((e) => setError(e.message));
    if (section === 'users') loadUsers().catch((e) => setError(e.message));
    if (section === 'moderation') loadModeration().catch((e) => setError(e.message));
    if (section === 'announcements') loadAnnouncements().catch((e) => setError(e.message));
    if (section === 'security') loadAudit().catch((e) => setError(e.message));
  }, [section]);

  useEffect(() => {
    if (section === 'users') {
      const t = setTimeout(() => loadUsers().catch(() => {}), 250);
      return () => clearTimeout(t);
    }
  }, [userQuery]);

  const handleUserAction = async (userId: string, action: string) => {
    setError('');
    try {
      const res = await apiFetch<{ user: UserProfile }>(`/api/admin/users/${userId}/action`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      setUsers((prev) => prev.map((u) => (u.id === userId ? res.user : u)));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleContentAction = async (type: string, id: string, action: string) => {
    setError('');
    try {
      await apiFetch(`/api/admin/content/${type}/${id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      loadModeration().catch(() => {});
    } catch (e: any) {
      setError(e.message || 'Content moderation action failed.');
    }
  };

  const handleResolveReport = async (id: string, status: string) => {
    setError('');
    try {
      await apiFetch(`/api/admin/reports/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      loadModeration().catch(() => {});
    } catch (e: any) {
      setError(e.message || 'Report update failed.');
    }
  };

  const handleBroadcastAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({ title: annTitle, body: annBody, bannerType: annType }),
      });
      setAnnTitle('');
      setAnnBody('');
      loadAnnouncements().catch(() => {});
      onAnnouncementPosted();
    } catch (e: any) {
      setError(e.message || 'Announcement broadcast failed.');
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 KB';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-panel rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#FF6B00]/15 border border-[#FF6B00]/40 flex items-center justify-center text-[#FF6B00] shadow-[0_0_20px_rgba(255,107,0,0.3)]">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-white flex items-center gap-2">
              Admin Command Center
            </h1>
            <p className="text-xs text-white/60">
              Signed in as {currentUser.role === 'super_admin' ? 'Super Admin' : 'Admin'} · @{currentUser.username} ({currentUser.email || 'rishabhjaiswal335@gmail.com'})
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['analytics', 'Analytics'],
              ['users', 'Users'],
              ['moderation', 'Moderation'],
              ['announcements', 'Announcements'],
              ['security', 'Security & Audit'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                section === id
                  ? 'vibe-gradient-cta text-white'
                  : 'bg-white/[0.04] text-white/70 hover:text-white border border-white/10'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-200">{error}</div>
      )}

      {/* A. LIVE ANALYTICS */}
      {section === 'analytics' && analytics && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Registered Users', value: analytics.metrics.totalUsers, sub: `${analytics.metrics.activeUsers} active accounts`, icon: Users },
              { label: 'Online Right Now', value: analytics.metrics.onlineNow, sub: 'Live WebSocket sessions', icon: Activity },
              { label: 'Posts & VibeReels', value: analytics.metrics.totalPosts + analytics.metrics.totalReels, sub: `${analytics.metrics.totalStories} active 24h stories`, icon: Database },
              { label: 'Pending Reports', value: analytics.metrics.pendingReports, sub: `Storage: ${formatBytes(analytics.metrics.storageBytes)}`, icon: FileWarning },
            ].map((stat, i) => {
              const Icon = stat.icon;
              return (
                <div key={i} className="glass-panel rounded-2xl p-5 space-y-2">
                  <div className="flex items-center justify-between text-white/60">
                    <span className="text-xs font-medium">{stat.label}</span>
                    <Icon size={16} className="text-[#00F0FF]" />
                  </div>
                  <p className="font-display text-2xl font-bold font-mono-tabular text-white">{stat.value}</p>
                  <p className="text-xs text-white/45">{stat.sub}</p>
                </div>
              );
            })}
          </div>

          <div className="glass-panel rounded-2xl p-5">
            <h3 className="font-display text-sm font-semibold text-white mb-4">Daily Real Registrations</h3>
            {analytics.dailyRegistrations.length === 0 ? (
              <p className="text-xs text-white/50">No registration events recorded yet.</p>
            ) : (
              <div className="flex items-end gap-3 h-36 pt-4">
                {analytics.dailyRegistrations.map((d: any) => {
                  const max = Math.max(1, ...analytics.dailyRegistrations.map((x: any) => x.count));
                  const pct = Math.max(12, Math.round((d.count / max) * 100));
                  return (
                    <div key={d.day} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                      <span className="text-[11px] font-mono-tabular text-white/75">{d.count}</span>
                      <div className="w-full max-w-[36px] rounded-t-lg vibe-gradient" style={{ height: `${pct}%` }} />
                      <span className="text-[10px] font-mono-tabular text-white/45">{d.day.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="glass-panel rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-white flex items-center gap-2">
                <Star size={16} className="text-[#FF6B00] fill-[#FF6B00]" /> User App Ratings
              </h3>
              <span className="text-xs font-mono-tabular text-[#00F0FF]">
                {ratingsData.averageRating}/5 avg · {ratingsData.totalRatings} reviews
              </span>
            </div>
            {ratingsData.ratings.length === 0 ? (
              <p className="text-xs text-white/50">No user ratings submitted yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {ratingsData.ratings.slice(0, 8).map((r) => (
                  <div key={r.id} className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">@{r.username}</span>
                      <span className="text-xs font-mono-tabular text-[#FF6B00] font-bold">{r.rating} ★</span>
                    </div>
                    {r.feedback && <p className="text-xs text-white/70">{r.feedback}</p>}
                    <p className="text-[11px] text-white/40">{timeAgo(r.updated_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* B. USER MANAGEMENT */}
      {section === 'users' && (
        <div className="glass-panel rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 justify-between">
            <div className="relative flex-1 max-w-md">
              <Search size={15} className="absolute left-3.5 top-3 text-white/40" />
              <input
                type="text"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder="Search by username, name, or email..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[#0A0A0F] border border-white/12 text-xs text-white"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-white/50 border-b border-white/10">
                <tr>
                  <th className="py-2.5 pr-3">Account</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 pl-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar src={u.avatar_url} name={u.full_name} size="sm" online={u.online} />
                        <div>
                          <div className="flex items-center gap-1 font-semibold text-white">
                            <span>@{u.username}</span>
                            <RoleAndVerifiedBadge role={u.role} isVerified={u.is_verified} size={13} />
                          </div>
                          <p className="text-white/45">{u.email || u.full_name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-white/80 capitalize">{u.role.replace('_', ' ')}</td>
                    <td className="py-3 px-3">
                      <span
                        className={
                          u.account_status === 'active'
                            ? 'text-emerald-400'
                            : u.account_status === 'suspended'
                              ? 'text-amber-400'
                              : 'text-rose-400'
                        }
                      >
                        {u.account_status}
                      </span>
                    </td>
                    <td className="py-3 pl-3 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleUserAction(u.id, u.is_verified ? 'unverify' : 'verify')}
                        className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white"
                      >
                        {u.is_verified ? 'Unverify' : 'Verify'}
                      </button>
                      {u.role !== 'super_admin' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleUserAction(u.id, u.account_status === 'active' ? 'suspend' : 'activate')}
                            className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                          >
                            {u.account_status === 'active' ? 'Suspend' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUserAction(u.id, u.account_status === 'banned' ? 'activate' : 'ban')}
                            className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                          >
                            {u.account_status === 'banned' ? 'Unban' : 'Ban'}
                          </button>
                          {currentUser.role === 'super_admin' && (
                            <button
                              type="button"
                              onClick={() => handleUserAction(u.id, u.role === 'admin' ? 'demote' : 'promote')}
                              className="px-2.5 py-1 rounded-lg bg-[#00F0FF]/15 text-[#00F0FF]"
                            >
                              {u.role === 'admin' ? 'Demote' : 'Make Admin'}
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* C. CONTENT MODERATION & REPORTS */}
      {section === 'moderation' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="glass-panel rounded-2xl p-5 space-y-3">
            <h3 className="font-display text-sm font-semibold text-white">Reports Queue ({reports.length})</h3>
            {reports.length === 0 ? (
              <p className="text-xs text-white/50 py-4">No user reports filed.</p>
            ) : (
              <div className="space-y-3 max-h-[460px] overflow-y-auto">
                {reports.map((r) => (
                  <div key={r.id} className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white capitalize">
                        {r.target_type} · {r.reason}
                      </span>
                      <span className={r.status === 'pending' ? 'text-amber-300' : 'text-emerald-400'}>{r.status}</span>
                    </div>
                    <p className="text-xs text-white/55">
                      Reported by @{r.reporter_username} · {timeAgo(r.created_at)}
                    </p>
                    {r.status === 'pending' && (
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleResolveReport(r.id, 'resolved')}
                          className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs flex items-center gap-1"
                        >
                          <CheckCircle2 size={13} /> Resolve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolveReport(r.id, 'dismissed')}
                          className="px-3 py-1 rounded-lg bg-white/10 text-white/75 text-xs"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass-panel rounded-2xl p-5 space-y-3">
            <h3 className="font-display text-sm font-semibold text-white">Posts & Reels Moderation</h3>
            <div className="space-y-3 max-h-[460px] overflow-y-auto">
              {posts.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/10">
                  <img
                    src={p.thumbnail_url || p.media_urls[0]}
                    alt={p.caption}
                    className="w-12 h-12 rounded-lg object-cover shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate">
                      @{p.username} · {p.media_type}
                    </p>
                    <p className="text-[11px] text-white/55 truncate">{p.caption || 'No caption'}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleContentAction('post', p.id, p.is_featured ? 'unfeature' : 'feature')}
                      title={p.is_featured ? 'Unfeature' : 'Feature'}
                      className={`p-2 rounded-lg ${
                        p.is_featured ? 'bg-[#FF6B00] text-white' : 'bg-white/10 text-white/70'
                      }`}
                    >
                      <Star size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleContentAction('post', p.id, p.is_removed ? 'restore' : 'remove')}
                      title={p.is_removed ? 'Restore' : 'Remove'}
                      className={`p-2 rounded-lg ${
                        p.is_removed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {p.is_removed ? <CheckCircle2 size={14} /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* D. ANNOUNCEMENTS */}
      {section === 'announcements' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <form onSubmit={handleBroadcastAnnouncement} className="glass-panel rounded-2xl p-5 space-y-4">
            <h3 className="font-display text-sm font-semibold text-white flex items-center gap-2">
              <Megaphone size={16} className="text-[#FF6B00]" /> Broadcast Global Announcement
            </h3>
            <input
              type="text"
              required
              value={annTitle}
              onChange={(e) => setAnnTitle(e.target.value)}
              placeholder="Announcement title"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F] border border-white/15 text-sm text-white"
            />
            <textarea
              rows={3}
              required
              value={annBody}
              onChange={(e) => setAnnBody(e.target.value)}
              placeholder="Write message to display as an app-wide banner and push notification..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F] border border-white/15 text-sm text-white resize-none"
            />
            <select
              value={annType}
              onChange={(e) => setAnnType(e.target.value as any)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F] border border-white/15 text-xs text-white"
            >
              <option value="festival">Festival / Cultural Highlight</option>
              <option value="info">Platform Update</option>
              <option value="warning">Safety / Maintenance Alert</option>
            </select>
            <button type="submit" className="w-full py-2.5 rounded-xl vibe-gradient-cta text-xs font-semibold text-white">
              Broadcast to All Users
            </button>
          </form>

          <div className="glass-panel rounded-2xl p-5 space-y-3">
            <h3 className="font-display text-sm font-semibold text-white">Recent Announcements</h3>
            <div className="space-y-2.5">
              {announcements.map((a) => (
                <div key={a.id} className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{a.title}</p>
                    <p className="text-xs text-white/65 mt-1">{a.body}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await apiFetch(`/api/admin/announcements/${a.id}/toggle`, { method: 'POST' });
                        loadAnnouncements().catch(() => {});
                        onAnnouncementPosted();
                      } catch (e: any) {
                        setError(e.message || 'Failed to toggle announcement.');
                      }
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 ${
                      a.is_active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/50'
                    }`}
                  >
                    {a.is_active ? 'Active' : 'Hidden'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* E. SECURITY & AUDIT LOGS */}
      {section === 'security' && (
        <div className="space-y-5">
          <div className="glass-panel rounded-2xl p-5 space-y-3">
            <h3 className="font-display text-sm font-semibold text-white">Admin Audit Logs</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-white/50 border-b border-white/10">
                  <tr>
                    <th className="py-2 pr-3">Timestamp</th>
                    <th className="py-2 px-3">Admin</th>
                    <th className="py-2 px-3">Action</th>
                    <th className="py-2 pl-3">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {auditLogs.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 pr-3 font-mono-tabular text-white/55">{timeAgo(l.created_at)}</td>
                      <td className="py-2.5 px-3 text-white">@{l.admin_username}</td>
                      <td className="py-2.5 px-3 font-mono-tabular text-[#00F0FF]">{l.action}</td>
                      <td className="py-2.5 pl-3 text-white/75">
                        {l.target_type} ({l.target_id.slice(0, 8)})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
