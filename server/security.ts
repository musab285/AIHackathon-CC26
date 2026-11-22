import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { ConsentScope, UserPublic, UserRecord, UserRole } from '../src/shared/types';

// In-memory cryptographic fallback when JWT_SECRET env var is unset (never hardcoded)
const TOKEN_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16
  ? process.env.JWT_SECRET
  : crypto.randomBytes(32).toString('hex');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  name: string;
  iat: number;
  exp: number;
}

export function signAuthToken(user: UserPublic): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    iat: now,
    exp: now + 60 * 60 * 12, // 12h hackathon demo session
  };
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const bodyB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64url');
  return `${headerB64}.${bodyB64}.${sig}`;
}

export function verifyAuthToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, sigB64] = parts;
  const expectedSig = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64url');
  const actualBuf = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (actualBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(actualBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function toPublicUser(user: UserRecord): UserPublic {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
  };
}

// Per-key sliding-window rate limiter (used for POST /v1/check and login)
const rateWindows = new Map<string, number[]>();

export function checkRateLimit(bucketKey: string, limitPerMin: number): {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
} {
  const now = Date.now();
  const windowStart = now - 60_000;
  const timestamps = (rateWindows.get(bucketKey) ?? []).filter((ts) => ts > windowStart);

  if (timestamps.length >= limitPerMin) {
    const oldest = timestamps[0] ?? now;
    const resetInSeconds = Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000));
    rateWindows.set(bucketKey, timestamps);
    return { allowed: false, remaining: 0, resetInSeconds };
  }

  timestamps.push(now);
  rateWindows.set(bucketKey, timestamps);
  return {
    allowed: true,
    remaining: Math.max(0, limitPerMin - timestamps.length),
    resetInSeconds: 60,
  };
}

export interface AuthedRequest extends Request {
  user?: UserPublic;
}

export function createAuthMiddleware(getUserById: (id: string) => UserRecord | undefined) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required. Provide Authorization: Bearer token.' });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    const payload = verifyAuthToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Invalid or expired session token.' });
      return;
    }
    const user = getUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: 'User account no longer exists.' });
      return;
    }
    req.user = toPublicUser(user);
    next();
  };
}

export function requireRoles(...allowedRoles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Access denied for role "${req.user.role}". Permitted roles: ${allowedRoles.join(', ')}.`,
      });
      return;
    }
    next();
  };
}

export type ConsentChecker = (params: {
  subjectType: 'user' | 'family';
  subjectId: string;
  scope: ConsentScope;
}) => boolean;
