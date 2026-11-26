import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError, api } from './api';

describe('api client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.cookie = 'vault_csrf=test-csrf';
  });

  it('sends CSRF header on mutating requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.logout();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('test-csrf');
  });

  it('throws ApiError on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => JSON.stringify({ error: 'Unauthorized', code: 'unauthorized' }),
      }),
    );
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
  });
});
