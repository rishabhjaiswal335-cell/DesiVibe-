# DesiVibe Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Identity Integrity**: Every document created in `/users/{userId}`, `/users/{userId}/private/info`, `/app_ratings/{userId}`, or `/follows/{followId}` must tie the owner/author UID (`uid`, `userId`, `followerId`) strictly to `request.auth.uid`, with `request.auth.token.email_verified == true`.
2. **Zero Self-Assigned Privilege**: Users creating their own `/users/{userId}` document cannot assign `role: 'admin'` or `'super_admin'` or `isVerified: true` unless they pass `isAdmin()` (which verifies `request.auth.token.email == 'rishabhjaiswal335@gmail.com' && request.auth.token.email_verified == true` or trusted `/admins/{uid}`).
3. **PII Isolation (Split Collection)**: Emails and phone numbers are stored strictly in `/users/{userId}/private/info` and are readable ONLY by `isOwner(userId)` or `isAdmin()`. Public profiles `/users/{userId}` contain zero PII.
4. **Master Gate Relational Sync**: `/users/{userId}/private/{docId}` requires the parent `/users/{userId}` document to exist (`exists(...) || existsAfter(...)` in a batch).
5. **Temporal Integrity**: All `createdAt` and `updatedAt` timestamps must equal `request.time`. `createdAt` is immutable on update.
6. **Rating Bounds & Unbounded Array Guard**: `app_ratings` `rating` must be an integer `1..5`, `feedback` <= 500 chars, and `tags` list size <= 6 with first-element type/size check.
7. **ID Poisoning & Shadow Field Defense**: All path IDs pass `isValidId()`, all strings enforce `.size()` bounds, and all creates/updates enforce `keys().hasAll(...) && keys().hasOnly(...)` plus `affectedKeys().hasOnly(...)`.
8. **Query Enforcer**: `allow list` never permits blanket `isSignedIn()` reads; every `list` rule evaluates `resource.data` against `request.auth.uid`, `isActive == true`, or `isAdmin()`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Rating Write**: Anonymous client writes to `/app_ratings/attacker123`.
2. **Privilege Escalation on Signup**: Non-admin user creates `/users/{uid}` with `role: 'super_admin', isVerified: true`.
3. **Shadow Field Injection**: Authenticated user updates `/users/{uid}` adding ghost field `isVerified: true` or `adminOverride: true`.
4. **PII Blanket Read**: User A attempts `getDoc` on `/users/userB/private/info`.
5. **Email Spoofing Attack**: User with `token.email == 'rishabhjaiswal335@gmail.com'` and `email_verified: false` tries to list `/app_ratings`.
6. **Impersonated Rating**: User A writes `/app_ratings/userB` or sets `userId: 'userB'`.
7. **Out-of-Bounds Rating**: User writes `/app_ratings/{uid}` with `rating: 99` or `rating: "5"`.
8. **Unbounded Array / Denial-of-Wallet**: User writes `tags: [1, 2, ... 50 items]` or `feedback` > 500 chars.
9. **ID Poisoning**: User targets `/follows/${'a'.repeat(500)}` or `/follows/bad$id`.
10. **Client-Forged Timestamp**: User creates `/app_ratings/{uid}` with `createdAt: new Date('2020-01-01')` instead of `serverTimestamp()`.
11. **Self-Follow / Impersonated Follow**: User A creates `/follows/f1` with `followerId: 'userB'` or `followingId: userA`.
12. **Blanket User List Scraping**: Non-admin user runs `getDocs(collection(db, 'users'))` without scoping to their own `uid`.
