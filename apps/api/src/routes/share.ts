import { Hono } from 'hono';
import { createShareLinkSchema } from '@vault/shared';
import type { ShareLinkDto } from '@vault/shared';
import type { Bindings, Variables } from '../env';
import { getDatabase } from '../db';
import { randomId, sha256Hex } from '../lib/crypto';
import { notFound } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/security';
import { createStorageService } from '../services/storage';
import { toItemDto } from '../services/mappers';
import type { ShareLinkRecord } from '../db/types';

export const shareRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function buildShareUrl(publicApiUrl: string, token: string): string {
  return `${publicApiUrl.replace(/\/$/, '')}/api/share/${token}`;
}

function toShareLinkDto(link: ShareLinkRecord, url: string): ShareLinkDto {
  return {
    id: link._id,
    itemId: link.itemId,
    url,
    expiresAt: link.expiresAt,
    createdAt: link.createdAt,
    revokedAt: link.revokedAt,
  };
}

// Create a share link for one of the caller's items.
shareRoutes.post(
  '/',
  requireAuth,
  rateLimit({ keyPrefix: 'share-create', limit: 20, windowMs: 60_000 }),
  async (c) => {
    const body = createShareLinkSchema.parse(await c.req.json());
    const db = await getDatabase(c.env);
    const userId = c.get('userId');
    const item = await db.findItemById(userId, body.itemId);
    if (!item) throw notFound('Item not found');

    const token = randomId(24);
    const tokenHash = await sha256Hex(token);
    const now = new Date().toISOString();
    const link: ShareLinkRecord = {
      _id: randomId(12),
      userId,
      itemId: item._id,
      tokenHash,
      expiresAt: new Date(Date.now() + body.expiresInHours * 60 * 60 * 1000).toISOString(),
      createdAt: now,
    };
    await db.createShareLink(link);

    const publicApiUrl = c.env.PUBLIC_API_URL || new URL(c.req.url).origin;
    return c.json({ shareLink: toShareLinkDto(link, buildShareUrl(publicApiUrl, token)) }, 201);
  },
);

// Revoke a share link the caller created.
shareRoutes.delete('/:id', requireAuth, async (c) => {
  const db = await getDatabase(c.env);
  const link = await db.revokeShareLink(c.get('userId'), c.req.param('id'));
  if (!link) throw notFound('Share link not found');
  return c.json({ ok: true });
});

// Public: fetch metadata for a share token, or a short-lived download URL with ?download=1.
// No auth — the token itself is the credential.
shareRoutes.get(
  '/:token',
  rateLimit({ keyPrefix: 'share-token', limit: 60, windowMs: 60_000 }),
  async (c) => {
    const token = c.req.param('token');
    const db = await getDatabase(c.env);
    const tokenHash = await sha256Hex(token);
    const link = await db.findShareLinkByTokenHash(tokenHash);
    if (!link || link.revokedAt) throw notFound('Share link not found');
    if (new Date(link.expiresAt).getTime() < Date.now()) throw notFound('Share link expired');

    const item = await db.findItemById(link.userId, link.itemId);
    if (!item || item.trashed) throw notFound('Item not found');

    if (c.req.query('download') === '1') {
      const storage = await createStorageService(c.env, db, c.env);
      const publicApiUrl = c.env.PUBLIC_API_URL || new URL(c.req.url).origin;
      const result = await storage.getDownloadUrl(link.userId, item._id, publicApiUrl, {
        disposition: 'attachment',
        touchAccess: false,
      });
      return c.json(result);
    }

    return c.json({ item: toItemDto(item), expiresAt: link.expiresAt });
  },
);
