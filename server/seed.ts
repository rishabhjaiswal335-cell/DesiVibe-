import crypto from 'crypto';
import { db, SUPER_ADMIN_EMAIL } from './db.ts';

function uuid() {
  return crypto.randomUUID();
}

export function provisionSuperAdminProfile() {
  // Server-side Super Admin provisioning for rishabhjaiswal335@gmail.com
  // Never stores a hardcoded password in frontend source code.
  const existing = db
    .prepare('SELECT id, role FROM profiles WHERE LOWER(email) = ?')
    .get(SUPER_ADMIN_EMAIL) as { id: string; role: string } | undefined;

  if (existing) {
    if (existing.role !== 'super_admin') {
      db.prepare(`UPDATE profiles SET role = 'super_admin', is_verified = 1, account_status = 'active' WHERE id = ?`).run(
        existing.id
      );
    }
    return existing.id;
  }

  const id = 'super-admin-rishabh';
  db.prepare(`
    INSERT OR IGNORE INTO profiles (
      id, username, email, full_name, bio, vibe_status, avatar_url,
      interests_json, is_verified, is_private, role, account_status, email_verified, is_demo
    ) VALUES (
      ?, 'rishabhjaiswal', ?, 'Rishabh Jaiswal',
      'Founder & Architect of DesiVibe · Building culture-first creator tech.',
      'Shipping DesiVibe',
      '',
      '["Tech","Design","Culture","Music"]',
      1, 0, 'super_admin', 'active', 1, 0
    )
  `).run(id, SUPER_ADMIN_EMAIL);

  return id;
}

export function initPlatformCatalogAndPurgeDemo() {
  // Remove any legacy demo accounts, posts, or stories so only real accounts exist
  db.prepare('DELETE FROM stories WHERE is_demo = 1').run();
  db.prepare('DELETE FROM posts WHERE is_demo = 1').run();
  db.prepare('DELETE FROM profiles WHERE is_demo = 1').run();

  // Platform audio tracks catalog for VibeReels
  const tracks = [
    { id: 'track-tabla-synth', title: 'Midnight Tabla Synth', artist: 'DesiVibe Originals', duration_sec: 32 },
    { id: 'track-mumbai-rain', title: 'Marine Drive After Rain', artist: 'DesiVibe LoFi', duration_sec: 45 },
    { id: 'track-jaipur-dusk', title: 'Sandstone Echoes', artist: 'DesiVibe Folk', duration_sec: 28 },
    { id: 'track-chai-groove', title: 'Kulhad Morning Groove', artist: 'DesiVibe Indie', duration_sec: 30 },
  ];

  const insertTrack = db.prepare(`
    INSERT OR IGNORE INTO audio_tracks (id, title, artist, duration_sec, usage_count)
    VALUES (?, ?, ?, ?, 0)
  `);
  for (const t of tracks) {
    insertTrack.run(t.id, t.title, t.artist, t.duration_sec);
  }

  // Initial welcome announcement if none exists
  const annCount = (db.prepare('SELECT COUNT(*) as cnt FROM announcements').get() as { cnt: number }).cnt;
  if (annCount === 0) {
    db.prepare(`
      INSERT INTO announcements (id, title, body, banner_type, is_active)
      VALUES (?, 'Welcome to DesiVibe', 'Your People. Your Culture. Your Vibe. Create an account to share posts, 24h VibeStories, VibeReels, and real-time VibeChat.', 'festival', 1)
    `).run(uuid());
  }
}
