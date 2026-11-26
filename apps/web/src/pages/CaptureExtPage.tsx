import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { inferContentTypeFromUrl } from '@vault/shared';
import { extractUrl } from '../lib/shareTarget';
import { libraryPathForType } from '../lib/saveSharedFile';
import { useUiStore } from '../stores/ui';

/** Deep link from the browser extension: `/capture-ext?url=&title=&text=` */
export function CaptureExtPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const openCapture = useUiStore((s) => s.openCapture);
  const [status, setStatus] = useState('Opening capture…');
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const title = searchParams.get('title') || '';
    const text = searchParams.get('text') || '';
    const url = searchParams.get('url') || '';

    const link = url.trim() || extractUrl(text) || extractUrl(title);
    if (link) {
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
      openCapture({
        contentType: 'note',
        title: title || undefined,
        notes: text || title,
      });
      navigate('/notes', { replace: true });
      return;
    }

    setError('Nothing to capture — missing url, title, or text.');
  }, [navigate, openCapture, searchParams]);

  return (
    <div className="mx-auto flex min-h-[50dvh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-accent shadow-glow">
        <span className="text-xl font-semibold">Æ</span>
      </div>
      <h1 className="text-xl font-semibold text-fog">Save to Aether</h1>
      {error ? (
        <>
          <p className="text-sm text-danger">{error}</p>
          <button type="button" className="btn-primary" onClick={() => navigate('/', { replace: true })}>
            Go to vault
          </button>
        </>
      ) : (
        <p className="text-sm text-mute">{status}</p>
      )}
    </div>
  );
}