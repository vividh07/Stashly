import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createApp, bootstrapAdmin } from './app';
import { loadNodeEnv } from './env';
import { logger } from './lib/logger';

const env = loadNodeEnv();
const app = createApp();
const port = Number(process.env.PORT || 8787);
const hostname = process.env.HOST || '0.0.0.0';

/** Prefer monorepo root (Render), then apps/api-relative path. */
function resolveWebDistRoot(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), 'web/dist'),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'index.html'))) {
      const rel = path.relative(process.cwd(), dir).replace(/\\/g, '/');
      return rel || '.';
    }
  }
  return null;
}

const webRoot = resolveWebDistRoot();
if (webRoot) {
  // API routes are already mounted under /api/* — only serve the SPA elsewhere.
  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api')) return next();
    return serveStatic({ root: webRoot })(c, next);
  });
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api')) return next();
    return serveStatic({ root: webRoot, path: 'index.html' })(c, next);
  });
  logger.info('Serving web UI from static dist', { webRoot });
} else {
  logger.info('Web dist not found — API-only mode');
}

await bootstrapAdmin(env);

serve(
  {
    fetch: (req) => app.fetch(req, env),
    port,
    hostname,
  },
  (info) => {
    logger.info('Personal Vault API listening', {
      host: hostname,
      port: info.port,
      cors: env.CORS_ORIGIN,
      db: 'mongodb',
      storage: env.R2_ACCESS_KEY_ID ? 'r2' : 'r2-binding',
      bucket: env.R2_BUCKET_NAME,
      web: Boolean(webRoot),
    });
  },
);
