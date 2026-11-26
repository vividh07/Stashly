import { Hono } from 'hono';
import { tagSchema } from '@vault/shared';
import type { Bindings, Variables } from '../env';
import { getDatabase } from '../db';
import { randomId } from '../lib/crypto';
import { conflict, notFound } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { toTagDto } from '../services/mappers';

export const tagRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

tagRoutes.use('*', requireAuth);

tagRoutes.get('/', async (c) => {
  const db = await getDatabase(c.env);
  const userId = c.get('userId');
  const tags = await db.listTags(userId);
  const withCounts = await Promise.all(
    tags.map(async (t) => {
      const listed = await db.listItems({
        userId,
        tags: [t.name],
        limit: 1,
        trashed: false,
      });
      return toTagDto(t, listed.total);
    }),
  );
  return c.json({ tags: withCounts });
});

tagRoutes.post('/', async (c) => {
  const body = tagSchema.parse(await c.req.json());
  const db = await getDatabase(c.env);
  const userId = c.get('userId');
  const existing = await db.findTagByName(userId, body.name);
  if (existing) throw conflict('Tag already exists');
  const now = new Date().toISOString();
  const tag = await db.createTag({
    _id: randomId(10),
    userId,
    name: body.name.toLowerCase(),
    color: body.color,
    createdAt: now,
    updatedAt: now,
  });
  return c.json({ tag: toTagDto(tag, 0) }, 201);
});

tagRoutes.patch('/:id', async (c) => {
  const body = tagSchema.partial().parse(await c.req.json());
  const db = await getDatabase(c.env);
  const tag = await db.updateTag(c.get('userId'), c.req.param('id'), {
    ...body,
    name: body.name?.toLowerCase(),
    updatedAt: new Date().toISOString(),
  });
  if (!tag) throw notFound('Tag not found');
  return c.json({ tag: toTagDto(tag, 0) });
});

tagRoutes.delete('/:id', async (c) => {
  const db = await getDatabase(c.env);
  const ok = await db.deleteTag(c.get('userId'), c.req.param('id'));
  if (!ok) throw notFound('Tag not found');
  return c.json({ ok: true });
});
