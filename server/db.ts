import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
export const BUCKETS = ['avatars', 'posts', 'reels', 'stories', 'chat-media'] as const;
for (const bucket of BUCKETS) {
  const dir = path.join(UPLOAD_ROOT, bucket);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const DB_PATH = path.join(DATA_DIR, 'desivibe.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'rishabhjaiswal335@gmail.com').toLowerCase().trim();

export function initDatabase() {
  db.exec(`
    -- 1. profiles
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT UNIQUE COLLATE NOCASE,
      phone TEXT UNIQUE,
      password_hash TEXT,
      full_name TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      vibe_status TEXT NOT NULL DEFAULT 'Creating vibes on DesiVibe',
      avatar_url TEXT NOT NULL DEFAULT '',
      interests_json TEXT NOT NULL DEFAULT '[]',
      is_verified INTEGER NOT NULL DEFAULT 0,
      is_private INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
      account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'banned')),
      email_verified INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      followers_count INTEGER NOT NULL DEFAULT 0,
      following_count INTEGER NOT NULL DEFAULT 0,
      posts_count INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. audio_tracks (referenced by posts)
    CREATE TABLE IF NOT EXISTS audio_tracks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      duration_sec INTEGER NOT NULL DEFAULT 30,
      audio_url TEXT NOT NULL DEFAULT '',
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 3. posts (posts + reels)
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      media_type TEXT NOT NULL CHECK (media_type IN ('image', 'carousel', 'video', 'reel')),
      media_urls_json TEXT NOT NULL DEFAULT '[]',
      thumbnail_url TEXT NOT NULL DEFAULT '',
      caption TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      aspect_ratio TEXT NOT NULL DEFAULT '4:5',
      audio_track_id TEXT REFERENCES audio_tracks(id) ON DELETE SET NULL,
      filter_name TEXT NOT NULL DEFAULT 'Original',
      is_featured INTEGER NOT NULL DEFAULT 0,
      is_removed INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      likes_count INTEGER NOT NULL DEFAULT 0,
      comments_count INTEGER NOT NULL DEFAULT 0,
      shares_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 4. stories (24-hour expiring)
    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      media_url TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
      overlay_text TEXT NOT NULL DEFAULT '',
      stickers_json TEXT NOT NULL DEFAULT '[]',
      is_demo INTEGER NOT NULL DEFAULT 0,
      views_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 5. likes
    CREATE TABLE IF NOT EXISTS likes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id)
    );

    -- 6. collections
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      cover_url TEXT NOT NULL DEFAULT '',
      is_private INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 7. saved_posts
    CREATE TABLE IF NOT EXISTS saved_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id)
    );

    -- 8. comments
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      likes_count INTEGER NOT NULL DEFAULT 0,
      is_removed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 9. follows
    CREATE TABLE IF NOT EXISTS follows (
      id TEXT PRIMARY KEY,
      follower_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      following_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'pending')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(follower_id, following_id)
    );

    -- 10. conversations
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      is_group INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
      last_message_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 11. conversation_members
    CREATE TABLE IF NOT EXISTS conversation_members (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
      last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(conversation_id, user_id)
    );

    -- 12. messages
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      media_url TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT 'text' CHECK (media_type IN ('text', 'image', 'voice', 'post_share', 'reel_share')),
      shared_post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      read_by_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 13. notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      actor_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK (type IN (
        'new_follower', 'follow_request', 'follow_accepted',
        'post_like', 'reel_like', 'comment', 'comment_reply',
        'story_reply', 'mention', 'message', 'admin_announcement'
      )),
      entity_id TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 14. story_views
    CREATE TABLE IF NOT EXISTS story_views (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      viewer_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(story_id, viewer_id)
    );

    -- 15. story_reactions
    CREATE TABLE IF NOT EXISTS story_reactions (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL DEFAULT '',
      reply_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 16. message_reactions
    CREATE TABLE IF NOT EXISTS message_reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, user_id, emoji)
    );

    -- 17. reports
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('post', 'reel', 'story', 'comment', 'user')),
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
      reviewed_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 18. hashtags
    CREATE TABLE IF NOT EXISTS hashtags (
      id TEXT PRIMARY KEY,
      tag TEXT NOT NULL UNIQUE COLLATE NOCASE,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 19. post_hashtags
    CREATE TABLE IF NOT EXISTS post_hashtags (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      hashtag_id TEXT NOT NULL REFERENCES hashtags(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, hashtag_id)
    );

    -- 20. user_blocks
    CREATE TABLE IF NOT EXISTS user_blocks (
      id TEXT PRIMARY KEY,
      blocker_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(blocker_id, blocked_id)
    );

    -- 21. admin_audit_logs
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- 22. announcements
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      banner_type TEXT NOT NULL DEFAULT 'info' CHECK (banner_type IN ('info', 'warning', 'festival')),
      created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT
    );

    -- Auth OTPs & Password Resets
    CREATE TABLE IF NOT EXISTS auth_codes (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN ('phone_otp', 'password_reset', 'email_verify')),
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Post-signup App Ratings
    CREATE TABLE IF NOT EXISTS app_ratings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      tags_json TEXT NOT NULL DEFAULT '[]',
      feedback TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(media_type, is_removed, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id, status);
    CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id, status);
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at DESC);

    -- Safe Server-Side Triggers for Counters
    CREATE TRIGGER IF NOT EXISTS trg_posts_insert AFTER INSERT ON posts
    WHEN NEW.is_removed = 0
    BEGIN
      UPDATE profiles SET posts_count = posts_count + 1 WHERE id = NEW.user_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_posts_delete AFTER DELETE ON posts
    WHEN OLD.is_removed = 0
    BEGIN
      UPDATE profiles SET posts_count = MAX(0, posts_count - 1) WHERE id = OLD.user_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_likes_insert AFTER INSERT ON likes
    BEGIN
      UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_likes_delete AFTER DELETE ON likes
    BEGIN
      UPDATE posts SET likes_count = MAX(0, likes_count - 1) WHERE id = OLD.post_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_comments_insert AFTER INSERT ON comments
    WHEN NEW.is_removed = 0
    BEGIN
      UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_comments_delete AFTER DELETE ON comments
    WHEN OLD.is_removed = 0
    BEGIN
      UPDATE posts SET comments_count = MAX(0, comments_count - 1) WHERE id = OLD.post_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_follows_insert AFTER INSERT ON follows
    WHEN NEW.status = 'accepted'
    BEGIN
      UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
      UPDATE profiles SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_follows_update AFTER UPDATE ON follows
    WHEN OLD.status = 'pending' AND NEW.status = 'accepted'
    BEGIN
      UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
      UPDATE profiles SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_follows_delete AFTER DELETE ON follows
    WHEN OLD.status = 'accepted'
    BEGIN
      UPDATE profiles SET following_count = MAX(0, following_count - 1) WHERE id = OLD.follower_id;
      UPDATE profiles SET followers_count = MAX(0, followers_count - 1) WHERE id = OLD.following_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_story_views_insert AFTER INSERT ON story_views
    BEGIN
      UPDATE stories SET views_count = views_count + 1 WHERE id = NEW.story_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_profiles_auto_follow_admin AFTER INSERT ON profiles
    WHEN NEW.is_demo = 0 AND LOWER(COALESCE(NEW.email, '')) != 'rishabhjaiswal335@gmail.com'
    BEGIN
      INSERT OR IGNORE INTO follows (id, follower_id, following_id, status)
      SELECT
        lower(hex(randomblob(16))),
        NEW.id,
        admin.id,
        'accepted'
      FROM profiles admin
      WHERE LOWER(admin.email) = 'rishabhjaiswal335@gmail.com'
        AND admin.id != NEW.id
      LIMIT 1;

      UPDATE profiles
      SET following_count = (SELECT COUNT(*) FROM follows WHERE follower_id = NEW.id AND status = 'accepted')
      WHERE id = NEW.id;

      UPDATE profiles
      SET followers_count = (SELECT COUNT(*) FROM follows WHERE following_id = profiles.id AND status = 'accepted')
      WHERE LOWER(email) = 'rishabhjaiswal335@gmail.com';
    END;
  `);
}
