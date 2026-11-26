import { Hono } from 'hono';
import {
  bulkActionSchema,
  cleanUrl,
  itemCreateSchema,
  itemLockSchema,
  itemUpdateSchema,
  searchQuerySchema,
} from '@vault/shared';
import type { DuplicateMatchDto } from '@vault/shared';
import type { Bindings, Variables } from '../env';
import { getDatabase } from '../db';
import { randomId } from '../lib/crypto';
import { verifyArchivePin } from '../lib/archive-pin';
import { badRequest, notFound, unauthorized } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { createStorageService } from '../services/storage';
import { toItemDto } from '../services/mappers';
import type { ItemRecord } from '../db/types';

export const itemRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

itemRoutes.use('*', requireAuth);

itemRoutes.get('/', async (c) => {
  const q = searchQuerySchema.parse(c.req.query());
  const db = await getDatabase(c.env);
  const tags = q.tags
    ? q.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;
  const result = await db.listItems({
    userId: c.get('userId'),
    q: q.q,
    contentType: q.contentType,
    tags,
    favorite: q.favorite,
    archived: q.archived,
    trashed: q.trashed,
    inbox: q.inbox,
    due: q.due,
    locked: q.locked,
    sort: q.sort,
    cursor: q.cursor,
    limit: q.limit || 40,
    from: q.from,
    to: q.to,
  });
  return c.json({
    items: result.items.map(toItemDto),
    nextCursor: result.nextCursor || null,
    total: result.total,
  });
});

itemRoutes.post('/', async (c) => {
  const body = itemCreateSchema.parse(await c.req.json());
  const db = await getDatabase(c.env);
  const userId = c.get('userId');

  if (body.idempotencyKey) {
    const existing = await db.findItemByIdempotency(userId, body.idempotencyKey);
    if (existing) return c.json({ item: toItemDto(existing) });
  }

  const now = new Date().toISOString();
  const item: ItemRecord = {
    _id: randomId(12),
    userId,
    title: body.title,
    description: body.description || null,
    contentType: body.contentType,
    url: body.url || null,
    notes: body.notes || null,
    tags: body.tags || [],
    fileName: body.fileName || null,
    fileSize: body.fileSize || null,
    mimeType: body.mimeType || null,
    favorite: false,
    archived: false,
    trashed: false,
    inbox: false,
    locked: false,
    status: 'synced',
    idempotencyKey: body.idempotencyKey || null,
    metadata: body.metadata,
    createdAt: now,
    updatedAt: now,
  };
  await db.createItem(item);
  await upsertTags(db, userId, item.tags);
  return c.json({ item: toItemDto(item) }, 201);
});

itemRoutes.get('/duplicates', async (c) => {
  const db = await getDatabase(c.env);
  const userId = c.get('userId');
  const contentHash = c.req.query('contentHash');
  const rawUrl = c.req.query('url');

  const duplicates: DuplicateMatchDto[] = [];
  if (contentHash) {
    const byHash = await db.findItemByContentHash(userId, contentHash);
    if (byHash) duplicates.push({ item: toItemDto(byHash), reason: 'contentHash' });
  }
  if (rawUrl) {
    const byUrl = await db.findItemByUrl(userId, cleanUrl(rawUrl));
    if (byUrl && !byUrl.trashed && !duplicates.some((d) => d.item.id === byUrl._id)) {
      duplicates.push({ item: toItemDto(byUrl), reason: 'url' });
    }
  }
  return c.json({ duplicates });
});

itemRoutes.get('/due', async (c) => {
  const db = await getDatabase(c.env);
  const items = await db.listDueItems(c.get('userId'));
  return c.json({ items: items.map(toItemDto) });
});

itemRoutes.post('/:id/lock', async (c) => {
  const body = itemLockSchema.parse(await c.req.json());
  const db = await getDatabase(c.env);
  const userId = c.get('userId');
  const existing = await db.findItemById(userId, c.req.param('id'));
  if (!existing) throw notFound('Item not found');

  // Unlocking requires the archive PIN; locking does not.
  if (body.locked === false) {
    if (!body.pin) throw badRequest('PIN required to unlock');
    const user = await db.findUserById(userId);
    if (!user) throw unauthorized();
    if (!(await verifyArchivePin(body.pin, user.archivePinHash))) {
      throw unauthorized('Invalid archive PIN');
    }
  }

  const item = await db.updateItem(userId, existing._id, {
    locked: body.locked,
    updatedAt: new Date().toISOString(),
  });
  if (!item) throw notFound('Item not found');
  return c.json({ item: toItemDto(item) });
});

itemRoutes.get('/:id', async (c) => {
  const db = await getDatabase(c.env);
  const item = await db.findItemById(c.get('userId'), c.req.param('id'));
  if (!item) throw notFound('Item not found');
  await db.updateItem(c.get('userId'), item._id, { accessedAt: new Date().toISOString() });
  return c.json({ item: toItemDto(item) });
});

itemRoutes.patch('/:id', async (c) => {
  const body = itemUpdateSchema.parse(await c.req.json());
  const db = await getDatabase(c.env);
  const userId = c.get('userId');
  const existing = await db.findItemById(userId, c.req.param('id'));
  if (!existing) throw notFound('Item not found');

  const now = new Date().toISOString();
  let patch: Partial<ItemRecord> = { ...body, updatedAt: now };
  if (body.trashed === true) {
    patch.deletedAt = now;
    patch.inbox = false;
  }
  if (body.trashed === false) patch.deletedAt = null;

  // Archiving moves the item out of libraries into the dedicated `archive` tag.
  if (body.archived === true && !existing.archived) {
    patch = { ...patch, ...buildArchivePatch(existing, now) };
  } else if (body.archived === false && existing.archived) {
    patch = { ...patch, ...buildUnarchivePatch(existing, now) };
  }

  const item = await db.updateItem(userId, existing._id, patch);
  if (!item) throw notFound('Item not found');
  if (item.tags?.length) await upsertTags(db, userId, item.tags);
  return c.json({ item: toItemDto(item) });
});

itemRoutes.post('/:id/trash', async (c) => {
  const db = await getDatabase(c.env);
  const userId = c.get('userId');
  const id = c.req.param('id');
  const existing = await db.findItemById(userId, id);
  if (!existing) throw notFound('Item not found');
  if (existing.trashed) {
    return c.json({ item: toItemDto(existing) });
  }
  const now = new Date().toISOString();
  const item = await db.updateItem(userId, existing._id, {
    trashed: true,
    inbox: false,
    deletedAt: now,
  });
  if (!item) {
    // Race: another request may have trashed/deleted it — re-read once.
    const again = await db.findItemById(userId, id);
    if (again?.trashed) return c.json({ item: toItemDto(again) });
    throw notFound('Failed to move item to trash');
  }
  return c.json({ item: toItemDto(item) });
});

itemRoutes.delete('/:id', async (c) => {
  const db = await getDatabase(c.env);
  const userId = c.get('userId');
  const item = await db.findItemById(userId, c.req.param('id'));
  if (!item) throw notFound('Item not found');

  // Soft-delete first unless already trashed or permanent=true.
  const permanent = c.req.query('permanent') === 'true' || item.trashed;
  if (!permanent) {
    const now = new Date().toISOString();
    const updated = await db.updateItem(userId, item._id, {
      trashed: true,
      inbox: false,
      deletedAt: now,
    });
    if (!updated) {
      const again = await db.findItemById(userId, item._id);
      if (again?.trashed) return c.json({ item: toItemDto(again) });
      throw notFound('Failed to move item to trash');
    }
    return c.json({ item: toItemDto(updated) });
  }

  if (item.objectKey) {
    try {
      const storage = await createStorageService(c.env, db, c.env);
      await storage.deleteObject(item.objectKey).catch(() => undefined);
    } catch {
      /* Still remove the DB row even if R2 cleanup fails */
    }
    if (item.fileSize) {
      const user = await db.findUserById(userId);
      if (user) {
        await db.updateUser(userId, {
          storageUsedBytes: Math.max(0, user.storageUsedBytes - (item.fileSize || 0)),
        });
      }
    }
  }
  const removed = await db.deleteItem(userId, item._id);
  if (!removed) throw notFound('Failed to delete item');
  return c.json({ ok: true });
});

itemRoutes.post('/bulk', async (c) => {
  const body = bulkActionSchema.parse(await c.req.json());
  const db = await getDatabase(c.env);
  const userId = c.get('userId');
  const now = new Date().toISOString();

  switch (body.action) {
    case 'favorite':
    case 'unfavorite':
    case 'trash':
    case 'keep':
    case 'lock':
    case 'unlock': {
      const patch: Partial<ItemRecord> =
        body.action === 'favorite'
          ? { favorite: true, updatedAt: now }
          : body.action === 'unfavorite'
            ? { favorite: false, updatedAt: now }
            : body.action === 'trash'
              ? { trashed: true, inbox: false, deletedAt: now, updatedAt: now }
              : body.action === 'keep'
                ? { inbox: false, updatedAt: now }
                : body.action === 'lock'
                  ? { locked: true, updatedAt: now }
                  : { locked: false, updatedAt: now };
      const n = await db.bulkUpdateItems(userId, body.ids, patch);
      return c.json({ updated: n });
    }
    case 'archive':
    case 'unarchive':
    case 'restore': {
      let updated = 0;
      for (const id of body.ids) {
        const item = await db.findItemById(userId, id);
        if (!item) continue;
        let patch: Partial<ItemRecord>;
        if (body.action === 'archive') {
          if (item.archived) continue;
          patch = buildArchivePatch(item, now);
        } else if (body.action === 'unarchive') {
          if (!item.archived) continue;
          patch = buildUnarchivePatch(item, now);
        } else {
          // restore from trash — also leave archive if it was archived
          patch = item.archived
            ? { ...buildUnarchivePatch(item, now), trashed: false, deletedAt: null }
            : { trashed: false, deletedAt: null, archived: false, updatedAt: now };
        }
        await db.updateItem(userId, id, patch);
        if (patch.tags?.length) await upsertTags(db, userId, patch.tags);
        updated += 1;
      }
      return c.json({ updated });
    }
    case 'tag': {
      for (const id of body.ids) {
        const item = await db.findItemById(userId, id);
        if (!item) continue;
        const tags = Array.from(new Set([...(item.tags || []), ...(body.tags || [])]));
        await db.updateItem(userId, id, { tags, updatedAt: now });
      }
      if (body.tags) await upsertTags(db, userId, body.tags);
      return c.json({ ok: true });
    }
    case 'delete': {
      for (const id of body.ids) {
        const item = await db.findItemById(userId, id);
        if (!item) continue;
        if (item.objectKey) {
          try {
            const storage = await createStorageService(c.env, db, c.env);
            await storage.deleteObject(item.objectKey).catch(() => undefined);
          } catch {
            /* keep going — DB row must still be removed */
          }
        }
        if (item.fileSize) {
          const user = await db.findUserById(userId);
          if (user) {
            await db.updateUser(userId, {
              storageUsedBytes: Math.max(0, user.storageUsedBytes - (item.fileSize || 0)),
            });
          }
        }
        await db.deleteItem(userId, id);
      }
      return c.json({ ok: true });
    }
    default:
      return c.json({ updated: 0 });
  }
});

const ARCHIVE_TAG = 'archive';

function buildArchivePatch(item: ItemRecord, now: string): Partial<ItemRecord> {
  const prevTags = (item.tags || []).filter((t) => t.toLowerCase() !== ARCHIVE_TAG);
  return {
    archived: true,
    inbox: false,
    tags: [ARCHIVE_TAG],
    metadata: {
      ...(item.metadata || {}),
      preArchiveTags: prevTags,
    },
    updatedAt: now,
  };
}

function buildUnarchivePatch(item: ItemRecord, now: string): Partial<ItemRecord> {
  const saved = item.metadata?.preArchiveTags;
  const restored = Array.isArray(saved)
    ? saved.filter((t): t is string => typeof t === 'string' && t.toLowerCase() !== ARCHIVE_TAG)
    : (item.tags || []).filter((t) => t.toLowerCase() !== ARCHIVE_TAG);
  const metadata = { ...(item.metadata || {}) };
  delete metadata.preArchiveTags;
  return {
    archived: false,
    tags: restored,
    metadata,
    updatedAt: now,
  };
}

async function upsertTags(
  db: Awaited<ReturnType<typeof getDatabase>>,
  userId: string,
  tags: string[],
) {
  for (const name of tags) {
    const existing = await db.findTagByName(userId, name);
    if (!existing) {
      const now = new Date().toISOString();
      await db.createTag({
        _id: randomId(10),
        userId,
        name: name.toLowerCase(),
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}
