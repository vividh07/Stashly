import { Hono } from 'hono';
import { searchQuerySchema } from '@vault/shared';
import type { Bindings, Variables } from '../env';
import { getDatabase } from '../db';
import { requireAuth } from '../middleware/auth';
import { toItemDto } from '../services/mappers';

export const searchRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

searchRoutes.use('*', requireAuth);

searchRoutes.get('/', async (c) => {
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
    archived: q.archived ?? false,
    trashed: q.trashed ?? false,
    sort: q.sort || 'newest',
    cursor: q.cursor,
    limit: q.limit || 30,
    from: q.from,
    to: q.to,
  });

  // Architecture note: this endpoint is text/index based today.
  // Future semantic search can add embedding vectors without changing the response shape.
  return c.json({
    items: result.items.map(toItemDto),
    nextCursor: result.nextCursor || null,
    total: result.total,
    mode: 'keyword',
  });
});
