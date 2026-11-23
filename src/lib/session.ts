import crypto from 'crypto';
import { cookies } from 'next/headers';
import { isLocalDbEnabled } from './local-db';
import type { SessionPayload } from './types';

export const SESSION_COOKIE_NAME = 'bara_coffee_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 hari

function getSecret(): string {
  const secret =
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    (isLocalDbEnabled() ? 'bara-coffee-local-dummy-session-secret-key-2026' : '');
  if (!secret) {
    throw new Error('SESSION_SECRET belum dikonfigurasi di environment variables.');
  }
  return secret;
}

function sign(data: string): string {
  return crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
}

export function createSessionToken(payload: Omit<SessionPayload, 'exp'>): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = sign(encoded);
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = sign(encoded);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    if (parsed.role !== 'owner' && parsed.role !== 'outlet' && parsed.role !== 'crew') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export async function setSessionCookie(payload: Omit<SessionPayload, 'exp'>): Promise<void> {
  const token = createSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && !isLocalDbEnabled(),
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export function safeComparePin(inputPin: string, storedPin: string): boolean {
  const a = Buffer.from(String(inputPin || '').trim());
  const b = Buffer.from(String(storedPin || '').trim());
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
