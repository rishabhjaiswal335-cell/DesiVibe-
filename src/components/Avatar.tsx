import { BadgeCheck, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { UserRole } from '../types.ts';

interface AvatarProps {
  src?: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  storyRing?: 'none' | 'unseen' | 'seen';
  online?: boolean;
  onClick?: () => void;
}

const SIZE_MAP = {
  xs: 'w-7 h-7 text-xs',
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-16 h-16 text-lg',
  xl: 'w-24 h-24 text-2xl',
};

export function Avatar({ src, name = 'D', size = 'md', storyRing = 'none', online = false, onClick }: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const initials = (name || 'D')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const ringClass =
    storyRing === 'unseen'
      ? 'story-ring-unseen p-[2px]'
      : storyRing === 'seen'
        ? 'story-ring-seen p-[2px]'
        : '';

  const inner = (
    <div
      className={`relative rounded-full overflow-hidden bg-[#15151F] flex items-center justify-center font-display font-semibold text-white/90 select-none ${SIZE_MAP[size]}`}
    >
      {src && !imgError ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#FF6B00]/30 via-[#FF007F]/25 to-[#00F0FF]/25">
          {initials}
        </div>
      )}
    </div>
  );

  return (
    <div
      onClick={onClick}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${ringClass} ${
        onClick ? 'cursor-pointer' : ''
      }`}
    >
      {storyRing !== 'none' ? <div className="rounded-full bg-[#0A0A0F] p-[2px]">{inner}</div> : inner}
      {online && (
        <span
          title="Online now"
          className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0A0A0F]"
        />
      )}
    </div>
  );
}

export function RoleAndVerifiedBadge({
  role,
  isVerified,
  size = 15,
}: {
  role?: UserRole;
  isVerified?: number | boolean;
  size?: number;
}) {
  if (role === 'super_admin') {
    return (
      <span
        title="Super Admin"
        className="inline-flex items-center text-[#FF6B00] drop-shadow-[0_0_8px_rgba(255,107,0,0.65)] shrink-0"
      >
        <ShieldCheck size={size + 1} />
      </span>
    );
  }
  if (isVerified) {
    return (
      <span title="Verified Creator" className="inline-flex items-center text-[#00F0FF] shrink-0">
        <BadgeCheck size={size} />
      </span>
    );
  }
  return null;
}

export function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}
