import { get, set, del, keys } from 'idb-keyval';
import type { ContentType, ItemDto } from '@vault/shared';
import { api, uploadToPresigned } from './api';

const PENDING_PREFIX = 'pending-upload:';
const PENDING_URL_PREFIX = 'pending-url:';
const PENDING_NOTE_PREFIX = 'pending-note:';

export interface PendingUpload {
  kind: 'upload';
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  title?: string;
  notes?: string;
  tags?: string[];
  contentType?: string;
  contentHash?: string;
  blob: ArrayBuffer;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export interface PendingUrlCapture {
  kind: 'url';
  id: string;
  url: string;
  title?: string;
  notes?: string;
  tags?: string[];
  contentType?: ContentType;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export interface PendingNoteCapture {
  kind: 'note';
  id: string;
  title: string;
  body: string;
  tags?: string[];
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export type PendingQueueItem = PendingUpload | PendingUrlCapture | PendingNoteCapture;

function keyFor(item: Pick<PendingQueueItem, 'kind' | 'id'>): string {
  if (item.kind === 'upload') return PENDING_PREFIX + item.id;
  if (item.kind === 'url') return PENDING_URL_PREFIX + item.id;
  return PENDING_NOTE_PREFIX + item.id;
}

/** Queue a file upload for when the connection returns. Back-compat: `kind` is added automatically. */
export async function queuePendingUpload(pending: Omit<PendingUpload, 'kind'>) {
  const full: PendingUpload = { ...pending, kind: 'upload' };
  await set(keyFor(full), full);
}

export async function queuePendingUrlCapture(pending: Omit<PendingUrlCapture, 'kind'>) {
  const full: PendingUrlCapture = { ...pending, kind: 'url' };
  await set(keyFor(full), full);
}

export async function queuePendingNoteCapture(pending: Omit<PendingNoteCapture, 'kind'>) {
  const full: PendingNoteCapture = { ...pending, kind: 'note' };
  await set(keyFor(full), full);
}

export async function listPendingUploads(): Promise<PendingUpload[]> {
  const allKeys = await keys();
  const pendingKeys = allKeys.filter((k) => String(k).startsWith(PENDING_PREFIX));
  const items: PendingUpload[] = [];
  for (const k of pendingKeys) {
    const v = await get<PendingUpload>(k);
    if (v) items.push(v);
  }
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** All queued items (uploads, URL captures, notes) across kinds, oldest first. */
export async function listPendingQueue(): Promise<PendingQueueItem[]> {
  const allKeys = await keys();
  const prefixes = [PENDING_PREFIX, PENDING_URL_PREFIX, PENDING_NOTE_PREFIX];
  const matching = allKeys.filter((k) => prefixes.some((p) => String(k).startsWith(p)));
  const items: PendingQueueItem[] = [];
  for (const k of matching) {
    const v = await get<PendingQueueItem>(k);
    if (v) items.push(v);
  }
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removePendingUpload(id: string) {
  await del(PENDING_PREFIX + id);
}

export async function clearPendingQueue(): Promise<number> {
  const pending = await listPendingQueue();
  for (const item of pending) {
    await del(keyFor(item));
  }
  return pending.length;
}

export async function removePendingQueueItem(item: Pick<PendingQueueItem, 'kind' | 'id'>) {
  await del(keyFor(item));
}

async function markAttemptFailed(item: PendingQueueItem, err: unknown) {
  const lastError = err instanceof Error ? err.message : 'Sync failed';
  await set(keyFor(item), { ...item, attempts: item.attempts + 1, lastError });
}

async function flushOne(item: PendingQueueItem): Promise<ItemDto> {
  if (item.kind === 'upload') {
    const { item: created, upload } = await api.requestUpload({
      fileName: item.fileName,
      mimeType: item.mimeType,
      fileSize: item.fileSize,
      title: item.title,
      notes: item.notes,
      tags: item.tags,
      contentType: item.contentType,
      contentHash: item.contentHash,
      idempotencyKey: item.id,
    });
    if (!upload.uploadUrl) throw new Error('Missing upload URL');
    const file = new File([item.blob], item.fileName, { type: item.mimeType });
    const { etag } = await uploadToPresigned(upload.uploadUrl, file);
    const completed = await api.completeUpload(upload.id, etag, item.contentHash);
    return completed.item || created;
  }
  if (item.kind === 'url') {
    const res = await api.captureUrl({
      url: item.url,
      title: item.title || undefined,
      notes: item.notes || undefined,
      tags: item.tags,
      contentType: item.contentType,
      idempotencyKey: item.id,
    });
    return res.item;
  }
  const res = await api.captureNote({
    title: item.title,
    body: item.body,
    tags: item.tags,
    idempotencyKey: item.id,
  });
  return res.item;
}

/** Retry a single queued item immediately. Throws on failure (caller should surface the error). */
export async function retryPendingItem(item: PendingQueueItem, onItem?: (item: ItemDto) => void): Promise<void> {
  try {
    const result = await flushOne(item);
    await removePendingQueueItem(item);
    onItem?.(result);
  } catch (err) {
    await markAttemptFailed(item, err);
    throw err;
  }
}

export async function flushPendingUploads(
  onItem?: (item: ItemDto) => void,
): Promise<{ synced: number; failed: number }> {
  const pending = await listPendingUploads();
  let synced = 0;
  let failed = 0;
  for (const p of pending) {
    try {
      const result = await flushOne(p);
      await removePendingUpload(p.id);
      onItem?.(result);
      synced++;
    } catch (err) {
      failed++;
      await markAttemptFailed(p, err);
    }
  }
  return { synced, failed };
}

/** Flush the full offline queue: uploads, URL captures, and notes. */
export async function flushPendingQueue(
  onItem?: (item: ItemDto) => void,
): Promise<{ synced: number; failed: number }> {
  const pending = await listPendingQueue();
  let synced = 0;
  let failed = 0;
  for (const p of pending) {
    try {
      const result = await flushOne(p);
      await removePendingQueueItem(p);
      onItem?.(result);
      synced++;
    } catch (err) {
      failed++;
      await markAttemptFailed(p, err);
    }
  }
  return { synced, failed };
}
