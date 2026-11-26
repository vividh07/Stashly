import { Hono } from 'hono';
import { completeUploadSchema, uploadUrlSchema } from '@vault/shared';
import type { Bindings, Variables } from '../env';
import { getDatabase } from '../db';
import { badRequest, notFound, unauthorized } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/security';
import { createStorageService } from '../services/storage';
import { buildStorageUsage, toItemDto } from '../services/mappers';

export const storageRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

storageRoutes.get('/usage', requireAuth, async (c) => {
  const db = await getDatabase(c.env);
  const user = await db.findUserById(c.get('userId'));
  if (!user) throw unauthorized();
  const usage = await buildStorageUsage(db, c.env, user);
  return c.json({ usage });
});

storageRoutes.post(
  '/upload-url',
  requireAuth,
  rateLimit({ keyPrefix: 'upload-url', limit: 40, windowMs: 60_000 }),
  async (c) => {
    const body = uploadUrlSchema.parse(await c.req.json());
    const db = await getDatabase(c.env);
    const storage = await createStorageService(c.env, db, c.env);
    const publicApiUrl = c.env.PUBLIC_API_URL || new URL(c.req.url).origin;
    const result = await storage.createUpload({
      userId: c.get('userId'),
      fileName: body.fileName,
      mimeType: body.mimeType,
      fileSize: body.fileSize,
      contentType: body.contentType,
      title: body.title,
      description: body.description,
      notes: body.notes,
      tags: body.tags,
      url: body.url,
      idempotencyKey: body.idempotencyKey,
      contentHash: body.contentHash,
      publicApiUrl,
    });
    return c.json(
      {
        item: toItemDto(result.item),
        duplicate: result.duplicate ? toItemDto(result.duplicate) : null,
        upload: {
          id: result.upload._id,
          itemId: result.upload.itemId,
          objectKey: result.upload.objectKey,
          fileName: result.upload.fileName,
          mimeType: result.upload.mimeType,
          fileSize: result.upload.fileSize,
          status: result.upload.status,
          uploadUrl: result.uploadUrl,
          expiresAt: result.upload.expiresAt,
          createdAt: result.upload.createdAt,
        },
      },
      201,
    );
  },
);

storageRoutes.post('/complete-upload', requireAuth, async (c) => {
  const body = completeUploadSchema.parse(await c.req.json());
  const db = await getDatabase(c.env);
  const storage = await createStorageService(c.env, db, c.env);
  const item = await storage.completeUpload(c.get('userId'), body.uploadId, body.etag, body.contentHash);
  return c.json({ item: toItemDto(item) });
});

storageRoutes.get('/hygiene', requireAuth, async (c) => {
  const db = await getDatabase(c.env);
  const hygiene = await db.getStorageHygiene(c.get('userId'), 10);
  return c.json({
    largestFiles: hygiene.largestFiles.map(toItemDto),
    unusedArchiveCandidates: hygiene.unusedArchiveCandidates.map(toItemDto),
    trashCount: hygiene.trashCount,
    expiredItems: hygiene.expiredItems.map(toItemDto),
    duplicateGroups: hygiene.duplicateGroups.map((g) => ({
      contentHash: g.contentHash,
      count: g.count,
      items: g.items.map(toItemDto),
    })),
  });
});

storageRoutes.post('/download-url', requireAuth, async (c) => {
  const json = await c.req.json<{
    itemId?: string;
    fileId?: string;
    disposition?: 'inline' | 'attachment';
    preview?: boolean;
  }>();
  const itemId = json.itemId || json.fileId;
  if (!itemId) throw badRequest('itemId required');
  const disposition = json.disposition === 'inline' || json.preview ? 'inline' : 'attachment';
  const db = await getDatabase(c.env);
  const storage = await createStorageService(c.env, db, c.env);
  const publicApiUrl = c.env.PUBLIC_API_URL || new URL(c.req.url).origin;
  const result = await storage.getDownloadUrl(c.get('userId'), itemId, publicApiUrl, {
    disposition,
    touchAccess: disposition === 'attachment',
  });
  return c.json(result);
});

storageRoutes.get('/:fileId', requireAuth, async (c) => {
  const db = await getDatabase(c.env);
  const item = await db.findItemById(c.get('userId'), c.req.param('fileId'));
  if (!item) throw notFound('File not found');
  return c.json({ item: toItemDto(item) });
});

storageRoutes.delete('/:fileId', requireAuth, async (c) => {
  const db = await getDatabase(c.env);
  const storage = await createStorageService(c.env, db, c.env);
  const userId = c.get('userId');
  const item = await db.findItemById(userId, c.req.param('fileId'));
  if (!item) throw notFound('File not found');
  if (item.objectKey) await storage.deleteObject(item.objectKey);
  if (item.fileSize) {
    const user = await db.findUserById(userId);
    if (user) {
      await db.updateUser(userId, {
        storageUsedBytes: Math.max(0, user.storageUsedBytes - item.fileSize),
      });
    }
  }
  await db.updateItem(userId, item._id, {
    objectKey: null,
    fileSize: 0,
    status: 'synced',
    updatedAt: new Date().toISOString(),
  });
  return c.json({ ok: true });
});

// Direct upload endpoint — browser PUTs here (same-origin) so R2 CORS is not required.
storageRoutes.put('/direct/:uploadId', requireAuth, async (c) => {
  const db = await getDatabase(c.env);
  const storage = await createStorageService(c.env, db, c.env);
  const upload = await db.findUploadById(c.get('userId'), c.req.param('uploadId'));
  if (!upload) throw notFound('Upload not found');
  if (new Date(upload.expiresAt).getTime() < Date.now()) {
    await db.updateUpload(c.get('userId'), upload._id, { status: 'expired' });
    await db.releaseReservation(c.get('userId'), upload.fileSize);
    throw badRequest('Upload URL expired');
  }

  const declared = Number(c.req.header('content-length') || 0);
  if (declared > upload.fileSize) throw badRequest('Payload too large');

  if (storage.putObjectStream && c.req.raw.body) {
    await storage.putObjectStream(
      upload.objectKey,
      c.req.raw.body,
      upload.mimeType,
      declared || upload.fileSize,
    );
    return c.json({ ok: true, bytes: declared || upload.fileSize });
  }

  if (!storage.putLocalObject) throw badRequest('Direct upload not supported in this mode');
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > upload.fileSize) throw badRequest('Payload too large');
  await storage.putLocalObject(upload.objectKey, buf, upload.mimeType);
  return c.json({ ok: true, bytes: buf.byteLength });
});

storageRoutes.get('/download-direct/:itemId', requireAuth, async (c) => {
  const db = await getDatabase(c.env);
  const storage = await createStorageService(c.env, db, c.env);
  const item = await db.findItemById(c.get('userId'), c.req.param('itemId'));
  if (!item?.objectKey) throw notFound('File not found');
  if (!storage.getLocalObject) throw badRequest('Direct download not supported in this mode');
  const obj = await storage.getLocalObject(item.objectKey);
  if (!obj) throw notFound('Object missing');
  const inline = c.req.query('inline') === '1';
  if (!inline) {
    await db.updateItem(c.get('userId'), item._id, { accessedAt: new Date().toISOString() });
  }
  const safeName = (item.fileName || 'file').replace(/"/g, '');
  return new Response(obj.body, {
    headers: {
      'Content-Type': item.mimeType || obj.mimeType,
      'Content-Disposition': inline
        ? `inline; filename="${safeName}"`
        : `attachment; filename="${safeName}"`,
      'Cache-Control': 'private, max-age=60',
    },
  });
});
