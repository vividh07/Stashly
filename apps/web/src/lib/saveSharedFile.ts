import { inferContentTypeFromMime, type ContentType, type ItemDto } from '@vault/shared';
import { api, uploadToPresigned } from './api';
import { queuePendingUpload } from './sync';
import type { SharedFileRecord } from './shareTarget';

export async function saveSharedFile(
  file: SharedFileRecord,
  opts?: { title?: string; onProgress?: (pct: number) => void },
): Promise<{ item?: ItemDto; queued: boolean; contentType: ContentType }> {
  const mimeType = file.type || 'application/octet-stream';
  const contentType = inferContentTypeFromMime(mimeType);
  const title = opts?.title?.trim() || file.name;
  const idempotencyKey = crypto.randomUUID();

  if (!navigator.onLine) {
    await queuePendingUpload({
      id: idempotencyKey,
      fileName: file.name,
      mimeType,
      fileSize: file.size,
      title,
      contentType,
      blob: file.buffer,
      createdAt: new Date().toISOString(),
      attempts: 0,
    });
    return { queued: true, contentType };
  }

  const { upload } = await api.requestUpload({
    fileName: file.name,
    mimeType,
    fileSize: file.size,
    title,
    contentType,
    idempotencyKey,
  });
  if (!upload.uploadUrl) throw new Error('Missing upload URL');

  const blobFile = new File([file.buffer], file.name, { type: mimeType });
  opts?.onProgress?.(0);
  const { etag } = await uploadToPresigned(upload.uploadUrl, blobFile, opts?.onProgress);
  const done = await api.completeUpload(upload.id, etag);
  return { item: done.item, queued: false, contentType };
}

export function libraryPathForType(contentType: ContentType): string {
  switch (contentType) {
    case 'image':
      return '/images';
    case 'video':
      return '/videos';
    case 'audio':
      return '/audio';
    case 'project':
      return '/projects';
    case 'bookmark':
      return '/bookmarks';
    case 'note':
      return '/notes';
    default:
      return '/files';
  }
}
