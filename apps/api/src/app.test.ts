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

function cookieJar(res: Response): string {
  return getSetCookies(res)
    .map((c) => c.split(';')[0])
    .join('; ');
}

function csrfFromJar(jar: string): string {
  const m = jar.match(/vault_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

describe('Personal Vault API', () => {
  let env: Bindings;
  let app: ReturnType<typeof createApp>;
  let cookies = '';
  let csrf = '';

  beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vault-test-'));
    resetDatabaseCache();
    env = {
      DATA_DIR: dir,
      JWT_SECRET: 'test-jwt-secret-value',
      CSRF_SECRET: 'test-csrf-secret',
      ALLOW_REGISTRATION: 'true',
      STORAGE_QUOTA_BYTES: String(50 * 1024 * 1024),
      CORS_ORIGIN: 'http://127.0.0.1:4173',
      SESSION_TTL_SECONDS: '3600',
      PRESIGNED_URL_TTL_SECONDS: '900',
      R2_BUCKET_NAME: 'personal-vault',
      BOOTSTRAP_ADMIN_EMAIL: 'owner@test.local',
      BOOTSTRAP_ADMIN_PASSWORD: 'password123',
      BOOTSTRAP_ADMIN_NAME: 'Owner',
      PUBLIC_API_URL: 'http://127.0.0.1:8787',
      NODE_ENV: 'test',
    };
    app = createApp();
    await bootstrapAdmin(env);
  });

  async function api(pathName: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (cookies) headers.set('cookie', cookies);
    if (csrf && init.method && init.method !== 'GET') headers.set('x-csrf-token', csrf);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const res = await app.request(pathName, { ...init, headers }, env);
    const set = cookieJar(res);
    if (set) {
      cookies = set;
      csrf = csrfFromJar(cookies) || csrf;
    }
    return res;
  }

  it('boots health endpoint', async () => {
    const res = await api('/api/health');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('logs in bootstrap admin', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@test.local', password: 'password123' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user.email).toBe('owner@test.local');
    expect(csrf).toBeTruthy();
  });

  it('rejects unauthorized item access', async () => {
    const bare = createApp();
    const res = await bare.request('/api/items', {}, env);
    expect(res.status).toBe(401);
  });

  it('captures a note and lists it', async () => {
    const res = await api('/api/capture/note', {
      method: 'POST',
      body: JSON.stringify({ title: 'Idea', body: 'Build a vault', tags: ['ideas'] }),
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.item.contentType).toBe('note');

    const list = await api('/api/items?contentType=note');
    const data = await list.json();
    expect(data.total).toBeGreaterThanOrEqual(1);
  });

  it('captures url metadata path without SSRF', async () => {
    const res = await api('/api/capture/url', {
      method: 'POST',
      body: JSON.stringify({ url: 'http://127.0.0.1/secret' }),
    });
    expect(res.status).toBe(400);
  });

  it('enforces ownership on item get', async () => {
    const res = await api('/api/items/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('creates upload reservation and completes local upload', async () => {
    const content = new TextEncoder().encode('hello vault file');
    const res = await api('/api/storage/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        fileName: 'hello.txt',
        mimeType: 'text/plain',
        fileSize: content.byteLength,
        title: 'Hello',
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.upload.uploadUrl).toContain('/api/storage/direct/');

    const putPath = data.upload.uploadUrl.startsWith('http')
      ? new URL(data.upload.uploadUrl).pathname
      : data.upload.uploadUrl;
    const put = await api(putPath, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: content,
    });
    expect(put.status).toBe(200);

    const done = await api('/api/storage/complete-upload', {
      method: 'POST',
      body: JSON.stringify({ uploadId: data.upload.id }),
    });
    expect(done.status).toBe(200);
    const item = await done.json();
    expect(item.item.status).toBe('synced');
  });

  it('rejects oversized uploads by mime limit', async () => {
    const res = await api('/api/storage/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        fileName: 'big.jpg',
        mimeType: 'image/jpeg',
        fileSize: 20 * 1024 * 1024,
      }),
    });
    expect(res.status).toBe(413);
  });

  it('rejects disallowed mime types', async () => {
    const res = await api('/api/storage/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        fileName: 'x.exe',
        mimeType: 'application/x-msdownload',
        fileSize: 100,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('searches by title', async () => {
    const res = await api('/api/search?q=Idea');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBeGreaterThanOrEqual(1);
  });

  it('returns storage usage', async () => {
    const res = await api('/api/storage/usage');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.usage.quotaBytes).toBeGreaterThan(0);
    expect(data.usage.usedBytes).toBeGreaterThanOrEqual(0);
  });

  it('dashboard returns live counts', async () => {
    const res = await api('/api/dashboard');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.dashboard.totalItems).toBeGreaterThanOrEqual(1);
  });

  it('trashes an item via POST /items/:id/trash then deletes forever', async () => {
    const created = await api('/api/capture/note', {
      method: 'POST',
      body: JSON.stringify({ title: 'Trash me', body: 'delete path regression' }),
    });
    expect(created.status).toBe(201);
    const { item } = await created.json();

    const trashed = await api(`/api/items/${item.id}/trash`, {
      method: 'POST',
      body: '{}',
    });
    expect(trashed.status).toBe(200);
    const trashedBody = await trashed.json();
    expect(trashedBody.item.trashed).toBe(true);

    const permanent = await api(`/api/items/${item.id}`, { method: 'DELETE' });
    expect(permanent.status).toBe(200);

    const missing = await api(`/api/items/${item.id}`);
    expect(missing.status).toBe(404);
  });
});
