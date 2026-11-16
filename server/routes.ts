import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import {
  AuthedRequest,
  hashPassword,
  optionalAuth,
  rateLimit,
  requireAdmin,
  requireAuth,
  requireSuperAdmin,
  signToken,
  syncFirebaseTokenWithSupabase,
  verifyFirebaseIdToken,
  verifyPassword,
} from './auth.ts';
import { BUCKETS, db, SUPER_ADMIN_EMAIL, UPLOAD_ROOT } from './db.ts';
import { realtime } from './realtime.ts';
import { provisionSuperAdminProfile } from './seed.ts';

function uuid() {
  return crypto.randomUUID();
}

function sanitizeProfile(row: any) {
  if (!row) return null;
  const { password_hash, ...safe } = row;
  const ratingRow = db.prepare('SELECT rating FROM app_ratings WHERE user_id = ?').get(row.id) as
    | { rating: number }
    | undefined;
  return {
    ...safe,
    interests: (() => {
      try {
        return JSON.parse(row.interests_json || '[]');
      } catch {
        return [];
      }
    })(),
    has_rated: Boolean(ratingRow),
    app_rating: ratingRow ? ratingRow.rating : null,
    online: realtime.isUserOnline(row.id),
  };
}

function sanitizePost(row: any, currentUserId?: string) {
  if (!row) return null;
  let mediaUrls: string[] = [];
  try {
    mediaUrls = JSON.parse(row.media_urls_json || '[]');
  } catch {
    mediaUrls = [];
  }
  const liked = currentUserId
    ? Boolean(db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(currentUserId, row.id))
    : false;
  const saved = currentUserId
    ? Boolean(db.prepare('SELECT 1 FROM saved_posts WHERE user_id = ? AND post_id = ?').get(currentUserId, row.id))
    : false;
  const followingAuthor =
    currentUserId && currentUserId !== row.user_id
      ? (db
          .prepare('SELECT status FROM follows WHERE follower_id = ? AND following_id = ?')
          .get(currentUserId, row.user_id) as { status: string } | undefined)?.status || null
      : null;

  return {
    ...row,
    media_urls: mediaUrls,
    is_liked: liked,
    is_saved: saved,
    follow_status: followingAuthor,
  };
}

function createNotification(params: {
  userId: string;
  actorId?: string | null;
  type: string;
  entityId?: string;
  message: string;
}) {
  if (params.actorId && params.userId === params.actorId) return;
  const id = uuid();
  db.prepare(`
    INSERT INTO notifications (id, user_id, actor_id, type, entity_id, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, params.userId, params.actorId || null, params.type, params.entityId || '', params.message);

  const full = db
    .prepare(`
      SELECT n.*, p.username as actor_username, p.full_name as actor_name, p.avatar_url as actor_avatar, p.is_verified as actor_verified
      FROM notifications n
      LEFT JOIN profiles p ON p.id = n.actor_id
      WHERE n.id = ?
    `)
    .get(id);

  realtime.emitToUser(params.userId, 'notification:new', full);
}

function safeDeleteLocalUpload(urlPath: string) {
  if (!urlPath || !urlPath.startsWith('/uploads/')) return;
  const rel = urlPath.replace(/^\/uploads\//, '');
  const fullPath = path.resolve(UPLOAD_ROOT, rel);
  if (fullPath.startsWith(UPLOAD_ROOT) && fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
    } catch {
      // Ignore cleanup failures
    }
  }
}

function autoFollowSuperAdmin(newUserId: string, newUsername: string) {
  const adminId = provisionSuperAdminProfile();
  if (!adminId || adminId === newUserId) return;
  let followRow = db
    .prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?')
    .get(newUserId, adminId) as { id: string } | undefined;
  if (!followRow) {
    const followId = uuid();
    db.prepare(`INSERT OR IGNORE INTO follows (id, follower_id, following_id, status) VALUES (?, ?, ?, 'accepted')`).run(
      followId,
      newUserId,
      adminId
    );
    followRow = { id: followId };
  }
  const alreadyNotified = db
    .prepare(`SELECT 1 FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'new_follower' LIMIT 1`)
    .get(adminId, newUserId);
  if (!alreadyNotified) {
    createNotification({
      userId: adminId,
      actorId: newUserId,
      type: 'new_follower',
      entityId: followRow.id,
      message: `@${newUsername} joined DesiVibe and started following you.`,
    });
  }
}

export function registerApiRoutes(app: express.Express) {
  const router = express.Router();

  // Configure Multer Storage Buckets
  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      const bucketRaw = String(req.query.bucket || req.body?.bucket || 'posts');
      const bucket = BUCKETS.includes(bucketRaw as any) ? bucketRaw : 'posts';
      cb(null, path.join(UPLOAD_ROOT, bucket));
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 10) || '.bin';
      cb(null, `${uuid()}${ext}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok =
        file.mimetype.startsWith('image/') ||
        file.mimetype.startsWith('video/') ||
        file.mimetype.startsWith('audio/');
      if (!ok) {
        return cb(new Error('Unsupported media format. Only image, video, and audio files are permitted.'));
      }
      cb(null, true);
    },
  });

  // -------------------------------------------------------
  // HEALTH
  // -------------------------------------------------------
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'DesiVibe API', timestamp: new Date().toISOString() });
  });

  // -------------------------------------------------------
  // AUTHENTICATION & ACCOUNTS
  // -------------------------------------------------------
  router.get('/auth/check-username', (req, res) => {
    const username = String(req.query.username || '').trim().toLowerCase();
    if (!username || !/^[a-z0-9._]{3,28}$/.test(username)) {
      return res.json({ available: false, reason: 'Use 3-28 lowercase letters, numbers, dots, or underscores.' });
    }
    const existing = db.prepare('SELECT id FROM profiles WHERE LOWER(username) = ?').get(username);
    res.json({ available: !existing });
  });

  router.post('/auth/signup', rateLimit(20, 60_000), (req, res) => {
    const { email, password, username, fullName, phone, bio, interests, vibeStatus } = req.body || {};
    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    const cleanUsername = String(username || '').trim().toLowerCase();
    const cleanName = String(fullName || '').trim();

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Valid email address is required.' });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    if (!cleanUsername || !/^[a-z0-9._]{3,28}$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Username must be 3-28 chars (letters, numbers, dot, underscore).' });
    }

    const existingUsername = db.prepare('SELECT id, email FROM profiles WHERE LOWER(username) = ?').get(cleanUsername) as
      | { id: string; email: string | null }
      | undefined;
    const existingEmail = db
      .prepare('SELECT id, password_hash, role FROM profiles WHERE LOWER(email) = ?')
      .get(cleanEmail) as { id: string; password_hash: string | null; role: string } | undefined;

    // Allow Super Admin pre-provisioned record (with null password_hash) to be claimed securely on first signup
    if (existingEmail && existingEmail.password_hash) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    if (existingUsername && (!existingEmail || existingUsername.id !== existingEmail.id)) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    const pwHash = hashPassword(String(password));
    const isSuper = cleanEmail === SUPER_ADMIN_EMAIL;
    const role = isSuper ? 'super_admin' : 'user';
    const verified = isSuper ? 1 : 0;

    let userId: string;
    if (existingEmail && !existingEmail.password_hash) {
      userId = existingEmail.id;
      db.prepare(`
        UPDATE profiles SET
          username = ?, phone = ?, password_hash = ?, full_name = ?, bio = ?,
          vibe_status = ?, interests_json = ?, role = ?, is_verified = ?, email_verified = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        cleanUsername,
        phone ? String(phone).trim() : null,
        pwHash,
        cleanName || 'DesiVibe Creator',
        String(bio || '').slice(0, 220),
        String(vibeStatus || 'Vibing on DesiVibe').slice(0, 80),
        JSON.stringify(Array.isArray(interests) ? interests.slice(0, 8) : []),
        role,
        verified,
        userId
      );
    } else {
      userId = uuid();
      db.prepare(`
        INSERT INTO profiles (
          id, username, email, phone, password_hash, full_name, bio, vibe_status,
          interests_json, is_verified, role, account_status, email_verified, is_demo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, 0)
      `).run(
        userId,
        cleanUsername,
        cleanEmail,
        phone ? String(phone).trim() : null,
        pwHash,
        cleanName || cleanUsername,
        String(bio || '').slice(0, 220),
        String(vibeStatus || 'Vibing on DesiVibe').slice(0, 80),
        JSON.stringify(Array.isArray(interests) ? interests.slice(0, 8) : []),
        verified,
        role
      );
      db.prepare(`INSERT INTO collections (id, user_id, name, is_private) VALUES (?, ?, 'All Saved', 1)`).run(
        uuid(),
        userId
      );
      autoFollowSuperAdmin(userId, cleanUsername);
    }

    const profile = sanitizeProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(userId));
    const token = signToken({ sub: userId, role });
    res.status(201).json({ token, user: profile, isNewUser: true });
  });

  router.post('/auth/login', rateLimit(30, 60_000), (req, res) => {
    const { identifier, password } = req.body || {};
    const clean = String(identifier || '').trim().toLowerCase();
    if (!clean || !password) {
      return res.status(400).json({ error: 'Email/username and password are required.' });
    }

    const row = db
      .prepare('SELECT * FROM profiles WHERE LOWER(email) = ? OR LOWER(username) = ?')
      .get(clean, clean) as any;

    if (!row || !row.password_hash || !verifyPassword(String(password), row.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    if (row.account_status === 'banned') {
      return res.status(403).json({ error: 'This account has been banned.' });
    }
    if (row.account_status === 'suspended') {
      return res.status(403).json({ error: 'This account is suspended.' });
    }

    if (row.email && row.email.toLowerCase() === SUPER_ADMIN_EMAIL && row.role !== 'super_admin') {
      db.prepare(`UPDATE profiles SET role = 'super_admin', is_verified = 1 WHERE id = ?`).run(row.id);
      row.role = 'super_admin';
      row.is_verified = 1;
    }

    const token = signToken({ sub: row.id, role: row.role });
    res.json({ token, user: sanitizeProfile(row) });
  });

  router.post('/auth/otp/request', rateLimit(10, 60_000), (req, res) => {
    const { target, purpose } = req.body || {};
    const cleanTarget = String(target || '').trim().toLowerCase();
    const validPurpose = ['phone_otp', 'password_reset', 'email_verify'].includes(purpose) ? purpose : 'phone_otp';
    if (!cleanTarget) {
      return res.status(400).json({ error: 'Phone number or email is required.' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO auth_codes (id, target, purpose, code, expires_at) VALUES (?, ?, ?, ?, ?)').run(
      uuid(),
      cleanTarget,
      validPurpose,
      code,
      expiresAt
    );

    // Return verification hint when no SMS/SMTP relay is configured in local sandbox
    res.json({
      sent: true,
      message: `6-digit verification code generated for ${cleanTarget}.`,
      previewCode: process.env.NODE_ENV === 'production' && process.env.SMTP_HOST ? undefined : code,
    });
  });

  router.post('/auth/otp/verify', rateLimit(20, 60_000), (req, res) => {
    const { phone, code, fullName, username } = req.body || {};
    const cleanPhone = String(phone || '').trim().toLowerCase();
    const cleanCode = String(code || '').trim();

    const record = db
      .prepare(
        `SELECT * FROM auth_codes WHERE target = ? AND purpose = 'phone_otp' AND code = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(cleanPhone, cleanCode, new Date().toISOString()) as any;

    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired OTP code.' });
    }
    db.prepare('UPDATE auth_codes SET used = 1 WHERE id = ?').run(record.id);

    let user = db.prepare('SELECT * FROM profiles WHERE phone = ?').get(cleanPhone) as any;
    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      const id = uuid();
      const uname =
        String(username || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9._]/g, '') || `vibe_${id.slice(0, 6)}`;
      db.prepare(`
        INSERT INTO profiles (id, username, phone, full_name, role, account_status, is_demo)
        VALUES (?, ?, ?, ?, 'user', 'active', 0)
      `).run(id, uname, cleanPhone, String(fullName || uname));
      db.prepare(`INSERT INTO collections (id, user_id, name, is_private) VALUES (?, ?, 'All Saved', 1)`).run(uuid(), id);
      autoFollowSuperAdmin(id, uname);
      user = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    }

    const token = signToken({ sub: user.id, role: user.role });
    res.json({ token, user: sanitizeProfile(user), isNewUser });
  });

  router.post('/auth/google', rateLimit(20, 60_000), async (req, res) => {
    const { idToken, email, fullName, avatarUrl } = req.body || {};

    let verifiedEmail = String(email || '').trim().toLowerCase();
    let verifiedName = String(fullName || '').trim();
    let verifiedAvatar = String(avatarUrl || '').trim();
    let firebaseVerified = false;
    let supabaseSync: { synced: boolean; reason?: string } = { synced: false };

    if (idToken) {
      try {
        const claims = await verifyFirebaseIdToken(String(idToken));
        verifiedEmail = claims.email || verifiedEmail;
        verifiedName = claims.name || verifiedName;
        verifiedAvatar = claims.picture || verifiedAvatar;
        firebaseVerified = true;
        supabaseSync = await syncFirebaseTokenWithSupabase(String(idToken));
      } catch (err: any) {
        return res.status(401).json({ error: err?.message || 'Invalid Firebase identity token.' });
      }
    }

    if (!verifiedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifiedEmail)) {
      return res.status(400).json({ error: 'Valid Google account email is required.' });
    }

    let user = db.prepare('SELECT * FROM profiles WHERE LOWER(email) = ?').get(verifiedEmail) as any;
    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      const id = uuid();
      const baseUsername = verifiedEmail.split('@')[0].replace(/[^a-z0-9._]/g, '').slice(0, 20) || 'creator';
      let finalUsername = baseUsername;
      if (db.prepare('SELECT 1 FROM profiles WHERE LOWER(username) = ?').get(finalUsername)) {
        finalUsername = `${baseUsername}_${id.slice(0, 4)}`;
      }
      const isSuper = verifiedEmail === SUPER_ADMIN_EMAIL;
      db.prepare(`
        INSERT INTO profiles (
          id, username, email, full_name, avatar_url, is_verified, role, account_status, email_verified, is_demo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, 0)
      `).run(
        id,
        finalUsername,
        verifiedEmail,
        String(verifiedName || finalUsername).slice(0, 60),
        String(verifiedAvatar || '').slice(0, 500),
        isSuper ? 1 : 0,
        isSuper ? 'super_admin' : 'user'
      );
      db.prepare(`INSERT INTO collections (id, user_id, name, is_private) VALUES (?, ?, 'All Saved', 1)`).run(uuid(), id);
      autoFollowSuperAdmin(id, finalUsername);
      user = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    } else {
      if (verifiedEmail === SUPER_ADMIN_EMAIL && user.role !== 'super_admin') {
        db.prepare(`UPDATE profiles SET role = 'super_admin', is_verified = 1, email_verified = 1 WHERE id = ?`).run(user.id);
      }
      if (!user.avatar_url && verifiedAvatar) {
        db.prepare('UPDATE profiles SET avatar_url = ?, email_verified = 1 WHERE id = ?').run(String(verifiedAvatar).slice(0, 500), user.id);
      }
      user = db.prepare('SELECT * FROM profiles WHERE id = ?').get(user.id);
    }

    if (user.account_status !== 'active') {
      return res.status(403).json({ error: `Account is ${user.account_status}.` });
    }

    const token = signToken({ sub: user.id, role: user.role });
    res.json({ token, user: sanitizeProfile(user), isNewUser, firebaseVerified, supabaseSync });
  });

  router.post('/auth/reset-password', rateLimit(15, 60_000), (req, res) => {
    const { email, code, newPassword } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !code || !newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Email, 6-digit code, and new password (6+ chars) are required.' });
    }

    const record = db
      .prepare(
        `SELECT * FROM auth_codes WHERE target = ? AND purpose = 'password_reset' AND code = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(cleanEmail, String(code).trim(), new Date().toISOString()) as any;

    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired reset code.' });
    }

    const user = db.prepare('SELECT id FROM profiles WHERE LOWER(email) = ?').get(cleanEmail) as { id: string } | undefined;
    if (!user) {
      return res.status(404).json({ error: 'No account found for that email.' });
    }

    db.prepare('UPDATE auth_codes SET used = 1 WHERE id = ?').run(record.id);
    db.prepare('UPDATE profiles SET password_hash = ?, email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      hashPassword(String(newPassword)),
      user.id
    );

    res.json({ success: true, message: 'Password updated successfully.' });
  });

  router.post('/auth/verify-email', requireAuth, (req: AuthedRequest, res) => {
    const { code } = req.body || {};
    const user = db.prepare('SELECT email FROM profiles WHERE id = ?').get(req.user!.id) as { email: string | null };
    if (!user?.email) return res.status(400).json({ error: 'No email on profile.' });

    const record = db
      .prepare(
        `SELECT * FROM auth_codes WHERE target = ? AND purpose = 'email_verify' AND code = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(user.email.toLowerCase(), String(code || '').trim(), new Date().toISOString()) as any;

    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }
    db.prepare('UPDATE auth_codes SET used = 1 WHERE id = ?').run(record.id);
    db.prepare('UPDATE profiles SET email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user!.id);
    res.json({ email_verified: 1 });
  });

  router.get('/auth/me', requireAuth, (req: AuthedRequest, res) => {
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.user!.id);
    const unreadNotifications = (
      db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user!.id) as {
        cnt: number;
      }
    ).cnt;
    res.json({ user: sanitizeProfile(profile), unreadNotifications });
  });

  // -------------------------------------------------------
  // MEDIA STORAGE UPLOAD
  // -------------------------------------------------------
  router.post('/media/upload', requireAuth, upload.single('file'), (req: AuthedRequest, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    const bucketRaw = String(req.query.bucket || req.body?.bucket || 'posts');
    const bucket = BUCKETS.includes(bucketRaw as any) ? bucketRaw : 'posts';
    const url = `/uploads/${bucket}/${req.file.filename}`;
    res.status(201).json({
      url,
      bucket,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  });

  // -------------------------------------------------------
  // PROFILES & SOCIAL GRAPH
  // -------------------------------------------------------
  router.get('/profiles/suggested', optionalAuth, (req: AuthedRequest, res) => {
    const uid = req.user?.id || '';
    const rows = db
      .prepare(`
        SELECT p.*,
          (SELECT status FROM follows f WHERE f.follower_id = ? AND f.following_id = p.id) as follow_status
        FROM profiles p
        WHERE p.id != ?
          AND p.account_status = 'active'
          AND p.is_demo = 0
          AND p.id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
          AND p.id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)
        ORDER BY p.is_verified DESC, p.followers_count DESC
        LIMIT 12
      `)
      .all(uid, uid, uid, uid);
    res.json({ users: rows.map(sanitizeProfile) });
  });

  router.get('/profiles/me/blocks', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(`
        SELECT p.* FROM user_blocks b
        JOIN profiles p ON p.id = b.blocked_id
        WHERE b.blocker_id = ?
        ORDER BY b.created_at DESC
      `)
      .all(req.user!.id);
    res.json({ blocked: rows.map(sanitizeProfile) });
  });

  router.patch('/profiles/me', requireAuth, (req: AuthedRequest, res) => {
    const { fullName, username, bio, vibeStatus, avatarUrl, interests, isPrivate } = req.body || {};
    const current = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.user!.id) as any;

    let nextUsername = current.username;
    if (username !== undefined && String(username).trim().toLowerCase() !== current.username.toLowerCase()) {
      const cleanU = String(username).trim().toLowerCase();
      if (!/^[a-z0-9._]{3,28}$/.test(cleanU)) {
        return res.status(400).json({ error: 'Invalid username format.' });
      }
      const conflict = db.prepare('SELECT id FROM profiles WHERE LOWER(username) = ? AND id != ?').get(cleanU, current.id);
      if (conflict) {
        return res.status(409).json({ error: 'Username already taken.' });
      }
      nextUsername = cleanU;
    }

    db.prepare(`
      UPDATE profiles SET
        username = ?,
        full_name = ?,
        bio = ?,
        vibe_status = ?,
        avatar_url = ?,
        interests_json = ?,
        is_private = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nextUsername,
      fullName !== undefined ? String(fullName).trim().slice(0, 60) : current.full_name,
      bio !== undefined ? String(bio).slice(0, 240) : current.bio,
      vibeStatus !== undefined ? String(vibeStatus).slice(0, 80) : current.vibe_status,
      avatarUrl !== undefined ? String(avatarUrl) : current.avatar_url,
      interests !== undefined ? JSON.stringify(Array.isArray(interests) ? interests.slice(0, 10) : []) : current.interests_json,
      isPrivate !== undefined ? (isPrivate ? 1 : 0) : current.is_private,
      current.id
    );

    const updated = sanitizeProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(current.id));
    res.json({ user: updated });
  });

  router.get('/profiles/:identifier', optionalAuth, (req: AuthedRequest, res) => {
    const ident = String(req.params.identifier).trim().toLowerCase();
    const profile = db
      .prepare('SELECT * FROM profiles WHERE id = ? OR LOWER(username) = ?')
      .get(req.params.identifier, ident) as any;

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found.' });
    }

    const viewerId = req.user?.id || '';
    const isSelf = viewerId === profile.id;

    const isBlocked = viewerId
      ? Boolean(
          db
            .prepare('SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
            .get(viewerId, profile.id, profile.id, viewerId)
        )
      : false;

    const followRow = viewerId
      ? (db
          .prepare('SELECT status FROM follows WHERE follower_id = ? AND following_id = ?')
          .get(viewerId, profile.id) as { status: string } | undefined)
      : undefined;

    const canViewPrivate = isSelf || !profile.is_private || followRow?.status === 'accepted' || req.user?.role === 'super_admin' || req.user?.role === 'admin';

    const posts = canViewPrivate && !isBlocked
      ? db
          .prepare(`
            SELECT p.*, pr.username, pr.full_name, pr.avatar_url, pr.is_verified, pr.role as author_role, pr.is_demo as author_is_demo,
              at.title as audio_title, at.artist as audio_artist
            FROM posts p
            JOIN profiles pr ON pr.id = p.user_id
            LEFT JOIN audio_tracks at ON at.id = p.audio_track_id
            WHERE p.user_id = ? AND p.is_removed = 0
            ORDER BY p.created_at DESC
          `)
          .all(profile.id)
          .map((r: any) => sanitizePost(r, viewerId))
      : [];

    res.json({
      profile: sanitizeProfile(profile),
      followStatus: followRow?.status || null,
      isBlocked,
      canViewContent: canViewPrivate && !isBlocked,
      posts: posts.filter((p: any) => p.media_type !== 'reel'),
      reels: posts.filter((p: any) => p.media_type === 'reel'),
    });
  });

  router.post('/profiles/:id/follow', requireAuth, (req: AuthedRequest, res) => {
    const targetId = req.params.id;
    const actorId = req.user!.id;
    if (targetId === actorId) {
      return res.status(400).json({ error: 'Cannot follow yourself.' });
    }

    const target = db.prepare('SELECT id, username, is_private, account_status FROM profiles WHERE id = ?').get(targetId) as any;
    if (!target || target.account_status !== 'active') {
      return res.status(404).json({ error: 'Account unavailable.' });
    }

    const existing = db
      .prepare('SELECT id, status FROM follows WHERE follower_id = ? AND following_id = ?')
      .get(actorId, targetId) as { id: string; status: string } | undefined;

    if (existing) {
      db.prepare('DELETE FROM follows WHERE id = ?').run(existing.id);
      const counts = db.prepare('SELECT followers_count, following_count FROM profiles WHERE id = ?').get(targetId);
      return res.json({ followStatus: null, counts });
    }

    const status = target.is_private ? 'pending' : 'accepted';
    const id = uuid();
    db.prepare('INSERT INTO follows (id, follower_id, following_id, status) VALUES (?, ?, ?, ?)').run(
      id,
      actorId,
      targetId,
      status
    );

    createNotification({
      userId: targetId,
      actorId,
      type: status === 'pending' ? 'follow_request' : 'new_follower',
      entityId: id,
      message:
        status === 'pending'
          ? `@${req.user!.username} requested to follow you.`
          : `@${req.user!.username} started following you.`,
    });

    const counts = db.prepare('SELECT followers_count, following_count FROM profiles WHERE id = ?').get(targetId);
    res.json({ followStatus: status, counts });
  });

  router.post('/profiles/follow-requests/:followId/respond', requireAuth, (req: AuthedRequest, res) => {
    const { action } = req.body || {};
    const follow = db
      .prepare('SELECT * FROM follows WHERE id = ? AND following_id = ? AND status = ?')
      .get(req.params.followId, req.user!.id, 'pending') as any;

    if (!follow) {
      return res.status(404).json({ error: 'Follow request not found.' });
    }

    if (action === 'accept') {
      db.prepare(`UPDATE follows SET status = 'accepted' WHERE id = ?`).run(follow.id);
      createNotification({
        userId: follow.follower_id,
        actorId: req.user!.id,
        type: 'follow_accepted',
        entityId: follow.id,
        message: `@${req.user!.username} accepted your follow request.`,
      });
      return res.json({ status: 'accepted' });
    }

    db.prepare('DELETE FROM follows WHERE id = ?').run(follow.id);
    res.json({ status: 'declined' });
  });

  router.get('/profiles/:id/followers', optionalAuth, (req, res) => {
    const rows = db
      .prepare(`
        SELECT p.* FROM follows f
        JOIN profiles p ON p.id = f.follower_id
        WHERE f.following_id = ? AND f.status = 'accepted' AND p.account_status = 'active'
        ORDER BY f.created_at DESC
      `)
      .all(req.params.id);
    res.json({ users: rows.map(sanitizeProfile) });
  });

  router.get('/profiles/:id/following', optionalAuth, (req, res) => {
    const rows = db
      .prepare(`
        SELECT p.* FROM follows f
        JOIN profiles p ON p.id = f.following_id
        WHERE f.follower_id = ? AND f.status = 'accepted' AND p.account_status = 'active'
        ORDER BY f.created_at DESC
      `)
      .all(req.params.id);
    res.json({ users: rows.map(sanitizeProfile) });
  });

  router.post('/profiles/:id/block', requireAuth, (req: AuthedRequest, res) => {
    const targetId = req.params.id;
    if (targetId === req.user!.id) return res.status(400).json({ error: 'Cannot block yourself.' });
    db.prepare('INSERT OR IGNORE INTO user_blocks (id, blocker_id, blocked_id) VALUES (?, ?, ?)').run(
      uuid(),
      req.user!.id,
      targetId
    );
    db.prepare('DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)').run(
      req.user!.id,
      targetId,
      targetId,
      req.user!.id
    );
    res.json({ blocked: true });
  });

  router.delete('/profiles/:id/block', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user!.id, req.params.id);
    res.json({ blocked: false });
  });

  // -------------------------------------------------------
  // POSTS, HOME FEED, REELS, EXPLORE, COLLECTIONS
  // -------------------------------------------------------
  router.get('/posts/feed', optionalAuth, (req: AuthedRequest, res) => {
    const uid = req.user?.id || '';
    const limit = Math.min(30, Math.max(1, Number(req.query.limit || 10)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    const rows = db
      .prepare(`
        SELECT p.*, pr.username, pr.full_name, pr.avatar_url, pr.is_verified, pr.role as author_role,
          at.title as audio_title, at.artist as audio_artist,
          CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_followed_author
        FROM posts p
        JOIN profiles pr ON pr.id = p.user_id
        LEFT JOIN audio_tracks at ON at.id = p.audio_track_id
        LEFT JOIN follows f ON f.follower_id = ? AND f.following_id = p.user_id AND f.status = 'accepted'
        WHERE p.is_removed = 0
          AND pr.account_status = 'active'
          AND p.is_demo = 0
          AND pr.is_demo = 0
          AND (pr.is_private = 0 OR p.user_id = ? OR f.id IS NOT NULL)
          AND p.user_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
          AND p.user_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)
        ORDER BY is_followed_author DESC, p.is_featured DESC, p.created_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(uid, uid, uid, uid, limit, offset);

    res.json({
      posts: rows.map((r: any) => sanitizePost(r, uid)),
      hasMore: rows.length === limit,
    });
  });

  router.get('/reels', optionalAuth, (req: AuthedRequest, res) => {
    // Public reels from ALL registered real users
    const uid = req.user?.id || '';
    const rows = db
      .prepare(`
        SELECT p.*, pr.username, pr.full_name, pr.avatar_url, pr.is_verified, pr.role as author_role,
          at.title as audio_title, at.artist as audio_artist,
          (p.likes_count * 2 + p.comments_count * 3 + p.shares_count * 4) as engagement_score
        FROM posts p
        JOIN profiles pr ON pr.id = p.user_id
        LEFT JOIN audio_tracks at ON at.id = p.audio_track_id
        WHERE p.media_type IN ('reel', 'video')
          AND p.is_removed = 0
          AND pr.account_status = 'active'
          AND pr.is_private = 0
          AND p.is_demo = 0
          AND pr.is_demo = 0
          AND p.user_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
          AND p.user_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)
        ORDER BY p.created_at DESC, engagement_score DESC
        LIMIT 50
      `)
      .all(uid, uid);

    res.json({ reels: rows.map((r: any) => sanitizePost(r, uid)) });
  });

  router.get('/explore', optionalAuth, (req: AuthedRequest, res) => {
    const uid = req.user?.id || '';

    const trendingPosts = db
      .prepare(`
        SELECT p.*, pr.username, pr.full_name, pr.avatar_url, pr.is_verified, pr.role as author_role,
          at.title as audio_title, at.artist as audio_artist
        FROM posts p
        JOIN profiles pr ON pr.id = p.user_id
        LEFT JOIN audio_tracks at ON at.id = p.audio_track_id
        WHERE p.is_removed = 0
          AND pr.account_status = 'active'
          AND pr.is_private = 0
          AND p.is_demo = 0
          AND pr.is_demo = 0
          AND p.user_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
        ORDER BY p.is_featured DESC, (p.likes_count + p.comments_count * 2) DESC, p.created_at DESC
        LIMIT 24
      `)
      .all(uid);

    const hashtags = db.prepare('SELECT * FROM hashtags ORDER BY usage_count DESC, tag ASC LIMIT 12').all();
    const audioTracks = db.prepare('SELECT * FROM audio_tracks ORDER BY usage_count DESC LIMIT 10').all();

    res.json({
      posts: trendingPosts.map((r: any) => sanitizePost(r, uid)),
      hashtags,
      audioTracks,
    });
  });

  router.get('/explore/search', optionalAuth, (req: AuthedRequest, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const uid = req.user?.id || '';
    if (!q) {
      return res.json({ users: [], hashtags: [], audioTracks: [], posts: [] });
    }
    const like = `%${q}%`;

    const users = db
      .prepare(`
        SELECT * FROM profiles
        WHERE account_status = 'active'
          AND is_demo = 0
          AND (LOWER(username) LIKE ? OR LOWER(full_name) LIKE ?)
          AND id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
        ORDER BY is_verified DESC, followers_count DESC
        LIMIT 15
      `)
      .all(like, like, uid);

    const hashtags = db
      .prepare('SELECT * FROM hashtags WHERE LOWER(tag) LIKE ? ORDER BY usage_count DESC LIMIT 12')
      .all(like);

    const audioTracks = db
      .prepare('SELECT * FROM audio_tracks WHERE LOWER(title) LIKE ? OR LOWER(artist) LIKE ? ORDER BY usage_count DESC LIMIT 10')
      .all(like, like);

    const posts = db
      .prepare(`
        SELECT p.*, pr.username, pr.full_name, pr.avatar_url, pr.is_verified, pr.role as author_role, pr.is_demo as author_is_demo
        FROM posts p
        JOIN profiles pr ON pr.id = p.user_id
        WHERE p.is_removed = 0 AND pr.is_private = 0 AND pr.account_status = 'active'
          AND (LOWER(p.caption) LIKE ? OR LOWER(p.location) LIKE ?)
        ORDER BY p.created_at DESC
        LIMIT 16
      `)
      .all(like, like);

    res.json({
      users: users.map(sanitizeProfile),
      hashtags,
      audioTracks,
      posts: posts.map((r: any) => sanitizePost(r, uid)),
    });
  });

  router.post('/posts', requireAuth, (req: AuthedRequest, res) => {
    const { mediaType, mediaUrls, thumbnailUrl, caption, location, aspectRatio, audioTrackId, filterName } = req.body || {};
    const validType = ['image', 'carousel', 'video', 'reel'].includes(mediaType) ? mediaType : 'image';
    const urls = Array.isArray(mediaUrls) ? mediaUrls.filter(Boolean) : [];
    if (urls.length === 0) {
      return res.status(400).json({ error: 'At least one uploaded media file is required.' });
    }

    const postId = uuid();
    const cleanCaption = String(caption || '').slice(0, 2200);

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO posts (
          id, user_id, media_type, media_urls_json, thumbnail_url, caption,
          location, aspect_ratio, audio_track_id, filter_name, is_demo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        postId,
        req.user!.id,
        validType,
        JSON.stringify(urls),
        String(thumbnailUrl || urls[0]),
        cleanCaption,
        String(location || '').slice(0, 120),
        String(aspectRatio || (validType === 'reel' ? '9:16' : '4:5')),
        audioTrackId || null,
        String(filterName || 'Original')
      );

      if (audioTrackId) {
        db.prepare('UPDATE audio_tracks SET usage_count = usage_count + 1 WHERE id = ?').run(audioTrackId);
      }

      const tags = cleanCaption.match(/#[A-Za-z0-9_]+/g) || [];
      for (const rawTag of tags) {
        const tag = rawTag.slice(1).toLowerCase();
        let h = db.prepare('SELECT id FROM hashtags WHERE LOWER(tag) = ?').get(tag) as { id: string } | undefined;
        if (!h) {
          const hid = uuid();
          db.prepare('INSERT INTO hashtags (id, tag, usage_count) VALUES (?, ?, 1)').run(hid, tag);
          h = { id: hid };
        } else {
          db.prepare('UPDATE hashtags SET usage_count = usage_count + 1 WHERE id = ?').run(h.id);
        }
        db.prepare('INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id) VALUES (?, ?)').run(postId, h.id);
      }
    });
    tx();

    const created = db
      .prepare(`
        SELECT p.*, pr.username, pr.full_name, pr.avatar_url, pr.is_verified, pr.role as author_role, pr.is_demo as author_is_demo,
          at.title as audio_title, at.artist as audio_artist
        FROM posts p
        JOIN profiles pr ON pr.id = p.user_id
        LEFT JOIN audio_tracks at ON at.id = p.audio_track_id
        WHERE p.id = ?
      `)
      .get(postId);

    const sanitized = sanitizePost(created, req.user!.id);
    realtime.broadcast('post:created', sanitized);
    res.status(201).json({ post: sanitized });
  });

  router.delete('/posts/:id', requireAuth, (req: AuthedRequest, res) => {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (post.user_id !== req.user!.id && req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
      return res.status(403).json({ error: 'You cannot delete this post.' });
    }

    db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
    try {
      const urls = JSON.parse(post.media_urls_json || '[]');
      for (const u of urls) safeDeleteLocalUpload(u);
      if (post.thumbnail_url) safeDeleteLocalUpload(post.thumbnail_url);
    } catch {
      // Ignore
    }
    realtime.broadcast('post:deleted', { postId: post.id });
    res.json({ deleted: true });
  });

  router.post('/posts/:id/like', requireAuth, (req: AuthedRequest, res) => {
    const post = db.prepare('SELECT id, user_id, media_type FROM posts WHERE id = ? AND is_removed = 0').get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const existing = db.prepare('SELECT id FROM likes WHERE user_id = ? AND post_id = ?').get(req.user!.id, post.id) as any;
    let liked = false;
    if (existing) {
      db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
    } else {
      db.prepare('INSERT INTO likes (id, user_id, post_id) VALUES (?, ?, ?)').run(uuid(), req.user!.id, post.id);
      liked = true;
      createNotification({
        userId: post.user_id,
        actorId: req.user!.id,
        type: post.media_type === 'reel' ? 'reel_like' : 'post_like',
        entityId: post.id,
        message: `@${req.user!.username} liked your ${post.media_type === 'reel' ? 'reel' : 'post'}.`,
      });
    }

    const updated = db.prepare('SELECT likes_count FROM posts WHERE id = ?').get(post.id) as { likes_count: number };
    realtime.broadcast('post:liked', { postId: post.id, likes_count: updated.likes_count, actorId: req.user!.id, liked });
    res.json({ liked, likes_count: updated.likes_count });
  });

  router.get('/posts/:id/comments', optionalAuth, (req, res) => {
    const rows = db
      .prepare(`
        SELECT c.*, p.username, p.full_name, p.avatar_url, p.is_verified, p.role as author_role
        FROM comments c
        JOIN profiles p ON p.id = c.user_id
        WHERE c.post_id = ? AND c.is_removed = 0 AND p.account_status = 'active'
        ORDER BY c.created_at ASC
      `)
      .all(req.params.id);
    res.json({ comments: rows });
  });

  router.post('/posts/:id/comments', requireAuth, (req: AuthedRequest, res) => {
    const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ? AND is_removed = 0').get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const content = String(req.body?.content || '').trim().slice(0, 1000);
    const parentId = req.body?.parentId ? String(req.body.parentId) : null;
    if (!content) return res.status(400).json({ error: 'Comment cannot be empty.' });

    const id = uuid();
    db.prepare('INSERT INTO comments (id, post_id, user_id, parent_id, content) VALUES (?, ?, ?, ?, ?)').run(
      id,
      post.id,
      req.user!.id,
      parentId,
      content
    );

    const comment = db
      .prepare(`
        SELECT c.*, p.username, p.full_name, p.avatar_url, p.is_verified, p.role as author_role
        FROM comments c
        JOIN profiles p ON p.id = c.user_id
        WHERE c.id = ?
      `)
      .get(id);

    const postStats = db.prepare('SELECT comments_count FROM posts WHERE id = ?').get(post.id) as { comments_count: number };

    if (parentId) {
      const parent = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(parentId) as { user_id: string } | undefined;
      if (parent) {
        createNotification({
          userId: parent.user_id,
          actorId: req.user!.id,
          type: 'comment_reply',
          entityId: post.id,
          message: `@${req.user!.username} replied to your comment: "${content.slice(0, 50)}"`,
        });
      }
    } else {
      createNotification({
        userId: post.user_id,
        actorId: req.user!.id,
        type: 'comment',
        entityId: post.id,
        message: `@${req.user!.username} commented: "${content.slice(0, 50)}"`,
      });
    }

    realtime.broadcast('post:commented', { postId: post.id, comment, comments_count: postStats.comments_count });
    res.status(201).json({ comment, comments_count: postStats.comments_count });
  });

  router.post('/posts/:id/save', requireAuth, (req: AuthedRequest, res) => {
    const post = db.prepare('SELECT id, thumbnail_url FROM posts WHERE id = ?').get(req.params.id) as any;
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const collectionId = req.body?.collectionId ? String(req.body.collectionId) : null;
    const existing = db.prepare('SELECT id FROM saved_posts WHERE user_id = ? AND post_id = ?').get(req.user!.id, post.id) as any;

    if (existing && !collectionId) {
      db.prepare('DELETE FROM saved_posts WHERE id = ?').run(existing.id);
      return res.json({ saved: false });
    }

    let targetCollection = collectionId;
    if (!targetCollection) {
      const def = db.prepare('SELECT id FROM collections WHERE user_id = ? ORDER BY created_at ASC LIMIT 1').get(req.user!.id) as any;
      if (def) {
        targetCollection = def.id;
      } else {
        targetCollection = uuid();
        db.prepare('INSERT INTO collections (id, user_id, name, cover_url) VALUES (?, ?, ?, ?)').run(
          targetCollection,
          req.user!.id,
          'All Saved',
          post.thumbnail_url || ''
        );
      }
    }

    if (existing) {
      db.prepare('UPDATE saved_posts SET collection_id = ? WHERE id = ?').run(targetCollection, existing.id);
    } else {
      db.prepare('INSERT INTO saved_posts (id, user_id, post_id, collection_id) VALUES (?, ?, ?, ?)').run(
        uuid(),
        req.user!.id,
        post.id,
        targetCollection
      );
    }

    db.prepare(`UPDATE collections SET cover_url = CASE WHEN cover_url = '' THEN ? ELSE cover_url END WHERE id = ?`).run(
      post.thumbnail_url || '',
      targetCollection
    );
    res.json({ saved: true, collectionId: targetCollection });
  });

  router.post('/posts/:id/share', optionalAuth, (req, res) => {
    db.prepare('UPDATE posts SET shares_count = shares_count + 1 WHERE id = ?').run(req.params.id);
    res.json({ shared: true });
  });

  router.get('/collections', requireAuth, (req: AuthedRequest, res) => {
    const collections = db
      .prepare('SELECT * FROM collections WHERE user_id = ? ORDER BY created_at ASC')
      .all(req.user!.id) as any[];
    const savedRows = db
      .prepare(`
        SELECT s.collection_id, p.*, pr.username, pr.full_name, pr.avatar_url, pr.is_verified, pr.role as author_role, pr.is_demo as author_is_demo
        FROM saved_posts s
        JOIN posts p ON p.id = s.post_id
        JOIN profiles pr ON pr.id = p.user_id
        WHERE s.user_id = ? AND p.is_removed = 0
        ORDER BY s.created_at DESC
      `)
      .all(req.user!.id)
      .map((r: any) => sanitizePost(r, req.user!.id));

    res.json({
      collections: collections.map((c) => ({
        ...c,
        items: savedRows.filter((s: any) => s.collection_id === c.id),
      })),
      savedPosts: savedRows,
    });
  });

  router.post('/collections', requireAuth, (req: AuthedRequest, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 50);
    if (!name) return res.status(400).json({ error: 'Collection name required.' });
    const id = uuid();
    db.prepare('INSERT INTO collections (id, user_id, name, is_private) VALUES (?, ?, ?, 1)').run(id, req.user!.id, name);
    res.status(201).json({ collection: db.prepare('SELECT * FROM collections WHERE id = ?').get(id) });
  });

  // -------------------------------------------------------
  // VIBESTORIES (24-HOUR EXPIRING STORIES)
  // -------------------------------------------------------
  router.get('/stories', optionalAuth, (req: AuthedRequest, res) => {
    const uid = req.user?.id || '';
    const nowIso = new Date().toISOString();

    const rows = db
      .prepare(`
        SELECT s.*, p.username, p.full_name, p.avatar_url, p.is_verified, p.role as author_role,
          CASE WHEN sv.id IS NOT NULL THEN 1 ELSE 0 END as seen
        FROM stories s
        JOIN profiles p ON p.id = s.user_id
        LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.viewer_id = ?
        WHERE s.expires_at > ?
          AND p.account_status = 'active'
          AND s.is_demo = 0
          AND p.is_demo = 0
          AND (p.is_private = 0 OR s.user_id = ? OR EXISTS (
            SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = p.id AND f.status = 'accepted'
          ))
        ORDER BY s.user_id = ? DESC, s.created_at ASC
      `)
      .all(uid, nowIso, uid, uid, uid) as any[];

    const groupedMap = new Map<string, any>();
    for (const r of rows) {
      if (!groupedMap.has(r.user_id)) {
        groupedMap.set(r.user_id, {
          user_id: r.user_id,
          username: r.username,
          full_name: r.full_name,
          avatar_url: r.avatar_url,
          is_verified: r.is_verified,
          is_demo: r.author_is_demo,
          hasUnseen: false,
          stories: [],
        });
      }
      const group = groupedMap.get(r.user_id);
      if (!r.seen) group.hasUnseen = true;
      group.stories.push({
        ...r,
        stickers: (() => {
          try {
            return JSON.parse(r.stickers_json || '[]');
          } catch {
            return [];
          }
        })(),
      });
    }

    res.json({ storyGroups: Array.from(groupedMap.values()) });
  });

  router.post('/stories', requireAuth, (req: AuthedRequest, res) => {
    const { mediaUrl, mediaType, overlayText, stickers } = req.body || {};
    if (!mediaUrl) return res.status(400).json({ error: 'Story media is required.' });
    const id = uuid();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO stories (id, user_id, media_url, media_type, overlay_text, stickers_json, is_demo, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      id,
      req.user!.id,
      String(mediaUrl),
      mediaType === 'video' ? 'video' : 'image',
      String(overlayText || '').slice(0, 140),
      JSON.stringify(Array.isArray(stickers) ? stickers.slice(0, 8) : []),
      expiresAt
    );

    res.status(201).json({ story: db.prepare('SELECT * FROM stories WHERE id = ?').get(id) });
  });

  router.post('/stories/:id/view', requireAuth, (req: AuthedRequest, res) => {
    const story = db.prepare('SELECT id FROM stories WHERE id = ?').get(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story expired or not found.' });
    db.prepare('INSERT OR IGNORE INTO story_views (id, story_id, viewer_id) VALUES (?, ?, ?)').run(
      uuid(),
      req.params.id,
      req.user!.id
    );
    res.json({ viewed: true });
  });

  router.get('/stories/:id/views', requireAuth, (req: AuthedRequest, res) => {
    const story = db.prepare('SELECT user_id FROM stories WHERE id = ?').get(req.params.id) as { user_id: string } | undefined;
    if (!story) return res.status(404).json({ error: 'Story not found.' });
    if (story.user_id !== req.user!.id && req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only the story creator can view viewer insights.' });
    }
    const viewers = db
      .prepare(`
        SELECT p.id, p.username, p.full_name, p.avatar_url, p.is_verified, sv.viewed_at
        FROM story_views sv
        JOIN profiles p ON p.id = sv.viewer_id
        WHERE sv.story_id = ?
        ORDER BY sv.viewed_at DESC
      `)
      .all(req.params.id);
    res.json({ viewers });
  });

  router.post('/stories/:id/react', requireAuth, (req: AuthedRequest, res) => {
    const story = db.prepare('SELECT id, user_id FROM stories WHERE id = ?').get(req.params.id) as any;
    if (!story) return res.status(404).json({ error: 'Story not found.' });

    const emoji = String(req.body?.emoji || '').slice(0, 16);
    const replyText = String(req.body?.replyText || '').trim().slice(0, 500);
    if (!emoji && !replyText) return res.status(400).json({ error: 'Reaction or reply required.' });

    db.prepare('INSERT INTO story_reactions (id, story_id, user_id, emoji, reply_text) VALUES (?, ?, ?, ?, ?)').run(
      uuid(),
      story.id,
      req.user!.id,
      emoji,
      replyText
    );

    if (story.user_id !== req.user!.id) {
      createNotification({
        userId: story.user_id,
        actorId: req.user!.id,
        type: 'story_reply',
        entityId: story.id,
        message: replyText
          ? `@${req.user!.username} replied to your story: "${replyText.slice(0, 50)}"`
          : `@${req.user!.username} reacted ${emoji} to your story.`,
      });

      // Deliver direct story reply into VibeChat conversation automatically
      if (replyText) {
        let conv = db
          .prepare(`
            SELECT c.id FROM conversations c
            JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
            JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
            WHERE c.is_group = 0
            LIMIT 1
          `)
          .get(req.user!.id, story.user_id) as { id: string } | undefined;

        if (!conv) {
          const cid = uuid();
          db.prepare('INSERT INTO conversations (id, is_group, created_by) VALUES (?, 0, ?)').run(cid, req.user!.id);
          db.prepare('INSERT INTO conversation_members (id, conversation_id, user_id) VALUES (?, ?, ?)').run(uuid(), cid, req.user!.id);
          db.prepare('INSERT INTO conversation_members (id, conversation_id, user_id) VALUES (?, ?, ?)').run(uuid(), cid, story.user_id);
          conv = { id: cid };
        }

        const msgId = uuid();
        const body = `Story reply: ${replyText}`;
        db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, content, media_type) VALUES (?, ?, ?, ?, 'text')`).run(
          msgId,
          conv.id,
          req.user!.id,
          body
        );
        db.prepare('UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?').run(conv.id);
        const fullMsg = db
          .prepare(`SELECT m.*, p.username, p.full_name, p.avatar_url FROM messages m JOIN profiles p ON p.id = m.sender_id WHERE m.id = ?`)
          .get(msgId);
        realtime.emitToUsers([req.user!.id, story.user_id], 'chat:message', fullMsg);
      }
    }

    res.json({ sent: true });
  });

  // -------------------------------------------------------
  // VIBECHAT REAL-TIME MESSAGING
  // -------------------------------------------------------
  router.get('/chat/conversations', requireAuth, (req: AuthedRequest, res) => {
    const uid = req.user!.id;
    const convs = db
      .prepare(`
        SELECT c.*, cm.last_read_at
        FROM conversations c
        JOIN conversation_members cm ON cm.conversation_id = c.id
        WHERE cm.user_id = ?
        ORDER BY c.last_message_at DESC
      `)
      .all(uid) as any[];

    const result = convs.map((c) => {
      const members = db
        .prepare(`
          SELECT p.id, p.username, p.full_name, p.avatar_url, p.is_verified, p.vibe_status, p.last_seen_at
          FROM conversation_members cm
          JOIN profiles p ON p.id = cm.user_id
          WHERE cm.conversation_id = ?
        `)
        .all(c.id)
        .map((m: any) => ({ ...m, online: realtime.isUserOnline(m.id) }));

      const lastMessage = db
        .prepare(`
          SELECT m.*, p.username as sender_username
          FROM messages m
          JOIN profiles p ON p.id = m.sender_id
          WHERE m.conversation_id = ?
          ORDER BY m.created_at DESC
          LIMIT 1
        `)
        .get(c.id);

      const unreadCount = (
        db
          .prepare(`
            SELECT COUNT(*) as cnt FROM messages
            WHERE conversation_id = ? AND sender_id != ? AND created_at > ? AND is_deleted = 0
          `)
          .get(c.id, uid, c.last_read_at) as { cnt: number }
      ).cnt;

      return { ...c, members, lastMessage, unreadCount };
    });

    res.json({ conversations: result });
  });

  router.post('/chat/conversations', requireAuth, (req: AuthedRequest, res) => {
    const { memberIds, isGroup, name } = req.body || {};
    const others = Array.isArray(memberIds) ? memberIds.filter((id: string) => id && id !== req.user!.id) : [];
    if (others.length === 0) {
      return res.status(400).json({ error: 'Select at least one recipient.' });
    }

    if (!isGroup && others.length === 1) {
      const existing = db
        .prepare(`
          SELECT c.id FROM conversations c
          JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
          JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
          WHERE c.is_group = 0
          LIMIT 1
        `)
        .get(req.user!.id, others[0]) as { id: string } | undefined;

      if (existing) {
        return res.json({ conversationId: existing.id, existing: true });
      }
    }

    const cid = uuid();
    db.prepare('INSERT INTO conversations (id, is_group, name, created_by) VALUES (?, ?, ?, ?)').run(
      cid,
      isGroup || others.length > 1 ? 1 : 0,
      String(name || '').slice(0, 60),
      req.user!.id
    );
    db.prepare(`INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'admin')`).run(
      uuid(),
      cid,
      req.user!.id
    );
    for (const mId of others) {
      db.prepare(`INSERT OR IGNORE INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')`).run(
        uuid(),
        cid,
        mId
      );
    }

    res.status(201).json({ conversationId: cid });
  });

  router.get('/chat/conversations/:id/messages', requireAuth, (req: AuthedRequest, res) => {
    const member = db
      .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(req.params.id, req.user!.id);
    if (!member) return res.status(403).json({ error: 'Access denied: Not a conversation participant.' });

    const messages = db
      .prepare(`
        SELECT m.*, p.username, p.full_name, p.avatar_url, p.is_verified,
          sp.media_urls_json as shared_media_urls, sp.caption as shared_caption, sp.media_type as shared_media_type,
          sp_author.username as shared_author_username
        FROM messages m
        JOIN profiles p ON p.id = m.sender_id
        LEFT JOIN posts sp ON sp.id = m.shared_post_id
        LEFT JOIN profiles sp_author ON sp_author.id = sp.user_id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
      `)
      .all(req.params.id)
      .map((m: any) => {
        const reactions = db
          .prepare('SELECT mr.emoji, mr.user_id, pr.username FROM message_reactions mr JOIN profiles pr ON pr.id = mr.user_id WHERE mr.message_id = ?')
          .all(m.id);
        return {
          ...m,
          read_by: (() => {
            try {
              return JSON.parse(m.read_by_json || '[]');
            } catch {
              return [];
            }
          })(),
          reactions,
        };
      });

    res.json({ messages });
  });

  router.post('/chat/conversations/:id/messages', requireAuth, (req: AuthedRequest, res) => {
    const member = db
      .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(req.params.id, req.user!.id);
    if (!member) return res.status(403).json({ error: 'Access denied.' });

    const { content, mediaUrl, mediaType, sharedPostId } = req.body || {};
    const validType = ['text', 'image', 'voice', 'post_share', 'reel_share'].includes(mediaType) ? mediaType : 'text';
    if (!content && !mediaUrl && !sharedPostId) {
      return res.status(400).json({ error: 'Message content or media required.' });
    }

    const msgId = uuid();
    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, content, media_url, media_type, shared_post_id, read_by_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msgId,
      req.params.id,
      req.user!.id,
      String(content || '').slice(0, 2000),
      String(mediaUrl || ''),
      validType,
      sharedPostId || null,
      JSON.stringify([req.user!.id])
    );

    db.prepare('UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      req.params.id
    );
    db.prepare('UPDATE conversation_members SET last_read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND user_id = ?').run(
      req.params.id,
      req.user!.id
    );

    const fullMsg = db
      .prepare(`
        SELECT m.*, p.username, p.full_name, p.avatar_url, p.is_verified,
          sp.media_urls_json as shared_media_urls, sp.caption as shared_caption, sp.media_type as shared_media_type,
          sp_author.username as shared_author_username
        FROM messages m
        JOIN profiles p ON p.id = m.sender_id
        LEFT JOIN posts sp ON sp.id = m.shared_post_id
        LEFT JOIN profiles sp_author ON sp_author.id = sp.user_id
        WHERE m.id = ?
      `)
      .get(msgId) as any;

    fullMsg.reactions = [];
    fullMsg.read_by = [req.user!.id];

    const members = db
      .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
      .all(req.params.id) as { user_id: string }[];
    const memberIds = members.map((m) => m.user_id);

    realtime.emitToUsers(memberIds, 'chat:message', fullMsg);

    for (const mId of memberIds) {
      if (mId !== req.user!.id) {
        createNotification({
          userId: mId,
          actorId: req.user!.id,
          type: 'message',
          entityId: req.params.id,
          message: `@${req.user!.username} sent you a message${content ? `: "${String(content).slice(0, 40)}"` : '.'}`,
        });
      }
    }

    res.status(201).json({ message: fullMsg });
  });

  router.post('/chat/conversations/:id/read', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('UPDATE conversation_members SET last_read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND user_id = ?').run(
      req.params.id,
      req.user!.id
    );
    const members = db
      .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
      .all(req.params.id) as { user_id: string }[];
    realtime.emitToUsers(
      members.map((m) => m.user_id),
      'chat:read',
      { conversationId: req.params.id, userId: req.user!.id, readAt: new Date().toISOString() }
    );
    res.json({ read: true });
  });

  router.post('/chat/messages/:id/react', requireAuth, (req: AuthedRequest, res) => {
    const emoji = String(req.body?.emoji || '').slice(0, 12);
    if (!emoji) return res.status(400).json({ error: 'Emoji required.' });
    const msg = db.prepare('SELECT id, conversation_id FROM messages WHERE id = ?').get(req.params.id) as any;
    if (!msg) return res.status(404).json({ error: 'Message not found.' });

    const existing = db
      .prepare('SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
      .get(msg.id, req.user!.id, emoji) as any;

    if (existing) {
      db.prepare('DELETE FROM message_reactions WHERE id = ?').run(existing.id);
    } else {
      db.prepare('INSERT INTO message_reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)').run(
        uuid(),
        msg.id,
        req.user!.id,
        emoji
      );
    }

    const reactions = db
      .prepare('SELECT mr.emoji, mr.user_id, pr.username FROM message_reactions mr JOIN profiles pr ON pr.id = mr.user_id WHERE mr.message_id = ?')
      .all(msg.id);
    const members = db
      .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
      .all(msg.conversation_id) as { user_id: string }[];
    realtime.emitToUsers(
      members.map((m) => m.user_id),
      'chat:reaction',
      { messageId: msg.id, conversationId: msg.conversation_id, reactions }
    );

    res.json({ reactions });
  });

  router.delete('/chat/messages/:id', requireAuth, (req: AuthedRequest, res) => {
    const msg = db.prepare('SELECT id, conversation_id, sender_id FROM messages WHERE id = ?').get(req.params.id) as any;
    if (!msg) return res.status(404).json({ error: 'Message not found.' });
    if (msg.sender_id !== req.user!.id) return res.status(403).json({ error: 'You can only delete your own messages.' });

    db.prepare(`UPDATE messages SET is_deleted = 1, content = 'Message deleted', media_url = '' WHERE id = ?`).run(msg.id);
    const members = db
      .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
      .all(msg.conversation_id) as { user_id: string }[];
    realtime.emitToUsers(
      members.map((m) => m.user_id),
      'chat:delete',
      { messageId: msg.id, conversationId: msg.conversation_id }
    );
    res.json({ deleted: true });
  });

  // -------------------------------------------------------
  // NOTIFICATIONS, REPORTS & ANNOUNCEMENTS
  // -------------------------------------------------------
  router.get('/notifications', requireAuth, (req: AuthedRequest, res) => {
    const notifications = db
      .prepare(`
        SELECT n.*, p.username as actor_username, p.full_name as actor_name, p.avatar_url as actor_avatar, p.is_verified as actor_verified
        FROM notifications n
        LEFT JOIN profiles p ON p.id = n.actor_id
        WHERE n.user_id = ?
        ORDER BY n.created_at DESC
        LIMIT 60
      `)
      .all(req.user!.id);

    const followRequests = db
      .prepare(`
        SELECT f.id as follow_id, f.created_at, p.id as user_id, p.username, p.full_name, p.avatar_url, p.is_verified
        FROM follows f
        JOIN profiles p ON p.id = f.follower_id
        WHERE f.following_id = ? AND f.status = 'pending'
        ORDER BY f.created_at DESC
      `)
      .all(req.user!.id);

    res.json({ notifications, followRequests });
  });

  router.post('/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
    res.json({ read: true });
  });

  router.post('/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
    res.json({ readAll: true });
  });

  router.post('/reports', requireAuth, (req: AuthedRequest, res) => {
    const { targetType, targetId, reason, details } = req.body || {};
    if (!['post', 'reel', 'story', 'comment', 'user'].includes(targetType) || !targetId || !reason) {
      return res.status(400).json({ error: 'Report targetType, targetId, and reason are required.' });
    }
    const id = uuid();
    db.prepare('INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      req.user!.id,
      targetType,
      String(targetId),
      String(reason).slice(0, 120),
      String(details || '').slice(0, 600)
    );
    res.status(201).json({ reported: true, id });
  });

  router.get('/announcements/active', (_req, res) => {
    const items = db
      .prepare(`SELECT * FROM announcements WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 3`)
      .all(new Date().toISOString());
    res.json({ announcements: items });
  });

  // -------------------------------------------------------
  // APP RATINGS (POST-SIGNUP RATING GATE)
  // -------------------------------------------------------
  router.post('/ratings', requireAuth, (req: AuthedRequest, res) => {
    const rawRating = Number(req.body?.rating);
    const rating = Number.isInteger(rawRating) && rawRating >= 1 && rawRating <= 5 ? rawRating : 0;
    if (!rating) {
      return res.status(400).json({ error: 'Please select a star rating between 1 and 5.' });
    }
    const tags = Array.isArray(req.body?.tags)
      ? req.body.tags.map((t: unknown) => String(t).slice(0, 32)).slice(0, 6)
      : [];
    const feedback = String(req.body?.feedback || '').trim().slice(0, 500);

    const existing = db.prepare('SELECT id FROM app_ratings WHERE user_id = ?').get(req.user!.id) as { id: string } | undefined;
    if (existing) {
      db.prepare(`
        UPDATE app_ratings SET rating = ?, tags_json = ?, feedback = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(rating, JSON.stringify(tags), feedback, req.user!.id);
    } else {
      db.prepare(`
        INSERT INTO app_ratings (id, user_id, rating, tags_json, feedback)
        VALUES (?, ?, ?, ?, ?)
      `).run(uuid(), req.user!.id, rating, JSON.stringify(tags), feedback);
    }

    const updatedUser = sanitizeProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.user!.id));
    res.status(201).json({ success: true, user: updatedUser });
  });

  // -------------------------------------------------------
  // SUPER ADMIN COMMAND CENTER (Protected Server-Side RBAC)
  // -------------------------------------------------------
  function logAdminAction(adminId: string, action: string, targetType: string, targetId: string, details: any) {
    db.prepare(`
      INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, details_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuid(), adminId, action, targetType, targetId, JSON.stringify(details || {}));
  }

  router.get('/admin/analytics', requireAdmin, (_req, res) => {
    const totalUsers = (db.prepare('SELECT COUNT(*) as cnt FROM profiles WHERE is_demo = 0').get() as any).cnt;
    const demoUsers = (db.prepare('SELECT COUNT(*) as cnt FROM profiles WHERE is_demo = 1').get() as any).cnt;
    const activeUsers = (
      db.prepare(`SELECT COUNT(*) as cnt FROM profiles WHERE account_status = 'active' AND is_demo = 0`).get() as any
    ).cnt;
    const totalPosts = (
      db.prepare(`SELECT COUNT(*) as cnt FROM posts WHERE media_type != 'reel' AND is_removed = 0`).get() as any
    ).cnt;
    const totalReels = (
      db.prepare(`SELECT COUNT(*) as cnt FROM posts WHERE media_type = 'reel' AND is_removed = 0`).get() as any
    ).cnt;
    const totalStories = (
      db.prepare('SELECT COUNT(*) as cnt FROM stories WHERE expires_at > ?').get(new Date().toISOString()) as any
    ).cnt;
    const pendingReports = (
      db.prepare(`SELECT COUNT(*) as cnt FROM reports WHERE status = 'pending'`).get() as any
    ).cnt;

    const dailyRegistrations = db
      .prepare(`
        SELECT DATE(created_at) as day, COUNT(*) as count
        FROM profiles
        WHERE is_demo = 0
        GROUP BY DATE(created_at)
        ORDER BY day DESC
        LIMIT 14
      `)
      .all()
      .reverse();

    // Calculate actual uploads disk usage
    let storageBytes = 0;
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const item of fs.readdirSync(dir)) {
        const p = path.join(dir, item);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p);
        else storageBytes += st.size;
      }
    };
    walk(UPLOAD_ROOT);

    const ratingStats = db
      .prepare('SELECT COUNT(*) as count, COALESCE(AVG(rating), 0) as avg FROM app_ratings')
      .get() as { count: number; avg: number };

    res.json({
      metrics: {
        totalUsers,
        demoUsers,
        activeUsers,
        onlineNow: realtime.getOnlineUserIds().length,
        totalPosts,
        totalReels,
        totalStories,
        pendingReports,
        storageBytes,
        totalRatings: ratingStats.count,
        averageRating: Number((ratingStats.avg || 0).toFixed(2)),
      },
      dailyRegistrations,
    });
  });

  router.get('/admin/ratings', requireAdmin, (_req, res) => {
    const stats = db
      .prepare('SELECT COUNT(*) as total, COALESCE(AVG(rating), 0) as average FROM app_ratings')
      .get() as { total: number; average: number };
    const ratings = db
      .prepare(`
        SELECT r.*, p.username, p.full_name, p.avatar_url, p.email
        FROM app_ratings r
        JOIN profiles p ON p.id = r.user_id
        ORDER BY r.updated_at DESC
        LIMIT 100
      `)
      .all()
      .map((r: any) => ({
        ...r,
        tags: (() => {
          try {
            return JSON.parse(r.tags_json || '[]');
          } catch {
            return [];
          }
        })(),
      }));
    res.json({
      totalRatings: stats.total,
      averageRating: Number((stats.average || 0).toFixed(2)),
      ratings,
    });
  });

  router.get('/admin/users', requireAdmin, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const like = `%${q}%`;

    const rows = db
      .prepare(`
        SELECT * FROM profiles
        WHERE is_demo = 0
          AND (LOWER(username) LIKE ? OR LOWER(full_name) LIKE ? OR LOWER(COALESCE(email, '')) LIKE ?)
        ORDER BY CASE role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at DESC
        LIMIT 100
      `)
      .all(like, like, like);

    res.json({ users: rows.map(sanitizeProfile) });
  });

  router.post('/admin/users/:id/action', requireAdmin, (req: AuthedRequest, res) => {
    const { action } = req.body || {};
    const target = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id) as any;
    if (!target) return res.status(404).json({ error: 'User not found.' });

    // Critical security lock: nobody can ban, suspend, or demote the Super Admin!
    if (target.role === 'super_admin' || (target.email && target.email.toLowerCase() === SUPER_ADMIN_EMAIL)) {
      if (['ban', 'suspend', 'demote'].includes(action)) {
        return res.status(403).json({ error: 'Security violation: Super Admin cannot be banned, suspended, or demoted.' });
      }
    }

    if (action === 'verify') {
      db.prepare('UPDATE profiles SET is_verified = 1 WHERE id = ?').run(target.id);
    } else if (action === 'unverify') {
      db.prepare('UPDATE profiles SET is_verified = 0 WHERE id = ?').run(target.id);
    } else if (action === 'ban') {
      db.prepare(`UPDATE profiles SET account_status = 'banned' WHERE id = ?`).run(target.id);
    } else if (action === 'suspend') {
      db.prepare(`UPDATE profiles SET account_status = 'suspended' WHERE id = ?`).run(target.id);
    } else if (action === 'activate') {
      db.prepare(`UPDATE profiles SET account_status = 'active' WHERE id = ?`).run(target.id);
    } else if (action === 'promote' || action === 'demote') {
      if (req.user!.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only Super Admin can change admin roles.' });
      }
      db.prepare('UPDATE profiles SET role = ? WHERE id = ?').run(action === 'promote' ? 'admin' : 'user', target.id);
    } else {
      return res.status(400).json({ error: 'Unknown admin action.' });
    }

    logAdminAction(req.user!.id, `user:${action}`, 'user', target.id, { username: target.username });
    res.json({ user: sanitizeProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(target.id)) });
  });

  router.get('/admin/content', requireAdmin, (_req, res) => {
    const posts = db
      .prepare(`
        SELECT p.*, pr.username, pr.full_name, pr.avatar_url
        FROM posts p JOIN profiles pr ON pr.id = p.user_id
        ORDER BY p.created_at DESC LIMIT 80
      `)
      .all()
      .map((r: any) => sanitizePost(r));
    const stories = db
      .prepare(`
        SELECT s.*, pr.username, pr.avatar_url
        FROM stories s JOIN profiles pr ON pr.id = s.user_id
        ORDER BY s.created_at DESC LIMIT 40
      `)
      .all();
    const comments = db
      .prepare(`
        SELECT c.*, pr.username
        FROM comments c JOIN profiles pr ON pr.id = c.user_id
        ORDER BY c.created_at DESC LIMIT 50
      `)
      .all();
    res.json({ posts, stories, comments });
  });

  router.post('/admin/content/:type/:id/action', requireAdmin, (req: AuthedRequest, res) => {
    const { type, id } = req.params;
    const { action } = req.body || {};
    if (type === 'post' || type === 'reel') {
      if (action === 'feature') db.prepare('UPDATE posts SET is_featured = 1 WHERE id = ?').run(id);
      else if (action === 'unfeature') db.prepare('UPDATE posts SET is_featured = 0 WHERE id = ?').run(id);
      else if (action === 'remove') db.prepare('UPDATE posts SET is_removed = 1 WHERE id = ?').run(id);
      else if (action === 'restore') db.prepare('UPDATE posts SET is_removed = 0 WHERE id = ?').run(id);
    } else if (type === 'story' && action === 'remove') {
      db.prepare('DELETE FROM stories WHERE id = ?').run(id);
    } else if (type === 'comment' && action === 'remove') {
      db.prepare('UPDATE comments SET is_removed = 1 WHERE id = ?').run(id);
    } else {
      return res.status(400).json({ error: 'Invalid moderation action.' });
    }
    logAdminAction(req.user!.id, `content:${action}`, type, id, {});
    res.json({ ok: true });
  });

  router.get('/admin/reports', requireAdmin, (_req, res) => {
    const reports = db
      .prepare(`
        SELECT r.*, p.username as reporter_username
        FROM reports r
        JOIN profiles p ON p.id = r.reporter_id
        ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
        LIMIT 80
      `)
      .all();
    res.json({ reports });
  });

  router.post('/admin/reports/:id/resolve', requireAdmin, (req: AuthedRequest, res) => {
    const status = ['resolved', 'dismissed', 'reviewed'].includes(req.body?.status) ? req.body.status : 'resolved';
    db.prepare('UPDATE reports SET status = ?, reviewed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      status,
      req.user!.id,
      req.params.id
    );
    logAdminAction(req.user!.id, `report:${status}`, 'report', req.params.id, {});
    res.json({ ok: true });
  });

  router.get('/admin/announcements', requireAdmin, (_req, res) => {
    const rows = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 30').all();
    res.json({ announcements: rows });
  });

  router.post('/admin/announcements', requireAdmin, (req: AuthedRequest, res) => {
    const { title, body, bannerType } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: 'Title and message body are required.' });
    const id = uuid();
    const bType = ['info', 'warning', 'festival'].includes(bannerType) ? bannerType : 'info';

    db.prepare(`INSERT INTO announcements (id, title, body, banner_type, created_by, is_active) VALUES (?, ?, ?, ?, ?, 1)`).run(
      id,
      String(title).slice(0, 100),
      String(body).slice(0, 400),
      bType,
      req.user!.id
    );

    const ann = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    // Notify all active real users
    const users = db.prepare(`SELECT id FROM profiles WHERE account_status = 'active' AND is_demo = 0`).all() as { id: string }[];
    for (const u of users) {
      createNotification({
        userId: u.id,
        actorId: req.user!.id,
        type: 'admin_announcement',
        entityId: id,
        message: `${title}: ${body}`,
      });
    }
    realtime.broadcast('announcement:new', ann);
    logAdminAction(req.user!.id, 'announcement:broadcast', 'announcement', id, { title });
    res.status(201).json({ announcement: ann });
  });

  router.post('/admin/announcements/:id/toggle', requireAdmin, (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT is_active FROM announcements WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Announcement not found.' });
    const next = row.is_active ? 0 : 1;
    db.prepare('UPDATE announcements SET is_active = ? WHERE id = ?').run(next, req.params.id);
    res.json({ is_active: next });
  });

  router.get('/admin/audit-logs', requireAdmin, (_req, res) => {
    const logs = db
      .prepare(`
        SELECT l.*, p.username as admin_username
        FROM admin_audit_logs l
        JOIN profiles p ON p.id = l.admin_id
        ORDER BY l.created_at DESC
        LIMIT 100
      `)
      .all();
    res.json({ logs });
  });

  app.use('/api', router);
}
