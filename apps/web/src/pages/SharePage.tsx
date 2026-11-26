import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { inferContentTypeFromMime, inferContentTypeFromUrl, type ContentType } from '@vault/shared';
import { clearIncomingShare, extractUrl, readIncomingShare } from '../lib/shareTarget';
import { libraryPathForType, saveSharedFile } from '../lib/saveSharedFile';
import { useUiStore } from '../stores/ui';

export function SharePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const openCapture = useUiStore((s) => s.openCapture);
  const setSyncStatus = useUiStore((s) => s.setSyncStatus);
  const [status, setStatus] = useState('Receiving share…');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const run = async () => {
      try {
        // Give the SW a beat to finish writing IndexedDB after POST → redirect.
        await new Promise((r) => setTimeout(r, 50));
        let incoming = await readIncomingShare();
        if (!incoming) {
          await new Promise((r) => setTimeout(r, 200));
          incoming = await readIncomingShare();
        }

        if (!incoming || incoming.error) {
          setError(incoming?.error || 'Nothing was shared. Open Aether from the Android share sheet.');
          return;
        }

        const { files, title, text, url } = incoming;

        if (files.length > 0) {
          setStatus(files.length === 1 ? 'Saving file…' : `Saving ${files.length} files…`);
          let lastType: ContentType = inferContentTypeFromMime(files[0].type);
          let queuedAny = false;

          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setStatus(`Saving ${i + 1} of ${files.length}…`);
            const result = await saveSharedFile(file, {
              title: files.length === 1 ? title || undefined : undefined,
              onProgress: (pct) => setProgress(pct),
            });
            lastType = result.contentType;
            if (result.queued) queuedAny = true;
          }

          await clearIncomingShare();
          await Promise.all([
            qc.invalidateQueries({ queryKey: ['items'] }),
            qc.invalidateQueries({ queryKey: ['dashboard'] }),
            qc.invalidateQueries({ queryKey: ['storage-usage'] }),
          ]);

          if (queuedAny) {
            setSyncStatus('offline', 'Shared files saved locally — will sync when online');
          } else {
            setSyncStatus('idle', files.length === 1 ? 'Shared file saved' : 'Shared files saved');
          }

          navigate(libraryPathForType(lastType), { replace: true });
          return;
        }

        const link = url.trim() || extractUrl(text) || extractUrl(title);
        if (link) {
          await clearIncomingShare();
          const contentType = inferContentTypeFromUrl(link);
          openCapture({
            contentType,
            url: link,
            title: title || undefined,
            notes: text && text !== link ? text : undefined,
          });
          navigate(libraryPathForType(contentType), { replace: true });
          return;
        }

        if (text.trim() || title.trim()) {
          await clearIncomingShare();
          openCapture({
            contentType: 'note',
            title: title || undefined,
            notes: text || title,
          });
          navigate('/notes', { replace: true });
          return;
        }

        await clearIncomingShare();
        setError('Share had no file, link, or text.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to handle share');
      }
    };

    void run();
  }, [navigate, openCapture, qc, setSyncStatus]);

  return (
    <div className="mx-auto flex min-h-[50dvh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-accent shadow-glow">
        <span className="text-xl font-semibold">Æ</span>
      </div>
      <h1 className="text-xl font-semibold text-fog">Share to Aether</h1>
      {error ? (
        <>
          <p className="text-sm text-danger">{error}</p>
          <button type="button" className="btn-primary" onClick={() => navigate('/', { replace: true })}>
            Go to vault
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-mute">{status}</p>
          {progress != null && (
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-void">
              <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
