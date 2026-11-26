const SHARE_DB = 'aether-share-v1';
const SHARE_STORE = 'incoming';
const SHARE_KEY = 'latest';

export interface SharedFileRecord {
  name: string;
  type: string;
  size: number;
  buffer: ArrayBuffer;
}

export interface IncomingShare {
  title: string;
  text: string;
  url: string;
  files: SharedFileRecord[];
  receivedAt: string;
  error?: string;
}

function openShareDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHARE_STORE)) {
        db.createObjectStore(SHARE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open share DB'));
  });
}

export async function readIncomingShare(): Promise<IncomingShare | null> {
  const db = await openShareDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE, 'readonly');
      const req = tx.objectStore(SHARE_STORE).get(SHARE_KEY);
      req.onsuccess = () => resolve((req.result as IncomingShare) || null);
      req.onerror = () => reject(req.error ?? new Error('Failed to read share'));
    });
  } finally {
    db.close();
  }
}

export async function clearIncomingShare(): Promise<void> {
  const db = await openShareDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE, 'readwrite');
      tx.objectStore(SHARE_STORE).delete(SHARE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to clear share'));
    });
  } finally {
    db.close();
  }
}

/** Extract first http(s) URL from free text (common when Android packs link into `text`). */
export function extractUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const asUrl = new URL(trimmed);
    if (asUrl.protocol === 'http:' || asUrl.protocol === 'https:') return asUrl.href;
  } catch {
    /* continue */
  }
  const match = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  try {
    return new URL(match[0]).href;
  } catch {
    return null;
  }
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[aether] service worker registration failed', err);
    });
  });
}
