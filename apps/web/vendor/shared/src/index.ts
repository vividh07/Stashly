import { z } from 'zod';

export const CONTENT_TYPES = [
  'bookmark',
  'image',
  'video',
  'file',
  'project',
  'audio',
  'note',
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export const ITEM_STATUSES = [
  'pending',
  'uploading',
  'syncing',
  'synced',
  'failed',
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const UPLOAD_STATUSES = [
  'reserved',
  'uploading',
  'completed',
  'failed',
  'expired',
  'abandoned',
] as const;

export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const FILE_SIZE_LIMITS = {
  image: 15 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
  document: 25 * 1024 * 1024,
  archive: 100 * 1024 * 1024,
  audio: 250 * 1024 * 1024,
  /** Single PUT to R2 maxes out at 5 GiB — keep at the cap. */
  video: 5 * 1024 * 1024 * 1024,
  default: 25 * 1024 * 1024,
} as const;

export const DEFAULT_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = [
  // images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
  // documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
  // archives
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/gzip',
  // audio
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
  'audio/webm',
  // video
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function getSizeLimitForMime(mime: string): number {
  if (mime.startsWith('image/')) return FILE_SIZE_LIMITS.image;
  if (mime.startsWith('video/')) return FILE_SIZE_LIMITS.video;
  if (mime.startsWith('audio/')) return FILE_SIZE_LIMITS.audio;
  if (
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed' ||
    mime === 'application/x-rar-compressed' ||
    mime === 'application/x-7z-compressed' ||
    mime === 'application/gzip'
  ) {
    return FILE_SIZE_LIMITS.archive;
  }
  if (mime === 'application/pdf') return FILE_SIZE_LIMITS.pdf;
  return FILE_SIZE_LIMITS.document;
}

export function inferContentTypeFromMime(mime: string): ContentType {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed' ||
    mime.includes('compressed')
  ) {
    return 'project';
  }
  return 'file';
}

export function inferContentTypeFromUrl(url: string): ContentType {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'github.com' || host === 'gitlab.com' || host === 'bitbucket.org') {
      return 'project';
    }
    if (
      host.includes('youtube.com') ||
      host === 'youtu.be' ||
      host.includes('vimeo.com') ||
      host.includes('twitch.tv')
    ) {
      return 'video';
    }
    if (
      host.includes('soundcloud.com') ||
      host.includes('spotify.com') ||
      host.includes('bandcamp.com')
    ) {
      return 'audio';
    }
    const ext = parsed.pathname.split('.').pop()?.toLowerCase();
    if (ext && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg'].includes(ext)) {
      return 'image';
    }
    if (ext && ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) return 'video';
    if (ext && ['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) return 'audio';
    if (ext && ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip'].includes(ext)) {
      return 'file';
    }
    return 'bookmark';
  } catch {
    return 'bookmark';
  }
}

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
});

export const registerSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8).max(128),
});

/** Wipe vault contents; account/login stays. Requires typing DELETE + password. */
export const purgeVaultSchema = z.object({
  password: z.string().min(8).max(128),
  confirm: z.literal('DELETE'),
});

export const forgotPasswordSchema = z.object({}).strict();

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(128),
});

export const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit authenticator code'),
});

export const totpEnableSchema = totpCodeSchema;

export const totpDisableSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(1).max(128),
});

export const resetPasswordWithTotpSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(8).max(128),
});

export const archivePinVerifySchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'PIN must be 4 digits'),
});

export const archivePinResetSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be 4 digits'),
});

export const tagSchema = z.object({
  name: z.string().min(1).max(64).trim(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export const itemCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  contentType: z.enum(CONTENT_TYPES),
  url: z.string().url().max(2048).optional().nullable(),
  notes: z.string().max(20000).optional(),
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
  mimeType: z.string().max(200).optional(),
  fileName: z.string().max(500).optional(),
  fileSize: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().max(128).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const itemUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional().nullable(),
  notes: z.string().max(20000).optional().nullable(),
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
  favorite: z.boolean().optional(),
  archived: z.boolean().optional(),
  trashed: z.boolean().optional(),
  inbox: z.boolean().optional(),
  locked: z.boolean().optional(),
  reminderAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  contentType: z.enum(CONTENT_TYPES).optional(),
  url: z.string().url().max(2048).optional().nullable(),
  contentHash: z.string().max(128).optional().nullable(),
});

export const captureUrlSchema = z.object({
  url: z.string().url().max(2048),
  title: z.string().max(500).optional(),
  description: z.string().max(5000).optional(),
  notes: z.string().max(20000).optional(),
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
  contentType: z.enum(CONTENT_TYPES).optional(),
  idempotencyKey: z.string().max(128).optional(),
});

export const captureNoteSchema = z.object({
  title: z.string().min(1).max(500),
  body: z.string().min(1).max(100000),
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
  markdown: z.boolean().optional(),
  idempotencyKey: z.string().max(128).optional(),
});

export const uploadUrlSchema = z.object({
  fileName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  fileSize: z.number().int().positive(),
  contentType: z.enum(CONTENT_TYPES).optional(),
  title: z.string().max(500).optional(),
  description: z.string().max(5000).optional(),
  notes: z.string().max(20000).optional(),
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
  url: z.string().url().max(2048).optional(),
  idempotencyKey: z.string().max(128).optional(),
  contentHash: z.string().max(128).optional(),
});

export const completeUploadSchema = z.object({
  uploadId: z.string().min(1),
  etag: z.string().max(200).optional(),
  contentHash: z.string().max(128).optional(),
});

const queryBoolean = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(v)) return true;
    if (['false', '0', 'no'].includes(v)) return false;
  }
  return value;
}, z.boolean().optional());

export const searchQuerySchema = z.object({
  q: z.string().max(500).optional(),
  contentType: z.enum(CONTENT_TYPES).optional(),
  tags: z.string().optional(),
  favorite: queryBoolean,
  archived: queryBoolean,
  trashed: queryBoolean,
  inbox: queryBoolean,
  due: queryBoolean,
  locked: queryBoolean,
  sort: z.enum(['newest', 'oldest', 'name', 'size']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const bulkActionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum([
    'favorite',
    'unfavorite',
    'archive',
    'unarchive',
    'trash',
    'restore',
    'delete',
    'tag',
    'keep',
    'lock',
    'unlock',
  ]),
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
});

export const createShareLinkSchema = z.object({
  itemId: z.string().min(1),
  expiresInHours: z.number().int().min(1).max(24 * 90).default(72),
});

export const itemLockSchema = z.object({
  locked: z.boolean(),
  pin: z.string().regex(/^\d{4}$/).optional(),
});

export const profileUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  theme: z.enum(['dark', 'light', 'system']).optional(),
  defaultCaptureType: z.enum(CONTENT_TYPES).optional(),
});

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  theme: 'dark' | 'light' | 'system';
  defaultCaptureType?: ContentType;
  storageQuotaBytes: number;
  storageUsedBytes: number;
  totpEnabled: boolean;
  createdAt: string;
}

export interface TagDto {
  id: string;
  name: string;
  color?: string;
  itemCount: number;
  createdAt: string;
}

export interface ItemDto {
  id: string;
  title: string;
  description?: string | null;
  contentType: ContentType;
  url?: string | null;
  notes?: string | null;
  tags: string[];
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  objectKey?: string | null;
  thumbnailKey?: string | null;
  favorite: boolean;
  archived: boolean;
  trashed: boolean;
  inbox: boolean;
  locked: boolean;
  contentHash?: string | null;
  reminderAt?: string | null;
  expiresAt?: string | null;
  status: ItemStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  accessedAt?: string | null;
}

export interface ShareLinkDto {
  id: string;
  itemId: string;
  url: string;
  expiresAt: string;
  createdAt: string;
  revokedAt?: string | null;
}

export interface DuplicateMatchDto {
  item: ItemDto;
  reason: 'contentHash' | 'url' | 'title';
}

/** Strip common tracker query params and normalize bookmark URLs. */
export function cleanUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return raw.trim();

  const dropExact = new Set([
    'fbclid',
    'gclid',
    'gbraid',
    'wbraid',
    'mc_cid',
    'mc_eid',
    'igshid',
    'si',
    'feature',
    'ref',
    'ref_src',
    'ref_url',
    'mkt_tok',
  ]);
  const keys = [...parsed.searchParams.keys()];
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (
      dropExact.has(lower) ||
      lower.startsWith('utm_') ||
      lower.startsWith('spm') ||
      lower.startsWith('pk_') ||
      lower.startsWith('sc_') ||
      lower.startsWith('vero_') ||
      lower.startsWith('yclid') ||
      lower === 'ncid'
    ) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.hash = '';
  // Normalize trailing slash for bare paths
  if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

export interface UploadDto {
  id: string;
  itemId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  status: UploadStatus;
  uploadUrl?: string;
  expiresAt: string;
  createdAt: string;
}

export interface StorageUsageDto {
  usedBytes: number;
  reservedBytes: number;
  quotaBytes: number;
  availableBytes: number;
  percentUsed: number;
  pendingUploads: number;
  failedUploads: number;
  largestFiles: Array<{
    id: string;
    title: string;
    fileName?: string | null;
    fileSize: number;
    contentType: ContentType;
  }>;
}

export interface DashboardDto {
  welcomeName: string;
  totalItems: number;
  recentItems: ItemDto[];
  favorites: ItemDto[];
  recentlyAccessed: ItemDto[];
  storage: StorageUsageDto;
  pendingUploads: number;
  failedSyncs: number;
  byType: Record<ContentType, number>;
}

export interface Paginated<T> {
  items: T[];
  nextCursor?: string | null;
  total?: number;
}

export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: unknown;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
