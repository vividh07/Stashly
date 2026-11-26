export const DEFAULT_ORIGIN = 'http://127.0.0.1:4173';

export async function getVaultOrigin() {
  const stored = await chrome.storage.sync.get({ vaultOrigin: DEFAULT_ORIGIN });
  return String(stored.vaultOrigin || DEFAULT_ORIGIN).replace(/\/$/, '');
}

export function buildCaptureExtUrl(origin, { url = '', title = '', text = '' } = {}) {
  const params = new URLSearchParams();
  if (url) params.set('url', url);
  if (title) params.set('title', title);
  if (text) params.set('text', text);
  const qs = params.toString();
  return `${origin}/capture-ext${qs ? `?${qs}` : ''}`;
}

export async function getCsrfToken(origin) {
  try {
    const cookie = await chrome.cookies.get({ url: `${origin}/`, name: 'vault_csrf' });
    return cookie?.value ?? null;
  } catch {
    return null;
  }
}

export function isCapturableUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * POST /api/capture/url when session cookies are available for the vault origin.
 * Falls back to opening /capture-ext in a tab when this fails.
 */
export async function tryCaptureViaApi(origin, { url, title, text }) {
  if (!isCapturableUrl(url)) return { ok: false, reason: 'bad-url' };

  const headers = { 'Content-Type': 'application/json' };
  const csrf = await getCsrfToken(origin);
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const body = {
    url,
    title: title || undefined,
    notes: text && text !== url ? text : undefined,
  };

  try {
    const res = await fetch(`${origin}/api/capture/url`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    return { ok: false, reason: `http-${res.status}` };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

export async function saveToVault(payload, { preferApi = true } = {}) {
  const origin = await getVaultOrigin();
  const normalized = {
    url: payload.url || '',
    title: payload.title || '',
    text: payload.text || '',
  };

  if (preferApi && isCapturableUrl(normalized.url)) {
    const api = await tryCaptureViaApi(origin, normalized);
    if (api.ok) return { method: 'api', origin };
  }

  const tabUrl = buildCaptureExtUrl(origin, normalized);
  await chrome.tabs.create({ url: tabUrl });
  return { method: 'tab', origin, tabUrl };
}