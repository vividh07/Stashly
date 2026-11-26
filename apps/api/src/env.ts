import { DEFAULT_STORAGE_QUOTA_BYTES } from '@vault/shared';

export interface AppEnv {
  MONGODB_URI?: string;
  DATA_DIR?: string;
  JWT_SECRET: string;
  CSRF_SECRET: string;
  ALLOW_REGISTRATION: string;
  STORAGE_QUOTA_BYTES: string;
  CORS_ORIGIN: string;
  SESSION_TTL_SECONDS: string;
  PRESIGNED_URL_TTL_SECONDS: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  R2_ENDPOINT?: string;
  R2_BUCKET_NAME: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
  BOOTSTRAP_ADMIN_PASSWORD?: string;
  BOOTSTRAP_ADMIN_NAME?: string;
  PUBLIC_API_URL?: string;
  APP_ORIGIN?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  NODE_ENV?: string;
}

export type Bindings = AppEnv & {
  VAULT_BUCKET?: R2Bucket;
};

export type Variables = {
  userId: string;
  userEmail: string;
  sessionId: string;
  requestId: string;
};

export function isTestEnv(env: AppEnv): boolean {
  return env.NODE_ENV === 'test';
}

export function parseQuota(env: AppEnv): number {
  const n = Number(env.STORAGE_QUOTA_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STORAGE_QUOTA_BYTES;
}

export function registrationAllowed(env: AppEnv): boolean {
  return env.ALLOW_REGISTRATION === 'true' || env.ALLOW_REGISTRATION === '1';
}

export function sessionTtlSeconds(env: AppEnv): number {
  const n = Number(env.SESSION_TTL_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 60 * 60 * 24 * 7;
}

export function presignTtlSeconds(env: AppEnv): number {
  const n = Number(env.PRESIGNED_URL_TTL_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 900;
}

export function hasR2Credentials(env: AppEnv): boolean {
  return Boolean(
    env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      (env.R2_ENDPOINT || env.CLOUDFLARE_ACCOUNT_ID),
  );
}

export function resolveR2Endpoint(env: AppEnv): string {
  if (env.R2_ENDPOINT) return env.R2_ENDPOINT;
  if (env.CLOUDFLARE_ACCOUNT_ID) {
    return `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }
  throw new Error('R2_ENDPOINT or CLOUDFLARE_ACCOUNT_ID is required');
}

function requireVar(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function isPlaceholderMongoUri(uri: string): boolean {
  return /USER:PASSWORD|cluster\.mongodb\.net\/personal_vault|example\.com/i.test(uri);
}

/** Validate cloud config for non-test runtimes. */
export function assertCloudConfig(env: AppEnv): void {
  if (isTestEnv(env)) return;

  const mongo = env.MONGODB_URI?.trim();
  if (!mongo || isPlaceholderMongoUri(mongo)) {
    throw new Error(
      'MONGODB_URI is required (MongoDB Atlas). Replace the placeholder in .env with your real connection string.',
    );
  }
  if (!hasR2Credentials(env) && !(env as Bindings).VAULT_BUCKET) {
    throw new Error(
      'Cloudflare R2 is required. Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_ENDPOINT (or CLOUDFLARE_ACCOUNT_ID).',
    );
  }
  requireVar('JWT_SECRET', env.JWT_SECRET);
  requireVar('CSRF_SECRET', env.CSRF_SECRET);
  if (/change-me/i.test(env.JWT_SECRET) || /change-me/i.test(env.CSRF_SECRET)) {
    throw new Error('Set strong unique JWT_SECRET and CSRF_SECRET in .env (not placeholder values).');
  }
}

export function loadNodeEnv(): AppEnv {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const env: AppEnv = {
    MONGODB_URI: process.env.MONGODB_URI,
    DATA_DIR: process.env.DATA_DIR,
    JWT_SECRET: process.env.JWT_SECRET || '',
    CSRF_SECRET: process.env.CSRF_SECRET || '',
    ALLOW_REGISTRATION: process.env.ALLOW_REGISTRATION || 'false',
    STORAGE_QUOTA_BYTES: process.env.STORAGE_QUOTA_BYTES || String(DEFAULT_STORAGE_QUOTA_BYTES),
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://127.0.0.1:4173',
    SESSION_TTL_SECONDS: process.env.SESSION_TTL_SECONDS || String(60 * 60 * 5),
    PRESIGNED_URL_TTL_SECONDS: process.env.PRESIGNED_URL_TTL_SECONDS || '7200',
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    R2_ENDPOINT: process.env.R2_ENDPOINT,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || 'personal-data',
    BOOTSTRAP_ADMIN_EMAIL: process.env.BOOTSTRAP_ADMIN_EMAIL || undefined,
    BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD || undefined,
    BOOTSTRAP_ADMIN_NAME: process.env.BOOTSTRAP_ADMIN_NAME || undefined,
    PUBLIC_API_URL: process.env.PUBLIC_API_URL || undefined,
    APP_ORIGIN: process.env.APP_ORIGIN || 'http://127.0.0.1:4173',
    RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
    EMAIL_FROM: process.env.EMAIL_FROM || undefined,
    NODE_ENV: nodeEnv,
  };
  if (nodeEnv !== 'test') {
    assertCloudConfig(env);
  }
  return env;
}
