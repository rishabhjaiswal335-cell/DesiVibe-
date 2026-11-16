export type UserRole = 'user' | 'admin' | 'super_admin';
export type AccountStatus = 'active' | 'suspended' | 'banned';

export interface UserProfile {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  full_name: string;
  bio: string;
  vibe_status: string;
  avatar_url: string;
  interests: string[];
  is_verified: number;
  is_private: number;
  role: UserRole;
  account_status: AccountStatus;
  email_verified: number;
  is_demo: number;
  followers_count: number;
  following_count: number;
  posts_count: number;
  has_rated?: boolean;
  app_rating?: number | null;
  online?: boolean;
  follow_status?: 'accepted' | 'pending' | null;
  created_at: string;
}

export interface PostItem {
  id: string;
  user_id: string;
  username: string;
  full_name: string;
  avatar_url: string;
  is_verified: number;
  author_role?: UserRole;
  author_is_demo?: number;
  media_type: 'image' | 'carousel' | 'video' | 'reel';
  media_urls: string[];
  thumbnail_url: string;
  caption: string;
  location: string;
  aspect_ratio: string;
  audio_track_id: string | null;
  audio_title?: string | null;
  audio_artist?: string | null;
  filter_name: string;
  is_featured: number;
  is_removed: number;
  is_demo: number;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  is_liked: boolean;
  is_saved: boolean;
  follow_status: 'accepted' | 'pending' | null;
  created_at: string;
}

export interface CommentItem {
  id: string;
  post_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  likes_count: number;
  username: string;
  full_name: string;
  avatar_url: string;
  is_verified: number;
  author_role?: UserRole;
  created_at: string;
}

export interface StoryItem {
  id: string;
  user_id: string;
  media_url: string;
  media_type: 'image' | 'video';
  overlay_text: string;
  stickers: string[];
  is_demo: number;
  views_count: number;
  seen: number;
  expires_at: string;
  created_at: string;
}

export interface StoryGroup {
  user_id: string;
  username: string;
  full_name: string;
  avatar_url: string;
  is_verified: number;
  is_demo: number;
  hasUnseen: boolean;
  stories: StoryItem[];
}

export interface CollectionItem {
  id: string;
  user_id: string;
  name: string;
  cover_url: string;
  is_private: number;
  items: PostItem[];
}

export interface ChatMember {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string;
  is_verified: number;
  vibe_status: string;
  online: boolean;
}

export interface ConversationItem {
  id: string;
  is_group: number;
  name: string;
  avatar_url: string;
  last_message_at: string;
  members: ChatMember[];
  lastMessage?: {
    id: string;
    content: string;
    media_type: string;
    sender_username: string;
    created_at: string;
  } | null;
  unreadCount: number;
}

export interface MessageItem {
  id: string;
  conversation_id: string;
  sender_id: string;
  username: string;
  full_name: string;
  avatar_url: string;
  is_verified: number;
  content: string;
  media_url: string;
  media_type: 'text' | 'image' | 'voice' | 'post_share' | 'reel_share';
  shared_post_id: string | null;
  shared_media_urls?: string;
  shared_caption?: string;
  shared_media_type?: string;
  shared_author_username?: string;
  is_deleted: number;
  read_by: string[];
  reactions: { emoji: string; user_id: string; username: string }[];
  created_at: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  actor_id: string | null;
  actor_username?: string;
  actor_name?: string;
  actor_avatar?: string;
  actor_verified?: number;
  type: string;
  entity_id: string;
  message: string;
  is_read: number;
  created_at: string;
}

export interface FollowRequestItem {
  follow_id: string;
  user_id: string;
  username: string;
  full_name: string;
  avatar_url: string;
  is_verified: number;
  created_at: string;
}

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  banner_type: 'info' | 'warning' | 'festival';
  is_active: number;
  created_at: string;
}

export interface SavedSessionAccount {
  token: string;
  user: UserProfile;
}

export type ActiveTab = 'home' | 'explore' | 'reels' | 'chat' | 'notifications' | 'profile' | 'admin';
