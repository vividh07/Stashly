import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, ExternalLink, FileText } from 'lucide-react';
import type { ItemDto } from '@vault/shared';
import { formatBytes } from '@vault/shared';
import { api, ApiError } from '../lib/api';
import { safeHttpUrl } from '../lib/safeUrl';

/** Public, unauthenticated page for a shared item — rendered outside the app shell. */
export function SharePublicPage() {
  const { token } = useParams();
  const [state, setState] = useState<{ item: ItemDto; expiresAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Missing share link');
      setLoading(false);
      return;
    }
    api
      .getShareLink(token)
      .then(setState)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Link not found or expired'))
      .finally(() => setLoading(false));
  }, [token]);

  const onDownload = async () => {
    if (!token) return;
    setDownloading(true);
    setError(null);
    try {
      const { url } = await api.shareDownloadUrl(token);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const item = state?.item;
  const openUrl = item ? safeHttpUrl(item.url) : null;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 bg-grid-fade" />
      <div className="glass relative w-full max-w-md animate-fade-up rounded-3xl p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-2xl font-semibold text-accent shadow-glow">
          Æ
        </div>
        <p className="mb-4 text-xs uppercase tracking-wider text-mute">Shared from Aether Vault</p>

        {loading ? (
          <div className="glass-soft h-24 animate-pulse rounded-2xl" />
        ) : error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : item ? (
          <>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-mist/40 text-mute">
              <FileText size={22} />
            </div>
            <h1 className="text-xl font-semibold text-fog">{item.title}</h1>
            {item.description && <p className="mt-2 text-sm text-mute">{item.description}</p>}
            <div className="mt-3 text-xs text-mute">
              {item.fileName && <div>{item.fileName}</div>}
              {item.fileSize != null && <div>{formatBytes(item.fileSize)}</div>}
              <div>Link expires {new Date(state!.expiresAt).toLocaleString()}</div>
            </div>
            <div className="mt-6 flex flex-col gap-2">
              {item.objectKey && (
                <button type="button" className="btn-primary w-full" disabled={downloading} onClick={onDownload}>
                  <Download size={16} /> {downloading ? 'Preparing…' : 'Download'}
                </button>
              )}
              {openUrl && (
                <a className="btn-subtle w-full" href={openUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} /> Open link
                </a>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
