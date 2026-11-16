import { CheckCircle2, Sparkles, Star } from 'lucide-react';
import { useState } from 'react';
import { apiFetch, saveAccountToVault, getActiveToken } from '../lib/api.ts';
import { syncAppRatingToFirestore } from '../lib/firebase.ts';
import type { UserProfile } from '../types.ts';

interface RatingScreenProps {
  currentUser: UserProfile;
  onRated: (updatedUser: UserProfile) => void;
}

const QUICK_TAGS = [
  'Futuristic UI',
  'Fast VibeReels',
  'VibeChat',
  '24h Stories',
  'Easy Login',
  'Smooth Experience',
];

const RATING_LABELS: Record<number, string> = {
  1: 'Needs Work',
  2: 'Okay Vibe',
  3: 'Good Vibe',
  4: 'Great Experience',
  5: 'Pure Electric Vibe!',
};

export function RatingScreen({ currentUser, onRated }: RatingScreenProps) {
  const [rating, setRating] = useState<number>(currentUser.app_rating || 5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [selectedTags, setSelectedTags] = useState<string[]>(['Futuristic UI']);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const activeStars = hoverRating || rating;

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag].slice(0, 6)
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) {
      setError('Please select a star rating to continue.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await apiFetch<{ success: boolean; user: UserProfile }>('/api/ratings', {
        method: 'POST',
        body: JSON.stringify({
          rating,
          tags: selectedTags,
          feedback: feedback.trim(),
        }),
      });
      await syncAppRatingToFirestore({
        username: currentUser.username,
        rating,
        tags: selectedTags,
        feedback: feedback.trim(),
      }).catch(() => {});

      const token = getActiveToken();
      if (token) {
        saveAccountToVault(token, res.user);
      }
      onRated(res.user);
    } catch (err: any) {
      setError(err.message || 'Could not save rating.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#0A0A0F] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,107,0,0.14),transparent_42%),radial-gradient(circle_at_80%_80%,rgba(255,0,127,0.12),transparent_45%)]" />

      <div className="w-full max-w-lg glass-panel rounded-3xl p-6 sm:p-8 relative z-10 shadow-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl vibe-gradient flex items-center justify-center font-display font-extrabold text-base text-white shadow-[0_0_24px_rgba(255,107,0,0.4)]">
              DV
            </div>
            <div>
              <span className="font-display text-lg font-bold vibe-text-gradient">DesiVibe</span>
              <p className="text-xs text-white/55">Welcome, @{currentUser.username}</p>
            </div>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-start gap-2.5 text-xs text-emerald-200">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
          <span>
            Account created! You are automatically following Super Admin{' '}
            <strong className="text-white">@rishabhjaiswal</strong>. Rate DesiVibe below to unlock your Home Feed.
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="text-center space-y-3">
            <h1 className="font-display text-2xl font-bold text-white">Rate Your DesiVibe First Impression</h1>
            <p className="text-xs text-white/60">
              Tap a star to share how DesiVibe feels so far. Your Home Feed opens right after.
            </p>

            <div className="flex items-center justify-center gap-2 pt-2">
              {[1, 2, 3, 4, 5].map((star) => {
                const filled = star <= activeStars;
                return (
                  <button
                    key={star}
                    type="button"
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => setRating(star)}
                    aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                    className="min-w-[48px] min-h-[48px] rounded-2xl flex items-center justify-center transition-transform active:scale-90 hover:scale-110 bg-white/[0.03] border border-white/10"
                  >
                    <Star
                      size={26}
                      className={
                        filled
                          ? 'text-[#FF6B00] fill-[#FF6B00] drop-shadow-[0_0_10px_rgba(255,107,0,0.6)]'
                          : 'text-white/25'
                      }
                    />
                  </button>
                );
              })}
            </div>

            <p className="text-sm font-semibold text-[#00F0FF]">
              {activeStars}/5 · {RATING_LABELS[activeStars]}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-white/70">What stands out?</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_TAGS.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                      active
                        ? 'bg-[#FF007F]/20 text-white border border-[#FF007F]/60'
                        : 'bg-white/[0.04] text-white/65 border border-white/10 hover:text-white'
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-white/70 mb-1.5">
              Quick Feedback (optional)
            </label>
            <textarea
              rows={3}
              maxLength={500}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Tell Rishabh Jaiswal what you love or what we should build next..."
              className="w-full px-4 py-3 rounded-2xl bg-[#0A0A0F]/80 border border-white/12 text-sm text-white placeholder:text-white/35 focus:outline-none focus:border-[#00F0FF] resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 px-5 rounded-2xl vibe-gradient-cta text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-[0_0_24px_rgba(255,0,127,0.35)] hover:opacity-95 disabled:opacity-50"
          >
            <Sparkles size={17} />
            {submitting ? 'Saving Rating...' : 'Submit Rating & Open Home Feed'}
          </button>
        </form>
      </div>
    </div>
  );
}
