import { Hono } from 'hono';
import {
  captureNoteSchema,
  captureUrlSchema,
  cleanUrl,
  inferContentTypeFromUrl,
} from '@vault/shared';
import type { Bindings, Variables } from '../env';
import { getDatabase } from '../db';
import { randomId } from '../lib/crypto';
import { badRequest } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/security';
import { assertSafeUrl, fetchSafeMetadata, parseHtmlMetadata } from '../lib/ssrf';
import { toItemDto } from '../services/mappers';
import type { ItemRecord } from '../db/types';

export const captureRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

captureRoutes.use('*', requireAuth);

captureRoutes.post(
  '/url',
  rateLimit({ keyPrefix: 'capture-url', limit: 30, windowMs: 60_000 }),
  async (c) => {
    const body = captureUrlSchema.parse(await c.req.json());
    try {
      assertSafeUrl(body.url);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Invalid URL');
    }

    const db = await getDatabase(c.env);
    const userId = c.get('userId');

    if (body.idempotencyKey) {
      const existing = await db.findItemByIdempotency(userId, body.idempotencyKey);
      if (existing) return c.json({ item: toItemDto(existing) });
    }

    const cleaned = cleanUrl(body.url);
    const existingByUrl = await db.findItemByUrl(userId, cleaned);
    if (existingByUrl && !existingByUrl.trashed) {
      return c.json({ item: toItemDto(existingByUrl), duplicate: true });
    }

    let meta = {
      title: '',
      description: '',
      image: '',
      favicon: '',
      siteName: '',
      domain: '',
    };
    try {
      const fetched = await fetchSafeMetadata(body.url);
      meta = parseHtmlMetadata(fetched.html, fetched.url);
    } catch {
      try {
        meta.domain = new URL(body.url).hostname.replace(/^www\./, '');
      } catch {
        /* ignore */
      }
    }

    const contentType = body.contentType || inferContentTypeFromUrl(body.url);
    const now = new Date().toISOString();
    const item: ItemRecord = {
      _id: randomId(12),
      userId,
      title: body.title || meta.title || meta.domain || body.url,
      description: body.description || meta.description || null,
      contentType,
      url: cleaned,
      notes: body.notes || null,
      tags: body.tags || [],
      favorite: false,
      archived: false,
      trashed: false,
      inbox: false,
      locked: false,
      status: 'synced',
      idempotencyKey: body.idempotencyKey || null,
      metadata: {
        favicon: meta.favicon,
        previewImage: meta.image,
        siteName: meta.siteName,
        domain: meta.domain,
      },
      createdAt: now,
      updatedAt: now,
    };
    await db.createItem(item);
    return c.json({ item: toItemDto(item) }, 201);
  },
);

captureRoutes.post(
  '/note',
  rateLimit({ keyPrefix: 'capture-note', limit: 60, windowMs: 60_000 }),
  async (c) => {
    const body = captureNoteSchema.parse(await c.req.json());
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
      description: body.body.slice(0, 280),
      contentType: 'note',
      notes: body.body,
      tags: body.tags || [],
      favorite: false,
      archived: false,
      trashed: false,
      inbox: false,
      locked: false,
      status: 'synced',
      idempotencyKey: body.idempotencyKey || null,
      metadata: { markdown: body.markdown !== false },
      createdAt: now,
      updatedAt: now,
    };
    await db.createItem(item);
    return c.json({ item: toItemDto(item) }, 201);
  },
);

captureRoutes.post('/', async (c) => {
  // Universal capture: decide based on payload shape
  const json = await c.req.json();
  if (typeof json?.url === 'string' && json.url) {
    // re-dispatch manually
    try {
      assertSafeUrl(json.url);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Invalid URL');
    }
    const body = captureUrlSchema.parse(json);
    c.req.raw = new Request(c.req.url, {
      method: 'POST',
      headers: c.req.raw.headers,
      body: JSON.stringify(body),
    });
    // Fall through by calling same logic — simpler to duplicate thin wrapper:
  }
  if (typeof json?.body === 'string' || json?.contentType === 'note') {
    const body = captureNoteSchema.parse({
      title: json.title || 'Quick note',
      body: json.body || json.notes || '',
      tags: json.tags,
      markdown: json.markdown,
      idempotencyKey: json.idempotencyKey,
    });
    const db = await getDatabase(c.env);
    const userId = c.get('userId');
    const now = new Date().toISOString();
    const item: ItemRecord = {
      _id: randomId(12),
      userId,
      title: body.title,
      description: body.body.slice(0, 280),
      contentType: 'note',
      notes: body.body,
      tags: body.tags || [],
      favorite: false,
      archived: false,
      trashed: false,
      inbox: false,
      locked: false,
      status: 'synced',
      idempotencyKey: body.idempotencyKey || null,
      metadata: { markdown: body.markdown !== false },
      createdAt: now,
      updatedAt: now,
    };
    await db.createItem(item);
    return c.json({ item: toItemDto(item) }, 201);
  }

  if (typeof json?.url === 'string') {
    const body = captureUrlSchema.parse(json);
    try {
      assertSafeUrl(body.url);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Invalid URL');
    }
    const db = await getDatabase(c.env);
    const userId = c.get('userId');

    if (body.idempotencyKey) {
      const existing = await db.findItemByIdempotency(userId, body.idempotencyKey);
      if (existing) return c.json({ item: toItemDto(existing) });
    }

    const cleaned = cleanUrl(body.url);
    const existingByUrl = await db.findItemByUrl(userId, cleaned);
    if (existingByUrl && !existingByUrl.trashed) {
      return c.json({ item: toItemDto(existingByUrl), duplicate: true });
    }

    let meta = { title: '', description: '', image: '', favicon: '', siteName: '', domain: '' };
    try {
      const fetched = await fetchSafeMetadata(body.url);
      meta = parseHtmlMetadata(fetched.html, fetched.url);
    } catch {
      try {
        meta.domain = new URL(body.url).hostname.replace(/^www\./, '');
      } catch {
        /* ignore */
      }
    }
    const now = new Date().toISOString();
    const item: ItemRecord = {
      _id: randomId(12),
      userId,
      title: body.title || meta.title || meta.domain || body.url,
      description: body.description || meta.description || null,
      contentType: body.contentType || inferContentTypeFromUrl(body.url),
      url: cleaned,
      notes: body.notes || null,
      tags: body.tags || [],
      favorite: false,
      archived: false,
      trashed: false,
      inbox: false,
      locked: false,
      status: 'synced',
      idempotencyKey: body.idempotencyKey || null,
      metadata: {
        favicon: meta.favicon,
        previewImage: meta.image,
        siteName: meta.siteName,
        domain: meta.domain,
      },
      createdAt: now,
      updatedAt: now,
    };
    await db.createItem(item);
    return c.json({ item: toItemDto(item) }, 201);
  }

  throw badRequest('Provide a url or note body');
});
