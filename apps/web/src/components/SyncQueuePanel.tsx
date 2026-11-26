import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, FileUp, RotateCw, StickyNote, Trash2, X } from 'lucide-react';
import {
  listPendingQueue,
  removePendingQueueItem,
  retryPendingItem,
  type PendingQueueItem,
} from '../lib/sync';
import { useUiStore } from '../stores/ui';
import { formatBytes } from '@vault/shared';

function labelFor(item: PendingQueueItem): string {
  if (item.kind === 'upload') return item.title || item.fileName;
  if (item.kind === 'url') return item.title || item.url;
  return item.title || 'Note';
}

function IconFor({ item }: { item: PendingQueueItem }) {
  if (item.kind === 'upload') return <FileUp size={16} />;
  if (item.kind === 'url') return <Bookmark size={16} />;
  return <StickyNote size={16} />;
}

export function SyncQueuePanel() {
  const open = useUiStore((s) => s.syncQueueOpen);
  const close = useUiStore((s) => s.closeSyncQueue);
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['sync-queue'],
    queryFn: listPendingQueue,
    enabled: open,
    refetchInterval: open ? 4000 : false,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['sync-queue'] });

  const retry = useMutation({
    mutationFn: async (item: PendingQueueItem) => {
      setBusyId(item.id);
      setError(null);
      await retryPendingItem(item);
    },
    onSettled: async () => {
      setBusyId(null);
      await refresh();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['items'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['storage-usage'] }),
      ]);
    },
    onError: (err: Error) => setError(err.message),
  });

  const discard = useMutation({
    mutationFn: (item: PendingQueueItem) => removePendingQueueItem(item),
    onSuccess: refresh,
  });

  if (!open) return null;

  const items = query.data || [];

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/55 sm:items-center sm:p-4">
      <button className="absolute inset-0 cursor-default" aria-label="Close" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-queue-title"
        className="glass relative z-10 flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-3xl shadow-glass sm:max-h-[min(640px,85dvh)] sm:rounded-3xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line/50 px-5 py-4">
          <div>
            <h2 id="sync-queue-title" className="text-lg font-semibold text-fog">
              Offline queue
            </h2>
            <p className="mt-0.5 text-xs text-mute">
              {items.length} item{items.length === 1 ? '' : 's'} waiting to sync
            </p>
          </div>
          <button
            type="button"
            className="touch-target -mr-1 rounded-xl p-2.5 text-mute hover:bg-mist/50"
            onClick={close}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {error && <p className="mb-3 text-sm text-danger">{error}</p>}
          {query.isLoading ? (
            <div className="glass h-24 animate-pulse rounded-2xl" />
          ) : !items.length ? (
            <div className="rounded-2xl border border-line/50 bg-mist/20 p-6 text-center text-sm text-mute">
              Nothing queued — everything is synced.
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={`${item.kind}:${item.id}`}
                  className="flex items-center gap-3 rounded-xl border border-line/50 bg-mist/20 px-3 py-2.5"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <IconFor item={item} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-fog">{labelFor(item)}</div>
                    <div className="truncate text-xs text-mute">
                      {item.kind === 'upload' ? formatBytes(item.fileSize) : item.kind}
                      {item.attempts > 0 ? ` · ${item.attempts} failed attempt${item.attempts === 1 ? '' : 's'}` : ''}
                      {item.lastError ? ` · ${item.lastError}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost shrink-0 px-2 py-1 text-xs"
                    disabled={busyId === item.id}
                    onClick={() => retry.mutate(item)}
                    aria-label="Retry"
                  >
                    <RotateCw size={14} className={busyId === item.id ? 'animate-spin' : ''} />
                    Retry
                  </button>
                  <button
                    type="button"
                    className="btn-ghost shrink-0 px-2 py-1 text-xs text-danger"
                    onClick={() => discard.mutate(item)}
                    aria-label="Discard"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
