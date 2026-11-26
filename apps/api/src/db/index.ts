import type { AppEnv } from '../env';
import { isTestEnv } from '../env';
import { FileDatabase } from './file-db';
import { MongoDatabase } from './mongo-db';
import type { Database } from './types';
import { logger } from '../lib/logger';

let dbPromise: Promise<Database> | null = null;

export async function getDatabase(env: AppEnv): Promise<Database> {
  if (!dbPromise) {
    dbPromise = createDatabase(env).catch((err) => {
      // Don't cache a failed connect — next request should retry (e.g. Atlas wake / IP allowlist).
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

async function createDatabase(env: AppEnv): Promise<Database> {
  // File DB is test-only. Runtime always uses MongoDB Atlas.
  if (isTestEnv(env) && env.DATA_DIR) {
    const fileDb = new FileDatabase(env.DATA_DIR);
    await fileDb.ensureIndexes();
    logger.info('Using in-test file database', { dataDir: env.DATA_DIR });
    return fileDb;
  }

  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required');
  }

  const mongo = new MongoDatabase(env.MONGODB_URI);
  await mongo.connect();
  await mongo.ensureIndexes();
  logger.info('Connected to MongoDB Atlas');
  return mongo;
}

export function resetDatabaseCache() {
  dbPromise = null;
}

export type { Database } from './types';
