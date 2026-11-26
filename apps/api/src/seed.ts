import { loadNodeEnv } from './env';
import { getDatabase, resetDatabaseCache } from './db';
import { hashPassword, randomId } from './lib/crypto';
import { DEFAULT_STORAGE_QUOTA_BYTES } from '@vault/shared';

const env = loadNodeEnv();

if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) {
  console.error(
    'Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD in .env to seed an admin account.',
  );
  process.exit(1);
}

resetDatabaseCache();
const db = await getDatabase(env);

const email = env.BOOTSTRAP_ADMIN_EMAIL;
const existing = await db.findUserByEmail(email);
if (existing) {
  console.log('Admin already exists:', email);
  process.exit(0);
}

const now = new Date().toISOString();
const user = await db.createUser({
  _id: randomId(12),
  email: email.toLowerCase(),
  name: env.BOOTSTRAP_ADMIN_NAME || 'Vault Owner',
  passwordHash: await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD),
  theme: 'dark',
  storageQuotaBytes: DEFAULT_STORAGE_QUOTA_BYTES,
  storageUsedBytes: 0,
  storageReservedBytes: 0,
  createdAt: now,
  updatedAt: now,
});

console.log('Created admin user:', user.email);
await db.close();
