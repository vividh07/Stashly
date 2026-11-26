/** Hardened archive PIN gate — in-memory unlock only (refresh = locked). */

import { api, ApiError } from './api';

const FAIL_KEY = 'vault.archive.fail.v1';
const UNLOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAILS_HARD = 8;

export type ArchiveUnlockState = {
  unlocked: boolean;
  expiresAt: number | null;
  fails: number;
  lockedUntil: number | null;
};

type FailRecord = { fails: number; lockedUntil: number };

/** Unlock lives only in RAM — refresh / crash / new tab always starts locked. */
let memoryUnlock: { expiresAt: number } | null = null;
const listeners = new Set<() => void>();
let guardsArmed = false;

function notify() {
  for (const cb of listeners) cb();
}

export function subscribeArchiveGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readFails(): FailRecord {
  try {
    const raw = sessionStorage.getItem(FAIL_KEY);
    if (!raw) return { fails: 0, lockedUntil: 0 };
    const parsed = JSON.parse(raw) as FailRecord;
    return {
      fails: Number(parsed.fails) || 0,
      lockedUntil: Number(parsed.lockedUntil) || 0,
    };
  } catch {
    return { fails: 0, lockedUntil: 0 };
  }
}

function writeFails(rec: FailRecord) {
  sessionStorage.setItem(FAIL_KEY, JSON.stringify(rec));
}

function lockDelayMs(fails: number): number {
  if (fails >= MAX_FAILS_HARD) return 30 * 60 * 1000;
  if (fails >= 5) return 5 * 60 * 1000;
  if (fails >= 3) return 30 * 1000;
  return 0;
}

function purgeExpiredUnlock(): void {
  if (memoryUnlock && memoryUnlock.expiresAt <= Date.now()) {
    memoryUnlock = null;
  }
}

export function getArchiveUnlockState(): ArchiveUnlockState {
  purgeExpiredUnlock();
  const fails = readFails();
  const now = Date.now();
  if (fails.lockedUntil > now) {
    return {
      unlocked: false,
      expiresAt: null,
      fails: fails.fails,
      lockedUntil: fails.lockedUntil,
    };
  }

  if (memoryUnlock && memoryUnlock.expiresAt > now) {
    return {
      unlocked: true,
      expiresAt: memoryUnlock.expiresAt,
      fails: fails.fails,
      lockedUntil: null,
    };
  }

  return { unlocked: false, expiresAt: null, fails: fails.fails, lockedUntil: null };
}

export function isArchiveUnlocked(): boolean {
  return getArchiveUnlockState().unlocked;
}

export function lockArchive(): void {
  if (!memoryUnlock) {
    notify();
    return;
  }
  memoryUnlock = null;
  notify();
}

export function clearArchiveGate(): void {
  memoryUnlock = null;
  try {
    sessionStorage.removeItem(FAIL_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

export function armArchiveSafeGuards(): void {
  if (guardsArmed || typeof window === 'undefined') return;
  guardsArmed = true;

  const seal = () => lockArchive();

  window.addEventListener('offline', seal);
  window.addEventListener('pagehide', seal);
  window.addEventListener('freeze', seal as EventListener);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') seal();
  });
}

export type UnlockResult =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: 'invalid' | 'locked' | 'format'; lockedUntil?: number; fails: number };

export async function tryUnlockArchive(pin: string): Promise<UnlockResult> {
  const cleaned = pin.replace(/\D/g, '');
  if (cleaned.length !== 4) {
    return { ok: false, reason: 'format', fails: readFails().fails };
  }

  const fails = readFails();
  const now = Date.now();
  if (fails.lockedUntil > now) {
    return {
      ok: false,
      reason: 'locked',
      lockedUntil: fails.lockedUntil,
      fails: fails.fails,
    };
  }

  try {
    const res = await api.verifyArchivePin(cleaned);
    const expiresAt = new Date(res.expiresAt).getTime();
    writeFails({ fails: 0, lockedUntil: 0 });
    memoryUnlock = { expiresAt };
    notify();
    return { ok: true, expiresAt };
  } catch (err) {
    const nextFails = fails.fails + 1;
    const delay = lockDelayMs(nextFails);
    const lockedUntil = delay > 0 ? now + delay : 0;
    writeFails({ fails: nextFails, lockedUntil });
    if (err instanceof ApiError && err.status === 401) {
      return {
        ok: false,
        reason: delay > 0 ? 'locked' : 'invalid',
        lockedUntil: lockedUntil || undefined,
        fails: nextFails,
      };
    }
    return {
      ok: false,
      reason: delay > 0 ? 'locked' : 'invalid',
      lockedUntil: lockedUntil || undefined,
      fails: nextFails,
    };
  }
}

export const ARCHIVE_UNLOCK_TTL_MS = UNLOCK_TTL_MS;
