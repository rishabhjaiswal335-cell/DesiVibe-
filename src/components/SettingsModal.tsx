import {
  CheckCircle2,
  Info,
  Lock,
  LogIn,
  LogOut,
  MailCheck,
  PlusCircle,
  Shield,
  Star,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch, getSavedAccounts, saveAccountToVault } from '../lib/api.ts';
import type { SavedSessionAccount, UserProfile } from '../types.ts';
import { Avatar, RoleAndVerifiedBadge } from './Avatar.tsx';
import { PWAInstallButton } from './PWAInstallButton.tsx';

interface SettingsModalProps {
  currentUser: UserProfile | null;
  onClose: () => void;
  onSwitchAccount: (acc: SavedSessionAccount) => void;
  onAddAccount: () => void;
  onLogout: () => void;
  onUserUpdated: (user: UserProfile) => void;
  onOpenRating?: () => void;
}

export function SettingsModal({
  currentUser,
  onClose,
  onSwitchAccount,
  onAddAccount,
  onLogout,
  onUserUpdated,
  onOpenRating,
}: SettingsModalProps) {
  const [savedAccounts] = useState<SavedSessionAccount[]>(getSavedAccounts());
  const [blockedUsers, setBlockedUsers] = useState<UserProfile[]>([]);
  const [verifyCode, setVerifyCode] = useState('');
  const [previewVerifyCode, setPreviewVerifyCode] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [privacySaving, setPrivacySaving] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    apiFetch<{ blocked: UserProfile[] }>('/api/profiles/me/blocks')
      .then((res) => setBlockedUsers(res.blocked || []))
      .catch(() => {});
  }, [currentUser?.id]);

  const requestEmailVerify = async () => {
    if (!currentUser?.email) return;
    try {
      const res = await apiFetch<{ previewCode?: string }>('/api/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ target: currentUser.email, purpose: 'email_verify' }),
      });
      setPreviewVerifyCode(res.previewCode || null);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not request verification code.');
    }
  };

  const submitEmailVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    try {
      await apiFetch('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ code: verifyCode }),
      });
      const updated = { ...currentUser, email_verified: 1 };
      onUserUpdated(updated);
      setStatusMsg('Email verified.');
      setPreviewVerifyCode(null);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Invalid verification code.');
    }
  };

  const toggleAccountPrivacy = async () => {
    if (!currentUser) return;
    setPrivacySaving(true);
    try {
      const res = await apiFetch<{ user: UserProfile }>('/api/profiles/me', {
        method: 'PATCH',
        body: JSON.stringify({ isPrivate: !currentUser.is_private }),
      });
      onUserUpdated(res.user);
      setStatusMsg(res.user.is_private ? 'Account switched to Private.' : 'Account switched to Public.');
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not update privacy setting.');
    } finally {
      setPrivacySaving(false);
    }
  };

  const unblock = async (userId: string) => {
    try {
      await apiFetch(`/api/profiles/${userId}/block`, { method: 'DELETE' });
      setBlockedUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not unblock user.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel rounded-3xl w-full max-w-lg max-h-[88vh] overflow-y-auto p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="font-display text-lg font-bold text-white">Settings & App Information</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center text-white/70"
          >
            <X size={18} />
          </button>
        </div>

        {/* App Information Section */}
        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Info size={16} className="text-[#00F0FF]" />
            About DesiVibe & Platform Information
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="p-2.5 rounded-xl bg-[#0A0A0F]/60 border border-white/[0.06]">
              <p className="text-white/45">Application</p>
              <p className="font-semibold text-white mt-0.5">DesiVibe · v1.0.0</p>
            </div>
            <div className="p-2.5 rounded-xl bg-[#0A0A0F]/60 border border-white/[0.06]">
              <p className="text-white/45">Created By</p>
              <p className="font-semibold text-white mt-0.5">Rishabh Jaiswal</p>
            </div>
            <div className="p-2.5 rounded-xl bg-[#0A0A0F]/60 border border-white/[0.06] sm:col-span-2">
              <p className="text-white/45">Super Admin & Official Support</p>
              <p className="font-semibold text-[#FF6B00] mt-0.5">rishabhjaiswal335@gmail.com</p>
            </div>
          </div>
          <ul className="space-y-1.5 text-xs text-white/65 leading-relaxed pt-1">
            <li>• Authentic Community: Only real registered creators — zero fake bots or demo accounts.</li>
            <li>• Firebase & Rules Security: Google Sign-In powered by Firebase Auth with strict Firestore rules and PII isolation.</li>
            <li>• 24h VibeStories: Shared stories automatically expire after 24 hours.</li>
            <li>• Real-Time VibeChat: Instant messaging, media sharing, and live notifications over WebSocket.</li>
          </ul>
          <PWAInstallButton />
        </div>

        {currentUser ? (
          <>
            {/* Privacy & Email Verification */}
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-white/10">
                <div className="flex items-center gap-2.5">
                  <Lock size={16} className="text-[#FF007F]" />
                  <div>
                    <p className="text-sm font-semibold text-white">Private Account</p>
                    <p className="text-xs text-white/50">Require approval for new followers</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleAccountPrivacy}
                  disabled={privacySaving}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                    currentUser.is_private
                      ? 'bg-[#FF007F]/25 text-white border border-[#FF007F]/60'
                      : 'bg-white/10 text-white/75 hover:text-white'
                  }`}
                >
                  {currentUser.is_private ? 'Private' : 'Public'}
                </button>
              </div>

              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <MailCheck size={16} className="text-[#00F0FF]" />
                  Email Verification
                </div>
                {currentUser.email_verified ? (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={14} /> Verified
                  </span>
                ) : (
                  <button type="button" onClick={requestEmailVerify} className="text-xs text-[#00F0FF] hover:underline">
                    Send Code
                  </button>
                )}
              </div>

              {previewVerifyCode && (
                <form onSubmit={submitEmailVerify} className="space-y-2">
                  <p className="text-xs text-white/70">
                    Verification code: <span className="font-mono-tabular font-bold text-[#FF6B00]">{previewVerifyCode}</span>
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value)}
                      placeholder="Enter 6-digit code"
                      className="flex-1 px-3 py-2 rounded-xl bg-[#0A0A0F] border border-white/15 text-xs text-white"
                    />
                    <button type="submit" className="px-4 py-2 rounded-xl vibe-gradient-cta text-xs font-semibold text-white">
                      Verify
                    </button>
                  </div>
                </form>
              )}
              {statusMsg && <p className="text-xs text-emerald-400">{statusMsg}</p>}
            </div>

            {/* App Rating Shortcut */}
            {onOpenRating && (
              <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-white/10">
                <div className="flex items-center gap-2.5">
                  <Star size={16} className="text-[#FF6B00] fill-[#FF6B00]" />
                  <div>
                    <p className="text-sm font-semibold text-white">Your DesiVibe Rating</p>
                    <p className="text-xs text-white/55">
                      {currentUser.app_rating ? `Rated ${currentUser.app_rating}/5 stars` : 'Share your app rating'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenRating();
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white"
                >
                  {currentUser.app_rating ? 'Update' : 'Rate Now'}
                </button>
              </div>
            )}

            {/* Multi-Account Switcher */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Users size={16} className="text-[#FF6B00]" /> Switch Accounts
                </h3>
                <button
                  type="button"
                  onClick={onAddAccount}
                  className="text-xs text-[#00F0FF] hover:underline flex items-center gap-1"
                >
                  <PlusCircle size={14} /> Add Account
                </button>
              </div>
              <div className="space-y-2">
                {savedAccounts.map((acc) => {
                  const isCurrent = acc.user.id === currentUser.id;
                  return (
                    <button
                      key={acc.user.id}
                      type="button"
                      onClick={() => {
                        saveAccountToVault(acc.token, acc.user);
                        onSwitchAccount(acc);
                        onClose();
                      }}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left ${
                        isCurrent ? 'bg-[#00F0FF]/10 border-[#00F0FF]/40' : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                      }`}
                    >
                      <Avatar src={acc.user.avatar_url} name={acc.user.full_name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <p className="text-sm font-medium text-white truncate">{acc.user.username}</p>
                          <RoleAndVerifiedBadge role={acc.user.role} isVerified={acc.user.is_verified} size={13} />
                        </div>
                        <p className="text-xs text-white/55 truncate">{acc.user.email || acc.user.full_name}</p>
                      </div>
                      {isCurrent && <span className="text-[11px] font-semibold text-[#00F0FF]">Active</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Blocked Users */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Shield size={15} className="text-white/60" /> Blocked Accounts ({blockedUsers.length})
              </h3>
              {blockedUsers.length === 0 ? (
                <p className="text-xs text-white/45">You haven&apos;t blocked anyone.</p>
              ) : (
                <div className="space-y-2">
                  {blockedUsers.map((u) => (
                    <div key={u.id} className="flex items-center justify-between p-2 rounded-xl bg-white/[0.03]">
                      <span className="text-xs text-white">@{u.username}</span>
                      <button type="button" onClick={() => unblock(u.id)} className="text-xs text-[#00F0FF] hover:underline">
                        Unblock
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="w-full py-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-sm font-semibold flex items-center justify-center gap-2"
            >
              <LogOut size={16} /> Log Out
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              onClose();
              onAddAccount();
            }}
            className="w-full py-3 rounded-xl vibe-gradient-cta text-white text-sm font-semibold flex items-center justify-center gap-2"
          >
            <LogIn size={16} /> Sign In or Create Account
          </button>
        )}
      </div>
    </div>
  );
}
