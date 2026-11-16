import { Plus } from 'lucide-react';
import type { StoryGroup, UserProfile } from '../types.ts';
import { Avatar } from './Avatar.tsx';

interface StoriesBarProps {
  storyGroups: StoryGroup[];
  currentUser: UserProfile | null;
  onSelectGroup: (index: number) => void;
  onCreateStory: () => void;
}

export function StoriesBar({ storyGroups, currentUser, onSelectGroup, onCreateStory }: StoriesBarProps) {
  return (
    <div className="glass-panel rounded-2xl p-4 mb-5">
      <div className="flex items-center gap-4 overflow-x-auto no-scrollbar pb-1">
        {/* Add Story Trigger */}
        <button
          type="button"
          onClick={onCreateStory}
          className="flex flex-col items-center gap-1.5 shrink-0 group min-w-[68px]"
        >
          <div className="relative">
            <Avatar src={currentUser?.avatar_url} name={currentUser?.full_name || 'You'} size="lg" />
            <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full vibe-gradient-cta border-2 border-[#0A0A0F] flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform">
              <Plus size={14} />
            </span>
          </div>
          <span className="text-[11px] font-medium text-white/75 truncate max-w-[68px]">Your Story</span>
        </button>

        {storyGroups.map((group, idx) => (
          <button
            key={group.user_id}
            type="button"
            onClick={() => onSelectGroup(idx)}
            className="flex flex-col items-center gap-1.5 shrink-0 min-w-[68px] group"
          >
            <Avatar
              src={group.avatar_url}
              name={group.full_name}
              size="lg"
              storyRing={group.hasUnseen ? 'unseen' : 'seen'}
            />
            <span className="text-[11px] font-medium text-white/80 group-hover:text-white truncate max-w-[72px]">
              {group.username}
            </span>
          </button>
        ))}

        {storyGroups.length === 0 && (
          <p className="text-xs text-white/45 pl-2">No active 24h stories right now — drop the first VibeStory.</p>
        )}
      </div>
    </div>
  );
}
