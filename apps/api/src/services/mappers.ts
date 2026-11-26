import type {
  DashboardDto,
  ItemDto,
  StorageUsageDto,
  TagDto,
  UserPublic,
} from '@vault/shared';
import type { CONTENT_TYPES } from '@vault/shared';
import type { ItemRecord, TagRecord, UserRecord } from '../db/types';
import type { Database } from '../db/types';
import { parseQuota, type AppEnv } from '../env';

export function toUserPublic(user: UserRecord): UserPublic {
  return {
    id: user._id,
    email: user.email,
    name: user.name,
    theme: user.theme,
    defaultCaptureType: user.defaultCaptureType,
    storageQuotaBytes: user.storageQuotaBytes,
    storageUsedBytes: user.storageUsedBytes,
    totpEnabled: Boolean(user.totpEnabled),
    createdAt: user.createdAt,
  };
}

export function toItemDto(item: ItemRecord): ItemDto {
  return {
    id: item._id,
    title: item.title,
    description: item.description,
    contentType: item.contentType,
    url: item.url,
    notes: item.notes,
    tags: item.tags,
    fileName: item.fileName,
    fileSize: item.fileSize,
    mimeType: item.mimeType,
    objectKey: item.objectKey,
    thumbnailKey: item.thumbnailKey,
    favorite: item.favorite,
    archived: item.archived,
    trashed: item.trashed,
    inbox: item.inbox !== false,
    locked: item.locked ?? false,
    contentHash: item.contentHash,
    reminderAt: item.reminderAt,
    expiresAt: item.expiresAt,
    status: item.status,
    metadata: item.metadata,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    accessedAt: item.accessedAt,
  };
}

export function toTagDto(tag: TagRecord, itemCount: number): TagDto {
  return {
    id: tag._id,
    name: tag.name,
    color: tag.color,
    itemCount,
    createdAt: tag.createdAt,
  };
}

export async function buildStorageUsage(
  db: Database,
  env: AppEnv,
  user: UserRecord,
): Promise<StorageUsageDto> {
  const quota = user.storageQuotaBytes || parseQuota(env);
  const used = user.storageUsedBytes;
  const reserved = user.storageReservedBytes;
  const pending = await db.listUploads(user._id, ['reserved', 'uploading']);
  const failed = await db.listUploads(user._id, ['failed']);
  const largest = await db.largestFiles(user._id, 10);
  return {
    usedBytes: used,
    reservedBytes: reserved,
    quotaBytes: quota,
    availableBytes: Math.max(0, quota - used - reserved),
    percentUsed: quota > 0 ? Math.min(100, ((used + reserved) / quota) * 100) : 0,
    pendingUploads: pending.length,
    failedUploads: failed.length,
    largestFiles: largest.map((i) => ({
      id: i._id,
      title: i.title,
      fileName: i.fileName,
      fileSize: i.fileSize || 0,
      contentType: i.contentType,
    })),
  };
}

export async function buildDashboard(
  db: Database,
  env: AppEnv,
  user: UserRecord,
): Promise<DashboardDto> {
  const [recent, favorites, accessed, storage, pending, failed, all] = await Promise.all([
    db.listItems({ userId: user._id, limit: 8, sort: 'newest', trashed: false, archived: false }),
    db.listItems({ userId: user._id, limit: 6, favorite: true, trashed: false, archived: false }),
    db.listItems({ userId: user._id, limit: 6, sort: 'newest', trashed: false, archived: false }),
    buildStorageUsage(db, env, user),
    db.countItems(user._id, { status: 'uploading' }),
    db.countItems(user._id, { status: 'failed' }),
    db.listItems({ userId: user._id, limit: 1, trashed: false, archived: false }),
  ]);

  // recently accessed: sort by accessedAt among non-trashed
  const accessedSorted = [...accessed.items]
    .filter((i) => i.accessedAt)
    .sort((a, b) => (b.accessedAt || '').localeCompare(a.accessedAt || ''))
    .slice(0, 6);

  const byType = {
    bookmark: 0,
    image: 0,
    video: 0,
    file: 0,
    project: 0,
    audio: 0,
    note: 0,
  } as Record<(typeof CONTENT_TYPES)[number], number>;

  // count by type efficiently enough for personal scale
  await Promise.all(
    (Object.keys(byType) as Array<keyof typeof byType>).map(async (t) => {
      byType[t] = await db.countItems(user._id, {
        contentType: t,
        trashed: false,
        archived: false,
      });
    }),
  );

  return {
    welcomeName: user.name.split(' ')[0] || user.name,
    totalItems: all.total,
    recentItems: recent.items.map(toItemDto),
    favorites: favorites.items.map(toItemDto),
    recentlyAccessed: accessedSorted.map(toItemDto),
    storage,
    pendingUploads: pending,
    failedSyncs: failed,
    byType,
  };
}
