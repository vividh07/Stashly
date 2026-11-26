import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '../env';
import { sessionTtlSeconds } from '../env';
import { getDatabase } from '../db';
import { createSessionToken, sha256Hex, verifySessionToken, randomId } from '../lib/crypto';
import { unauthorized } from '../lib/errors';
import type { SessionRecord } from '../db/types';

export const SESSION_COOKIE = 'vault_session';
export const CSRF_COOKIE = 'vault_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export async function resolveSession(
  env: Bindings,
  cookieHeader: string | undefined,
): Promise<{ userId: string; sessionId: string; userEmail: string } | null> {
  const token = getCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;

  const payload = await verifySessionToken(env.JWT_SECRET, token);
  if (!payload) return null;

  const db = await getDatabase(env);
  const session = await db.findSessionById(payload.sid);
  if (!session || session.userId !== payload.uid) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await db.deleteSession(session._id);
    return null;
  }

  const tokenHash = await sha256Hex(token);
  if (tokenHash !== session.tokenHash) return null;

  const user = await db.findUserById(payload.uid);
  return {
    userId: payload.uid,
    sessionId: payload.sid,
    userEmail: user?.email || '',
  };
}

export const requireAuth = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const session = await resolveSession(c.env, c.req.header('cookie'));
    if (!session) throw unauthorized();
    c.set('userId', session.userId);
    c.set('sessionId', session.sessionId);
    c.set('userEmail', session.userEmail);
    await next();
  },
);

export async function issueSession(
  env: Bindings,
  userId: string,
  meta?: { userAgent?: string; ip?: string },
) {
  const db = await getDatabase(env);
  const sid = randomId(18);
  const ttl = sessionTtlSeconds(env);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const token = await createSessionToken(env.JWT_SECRET, { sid, uid: userId, exp });
  const tokenHash = await sha256Hex(token);
  const session: SessionRecord = {
    _id: sid,
    userId,
    tokenHash,
    expiresAt: new Date(exp * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    userAgent: meta?.userAgent,
    ipHash: meta?.ip ? await sha256Hex(meta.ip) : undefined,
  };
  await db.createSession(session);
  const csrf = randomId(24);
  return { token, csrf, expiresAt: session.expiresAt, maxAge: ttl };
}

export function getCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function setCookie(
  name: string,
  value: string,
  opts: { maxAge: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Strict' | 'Lax' | 'None' },
) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${opts.maxAge}`,
    `SameSite=${opts.sameSite || 'Lax'}`,
  ];
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, secure?: boolean) {
  return setCookie(name, '', { maxAge: 0, httpOnly: true, secure, sameSite: 'Lax' });
}
