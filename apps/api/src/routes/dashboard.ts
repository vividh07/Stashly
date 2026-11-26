import { Hono } from 'hono';
import type { Bindings, Variables } from '../env';
import { getDatabase } from '../db';
import { unauthorized } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { buildDashboard } from '../services/mappers';

export const dashboardRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

dashboardRoutes.get('/', requireAuth, async (c) => {
  const db = await getDatabase(c.env);
  const user = await db.findUserById(c.get('userId'));
  if (!user) throw unauthorized();
  const dashboard = await buildDashboard(db, c.env, user);
  return c.json({ dashboard });
});
