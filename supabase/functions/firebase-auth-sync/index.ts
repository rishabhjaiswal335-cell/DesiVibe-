// Supabase Edge Function: Verify Firebase Identity Token & Sync with Supabase Auth + Profiles
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPER_ADMIN_EMAIL = 'rishabhjaiswal335@gmail.com';
const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') ?? 'gen-lang-client-0065296231';
const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface FirebaseClaims {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

function base64UrlToUint8Array(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed Firebase identity token.');

  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(headerB64)));
  const claims: FirebaseClaims = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(payloadB64)));

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Invalid Firebase token header.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== FIREBASE_PROJECT_ID) {
    throw new Error('Firebase token audience mismatch.');
  }
  if (claims.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
    throw new Error('Firebase token issuer mismatch.');
  }
  if (!claims.sub || claims.exp <= now) {
    throw new Error('Firebase token expired or missing subject.');
  }

  const jwksRes = await fetch(JWKS_URL);
  if (!jwksRes.ok) throw new Error('Unable to fetch Google JWK set.');
  const { keys } = await jwksRes.json();
  const jwk = keys.find((k: { kid: string }) => k.kid === header.kid);
  if (!jwk) throw new Error('Matching Google public key not found.');

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToUint8Array(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );
  if (!ok) throw new Error('Invalid Firebase identity token signature.');

  return claims;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const { idToken } = await req.json();
    if (!idToken) {
      return new Response(JSON.stringify({ error: 'Firebase idToken is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const claims = await verifyFirebaseIdToken(String(idToken));
    const email = (claims.email || '').toLowerCase().trim();
    if (!email) {
      return new Response(JSON.stringify({ error: 'Verified email missing in Firebase token.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Find or provision user in Supabase Auth
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, username, role, is_verified')
      .ilike('email', email)
      .maybeSingle();

    let userId = existingProfile?.id;
    let isNewUser = false;

    if (!userId) {
      isNewUser = true;
      const baseUsername = email.split('@')[0].replace(/[^a-z0-9._]/g, '').slice(0, 20) || 'creator';
      const generatedUsername = `${baseUsername}_${claims.sub.slice(0, 4).toLowerCase()}`;
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          username: generatedUsername,
          full_name: claims.name || generatedUsername,
          avatar_url: claims.picture || '',
          firebase_uid: claims.sub,
        },
      });
      if (createErr || !created.user) {
        throw new Error(createErr?.message || 'Failed to sync user into Supabase Auth.');
      }
      userId = created.user.id;
    }

    // Ensure Super Admin role & profile freshness
    const isSuper = email === SUPER_ADMIN_EMAIL;
    await supabaseAdmin
      .from('profiles')
      .update({
        avatar_url: claims.picture || undefined,
        full_name: claims.name || undefined,
        role: isSuper ? 'super_admin' : undefined,
        is_verified: isSuper ? true : undefined,
      })
      .eq('id', userId);

    // Ensure new user automatically follows Super Admin (rishabhjaiswal335@gmail.com)
    if (!isSuper) {
      const { data: adminProfile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .ilike('email', SUPER_ADMIN_EMAIL)
        .maybeSingle();

      if (adminProfile?.id && adminProfile.id !== userId) {
        await supabaseAdmin
          .from('follows')
          .upsert(
            { follower_id: userId, following_id: adminProfile.id, status: 'accepted' },
            { onConflict: 'follower_id,following_id' }
          );
      }
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    // Exchange verified identity for a real Supabase session (access_token + refresh_token)
    let sessionPayload: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      user: unknown;
    } | null = null;

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (supabaseUrl && supabaseAnonKey) {
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email,
      });

      const hashedToken = linkData?.properties?.hashed_token;
      if (!linkErr && hashedToken) {
        const supabasePublic = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: otpData, error: otpErr } = await supabasePublic.auth.verifyOtp({
          token_hash: hashedToken,
          type: 'magiclink',
        });
        if (!otpErr && otpData?.session) {
          sessionPayload = {
            access_token: otpData.session.access_token,
            refresh_token: otpData.session.refresh_token,
            expires_in: otpData.session.expires_in,
            token_type: otpData.session.token_type,
            user: otpData.session.user,
          };
        }
      }
    }

    return new Response(
      JSON.stringify({
        synced: true,
        isNewUser,
        firebaseUid: claims.sub,
        profile,
        session: sessionPayload,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Firebase sync failed' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }
    );
  }
});
