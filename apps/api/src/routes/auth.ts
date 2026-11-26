import { Hono } from 'hono';
import {
  archivePinResetSchema,
  archivePinVerifySchema,
  changePasswordSchema,
  DEFAULT_STORAGE_QUOTA_BYTES,
  forgotPasswordSchema,
  loginSchema,
  profileUpdateSchema,
  purgeVaultSchema,
  registerSchema,
  resetPasswordSchema,
  resetPasswordWithTotpSchema,
  totpDisableSchema,
  totpEnableSchema,
} from '@vault/shared';
import type { Bindings, Variables } from '../env';
import { parseQuota, registrationAllowed } from '../env';
import { getDatabase } from '../db';
import type { UserRecord } from '../db/types';
import { hashPassword, randomId, sha256Hex, verifyPassword } from '../lib/crypto';
import { DEFAULT_ARCHIVE_PIN_HASH, hashArchivePin, verifyArchivePin } from '../lib/archive-pin';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors';
import {
  clearCookie,
  CSRF_COOKIE,
  issueSession,
  requireAuth,
  resolveSession,
  SESSION_COOKIE,
  setCookie,
} from '../middleware/auth';
import { rateLimit } from '../middleware/security';
import { toUserPublic } from '../services/mappers';
import { sendPasswordResetEmail } from '../lib/email';
import { logger } from '../lib/logger';
import {
  buildOtpAuthUri,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  verifyTotpCode,
} from '../lib/totp';

function encKey(env: Bindings): string {
  return env.JWT_SECRET || env.CSRF_SECRET;
}

async function ensureArchivePinHash(user: UserRecord, db: Awaited<ReturnType<typeof getDatabase>>) {
  if (user.archivePinHash) return user;
  const updated = await db.updateUser(user._id, {
    archivePinHash: DEFAULT_ARCHIVE_PIN_HASH,
    updatedAt: new Date().toISOString(),
  });
  return updated || user;
}

async function unlockTotpSecret(user: UserRecord, env: Bindings): Promise<string | null> {
  const enc = user.totpEnabled ? user.totpSecretEnc : user.totpPendingSecretEnc;
  if (!enc) return null;
  return decryptSecret(enc, encKey(env));
}

export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function isSecure(c: { env: Bindings; req: { url: string } }) {
  return c.env.NODE_ENV === 'production' || c.req.url.startsWith('https://');
}

authRoutes.get('/status', async (c) => {
  const open = registrationAllowed(c.env);
  const db = await getDatabase(c.env);
  const users = await db.listUsers(1);
  return c.json({
    registrationOpen: open,
    allowRegistration: open,
    totpEnabled: Boolean(users[0]?.totpEnabled),
  });
});

authRoutes.post(
  '/register',
  rateLimit({ keyPrefix: 'register', limit: 5, windowMs: 60_000 }),
  async (c) => {
    if (!registrationAllowed(c.env)) {
      throw forbidden('Public registration is disabled');
    }
    const db = await getDatabase(c.env);
    const body = registerSchema.parse(await c.req.json());
    const existing = await db.findUserByEmail(body.email);
    if (existing) throw conflict('Email already registered');

    const now = new Date().toISOString();
    const user = await db.createUser({
      _id: randomId(12),
      email: body.email.toLowerCase(),
      name: body.name,
      passwordHash: await hashPassword(body.password),
      theme: 'dark',
      storageQuotaBytes: parseQuota(c.env) || DEFAULT_STORAGE_QUOTA_BYTES,
      storageUsedBytes: 0,
      storageReservedBytes: 0,
      totpEnabled: false,
      archivePinHash: DEFAULT_ARCHIVE_PIN_HASH,
      createdAt: now,
      updatedAt: now,
    });

    const session = await issueSession(c.env, user._id, {
      userAgent: c.req.header('user-agent') || undefined,
      ip: c.req.header('cf-connecting-ip') || undefined,
    });
    const secure = isSecure(c);
    c.header(
      'Set-Cookie',
      setCookie(SESSION_COOKIE, session.token, {
        maxAge: session.maxAge,
        httpOnly: true,
        secure,
        sameSite: 'Lax',
      }),
    );
    c.header(
      'Set-Cookie',
      setCookie(CSRF_COOKIE, session.csrf, {
        maxAge: session.maxAge,
        httpOnly: false,
        secure,
        sameSite: 'Lax',
      }),
      { append: true },
    );
    return c.json({ user: toUserPublic(user), csrfToken: session.csrf }, 201);
  },
);

authRoutes.post(
  '/login',
  rateLimit({ keyPrefix: 'login', limit: 10, windowMs: 60_000 }),
  async (c) => {
    const body = loginSchema.parse(await c.req.json());
    const db = await getDatabase(c.env);
    const user = await db.findUserByEmail(body.email);
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw unauthorized('Invalid email or password');
    }
    const session = await issueSession(c.env, user._id, {
      userAgent: c.req.header('user-agent') || undefined,
      ip: c.req.header('cf-connecting-ip') || undefined,
    });
    const secure = isSecure(c);
    c.header(
      'Set-Cookie',
      setCookie(SESSION_COOKIE, session.token, {
        maxAge: session.maxAge,
        httpOnly: true,
        secure,
        sameSite: 'Lax',
      }),
    );
    c.header(
      'Set-Cookie',
      setCookie(CSRF_COOKIE, session.csrf, {
        maxAge: session.maxAge,
        httpOnly: false,
        secure,
        sameSite: 'Lax',
      }),
      { append: true },
    );
    return c.json({ user: toUserPublic(user), csrfToken: session.csrf });
  },
);

const RESET_TTL_MS = 30 * 60 * 1000;

authRoutes.post(
  '/forgot-password',
  rateLimit({ keyPrefix: 'forgot-password', limit: 5, windowMs: 60_000 }),
  async (c) => {
    forgotPasswordSchema.parse(await c.req.json().catch(() => ({})));
    const db = await getDatabase(c.env);
    const users = await db.listUsers(1);
    const user = users[0];
    if (!user) {
      throw badRequest('No vault account is configured');
    }

    const token = randomId(32);
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
    await db.updateUser(user._id, {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expiresAt,
    });

    const origin = (c.env.APP_ORIGIN || 'http://127.0.0.1:4173').replace(/\/$/, '');
    const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`;

    try {
      await sendPasswordResetEmail(c.env, user.email, resetUrl);
    } catch (err) {
      logger.error('Password reset email failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      await db.updateUser(user._id, {
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      });
      throw badRequest('Unable to send reset email right now. Try again later.');
    }

    return c.json({
      ok: true,
      message: 'A password reset link was sent to your registered email.',
    });
  },
);

authRoutes.post(
  '/reset-password',
  rateLimit({ keyPrefix: 'reset-password', limit: 10, windowMs: 60_000 }),
  async (c) => {
    const body = resetPasswordSchema.parse(await c.req.json());
    const db = await getDatabase(c.env);
    const tokenHash = await sha256Hex(body.token);
    const user = await db.findUserByPasswordResetTokenHash(tokenHash);
    if (!user?.passwordResetExpiresAt) {
      throw badRequest('Invalid or expired reset link');
    }
    if (new Date(user.passwordResetExpiresAt).getTime() < Date.now()) {
      await db.updateUser(user._id, {
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      });
      throw badRequest('Invalid or expired reset link');
    }

    await db.updateUser(user._id, {
      passwordHash: await hashPassword(body.password),
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      updatedAt: new Date().toISOString(),
    });
    await db.deleteSessionsForUser(user._id);
    return c.json({ ok: true, message: 'Password updated. You can sign in now.' });
  },
);

authRoutes.post('/logout', requireAuth, async (c) => {
  const db = await getDatabase(c.env);
  await db.deleteSession(c.get('sessionId'));
  const secure = isSecure(c);
  c.header('Set-Cookie', clearCookie(SESSION_COOKIE, secure));
  c.header('Set-Cookie', clearCookie(CSRF_COOKIE, secure), { append: true });
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const session = await resolveSession(c.env, c.req.header('cookie'));
  if (!session) return c.json({ user: null });
  const db = await getDatabase(c.env);
  const user = await db.findUserById(session.userId);
  if (!user) return c.json({ user: null });
  return c.json({ user: toUserPublic(user) });
});

authRoutes.patch('/me', requireAuth, async (c) => {
  const body = profileUpdateSchema.parse(await c.req.json());
  const db = await getDatabase(c.env);
  const user = await db.updateUser(c.get('userId'), {
    ...body,
    updatedAt: new Date().toISOString(),
  });
  if (!user) throw unauthorized();
  return c.json({ user: toUserPublic(user) });
});

authRoutes.post('/change-password', requireAuth, async (c) => {
  const body = changePasswordSchema.parse(await c.req.json());
  if (body.currentPassword === body.newPassword) {
    throw badRequest('New password must be different');
  }
  const db = await getDatabase(c.env);
  const user = await db.findUserById(c.get('userId'));
  if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
    throw unauthorized('Current password is incorrect');
  }
  await db.updateUser(user._id, {
    passwordHash: await hashPassword(body.newPassword),
    updatedAt: new Date().toISOString(),
  });
  await db.deleteSessionsForUser(user._id);
  return c.json({ ok: true });
});

/** Delete all vault content for the signed-in user. Keeps account, password, TOTP, archive PIN. */
authRoutes.post(
  '/purge-data',
  requireAuth,
  rateLimit({ keyPrefix: 'purge-data', limit: 3, windowMs: 60 * 60_000 }),
  async (c) => {
    const body = purgeVaultSchema.parse(await c.req.json());
    const db = await getDatabase(c.env);
    const userId = c.get('userId');
    const user = await db.findUserById(userId);
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw unauthorized('Password is incorrect');
    }

    const { deletedItems, objectKeys } = await db.purgeUserData(userId);

    let filesRemoved = 0;
    if (objectKeys.length) {
      try {
        const { createStorageService } = await import('../services/storage');
        const storage = await createStorageService(c.env, db, c.env);
        for (const key of objectKeys) {
          try {
            await storage.deleteObject(key);
            filesRemoved += 1;
          } catch {
            /* continue — metadata already gone */
          }
        }
      } catch (err) {
        logger.error('purge-data R2 cleanup failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const refreshed = await db.findUserById(userId);
    return c.json({
      ok: true,
      deletedItems,
      filesRemoved,
      user: refreshed ? toUserPublic(refreshed) : toUserPublic(user),
    });
  },
);

authRoutes.get('/totp/status', requireAuth, async (c) => {
  const db = await getDatabase(c.env);
  const user = await db.findUserById(c.get('userId'));
  if (!user) throw unauthorized();
  return c.json({ enabled: Boolean(user.totpEnabled) });
});

authRoutes.post('/totp/setup', requireAuth, async (c) => {
  const db = await getDatabase(c.env);
  const user = await db.findUserById(c.get('userId'));
  if (!user) throw unauthorized();
  if (user.totpEnabled) throw badRequest('Authenticator is already enabled');

  const secret = generateTotpSecret();
  const enc = await encryptSecret(secret, encKey(c.env));
  await db.updateUser(user._id, {
    totpPendingSecretEnc: enc,
    updatedAt: new Date().toISOString(),
  });
  const otpauthUrl = buildOtpAuthUri({
    secret,
    accountName: user.email,
    issuer: 'Aether Vault',
  });
  return c.json({ secret, otpauthUrl });
});

authRoutes.post(
  '/totp/enable',
  requireAuth,
  rateLimit({ keyPrefix: 'totp-enable', limit: 10, windowMs: 60_000 }),
  async (c) => {
    const body = totpEnableSchema.parse(await c.req.json());
    const db = await getDatabase(c.env);
    const user = await db.findUserById(c.get('userId'));
    if (!user?.totpPendingSecretEnc) throw badRequest('Start authenticator setup first');
    const secret = await decryptSecret(user.totpPendingSecretEnc, encKey(c.env));
    if (!secret) throw badRequest('Setup expired — start again');
    if (!(await verifyTotpCode(secret, body.code))) {
      throw unauthorized('Invalid authenticator code');
    }
    const updated = await db.updateUser(user._id, {
      totpSecretEnc: user.totpPendingSecretEnc,
      totpPendingSecretEnc: null,
      totpEnabled: true,
      updatedAt: new Date().toISOString(),
    });
    return c.json({ ok: true, user: toUserPublic(updated || user) });
  },
);

authRoutes.post(
  '/totp/disable',
  requireAuth,
  rateLimit({ keyPrefix: 'totp-disable', limit: 8, windowMs: 60_000 }),
  async (c) => {
    const body = totpDisableSchema.parse(await c.req.json());
    const db = await getDatabase(c.env);
    const user = await db.findUserById(c.get('userId'));
    if (!user?.totpEnabled || !user.totpSecretEnc) {
      throw badRequest('Authenticator is not enabled');
    }
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      throw unauthorized('Password is incorrect');
    }
    const secret = await decryptSecret(user.totpSecretEnc, encKey(c.env));
    if (!secret || !(await verifyTotpCode(secret, body.code))) {
      throw unauthorized('Invalid authenticator code');
    }
    const updated = await db.updateUser(user._id, {
      totpEnabled: false,
      totpSecretEnc: null,
      totpPendingSecretEnc: null,
      updatedAt: new Date().toISOString(),
    });
    return c.json({ ok: true, user: toUserPublic(updated || user) });
  },
);

authRoutes.post(
  '/reset-password-totp',
  rateLimit({ keyPrefix: 'reset-password-totp', limit: 5, windowMs: 60_000 }),
  async (c) => {
    const body = resetPasswordWithTotpSchema.parse(await c.req.json());
    const db = await getDatabase(c.env);
    const users = await db.listUsers(1);
    const user = users[0];
    if (!user?.totpEnabled || !user.totpSecretEnc) {
      throw badRequest('Authenticator is not set up for this vault');
    }
    const secret = await decryptSecret(user.totpSecretEnc, encKey(c.env));
    if (!secret || !(await verifyTotpCode(secret, body.code))) {
      throw unauthorized('Invalid authenticator code');
    }
    await db.updateUser(user._id, {
      passwordHash: await hashPassword(body.password),
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      updatedAt: new Date().toISOString(),
    });
    await db.deleteSessionsForUser(user._id);
    return c.json({ ok: true, message: 'Password updated. You can sign in now.' });
  },
);

authRoutes.post(
  '/archive-pin/verify',
  requireAuth,
  rateLimit({ keyPrefix: 'archive-pin-verify', limit: 12, windowMs: 60_000 }),
  async (c) => {
    const body = archivePinVerifySchema.parse(await c.req.json());
    const db = await getDatabase(c.env);
    let user = await db.findUserById(c.get('userId'));
    if (!user) throw unauthorized();
    user = await ensureArchivePinHash(user, db);
    if (!(await verifyArchivePin(body.pin, user.archivePinHash))) {
      throw unauthorized('Invalid archive PIN');
    }
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    return c.json({ ok: true, expiresAt });
  },
);

authRoutes.post(
  '/archive-pin/reset',
  requireAuth,
  rateLimit({ keyPrefix: 'archive-pin-reset', limit: 5, windowMs: 60_000 }),
  async (c) => {
    const body = archivePinResetSchema.parse(await c.req.json());
    const db = await getDatabase(c.env);
    const user = await db.findUserById(c.get('userId'));
    if (!user?.totpEnabled || !user.totpSecretEnc) {
      throw badRequest('Enable authenticator first to reset the archive PIN');
    }
    const secret = await unlockTotpSecret(user, c.env);
    if (!secret || !(await verifyTotpCode(secret, body.code))) {
      throw unauthorized('Invalid authenticator code');
    }
    await db.updateUser(user._id, {
      archivePinHash: await hashArchivePin(body.pin),
      updatedAt: new Date().toISOString(),
    });
    return c.json({ ok: true, message: 'Archive PIN updated' });
  },
);
