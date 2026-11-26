import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, writeFile, readFile, unlink, access, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import {
  hasR2Credentials,
  isTestEnv,
  parseQuota,
  presignTtlSeconds,
  resolveR2Endpoint,
  type AppEnv,
  type Bindings,
} from '../env';
import { randomId } from '../lib/crypto';
import { badRequest, notFound, payloadTooLarge, quotaExceeded, serverError } from '../lib/errors';
import {
  ALLOWED_MIME_TYPES,
  getSizeLimitForMime,
  inferContentTypeFromMime,
  type ContentType,
} from '@vault/shared';
import type { Database } from '../db/types';
import type { ItemRecord, UploadRecord } from '../db/types';

/** Same-origin relative paths so the web app (Vite proxy / Pages) can attach cookies + CSRF. */
function apiMediatedUrl(pathname: string): string {
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

export interface StorageService {
  createUpload(params: {
    userId: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    contentType?: ContentType;
    title?: string;
    description?: string;
    notes?: string;
    tags?: string[];
    url?: string;
    idempotencyKey?: string;
    contentHash?: string;
    publicApiUrl: string;
  }): Promise<{ item: ItemRecord; upload: UploadRecord; uploadUrl: string; duplicate: ItemRecord | null }>;
  completeUpload(
    userId: string,
    uploadId: string,
    etag?: string,
    contentHash?: string,
  ): Promise<ItemRecord>;
  getDownloadUrl(
    userId: string,
    itemId: string,
    publicApiUrl: string,
    opts?: { disposition?: 'inline' | 'attachment'; touchAccess?: boolean },
  ): Promise<{ url: string; expiresAt: string }>;
  deleteObject(objectKey: string): Promise<void>;
  objectExists(objectKey: string): Promise<{ exists: boolean; size?: number }>;
  putLocalObject?(objectKey: string, body: ArrayBuffer, mimeType: string): Promise<void>;
  /** Stream body to R2 (multipart) — used for large video/audio without loading into RAM. */
  putObjectStream?(
    objectKey: string,
    body: ReadableStream<Uint8Array> | Readable,
    mimeType: string,
    contentLength: number,
  ): Promise<void>;
  getLocalObject?(objectKey: string): Promise<{ body: Uint8Array; mimeType: string } | null>;
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ()[\]]+/g, '_');
  if (!base || base === '.' || base === '..') return 'file';
  return base.slice(0, 200);
}

function buildObjectKey(userId: string, fileName: string): string {
  const safe = sanitizeFileName(fileName);
  const stamp = new Date().toISOString().slice(0, 10);
  return `users/${userId}/${stamp}/${randomId(12)}_${safe}`;
}

function validateUploadInput(mimeType: string, fileSize: number) {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw badRequest('File type not allowed', { mimeType });
  }
  const limit = getSizeLimitForMime(mimeType);
  if (fileSize > limit) {
    throw payloadTooLarge(`File exceeds limit of ${limit} bytes for type ${mimeType}`);
  }
}

export async function createStorageService(
  env: AppEnv,
  db: Database,
  bindings?: Bindings,
): Promise<StorageService> {
  if (hasR2Credentials(env)) {
    return createR2Storage(env, db);
  }
  // Prefer Workers R2 binding when present
  if (bindings?.VAULT_BUCKET) {
    return createR2BindingStorage(env, db, bindings.VAULT_BUCKET);
  }
  // Local disk objects are test-only
  if (isTestEnv(env)) {
    return createLocalStorage(env, db);
  }
  throw serverError(
    'Cloudflare R2 is required. Set R2 credentials or bind VAULT_BUCKET.',
  );
}

function createR2Client(env: AppEnv) {
  return new S3Client({
    region: 'auto',
    endpoint: resolveR2Endpoint(env),
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  });
}

function createR2Storage(env: AppEnv, db: Database): StorageService {
  const client = createR2Client(env);
  const bucket = env.R2_BUCKET_NAME;
  const ttl = presignTtlSeconds(env);

  // Browser → API → R2 (same-origin, no R2 CORS). Large files stream via multipart.
  return {
    async createUpload(params) {
      validateUploadInput(params.mimeType, params.fileSize);
      if (params.idempotencyKey) {
        const existingUpload = await db.findUploadByIdempotency(params.userId, params.idempotencyKey);
        if (existingUpload) {
          const item = await db.findItemById(params.userId, existingUpload.itemId);
          if (item) {
            return {
              item,
              upload: existingUpload,
              uploadUrl: apiMediatedUrl(`/api/storage/direct/${existingUpload._id}`),
              duplicate: null,
            };
          }
        }
      }

      const duplicate = params.contentHash
        ? await db.findItemByContentHash(params.userId, params.contentHash)
        : null;

      const quota = parseQuota(env);
      const reserved = await db.reserveStorage(params.userId, params.fileSize, quota);
      if (!reserved) throw quotaExceeded();

      const now = new Date().toISOString();
      const objectKey = buildObjectKey(params.userId, params.fileName);
      const contentType =
        params.contentType || inferContentTypeFromMime(params.mimeType);
      const itemId = randomId(12);
      const uploadId = randomId(12);

      const item: ItemRecord = {
        _id: itemId,
        userId: params.userId,
        title: params.title || params.fileName,
        description: params.description || null,
        contentType,
        url: params.url || null,
        notes: params.notes || null,
        tags: params.tags || [],
        fileName: params.fileName,
        fileSize: params.fileSize,
        mimeType: params.mimeType,
        objectKey,
        favorite: false,
        archived: false,
        trashed: false,
        inbox: false,
        locked: false,
        contentHash: params.contentHash || null,
        status: 'uploading',
        idempotencyKey: params.idempotencyKey || null,
        createdAt: now,
        updatedAt: now,
      };

      const upload: UploadRecord = {
        _id: uploadId,
        userId: params.userId,
        itemId,
        objectKey,
        fileName: params.fileName,
        mimeType: params.mimeType,
        fileSize: params.fileSize,
        status: 'uploading',
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        createdAt: now,
        updatedAt: now,
        idempotencyKey: params.idempotencyKey || null,
      };

      try {
        await db.createItem(item);
        await db.createUpload(upload);
        return {
          item,
          upload,
          uploadUrl: apiMediatedUrl(`/api/storage/direct/${uploadId}`),
          duplicate,
        };
      } catch (err) {
        await db.releaseReservation(params.userId, params.fileSize);
        throw err;
      }
    },

    async completeUpload(userId, uploadId, etag, contentHash) {
      const upload = await db.findUploadById(userId, uploadId);
      if (!upload) throw notFound('Upload not found');
      if (upload.status === 'completed') {
        const item = await db.findItemById(userId, upload.itemId);
        if (!item) throw notFound('Item not found');
        return item;
      }

      const head = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: upload.objectKey }),
      );
      const actualSize = head.ContentLength ?? 0;
      if (actualSize <= 0) throw badRequest('Uploaded object missing or empty');
      if (actualSize > upload.fileSize) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: upload.objectKey }));
        await db.releaseReservation(userId, upload.fileSize);
        await db.updateUpload(userId, uploadId, { status: 'failed' });
        await db.updateItem(userId, upload.itemId, { status: 'failed' });
        throw payloadTooLarge('Uploaded object larger than reserved size');
      }

      await db.commitReservation(userId, upload.fileSize, actualSize);
      await db.updateUpload(userId, uploadId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        etag: etag || head.ETag || null,
        fileSize: actualSize,
      });
      const item = await db.updateItem(userId, upload.itemId, {
        status: 'synced',
        fileSize: actualSize,
        ...(contentHash ? { contentHash } : {}),
      });
      if (!item) throw notFound('Item not found');
      return item;
    },

    async getDownloadUrl(userId, itemId, _publicApiUrl, opts) {
      const item = await db.findItemById(userId, itemId);
      if (!item?.objectKey) throw notFound('File not found');
      const disposition = opts?.disposition === 'inline' ? 'inline' : 'attachment';
      const filename = item.fileName ? sanitizeFileName(item.fileName) : 'file';
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: item.objectKey,
          ResponseContentDisposition: `${disposition}; filename="${filename}"`,
          ResponseContentType: item.mimeType || undefined,
        }),
        { expiresIn: ttl },
      );
      if (opts?.touchAccess !== false) {
        await db.updateItem(userId, itemId, { accessedAt: new Date().toISOString() });
      }
      return { url, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
    },

    async deleteObject(objectKey) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    },

    async objectExists(objectKey) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
        return { exists: true, size: head.ContentLength };
      } catch {
        return { exists: false };
      }
    },

    async putLocalObject(objectKey, body, mimeType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: Buffer.from(body),
          ContentType: mimeType,
        }),
      );
    },

    async putObjectStream(objectKey, body, mimeType, contentLength) {
      const stream =
        body instanceof Readable
          ? body
          : Readable.fromWeb(body as import('node:stream/web').ReadableStream);
      const upload = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: objectKey,
          Body: stream,
          ContentType: mimeType,
          ...(contentLength > 0 ? { ContentLength: contentLength } : {}),
        },
        queueSize: 4,
        partSize: 16 * 1024 * 1024,
        leavePartsOnError: false,
      });
      await upload.done();
    },

    async getLocalObject(objectKey) {
      try {
        const out = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
        );
        const bytes = await out.Body?.transformToByteArray();
        if (!bytes) return null;
        return {
          body: bytes,
          mimeType: out.ContentType || 'application/octet-stream',
        };
      } catch {
        return null;
      }
    },
  };
}

function createR2BindingStorage(env: AppEnv, db: Database, bucket: R2Bucket): StorageService {
  // R2 bindings don't support S3 presigned URLs the same way; use API-mediated upload endpoints.
  const local = createLocalLikeViaBinding(env, db, bucket);
  return local;
}

function createLocalLikeViaBinding(env: AppEnv, db: Database, bucket: R2Bucket): StorageService {
  const ttl = presignTtlSeconds(env);
  return {
    async createUpload(params) {
      validateUploadInput(params.mimeType, params.fileSize);
      const duplicate = params.contentHash
        ? await db.findItemByContentHash(params.userId, params.contentHash)
        : null;

      const quota = parseQuota(env);
      const reserved = await db.reserveStorage(params.userId, params.fileSize, quota);
      if (!reserved) throw quotaExceeded();

      const now = new Date().toISOString();
      const objectKey = buildObjectKey(params.userId, params.fileName);
      const itemId = randomId(12);
      const uploadId = randomId(12);
      const contentType = params.contentType || inferContentTypeFromMime(params.mimeType);

      const item: ItemRecord = {
        _id: itemId,
        userId: params.userId,
        title: params.title || params.fileName,
        description: params.description || null,
        contentType,
        url: params.url || null,
        notes: params.notes || null,
        tags: params.tags || [],
        fileName: params.fileName,
        fileSize: params.fileSize,
        mimeType: params.mimeType,
        objectKey,
        favorite: false,
        archived: false,
        trashed: false,
        inbox: false,
        locked: false,
        contentHash: params.contentHash || null,
        status: 'uploading',
        idempotencyKey: params.idempotencyKey || null,
        createdAt: now,
        updatedAt: now,
      };
      const upload: UploadRecord = {
        _id: uploadId,
        userId: params.userId,
        itemId,
        objectKey,
        fileName: params.fileName,
        mimeType: params.mimeType,
        fileSize: params.fileSize,
        status: 'uploading',
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        createdAt: now,
        updatedAt: now,
        idempotencyKey: params.idempotencyKey || null,
      };

      try {
        await db.createItem(item);
        await db.createUpload(upload);
        const uploadUrl = apiMediatedUrl(`/api/storage/direct/${uploadId}`);
        return { item, upload, uploadUrl, duplicate };
      } catch (err) {
        await db.releaseReservation(params.userId, params.fileSize);
        throw err;
      }
    },
    async completeUpload(userId, uploadId, _etag, contentHash) {
      const upload = await db.findUploadById(userId, uploadId);
      if (!upload) throw notFound('Upload not found');
      const obj = await bucket.head(upload.objectKey);
      if (!obj) throw badRequest('Uploaded object missing');
      await db.commitReservation(userId, upload.fileSize, obj.size);
      await db.updateUpload(userId, uploadId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        fileSize: obj.size,
      });
      const item = await db.updateItem(userId, upload.itemId, {
        status: 'synced',
        fileSize: obj.size,
        ...(contentHash ? { contentHash } : {}),
      });
      if (!item) throw notFound('Item not found');
      return item;
    },
    async getDownloadUrl(userId, itemId, _publicApiUrl, opts) {
      const item = await db.findItemById(userId, itemId);
      if (!item?.objectKey) throw notFound('File not found');
      if (opts?.touchAccess !== false) {
        await db.updateItem(userId, itemId, { accessedAt: new Date().toISOString() });
      }
      const inline = opts?.disposition === 'inline' ? '?inline=1' : '';
      return {
        url: apiMediatedUrl(`/api/storage/download-direct/${itemId}${inline}`),
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      };
    },
    async deleteObject(objectKey) {
      await bucket.delete(objectKey);
    },
    async objectExists(objectKey) {
      const obj = await bucket.head(objectKey);
      return obj ? { exists: true, size: obj.size } : { exists: false };
    },
    async putLocalObject(objectKey, body, mimeType) {
      await bucket.put(objectKey, body, { httpMetadata: { contentType: mimeType } });
    },
    async getLocalObject(objectKey) {
      const obj = await bucket.get(objectKey);
      if (!obj) return null;
      const ab = await obj.arrayBuffer();
      return {
        body: new Uint8Array(ab),
        mimeType: obj.httpMetadata?.contentType || 'application/octet-stream',
      };
    },
  };
}

function createLocalStorage(env: AppEnv, db: Database): StorageService {
  const root = path.resolve(env.DATA_DIR || '.data', 'objects');
  const ttl = presignTtlSeconds(env);
  const mimeIndex = new Map<string, string>();

  const ensure = async () => mkdir(root, { recursive: true });
  const diskPath = (key: string) => {
    if (key.includes('..') || key.startsWith('/') || key.includes('\\')) {
      throw badRequest('Invalid object key');
    }
    return path.join(root, key);
  };

  return {
    async createUpload(params) {
      validateUploadInput(params.mimeType, params.fileSize);
      if (params.idempotencyKey) {
        const existingUpload = await db.findUploadByIdempotency(params.userId, params.idempotencyKey);
        if (existingUpload) {
          const item = await db.findItemById(params.userId, existingUpload.itemId);
          if (item) {
            return {
              item,
              upload: existingUpload,
              uploadUrl: apiMediatedUrl(`/api/storage/direct/${existingUpload._id}`),
              duplicate: null,
            };
          }
        }
      }

      const duplicate = params.contentHash
        ? await db.findItemByContentHash(params.userId, params.contentHash)
        : null;

      const quota = parseQuota(env);
      const reserved = await db.reserveStorage(params.userId, params.fileSize, quota);
      if (!reserved) throw quotaExceeded();

      const now = new Date().toISOString();
      const objectKey = buildObjectKey(params.userId, params.fileName);
      const itemId = randomId(12);
      const uploadId = randomId(12);
      const contentType = params.contentType || inferContentTypeFromMime(params.mimeType);

      const item: ItemRecord = {
        _id: itemId,
        userId: params.userId,
        title: params.title || params.fileName,
        description: params.description || null,
        contentType,
        url: params.url || null,
        notes: params.notes || null,
        tags: params.tags || [],
        fileName: params.fileName,
        fileSize: params.fileSize,
        mimeType: params.mimeType,
        objectKey,
        favorite: false,
        archived: false,
        trashed: false,
        inbox: false,
        locked: false,
        contentHash: params.contentHash || null,
        status: 'uploading',
        idempotencyKey: params.idempotencyKey || null,
        createdAt: now,
        updatedAt: now,
      };
      const upload: UploadRecord = {
        _id: uploadId,
        userId: params.userId,
        itemId,
        objectKey,
        fileName: params.fileName,
        mimeType: params.mimeType,
        fileSize: params.fileSize,
        status: 'uploading',
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        createdAt: now,
        updatedAt: now,
        idempotencyKey: params.idempotencyKey || null,
      };

      try {
        await ensure();
        await db.createItem(item);
        await db.createUpload(upload);
        mimeIndex.set(objectKey, params.mimeType);
        return {
          item,
          upload,
          uploadUrl: apiMediatedUrl(`/api/storage/direct/${uploadId}`),
          duplicate,
        };
      } catch (err) {
        await db.releaseReservation(params.userId, params.fileSize);
        throw err;
      }
    },

    async completeUpload(userId, uploadId, _etag, contentHash) {
      const upload = await db.findUploadById(userId, uploadId);
      if (!upload) throw notFound('Upload not found');
      if (upload.status === 'completed') {
        const item = await db.findItemById(userId, upload.itemId);
        if (!item) throw notFound('Item not found');
        return item;
      }
      const p = diskPath(upload.objectKey);
      try {
        await access(p);
      } catch {
        throw badRequest('Uploaded object missing');
      }
      const st = await stat(p);
      if (st.size <= 0) throw badRequest('Uploaded object empty');
      if (st.size > upload.fileSize) {
        await unlink(p).catch(() => undefined);
        await db.releaseReservation(userId, upload.fileSize);
        await db.updateUpload(userId, uploadId, { status: 'failed' });
        await db.updateItem(userId, upload.itemId, { status: 'failed' });
        throw payloadTooLarge('Uploaded object larger than reserved size');
      }
      await db.commitReservation(userId, upload.fileSize, st.size);
      await db.updateUpload(userId, uploadId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        fileSize: st.size,
      });
      const item = await db.updateItem(userId, upload.itemId, {
        status: 'synced',
        fileSize: st.size,
        ...(contentHash ? { contentHash } : {}),
      });
      if (!item) throw notFound('Item not found');
      return item;
    },

    async getDownloadUrl(userId, itemId, _publicApiUrl, opts) {
      const item = await db.findItemById(userId, itemId);
      if (!item?.objectKey) throw notFound('File not found');
      if (opts?.touchAccess !== false) {
        await db.updateItem(userId, itemId, { accessedAt: new Date().toISOString() });
      }
      const inline = opts?.disposition === 'inline' ? '?inline=1' : '';
      return {
        url: apiMediatedUrl(`/api/storage/download-direct/${itemId}${inline}`),
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      };
    },

    async deleteObject(objectKey) {
      await unlink(diskPath(objectKey)).catch(() => undefined);
      mimeIndex.delete(objectKey);
    },

    async objectExists(objectKey) {
      try {
        const st = await stat(diskPath(objectKey));
        return { exists: true, size: st.size };
      } catch {
        return { exists: false };
      }
    },

    async putLocalObject(objectKey, body, mimeType) {
      const p = diskPath(objectKey);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, Buffer.from(body));
      mimeIndex.set(objectKey, mimeType);
    },

    async getLocalObject(objectKey) {
      try {
        const body = await readFile(diskPath(objectKey));
        return {
          body: new Uint8Array(body),
          mimeType: mimeIndex.get(objectKey) || 'application/octet-stream',
        };
      } catch {
        return null;
      }
    },
  };
}

export async function abandonExpiredUploads(db: Database, storage: StorageService, userId?: string) {
  // cleanup helper used by reconciliation endpoint / startup
  void db;
  void storage;
  void userId;
  void serverError;
}
