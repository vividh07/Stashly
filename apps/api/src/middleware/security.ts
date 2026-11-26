import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '../env';
import { getDatabase } from '../db';
import { AppError, tooMany } from '../lib/errors';
import { CSRF_COOKIE, CSRF_HEADER, getCookie } from './auth';
import { randomId } from '../lib/crypto';
import { logger } from '../lib/logger';

export const requestId = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const id = c.req.header('x-request-id') || randomId(8);
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    await next();
  },
);

export const secureHeaders = createMiddleware(async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Cross-Origin-Resource-Policy', 'same-site');
});

export const csrfProtection = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await next();
      return;
    }
    // Allow auth login/register without CSRF (no session yet)
    const path = new URL(c.req.url).pathname;
    if (
      path === '/api/auth/login' ||
      path === '/api/auth/register' ||
      path === '/api/auth/forgot-password' ||
      path === '/api/auth/reset-password'
    ) {
      await next();
      return;
    }
    const cookieToken = getCookie(c.req.header('cookie'), CSRF_COOKIE);
    const headerToken = c.req.header(CSRF_HEADER);
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new AppError(403, 'CSRF token mismatch', 'csrf');
    }
    await next();
  },
);

export function rateLimit(opts: { keyPrefix: string; limit: number; windowMs: number }) {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    const db = await getDatabase(c.env);
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'local';
    const userPart = c.get('userId') || 'anon';
    const key = `${opts.keyPrefix}:${userPart}:${ip}`;
    const result = await db.hitRateLimit(key, opts.limit, opts.windowMs);
    c.header('X-RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) throw tooMany();
    await next();
  });
}

export const errorHandler = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    try {
      await next();
    } catch (err) {
      if (err instanceof AppError) {
        return c.json(
          { error: err.message, code: err.code, details: err.details },
          err.status as 400,
        );
      }
      logger.error('Unhandled error', {
        requestId: c.get('requestId'),
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json({ error: 'Internal server error', code: 'internal' }, 500);
    }
  },
);
