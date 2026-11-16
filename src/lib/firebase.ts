import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { UserProfile } from '../types.ts';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export function initFirebaseGoogleAuthProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

export const googleProvider = initFirebaseGoogleAuthProvider();

const SUPABASE_SESSION_KEY = 'desivibe_supabase_session';

export interface SupabaseSessionExchangeResult {
  synced: boolean;
  isNewUser?: boolean;
  firebaseUid?: string;
  profile?: unknown;
  session?: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    user?: unknown;
  } | null;
}

export function getSupabaseSession(): SupabaseSessionExchangeResult['session'] | null {
  try {
    const raw = localStorage.getItem(SUPABASE_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSupabaseSession() {
  try {
    localStorage.removeItem(SUPABASE_SESSION_KEY);
  } catch {
    // Ignore storage errors
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();

export async function signInWithGooglePopup() {
  const credential = await signInWithPopup(auth, googleProvider);
  const user = credential.user;
  if (!user.email) {
    throw new Error('Google account did not provide a valid email address.');
  }
  const idToken = await user.getIdToken();
  return {
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName || user.email.split('@')[0],
    photoURL: user.photoURL || '',
    idToken,
  };
}

/**
 * Exchanges a Firebase user ID token for a Supabase session token via the
 * firebase-auth-sync Edge Function so Firebase & Supabase stay synchronized.
 */
export async function exchangeFirebaseTokenForSupabaseSession(
  firebaseIdToken?: string
): Promise<SupabaseSessionExchangeResult | null> {
  const token = firebaseIdToken || (await auth.currentUser?.getIdToken());
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !anonKey || !token) return null;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/firebase-auth-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ idToken: token }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as SupabaseSessionExchangeResult;
    if (data.session?.access_token) {
      try {
        localStorage.setItem(SUPABASE_SESSION_KEY, JSON.stringify(data.session));
      } catch {
        // Ignore storage quota errors
      }
    }
    return data;
  } catch {
    return null;
  }
}

export async function syncWithSupabaseEdge(idToken: string) {
  return exchangeFirebaseTokenForSupabaseSession(idToken);
}

export async function signOutFirebase() {
  clearSupabaseSession();
  try {
    if (auth.currentUser) {
      await signOut(auth);
    }
  } catch {
    // Ignore signout errors when no Firebase session exists
  }
}

function sanitizeUsernameForFirestore(username: string) {
  const cleaned = username.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 30);
  return cleaned.length >= 3 ? cleaned : `vibe_${cleaned || 'user'}`;
}

export async function syncUserToFirestore(profile: UserProfile, isNewUser: boolean) {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;

  const uid = fbUser.uid;
  const userDocPath = `users/${uid}`;
  const privateDocPath = `users/${uid}/private/info`;
  const isBootstrappedAdmin =
    fbUser.email?.toLowerCase() === 'rishabhjaiswal335@gmail.com' && fbUser.emailVerified;

  try {
    const batch = writeBatch(db);
    const now = serverTimestamp();

    if (isNewUser) {
      batch.set(doc(db, 'users', uid), {
        uid,
        username: sanitizeUsernameForFirestore(profile.username),
        fullName: (profile.full_name || profile.username).slice(0, 60),
        bio: (profile.bio || '').slice(0, 240),
        vibeStatus: (profile.vibe_status || 'Vibing on DesiVibe').slice(0, 80),
        avatarUrl: (profile.avatar_url || '').slice(0, 500),
        isVerified: isBootstrappedAdmin ? Boolean(profile.is_verified) : false,
        role: isBootstrappedAdmin ? profile.role : 'user',
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      batch.set(doc(db, 'users', uid, 'private', 'info'), {
        uid,
        email: (fbUser.email || profile.email || '').slice(0, 160),
        phone: (profile.phone || '').slice(0, 32),
        hasRated: Boolean(profile.has_rated),
        createdAt: now,
        updatedAt: now,
      });

      if (!isBootstrappedAdmin) {
        const followId = `${uid}_super_admin`;
        batch.set(doc(db, 'follows', followId), {
          followerId: uid,
          followingId: 'super-admin-rishabh',
          status: 'accepted',
          createdAt: now,
          updatedAt: now,
        });
      }
    } else {
      batch.set(
        doc(db, 'users', uid),
        {
          uid,
          username: sanitizeUsernameForFirestore(profile.username),
          fullName: (profile.full_name || profile.username).slice(0, 60),
          bio: (profile.bio || '').slice(0, 240),
          vibeStatus: (profile.vibe_status || 'Vibing on DesiVibe').slice(0, 80),
          avatarUrl: (profile.avatar_url || '').slice(0, 500),
          isVerified: isBootstrappedAdmin ? Boolean(profile.is_verified) : false,
          role: isBootstrappedAdmin ? profile.role : 'user',
          followersCount: Math.max(0, Math.floor(profile.followers_count || 0)),
          followingCount: Math.max(0, Math.floor(profile.following_count || 0)),
          postsCount: Math.max(0, Math.floor(profile.posts_count || 0)),
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    await batch.commit();
  } catch (err) {
    // Only surface if it's a permission issue during active Firebase auth
    if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
      handleFirestoreError(err, OperationType.WRITE, `${userDocPath} | ${privateDocPath}`);
    }
  }
}

export async function syncAppRatingToFirestore(params: {
  username: string;
  rating: number;
  tags: string[];
  feedback: string;
}) {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;

  const uid = fbUser.uid;
  const ratingPath = `app_ratings/${uid}`;
  try {
    const batch = writeBatch(db);
    const now = serverTimestamp();

    batch.set(doc(db, 'app_ratings', uid), {
      userId: uid,
      username: params.username.slice(0, 40) || 'creator',
      rating: Math.min(5, Math.max(1, Math.round(params.rating))),
      tags: params.tags.map((t) => t.slice(0, 32)).slice(0, 6),
      feedback: params.feedback.slice(0, 500),
      createdAt: now,
      updatedAt: now,
    });

    await batch.commit();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
      handleFirestoreError(err, OperationType.WRITE, ratingPath);
    }
  }
}
