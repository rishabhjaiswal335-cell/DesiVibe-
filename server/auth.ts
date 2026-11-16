import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { db, SUPER_ADMIN_EMAIL } from './db.ts';

const JWT_SECRET = process.env.DESIVIBE_JWT_SECRET || crypto.createHash('sha256').update(`desivibe-local-${process.cwd()}`).digest('hex');

function getFirebaseProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.projectId) return cfg.projectId;
    }
  } catch {
    // Ignore read error
  }
  return '';
}

let cachedGoogleCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function fetchGoogleFirebaseCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedGoogleCerts && cachedGoogleCerts.expiresAt > now) {
    return cachedGoogleCerts.certs;
  }
  const res = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!res.ok) {
    throw new Error('Failed to fetch Google Firebase public certificates.');
  }
  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const ttlMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600_000;
  cachedGoogleCerts = { certs, expiresAt: now + ttlMs };
  return certs;
}

export interface VerifiedFirebaseToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseToken> {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase identity token.');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported Firebase token algorithm.');
  }

  const projectId = getFirebaseProjectId();
  const nowSec = Math.floor(Date.now() / 1000);
  if (projectId) {
    if (payload.aud !== projectId) {
      throw new Error('Firebase token audience mismatch.');
    }
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
      throw new Error('Firebase token issuer mismatch.');
    }
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Firebase token missing subject UID.');
  }
  if (!payload.exp || payload.exp <= nowSec) {
    throw new Error('Firebase identity token has expired.');
  }

  const certs = await fetchGoogleFirebaseCerts();
  const cert = certs[header.kid];
  if (!cert) {
    throw new Error('Unable to locate matching Firebase signing certificate.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const valid = verifier.verify(cert, Buffer.from(sigB64, 'base64url'));
  if (!valid) {
    throw new Error('Invalid Firebase identity token signature.');
  }

  return {
    uid: payload.sub,
    email: String(payload.email || '').toLowerCase().trim(),
    emailVerified: Boolean(payload.email_verified),
    name: String(payload.name || ''),
    picture: String(payload.picture || ''),
  };
}

export async function syncFirebaseTokenWithSupabase(idToken: string): Promise<{ synced: boolean; reason?: string }> {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !serviceKey) {
    return { synced: false, reason: 'Supabase credentials not set in local environment.' };
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/firebase-auth-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) {
      return { synced: false, reason: `Supabase edge sync returned ${res.status}` };
    }
    return { synced: true };
  } catch (err: any) {
    return { synced: false, reason: err?.message || 'Supabase sync unreachable' };
  }
}

export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  role: 'user' | 'admin' | 'super_admin';
  account_status: 'active' | 'suspended' | 'banned';
  is_verified: number;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function signToken(payload: { sub: string; role: string }): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30 days persistent session
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): { sub: string; role: string; exp: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expected = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function resolveUserFromToken(token?: string | null): AuthUser | null {
  if (!token) return null;
  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  const payload = verifyToken(cleanToken);
  if (!payload?.sub) return null;

  const row = db
    .prepare('SELECT id, username, email, role, account_status, is_verified FROM profiles WHERE id = ?')
    .get(payload.sub) as AuthUser | undefined;

  if (!row) return null;

  // Enforce server-side Super Admin privilege for designated email
  if (row.email && row.email.toLowerCase() === SUPER_ADMIN_EMAIL && row.role !== 'super_admin') {
    db.prepare(`UPDATE profiles SET role = 'super_admin', is_verified = 1, account_status = 'active' WHERE id = ?`).run(row.id);
    row.role = 'super_admin';
    row.is_verified = 1;
    row.account_status = 'active';
  }

  return row;
}

export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const user = resolveUserFromToken(authHeader);
  if (user && user.account_status === 'active') {
    req.user = user;
  }
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const user = resolveUserFromToken(authHeader);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  if (user.account_status === 'banned') {
    return res.status(403).json({ error: 'This account has been banned by moderation.' });
  }
  if (user.account_status === 'suspended') {
    return res.status(403).json({ error: 'This account is currently suspended.' });
  }
  req.user = user;
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'super_admin')) {
      return res.status(403).json({ error: 'Forbidden: Admin privileges required.' });
    }
    next();
  });
}

export function requireSuperAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden: Super Admin privileges required.' });
    }
    next();
  });
}

// Simple in-memory rate limiter for auth & write routes
const rateBucket = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests = 60, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip || 'local'}:${req.path}`;
    const now = Date.now();
    const entry = rateBucket.get(key);
    if (!entry || entry.resetAt <= now) {
      rateBucket.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    entry.count += 1;
    next();
  };
}
