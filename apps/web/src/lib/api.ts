import type {
  ContentType,
  DashboardDto,
  DuplicateMatchDto,
  ItemDto,
  Paginated,
  ShareLinkDto,
  StorageUsageDto,
  TagDto,
  UploadDto,
  UserPublic,
} from '@vault/shared';

export interface StorageHygieneDto {
  largestFiles: ItemDto[];
  unusedArchiveCandidates: ItemDto[];
  trashCount: number;
  expiredItems: ItemDto[];
  duplicateGroups: Array<{ contentHash: string; count: number; items: ItemDto[] }>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData) && !(init.body instanceof ArrayBuffer) && !(init.body instanceof Uint8Array)) {
    headers.set('Content-Type', 'application/json');
  }
  const csrf = readCookie('vault_csrf');
  if (csrf && init.method && init.method !== 'GET' && init.method !== 'HEAD') {
    headers.set('X-CSRF-Token', csrf);
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) throw new ApiError(res.statusText || 'Request failed', res.status);
      throw new ApiError('Invalid server response', res.status || 500);
    }
  }
  if (!res.ok) {
    throw new ApiError(data?.error || res.statusText, res.status, data?.code, data?.details);
  }
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  authStatus: () =>
    request<{ registrationOpen: boolean; allowRegistration: boolean; totpEnabled: boolean }>(
      '/api/auth/status',
    ),
  me: () => request<{ user: UserPublic | null }>('/api/auth/me'),
  login: (email: string, password: string) =>
    request<{ user: UserPublic; csrfToken: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (name: string, email: string, password: string) =>
    request<{ user: UserPublic; csrfToken: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),
  forgotPassword: () =>
    request<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
  resetPasswordWithTotp: (code: string, password: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/reset-password-totp', {
      method: 'POST',
      body: JSON.stringify({ code, password }),
    }),
  totpStatus: () => request<{ enabled: boolean }>('/api/auth/totp/status'),
  totpSetup: () => request<{ secret: string; otpauthUrl: string }>('/api/auth/totp/setup', { method: 'POST' }),
  totpEnable: (code: string) =>
    request<{ ok: boolean; user: UserPublic }>('/api/auth/totp/enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  totpDisable: (code: string, password: string) =>
    request<{ ok: boolean; user: UserPublic }>('/api/auth/totp/disable', {
      method: 'POST',
      body: JSON.stringify({ code, password }),
    }),
  verifyArchivePin: (pin: string) =>
    request<{ ok: boolean; expiresAt: string }>('/api/auth/archive-pin/verify', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),
  resetArchivePin: (code: string, pin: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/archive-pin/reset', {
      method: 'POST',
      body: JSON.stringify({ code, pin }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  updateProfile: (body: Partial<UserPublic> & { theme?: string; defaultCaptureType?: string }) =>
    request<{ user: UserPublic }>('/api/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  purgeVault: (password: string) =>
    request<{ ok: boolean; deletedItems: number; filesRemoved: number; user: UserPublic }>(
      '/api/auth/purge-data',
      {
        method: 'POST',
        body: JSON.stringify({ password, confirm: 'DELETE' }),
      },
    ),
  dashboard: () => request<{ dashboard: DashboardDto }>('/api/dashboard'),
  items: (query: Record<string, string | number | boolean | undefined>) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== '') params.set(k, String(v));
    });
    return request<Paginated<ItemDto> & { total?: number }>(`/api/items?${params}`);
  },
  getItem: (id: string) => request<{ item: ItemDto }>(`/api/items/${id}`),
  createItem: (body: unknown) =>
    request<{ item: ItemDto }>('/api/items', { method: 'POST', body: JSON.stringify(body) }),
  updateItem: (id: string, body: unknown) =>
    request<{ item: ItemDto }>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  trashItem: (id: string) =>
    request<{ item: ItemDto }>(`/api/items/${id}/trash`, { method: 'POST', body: '{}' }),
  deleteItem: (id: string, permanent = false) =>
    request<{ ok?: boolean; item?: ItemDto }>(
      `/api/items/${id}${permanent ? '?permanent=true' : ''}`,
      { method: 'DELETE' },
    ),
  bulk: (body: unknown) =>
    request<{ ok?: boolean; updated?: number }>('/api/items/bulk', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  captureUrl: (body: unknown) =>
    request<{ item: ItemDto; duplicate?: boolean }>('/api/capture/url', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  captureNote: (body: unknown) =>
    request<{ item: ItemDto }>('/api/capture/note', { method: 'POST', body: JSON.stringify(body) }),
  duplicates: (query: { contentHash?: string; url?: string }) => {
    const params = new URLSearchParams();
    if (query.contentHash) params.set('contentHash', query.contentHash);
    if (query.url) params.set('url', query.url);
    return request<{ duplicates: DuplicateMatchDto[] }>(`/api/items/duplicates?${params}`);
  },
  dueItems: () => request<{ items: ItemDto[] }>('/api/items/due'),
  lockItem: (id: string, locked: boolean, pin?: string) =>
    request<{ item: ItemDto }>(`/api/items/${id}/lock`, {
      method: 'POST',
      body: JSON.stringify({ locked, pin }),
    }),
  createShareLink: (itemId: string, expiresInHours: number) =>
    request<{ shareLink: ShareLinkDto }>('/api/share', {
      method: 'POST',
      body: JSON.stringify({ itemId, expiresInHours }),
    }),
  revokeShareLink: (id: string) =>
    request<{ ok: boolean }>(`/api/share/${id}`, { method: 'DELETE' }),
  /** Public — fetches share metadata for a token. No auth required by the API. */
  getShareLink: (token: string) =>
    request<{ item: ItemDto; expiresAt: string }>(`/api/share/${token}`),
  shareDownloadUrl: (token: string) =>
    request<{ url: string; expiresAt: string }>(`/api/share/${token}?download=1`),
  search: (query: Record<string, string | number | boolean | undefined>) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== '') params.set(k, String(v));
    });
    return request<Paginated<ItemDto> & { total?: number; mode?: string }>(`/api/search?${params}`);
  },
  tags: () => request<{ tags: TagDto[] }>('/api/tags'),
  createTag: (name: string, color?: string) =>
    request<{ tag: TagDto }>('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    }),
  storageUsage: () => request<{ usage: StorageUsageDto }>('/api/storage/usage'),
  hygiene: () => request<StorageHygieneDto>('/api/storage/hygiene'),
  requestUpload: (body: {
    fileName: string;
    mimeType: string;
    fileSize: number;
    contentType?: ContentType | string;
    title?: string;
    description?: string;
    notes?: string;
    tags?: string[];
    url?: string;
    idempotencyKey?: string;
    contentHash?: string;
  }) =>
    request<{ item: ItemDto; upload: UploadDto; duplicate: ItemDto | null }>(
      '/api/storage/upload-url',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),
  completeUpload: (uploadId: string, etag?: string, contentHash?: string) =>
    request<{ item: ItemDto }>('/api/storage/complete-upload', {
      method: 'POST',
      body: JSON.stringify({ uploadId, etag, contentHash }),
    }),
  downloadUrl: (itemId: string) =>
    request<{ url: string; expiresAt: string }>('/api/storage/download-url', {
      method: 'POST',
      body: JSON.stringify({ itemId }),
    }),
  /** Inline URL for in-app image/video/audio preview (original file, not a separate thumbnail). */
  previewUrl: (itemId: string) =>
    request<{ url: string; expiresAt: string }>('/api/storage/download-url', {
      method: 'POST',
      body: JSON.stringify({ itemId, disposition: 'inline', preview: true }),
    }),
  exportData: () => request<{ exportedAt: string; items: unknown[]; tags: unknown[] }>('/api/export'),
};

/** True when the item has an original file in R2 (not a plain link/note). */
export function itemHasOriginalFile(item: Pick<ItemDto, 'objectKey'>): boolean {
  return Boolean(item.objectKey);
}

/** Download the original stored file (full quality), not a thumbnail or preview. */
export async function downloadOriginalFile(
  item: Pick<ItemDto, 'id' | 'objectKey' | 'fileName' | 'title'>,
): Promise<void> {
  if (!item.objectKey) {
    throw new ApiError('No original file on this item', 400);
  }
  const { url } = await api.downloadUrl(item.id);
  const fileName = item.fileName || item.title || 'download';

  // Same-origin / API-mediated downloads need cookies.
  if (url.startsWith('/')) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      throw new ApiError(res.statusText || 'Download failed', res.status);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    return;
  }

  // Presigned R2 URL — Content-Disposition forces original filename + attachment.
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener noreferrer';
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Resolve API-mediated upload URLs onto the page origin (Vite proxy / Pages). */
function resolveUploadUrl(uploadUrl: string): { url: string; sameOrigin: boolean } {
  try {
    const parsed = new URL(uploadUrl, location.origin);
    if (parsed.pathname.startsWith('/api/storage/direct/')) {
      return { url: `${parsed.pathname}${parsed.search}`, sameOrigin: true };
    }
    const sameOrigin = parsed.origin === location.origin;
    return { url: sameOrigin ? `${parsed.pathname}${parsed.search}` : parsed.href, sameOrigin };
  } catch {
    return { url: uploadUrl, sameOrigin: uploadUrl.startsWith('/') };
  }
}

export async function uploadToPresigned(
  uploadUrl: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ etag?: string }> {
  const { url, sameOrigin } = resolveUploadUrl(uploadUrl);
  // Use XHR for progress events
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.withCredentials = sameOrigin;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    if (sameOrigin) {
      const csrf = readCookie('vault_csrf');
      if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader('etag') || undefined });
      } else {
        let message = 'Upload failed';
        try {
          const data = JSON.parse(xhr.responseText);
          if (data?.error) message = data.error;
        } catch {
          /* ignore */
        }
        reject(new ApiError(message, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('Network error during upload', 0));
    xhr.send(file);
  });
}
