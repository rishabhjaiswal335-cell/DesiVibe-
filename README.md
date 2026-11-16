# DesiVibe – Your People. Your Culture. Your Vibe.

Made by **Rishabh Jaiswal** · Super Admin: `rishabhjaiswal335@gmail.com`

DesiVibe is a cross-platform social media ecosystem combining a responsive Web application, real-time WebSocket & Express/SQLite server (plus full Supabase PostgreSQL/Realtime/Storage/Edge Function definitions), an Admin Command Center, and an Expo React Native mobile app for Android and iOS.

---

## Project Structure

- `/server.ts` & `/server/` — Full-stack Express + WebSocket (`ws`) + SQLite (22 tables, atomic counter triggers, rate limiting, scrypt + HMAC JWT auth, media buckets, 24h story expiration sweep)
- `/src/` — Responsive Web Application & Super Admin Command Center (`React 19`, `TypeScript`, `Tailwind CSS v4`, `motion`)
- `/supabase/` — Complete PostgreSQL 22-table migrations (`001_desivibe_schema.sql`), Row Level Security (`002_rls_policies.sql`), Storage Buckets (`003_storage_buckets.sql`), and Deno Edge Functions (`expire-stories`, `admin-actions`)
- `/mobile/` — Cross-platform React Native + Expo Router + Zustand + React Query Android & iOS mobile app

---

## 1. Local & Web Installation

```bash
npm install
cp .env.example .env
npm run dev
```

The live Web App + API + WebSocket server runs on `http://localhost:3000`.

### Production Web Build & Start

```bash
npm run build
NODE_ENV=production npm start
```

---

## 2. Supabase Cloud Backend Setup

1. Create a Supabase project at `https://supabase.com`.
2. Run the SQL migrations in order inside the Supabase SQL Editor (or via `supabase db push`):
   - `supabase/migrations/001_desivibe_schema.sql`
   - `supabase/migrations/002_rls_policies.sql`
   - `supabase/migrations/003_storage_buckets.sql`
3. Deploy Edge Functions:
   ```bash
   supabase functions deploy expire-stories
   supabase functions deploy admin-actions
   ```
4. Schedule `expire-stories` via Supabase Cron (`0 * * * *`) to purge expired 24-hour stories and delete storage objects.
5. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env`.

---

## 3. Secure Super Admin Provisioning

- `rishabhjaiswal335@gmail.com` is provisioned **strictly server-side** (`SUPER_ADMIN_EMAIL`) with `role = 'super_admin'` and `is_verified = 1`.
- No admin password is ever hardcoded in frontend code. Sign up or sign in with `rishabhjaiswal335@gmail.com` (or use Forgot Password / Google sign-in) to claim the Super Admin account and unlock the **Admin Command Center**.
- Server-side middleware (`requireAdmin`, `requireSuperAdmin`) and database protections prevent any ordinary admin or user from banning, suspending, or demoting the Super Admin.

---

## 4. Android Build Instructions (Expo EAS)

```bash
cd mobile
npm install
npx eas login
npx eas build --platform android --profile preview   # Generates .apk for testing
npx eas build --platform android --profile production # Generates .aab for Google Play
```

---

## 5. iOS Build Instructions (Expo EAS)

```bash
cd mobile
npm install
npx eas build --platform ios --profile preview        # Internal TestFlight / Simulator
npx eas build --platform ios --profile production     # App Store Connect submission
```

---

## 6. Testing Checklist

1. **Authentication**: Sign up with a new email + live username availability check, test Phone OTP login, Google login, and Forgot/Reset password.
2. **Home Feed & VibeStories**: Double-tap a post for the heart-burst animation, open nested comments and reply, bookmark a post, tap a story ring to view 24h stories with tap navigation & direct replies.
3. **Create Studio**: Open Create (`+`), select or capture a photo/video/story/reel, apply a color grade filter, add `#hashtags`, publish, and verify live WebSocket feed update.
4. **VibeReels & Explore**: Switch to VibeReels to see public reels from all registered users; search users/hashtags/audio in Explore.
5. **VibeChat**: Send real-time messages, image attachments, voice notes, emoji reactions, and verify typing indicators & online presence across two browser windows.
6. **Admin Command Center**: Sign in as `rishabhjaiswal335@gmail.com` to access live analytics, user verification/moderation, report resolution, global announcements, and audit logs.
