import { ArrowLeft, CheckCircle2, KeyRound, Phone, Sparkles, UserCheck, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch, getSavedAccounts, saveAccountToVault } from '../lib/api.ts';
import {
  exchangeFirebaseTokenForSupabaseSession,
  signInWithGooglePopup,
  syncUserToFirestore,
} from '../lib/firebase.ts';
import type { UserProfile } from '../types.ts';
import { Avatar } from './Avatar.tsx';

interface AuthViewProps {
  onSuccess: (user: UserProfile, token: string, isNewUser?: boolean) => void;
  onClose?: () => void;
  canClose?: boolean;
}

type AuthMode = 'login' | 'signup' | 'otp' | 'forgot' | 'google';

const INTEREST_OPTIONS = ['Music', 'Travel', 'Street Food', 'Fashion', 'Gaming', 'Photography', 'Cinema', 'Tech', 'Dance', 'Fitness'];

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}

export function AuthView({ onSuccess, onClose, canClose = false }: AuthViewProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [bio, setBio] = useState('');
  const [interests, setInterests] = useState<string[]>(['Music', 'Travel']);
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [previewOtp, setPreviewOtp] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameHint, setUsernameHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const savedAccounts = getSavedAccounts();

  useEffect(() => {
    if (mode !== 'signup' || !username.trim()) {
      setUsernameAvailable(null);
      setUsernameHint('');
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch<{ available: boolean; reason?: string }>(
          `/api/auth/check-username?username=${encodeURIComponent(username.trim())}`
        );
        setUsernameAvailable(res.available);
        setUsernameHint(res.reason || (res.available ? 'Username available' : 'Already taken'));
      } catch {
        setUsernameAvailable(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [username, mode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: UserProfile }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      saveAccountToVault(res.token, res.user);
      onSuccess(res.user, res.token, false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: UserProfile; isNewUser?: boolean }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, username, fullName, phone, password, bio, interests }),
      });
      saveAccountToVault(res.token, res.user);
      onSuccess(res.user, res.token, res.isNewUser ?? true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOtp = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ sent: boolean; previewCode?: string }>('/api/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ target: phone, purpose: 'phone_otp' }),
      });
      setOtpSent(true);
      setPreviewOtp(res.previewCode || null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: UserProfile; isNewUser?: boolean }>('/api/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ phone, code: otpCode, fullName, username }),
      });
      saveAccountToVault(res.token, res.user);
      onSuccess(res.user, res.token, Boolean(res.isNewUser));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestReset = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ previewCode?: string }>('/api/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ target: email, purpose: 'password_reset' }),
      });
      setResetSent(true);
      setPreviewOtp(res.previewCode || null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email, code: otpCode, newPassword }),
      });
      setMode('login');
      setIdentifier(email);
      setPassword('');
      setPreviewOtp(null);
      setResetSent(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      const googleUser = await signInWithGooglePopup();
      const [res] = await Promise.all([
        apiFetch<{ token: string; user: UserProfile; isNewUser?: boolean }>('/api/auth/google', {
          method: 'POST',
          body: JSON.stringify({
            idToken: googleUser.idToken,
            email: googleUser.email,
            fullName: googleUser.displayName,
            avatarUrl: googleUser.photoURL,
          }),
        }),
        exchangeFirebaseTokenForSupabaseSession(googleUser.idToken).catch(() => null),
      ]);
      await syncUserToFirestore(res.user, Boolean(res.isNewUser)).catch(() => {});
      saveAccountToVault(res.token, res.user);
      onSuccess(res.user, res.token, Boolean(res.isNewUser));
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        setError('Google sign-in popup was closed before completing.');
      } else if (code === 'auth/popup-blocked') {
        setError('Popup blocked by browser. Please allow popups for DesiVibe and try again.');
      } else {
        setError(err?.message || 'Google sign-in failed.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const toggleInterest = (tag: string) => {
    setInterests((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag].slice(0, 6)));
  };

  const GoogleButton = () => (
    <button
      type="button"
      onClick={handleGoogleSignIn}
      disabled={googleLoading || loading}
      className="w-full py-3 px-4 rounded-xl bg-white text-[#0A0A0F] hover:bg-white/90 text-sm font-semibold flex items-center justify-center gap-2.5 transition-colors disabled:opacity-60"
    >
      <GoogleMark />
      {googleLoading ? 'Connecting Google Account...' : 'Continue with Google'}
    </button>
  );

  return (
    <div className="min-h-screen w-full bg-[#0A0A0F] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(255,107,0,0.12),transparent_42%),radial-gradient(circle_at_85%_85%,rgba(0,240,255,0.1),transparent_45%)]" />

      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-5 glass-panel rounded-3xl overflow-hidden relative z-10 shadow-2xl">
        {/* Left Brand Panel */}
        <div className="lg:col-span-2 p-7 sm:p-8 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-white/10 bg-gradient-to-b from-[#15151F]/90 to-[#0A0A0F]/95">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl vibe-gradient flex items-center justify-center font-display font-extrabold text-lg text-white shadow-[0_0_24px_rgba(255,107,0,0.4)]">
                  DV
                </div>
                <span className="font-display text-2xl font-bold tracking-tight vibe-text-gradient">DesiVibe</span>
              </div>
              {canClose && onClose && (
                <button
                  onClick={onClose}
                  className="text-xs text-white/60 hover:text-white px-3 py-1.5 rounded-lg border border-white/10"
                >
                  Explore App
                </button>
              )}
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white mt-8 leading-tight text-balance">
              Your People. Your Culture. Your Vibe.
            </h1>
            <p className="text-sm text-white/65 mt-3 leading-relaxed">
              Share 24-hour VibeStories, explore global VibeReels, and connect in real time with encrypted VibeChat.
            </p>
          </div>

          {savedAccounts.length > 0 && (
            <div className="mt-8 pt-6 border-t border-white/10">
              <p className="text-xs font-medium text-white/55 mb-3">Quick Switch Saved Sessions</p>
              <div className="space-y-2">
                {savedAccounts.map((acc) => (
                  <button
                    key={acc.user.id}
                    type="button"
                    onClick={() => {
                      saveAccountToVault(acc.token, acc.user);
                      onSuccess(acc.user, acc.token, false);
                    }}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-colors text-left"
                  >
                    <Avatar src={acc.user.avatar_url} name={acc.user.full_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate">{acc.user.full_name}</p>
                      <p className="text-xs text-white/55 truncate">@{acc.user.username}</p>
                    </div>
                    <UserCheck size={16} className="text-[#00F0FF] shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-white/40 mt-6">Made by Rishabh Jaiswal</p>
        </div>

        {/* Right Interactive Auth Panel */}
        <div className="lg:col-span-3 p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2 mb-6">
            {(
              [
                ['login', 'Sign In'],
                ['signup', 'Create Account'],
                ['otp', 'Phone OTP'],
                ['google', 'Google'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setMode(id);
                  setError('');
                  setPreviewOtp(null);
                }}
                className={`px-3.5 py-2 text-xs font-medium rounded-xl whitespace-nowrap shrink-0 transition-all ${
                  mode === id
                    ? 'vibe-gradient-cta text-white shadow-[0_0_16px_rgba(255,0,127,0.35)]'
                    : 'bg-white/[0.04] text-white/70 hover:text-white border border-white/10'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-center gap-2">
              <XCircle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {mode === 'login' && (
            <div className="space-y-4">
              <GoogleButton />

              <div className="flex items-center gap-3 text-xs text-white/35">
                <div className="h-px flex-1 bg-white/10" />
                <span>or sign in with password</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1.5">Email or Username</label>
                  <input
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="you@example.com or username"
                    className="w-full px-4 py-3 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white placeholder:text-white/35 focus:outline-none focus:border-[#00F0FF]"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-white/70">Password</label>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('forgot');
                        setError('');
                      }}
                      className="text-xs text-[#00F0FF] hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full px-4 py-3 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white placeholder:text-white/35 focus:outline-none focus:border-[#00F0FF]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 rounded-xl vibe-gradient-cta text-white text-sm font-semibold hover:opacity-95 transition-opacity disabled:opacity-50"
                >
                  {loading ? 'Signing in...' : 'Sign In to DesiVibe'}
                </button>
              </form>
            </div>
          )}

          {mode === 'signup' && (
            <div className="space-y-4">
              <GoogleButton />

              <div className="flex items-center gap-3 text-xs text-white/35">
                <div className="h-px flex-1 bg-white/10" />
                <span>or register with email</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <form onSubmit={handleSignup} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-white/70 mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Your Full Name"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white focus:outline-none focus:border-[#00F0FF]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-white/70 mb-1">Username</label>
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value.toLowerCase())}
                      placeholder="your.vibe"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white focus:outline-none focus:border-[#00F0FF]"
                    />
                    {usernameHint && (
                      <p
                        className={`text-[11px] mt-1 flex items-center gap-1 ${
                          usernameAvailable ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        {usernameAvailable ? <CheckCircle2 size={12} /> : null}
                        {usernameHint}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-white/70 mb-1">Email</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white focus:outline-none focus:border-[#00F0FF]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-white/70 mb-1">Password</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white focus:outline-none focus:border-[#00F0FF]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-white/70 mb-1">Bio</label>
                  <input
                    type="text"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Creator, traveler, music lover..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white focus:outline-none focus:border-[#00F0FF]"
                  />
                </div>

                <div>
                  <p className="text-xs font-medium text-white/70 mb-1.5">Pick your interests</p>
                  <div className="flex flex-wrap gap-1.5">
                    {INTEREST_OPTIONS.map((tag) => {
                      const active = interests.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleInterest(tag)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                            active
                              ? 'bg-[#FF6B00]/20 text-[#FF6B00] border border-[#FF6B00]/50'
                              : 'bg-white/[0.04] text-white/60 border border-white/10 hover:text-white'
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 rounded-xl vibe-gradient-cta text-white text-sm font-semibold hover:opacity-95 transition-opacity disabled:opacity-50"
                >
                  {loading ? 'Creating Account...' : 'Create DesiVibe Account'}
                </button>
              </form>
            </div>
          )}

          {mode === 'otp' && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-white/70 mb-1.5">Phone Number</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Phone size={15} className="absolute left-3.5 top-3.5 text-white/40" />
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white focus:outline-none focus:border-[#00F0FF]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleRequestOtp}
                    disabled={loading || !phone}
                    className="px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white whitespace-nowrap shrink-0"
                  >
                    Send OTP
                  </button>
                </div>
              </div>

              {previewOtp && (
                <div className="p-3 rounded-xl bg-[#00F0FF]/10 border border-[#00F0FF]/30 text-xs text-[#00F0FF] flex items-center justify-between">
                  <span>Verification OTP generated</span>
                  <span className="font-mono-tabular font-bold text-sm tracking-widest">{previewOtp}</span>
                </div>
              )}

              {otpSent && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-white/70 mb-1.5">6-Digit OTP</label>
                    <input
                      type="text"
                      required
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="Enter 6-digit code"
                      className="w-full px-4 py-3 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm font-mono-tabular tracking-widest text-white focus:outline-none focus:border-[#00F0FF]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Full Name (new users)"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-xs text-white focus:outline-none focus:border-[#00F0FF]"
                    />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Username (new users)"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-xs text-white focus:outline-none focus:border-[#00F0FF]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 px-4 rounded-xl vibe-gradient-cta text-white text-sm font-semibold"
                  >
                    {loading ? 'Verifying...' : 'Verify OTP & Sign In'}
                  </button>
                </>
              )}
            </form>
          )}

          {mode === 'google' && (
            <div className="space-y-5">
              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Sparkles size={16} className="text-[#00F0FF]" />
                  Firebase Google Authentication
                </div>
                <p className="text-xs text-white/65 leading-relaxed">
                  Sign in securely with your Google account using Firebase Authentication. New creators automatically connect with Super Admin @rishabhjaiswal and get verified instantly.
                </p>
              </div>
              <GoogleButton />
            </div>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <button
                type="button"
                onClick={() => setMode('login')}
                className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white"
              >
                <ArrowLeft size={14} /> Back to Sign In
              </button>
              <div>
                <label className="block text-xs font-medium text-white/70 mb-1.5">Registered Email</label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="flex-1 px-4 py-3 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white focus:outline-none focus:border-[#00F0FF]"
                  />
                  <button
                    type="button"
                    onClick={handleRequestReset}
                    disabled={loading || !email}
                    className="px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white whitespace-nowrap shrink-0"
                  >
                    Get Code
                  </button>
                </div>
              </div>

              {previewOtp && (
                <div className="p-3 rounded-xl bg-[#FF6B00]/10 border border-[#FF6B00]/30 text-xs text-[#FF6B00] flex items-center justify-between">
                  <span>Password reset code</span>
                  <span className="font-mono-tabular font-bold text-sm tracking-widest">{previewOtp}</span>
                </div>
              )}

              {resetSent && (
                <>
                  <input
                    type="text"
                    required
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="6-digit reset code"
                    className="w-full px-4 py-3 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm font-mono-tabular text-white focus:outline-none focus:border-[#00F0FF]"
                  />
                  <div className="relative">
                    <KeyRound size={15} className="absolute left-3.5 top-3.5 text-white/40" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New password (6+ characters)"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white focus:outline-none focus:border-[#00F0FF]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 px-4 rounded-xl vibe-gradient-cta text-white text-sm font-semibold"
                  >
                    Update Password
                  </button>
                </>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
