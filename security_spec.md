# Security Specification — Relief Message Checker Firestore Rules

## 1. Data Invariants
1. **Default Deny**: Every unmatched path under `/databases/{database}/documents` is denied for read and write.
2. **Owner Isolation & PII Protection**: `/users/{userId}`, `/cloud_cases/{caseId}`, and `/cloud_consents/{consentId}` are readable only by their verified owner (`request.auth.uid == ownerUid` / `userId`) or a verified admin (`mmak.lughat@gmail.com` with `email_verified == true`). No blanket `isSignedIn()` reads or list queries exist.
3. **No Self-Assigned Admin Privileges**: Users creating `/users/{userId}` can only assign non-privileged roles (`citizen` or `helper`) and cannot modify `role` or `uid` on update.
4. **Immutable Terminal Cases**: Once a `cloud_cases` document reaches `status == 'closed'`, non-admin updates are strictly blocked.
5. **Temporal Integrity**: All `createdAt` and `updatedAt` fields must equal `request.time` on create/update; `createdAt` and `ownerUid` are immutable on update.
6. **Strict Key & Size Enforcement**: Every string field enforces `.size()` limits, every ID matches `^[a-zA-Z0-9_\-]+$`, and shadow/ghost fields are rejected via `hasOnly()`.

## 2. The "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated read of `/cloud_cases/CASE-1`**: `auth: null` -> DENIED.
2. **Cross-user read of `/users/otherUid`**: `auth.uid: "userA"` reading `/users/userB` -> DENIED.
3. **Self-assigned admin role on create**: `/users/userA` with `{ role: "admin", ... }` -> DENIED.
4. **Role privilege escalation on update**: Updating `role` from `"citizen"` to `"officer"` -> DENIED.
5. **Shadow field injection on case create**: `/cloud_cases/CASE-1` including extra ghost field `isVerified: true` -> DENIED (`hasOnly`).
6. **Identity spoofing on case create**: `auth.uid: "userA"` setting `ownerUid: "userB"` -> DENIED.
7. **Unverified admin email spoofing**: `email: "mmak.lughat@gmail.com"`, `email_verified: false` -> DENIED.
8. **ID poisoning attack**: Document ID containing 200+ junk characters or special symbols -> DENIED (`isValidId`).
9. **Denial-of-Wallet oversized message**: `redactedMessage` > 2500 characters -> DENIED.
10. **Client-forged timestamp**: `createdAt` set to a past date instead of `request.time` -> DENIED.
11. **Mutating terminal closed case**: Non-admin attempting to update `status` after `existing().status == 'closed'` -> DENIED.
12. **Blanket list query scraping**: Listing `/cloud_cases` without matching `resource.data.ownerUid == request.auth.uid` -> DENIED.
