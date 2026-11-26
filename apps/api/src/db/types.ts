import type { ContentType, ItemStatus, UploadStatus } from '@vault/shared';

export interface UserRecord {
  _id: string;
  email: string;
  name: string;
  passwordHash: string;
  theme: 'dark' | 'light' | 'system';
  defaultCaptureType?: ContentType;
  storageQuotaBytes: number;
  storageUsedBytes: number;
  storageReservedBytes: number;
  passwordResetTokenHash?: string | null;
  passwordResetExpiresAt?: string | null;
  /** AES-GCM encrypted TOTP secret (base64 pack) when enabled or pending setup. */
  totpSecretEnc?: string | null;
  totpEnabled?: boolean;
  /** Pending secret during setup before first successful confirm. */
  totpPendingSecretEnc?: string | null;
  /** SHA-256 hex of archive PIN with server pepper. */
  archivePinHash?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  _id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  userAgent?: string;
  ipHash?: string;
}

export interface ItemRecord {
  _id: string;
  userId: string;
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
  inbox?: boolean;
  locked?: boolean;
  contentHash?: string | null;
  reminderAt?: string | null;
  expiresAt?: string | null;
  status: ItemStatus;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  accessedAt?: string | null;
  deletedAt?: string | null;
}

export interface ShareLinkRecord {
  _id: string;
  userId: string;
  itemId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  revokedAt?: string | null;
}

export interface UploadRecord {
  _id: string;
  userId: string;
  itemId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  status: UploadStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  etag?: string | null;
  idempotencyKey?: string | null;
}

export interface TagRecord {
  _id: string;
  userId: string;
  name: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RateLimitRecord {
  _id: string;
  count: number;
  resetAt: string;
}

export interface ItemListQuery {
  userId: string;
  q?: string;
  contentType?: ContentType;
  tags?: string[];
  favorite?: boolean;
  archived?: boolean;
  trashed?: boolean;
  inbox?: boolean;
  due?: boolean;
  locked?: boolean;
  sort?: 'newest' | 'oldest' | 'name' | 'size';
  cursor?: string;
  limit: number;
  from?: string;
  to?: string;
}

export interface DuplicateGroup {
  contentHash: string;
  count: number;
  items: ItemRecord[];
}

export interface StorageHygieneResult {
  largestFiles: ItemRecord[];
  unusedArchiveCandidates: ItemRecord[];
  trashCount: number;
  expiredItems: ItemRecord[];
  duplicateGroups: DuplicateGroup[];
}

export interface Database {
  ensureIndexes(): Promise<void>;
  // users
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByPasswordResetTokenHash(hash: string): Promise<UserRecord | null>;
  listUsers(limit?: number): Promise<UserRecord[]>;
  createUser(user: UserRecord): Promise<UserRecord>;
  updateUser(id: string, patch: Partial<UserRecord>): Promise<UserRecord | null>;
  countUsers(): Promise<number>;
  // sessions
  createSession(session: SessionRecord): Promise<SessionRecord>;
  findSessionById(id: string): Promise<SessionRecord | null>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsForUser(userId: string): Promise<void>;
  // items
  createItem(item: ItemRecord): Promise<ItemRecord>;
  findItemById(userId: string, id: string): Promise<ItemRecord | null>;
  findItemByIdempotency(userId: string, key: string): Promise<ItemRecord | null>;
  findItemByContentHash(userId: string, hash: string): Promise<ItemRecord | null>;
  findItemByUrl(userId: string, url: string): Promise<ItemRecord | null>;
  updateItem(userId: string, id: string, patch: Partial<ItemRecord>): Promise<ItemRecord | null>;
  deleteItem(userId: string, id: string): Promise<boolean>;
  listItems(query: ItemListQuery): Promise<{ items: ItemRecord[]; nextCursor?: string; total: number }>;
  countItems(userId: string, filter?: Partial<Pick<ItemRecord, 'contentType' | 'favorite' | 'archived' | 'trashed' | 'status'>>): Promise<number>;
  bulkUpdateItems(userId: string, ids: string[], patch: Partial<ItemRecord>): Promise<number>;
  sumFileSizes(userId: string): Promise<number>;
  largestFiles(userId: string, limit: number): Promise<ItemRecord[]>;
  listDueItems(userId: string): Promise<ItemRecord[]>;
  getStorageHygiene(userId: string, limit?: number): Promise<StorageHygieneResult>;
  // share links
  createShareLink(link: ShareLinkRecord): Promise<ShareLinkRecord>;
  findShareLinkById(userId: string, id: string): Promise<ShareLinkRecord | null>;
  findShareLinkByTokenHash(tokenHash: string): Promise<ShareLinkRecord | null>;
  listShareLinksForItem(userId: string, itemId: string): Promise<ShareLinkRecord[]>;
  revokeShareLink(userId: string, id: string): Promise<ShareLinkRecord | null>;
  // uploads
  createUpload(upload: UploadRecord): Promise<UploadRecord>;
  findUploadById(userId: string, id: string): Promise<UploadRecord | null>;
  findUploadByIdempotency(userId: string, key: string): Promise<UploadRecord | null>;
  updateUpload(userId: string, id: string, patch: Partial<UploadRecord>): Promise<UploadRecord | null>;
  listUploads(userId: string, status?: UploadStatus[]): Promise<UploadRecord[]>;
  deleteUpload(userId: string, id: string): Promise<void>;
  // tags
  listTags(userId: string): Promise<TagRecord[]>;
  findTagByName(userId: string, name: string): Promise<TagRecord | null>;
  createTag(tag: TagRecord): Promise<TagRecord>;
  updateTag(userId: string, id: string, patch: Partial<TagRecord>): Promise<TagRecord | null>;
  deleteTag(userId: string, id: string): Promise<boolean>;
  /** Wipe items/uploads/tags/share links for a user. Returns objectKeys that still need R2 cleanup. */
  purgeUserData(userId: string): Promise<{ deletedItems: number; objectKeys: string[] }>;
  // storage reservation
  reserveStorage(userId: string, bytes: number, quotaBytes: number): Promise<boolean>;
  releaseReservation(userId: string, bytes: number): Promise<void>;
  commitReservation(userId: string, reservedBytes: number, actualBytes: number): Promise<void>;
  // rate limit
  hitRateLimit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; remaining: number }>;
  close(): Promise<void>;
}
