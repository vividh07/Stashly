import { describe, expect, it, beforeAll } from 'vitest';
import { createApp, bootstrapAdmin } from './app';
import type { Bindings } from './env';
import { resetDatabaseCache } from './db';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

function getSetCookies(res: Response): string[] {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') return anyHeaders.getSetCookie();
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

describe('storage quota concurrency', () => {
  let env: Bindings;
  let app: ReturnType<typeof createApp>;
  let cookies = '';
  let csrf = '';

  beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vault-quota-'));
    resetDatabaseCache();
    env = {
      DATA_DIR: dir,
      JWT_SECRET: 'quota-jwt-secret-value',
      CSRF_SECRET: 'quota-csrf-secret',
      ALLOW_REGISTRATION: 'true',
      STORAGE_QUOTA_BYTES: String(1000),
      CORS_ORIGIN: 'http://127.0.0.1:4173',
      SESSION_TTL_SECONDS: '3600',
      PRESIGNED_URL_TTL_SECONDS: '900',
      R2_BUCKET_NAME: 'personal-vault',
      BOOTSTRAP_ADMIN_EMAIL: 'quota@test.local',
      BOOTSTRAP_ADMIN_PASSWORD: 'password123',
      BOOTSTRAP_ADMIN_NAME: 'Quota',
      PUBLIC_API_URL: 'http://127.0.0.1:8787',
      NODE_ENV: 'test',
    };
    app = createApp();
    await bootstrapAdmin(env);

    const login = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'quota@test.local', password: 'password123' }),
      },
      env,
    );
    cookies = getSetCookies(login)
      .map((c) => c.split(';')[0])
      .join('; ');
    csrf = decodeURIComponent(cookies.match(/vault_csrf=([^;]+)/)?.[1] || '');
  });

  it('prevents concurrent reservations from exceeding quota', async () => {
    const reqs = [600, 600].map((fileSize) =>
      app.request(
        '/api/storage/upload-url',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: cookies,
            'x-csrf-token': csrf,
          },
          body: JSON.stringify({
            fileName: `f-${fileSize}.txt`,
            mimeType: 'text/plain',
            fileSize,
          }),
        },
        env,
      ),
    );
    const results = await Promise.all(reqs);
    const statuses = results.map((r) => r.status).sort();
    // one succeeds (201), one must fail quota (413)
    expect(statuses).toEqual([201, 413]);
  });
});
