/* Aether Vault service worker — share target + installability (phone-first). */
const SHARE_DB = 'aether-share-v1';
const SHARE_STORE = 'incoming';
const SHARE_KEY = 'latest';

function openShareDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHARE_STORE)) {
        db.createObjectStore(SHARE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putSharePayload(payload) {
  const db = await openShareDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, 'readwrite');
    tx.objectStore(SHARE_STORE).put(payload, SHARE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function fileToRecord(file) {
  const buffer = await file.arrayBuffer();
  return {
    name: file.name || 'shared',
    type: file.type || 'application/octet-stream',
    size: file.size,
    buffer,
  };
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share') return;

  event.respondWith(
    (async () => {
      try {
        const formData = await event.request.formData();
        const title = String(formData.get('title') || '');
        const text = String(formData.get('text') || '');
        const sharedUrl = String(formData.get('url') || '');
        const media = formData.getAll('media').filter((f) => f && typeof f === 'object' && 'arrayBuffer' in f);
        const files = [];
        for (const file of media) {
          files.push(await fileToRecord(file));
        }
        await putSharePayload({
          title,
          text,
          url: sharedUrl,
          files,
          receivedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[aether-sw] share target failed', err);
        await putSharePayload({
          title: '',
          text: '',
          url: '',
          files: [],
          error: String(err && err.message ? err.message : err),
          receivedAt: new Date().toISOString(),
        });
      }
      return Response.redirect('/share?received=1', 303);
    })(),
  );
});
