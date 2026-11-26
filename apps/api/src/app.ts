import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings, Variables } from './env';
import { authRoutes } from './routes/auth';
import { itemRoutes } from './routes/items';
import { captureRoutes } from './routes/capture';
import { storageRoutes } from './routes/storage';
import { tagRoutes } from './routes/tags';
import { searchRoutes } from './routes/search';
import { dashboardRoutes } from './routes/dashboard';
import { shareRoutes } from './routes/share';
import { csrfProtection, errorHandler, requestId, secureHeaders } from './middleware/security';
import { getDatabase } from './db';
import { hashPassword, randomId } from './lib/crypto';
import { DEFAULT_STORAGE_QUOTA_BYTES } from '@vault/shared';
import { parseQuota } from './env';
import { logger } from './lib/logger';
import { ZodError } from 'zod';
import { AppError } from './lib/errors';

export function createApp() {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

  app.use('*', requestId);
  app.use('*', secureHeaders);
  app.use('*', errorHandler);

  app.use('*', async (c, next) => {
    const origin = c.env.CORS_ORIGIN || '*';
    const handler = cors({
      origin: (reqOrigin) => {
        if (origin === '*') return reqOrigin || '';
        const allowed = origin.split(',').map((s) => s.trim());
        if (reqOrigin && allowed.includes(reqOrigin)) return reqOrigin;
        return allowed[0] || '';
      },
      credentials: true,
      allowHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id', 'X-Idempotency-Key'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    });
    return handler(c, next);
  });

  app.use('/api/*', csrfProtection);

  app.onError((err, c) => {
    if (err instanceof ZodError) {
      return c.json(
        { error: 'Validation failed', code: 'validation', details: err.flatten() },
        400,
      );
    }
    if (err instanceof AppError) {
      return c.json({ error: err.message, code: err.code, details: err.details }, err.status as 400);
    }
    logger.error('onError', { error: err.message });
    const mongoHint =
      /timed out|Server selection|ECONNREFUSED|ENOTFOUND|MongoNetwork/i.test(err.message)
        ? ' MongoDB unreachable from Workers — in Atlas → Network Access, allow 0.0.0.0/0.'
        : '';
    return c.json(
      {
        error: `Internal server error.${mongoHint}`,
        code: 'internal',
        detail: err.message,
      },
      500,
    );
  });

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      service: 'personal-vault-api',
      time: new Date().toISOString(),
      storageMode: c.env.R2_ACCESS_KEY_ID || c.env.VAULT_BUCKET ? 'r2' : 'none',
      dbMode: c.env.MONGODB_URI ? 'mongodb' : 'none',
    }),
  );

  app.route('/api/auth', authRoutes);
  app.route('/api/items', itemRoutes);
  app.route('/api/capture', captureRoutes);
  app.route('/api/storage', storageRoutes);
  app.route('/api/tags', tagRoutes);
  app.route('/api/search', searchRoutes);
  app.route('/api/dashboard', dashboardRoutes);
  app.route('/api/share', shareRoutes);

  app.get('/api/export', async (c) => {
    const { requireAuth } = await import('./middleware/auth');
    // Manual auth check via middleware invocation pattern
    let authed = false;
    await requireAuth(c, async () => {
      authed = true;
    });
    if (!authed) return c.json({ error: 'Unauthorized' }, 401);
    const db = await getDatabase(c.env);
    const userId = c.get('userId');
    const items = await db.listItems({ userId, limit: 10000, trashed: false });
    const tags = await db.listTags(userId);
    return c.json({
      exportedAt: new Date().toISOString(),
      items: items.items,
      tags,
    });
  });

  return app;
}

export async function bootstrapAdmin(env: Bindings) {
  if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) return;
  const db = await getDatabase(env);
  const count = await db.countUsers();
  if (count > 0) return;
  const now = new Date().toISOString();
  await db.createUser({
    _id: randomId(12),
    email: env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(),
    name: env.BOOTSTRAP_ADMIN_NAME || 'Vault Owner',
    passwordHash: await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD),
    theme: 'dark',
    storageQuotaBytes: parseQuota(env) || DEFAULT_STORAGE_QUOTA_BYTES,
    storageUsedBytes: 0,
    storageReservedBytes: 0,
    createdAt: now,
    updatedAt: now,
  });
  logger.info('Bootstrapped admin user', { email: env.BOOTSTRAP_ADMIN_EMAIL });
}

export type VaultApp = ReturnType<typeof createApp>;
