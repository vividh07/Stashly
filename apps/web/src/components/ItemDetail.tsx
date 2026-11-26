import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, ExternalLink, Lock, Share2, Trash2, Unlock, X } from 'lucide-react';
import type { ItemDto, ShareLinkDto } from '@vault/shared';
import { formatBytes } from '@vault/shared';
import { api, ApiError, downloadOriginalFile, itemHasOriginalFile } from '../lib/api';
import { safeHttpUrl } from '../lib/safeUrl';
import { useItemLockStore } from '../stores/itemLock';
import { ConfirmDialog } from './ConfirmDialog';
import { ItemMediaPreview } from './ItemMediaPreview';

interface Props {
  item: ItemDto | null;
  onClose: () => void;
}

/** ISO datetime (with offset) <-> value usable by <input type="datetime-local"> (local, no offset). */
function toLocalInputValue(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

const EXPIRES_OPTIONS = [
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
];

export function ItemDetail({ item, onClose }: Props) {
  const qc = useQueryClient();
  const isUnlocked = useItemLockStore((s) => s.isUnlocked);
  const unlockItem = useItemLockStore((s) => s.unlock);
  const lockItem = useItemLockStore((s) => s.lock);

  const unlockedInSession = item ? isUnlocked(item.id) : false;
  const [locked, setLocked] = useState(Boolean(item?.locked));
  const sealed = locked && !unlockedInSession;

  const [title, setTitle] = useState(item?.title || '');
  const [notes, setNotes] = useState(item?.notes || '');
  const [tags, setTags] = useState((item?.tags || []).join(', '));
  const [description, setDescription] = useState(item?.description || '');
  const [reminderAt, setReminderAt] = useState(toLocalInputValue(item?.reminderAt));
  const [expiresAt, setExpiresAt] = useState(toLocalInputValue(item?.expiresAt));

  const [pin, setPin] = useState('');
  const [lockError, setLockError] = useState<string | null>(null);
  const [shareHours, setShareHours] = useState(72);
  const [shareLinks, setShareLinks] = useState<ShareLinkDto[]>([]);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setShareLinks([]);
    setPin('');
    setLockError(null);
    setShareError(null);
    setLocked(Boolean(item?.locked));
  }, [item?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!item) return;
      return api.updateItem(item.id, {
        title,
        notes,
        description,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        reminderAt: fromLocalInputValue(reminderAt),
        expiresAt: fromLocalInputValue(expiresAt),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['items'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      await qc.invalidateQueries({ queryKey: ['due-items'] });
      onClose();
    },
  });

  const toggleLock = useMutation({
    mutationFn: async () => {
      if (!item) return;
      setLockError(null);
      if (locked) {
        if (pin.length !== 4) throw new Error('Enter your 4-digit archive PIN');
        const res = await api.lockItem(item.id, false, pin);
        unlockItem(item.id);
        setPin('');
        return res.item;
      }
      const res = await api.lockItem(item.id, true);
      lockItem(item.id);
      return res.item;
    },
    onSuccess: async (updated) => {
      if (updated) setLocked(updated.locked);
      await qc.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (err: Error) => {
      setLockError(err instanceof ApiError ? err.message : err.message || 'Could not update lock');
    },
  });

  const createShare = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error('No item');
      setShareError(null);
      const res = await api.createShareLink(item.id, shareHours);
      return res.shareLink;
    },
    onSuccess: (link) => setShareLinks((prev) => [link, ...prev]),
    onError: (err: Error) => setShareError(err.message),
  });

  const revokeShare = useMutation({
    mutationFn: async (id: string) => {
      await api.revokeShareLink(id);
      return id;
    },
    onSuccess: (id) =>
      setShareLinks((prev) => prev.map((l) => (l.id === id ? { ...l, revokedAt: new Date().toISOString() } : l))),
  });

  const [downloading, setDownloading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const trashItem = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error('No item');
      if (item.trashed) {
        await api.deleteItem(item.id, true);
        return;
      }
      await api.trashItem(item.id);
    },
    onSuccess: async () => {
      setConfirmDelete(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['items'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['storage-usage'] }),
      ]);
      onClose();
    },
    onError: (err: Error) => {
      setDeleteError(err instanceof ApiError ? err.message : err.message || 'Delete failed');
    },
  });

  if (!item) return null;

  const canDownload = !sealed && itemHasOriginalFile(item);

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-end bg-black/45 sm:items-stretch">
      <button className="absolute inset-0" aria-label="Close" onClick={onClose} />
      <aside className="glass safe-pb relative z-10 flex max-h-[92dvh] w-full max-w-lg animate-fade-up flex-col rounded-t-3xl border-line/60 p-4 sm:h-full sm:max-h-none sm:rounded-none sm:border-l sm:p-5">
        <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-line/80 sm:hidden" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-mute">
              {item.contentType}
              {locked && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-warn">
                  <Lock size={10} /> {unlockedInSession ? 'unlocked' : 'locked'}
                </span>
              )}
            </div>
            <h2 className="text-xl font-semibold text-fog">Edit item</h2>
          </div>
          <button className="touch-target -mr-1 rounded-xl p-2.5 text-mute hover:bg-mist/50" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
          {sealed ? (
            <div className="rounded-2xl border border-warn/30 bg-warn/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-warn">
                <Lock size={16} /> This item is locked
              </div>
              <p className="mb-3 text-xs text-mute">
                Notes, URL, and preview are hidden until you unlock it with your archive PIN for this
                session.
              </p>
              <div className="flex items-center gap-2">
                <input
                  className="input w-28 text-center tracking-widest"
                  inputMode="numeric"
                  type="password"
                  placeholder="PIN"
                  value={pin}
                  maxLength={4}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={toggleLock.isPending || pin.length !== 4}
                  onClick={() => toggleLock.mutate()}
                >
                  <Unlock size={14} /> Unlock
                </button>
              </div>
              {lockError && <p className="mt-2 text-xs text-danger">{lockError}</p>}
            </div>
          ) : (
            <ItemMediaPreview item={item} large />
          )}

          <div>
            <label className="label">Title</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              className="input min-h-[80px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {!sealed && (
            <>
              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input min-h-[140px] font-mono text-[13px]"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Tags</label>
                <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
              </div>
            </>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Reminder</label>
              <input
                className="input"
                type="datetime-local"
                value={reminderAt}
                onChange={(e) => setReminderAt(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Expires</label>
              <input
                className="input"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-xl border border-line/50 bg-mist/20 p-3 text-xs text-mute">
            <div>Created {new Date(item.createdAt).toLocaleString()}</div>
            <div>Updated {new Date(item.updatedAt).toLocaleString()}</div>
            {!sealed && item.fileName && <div>File {item.fileName}</div>}
            {item.fileSize != null && <div>Size {formatBytes(item.fileSize)}</div>}
            {item.mimeType && <div>MIME {item.mimeType}</div>}
            <div>Status {item.status}</div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-line/50 bg-mist/20 p-3">
            <div className="text-xs text-mute">
              <div className="font-medium text-fog">{locked ? 'Locked item' : 'Lock this item'}</div>
              <div>Hides notes, URL, and preview until unlocked with your archive PIN.</div>
            </div>
            {!locked && (
              <button
                type="button"
                className="btn-subtle shrink-0"
                disabled={toggleLock.isPending}
                onClick={() => toggleLock.mutate()}
              >
                <Lock size={14} /> Lock
              </button>
            )}
          </div>

          {!sealed && itemHasOriginalFile(item) && (
            <div className="rounded-xl border border-line/50 bg-mist/20 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-fog">
                <Share2 size={14} /> Share link
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input w-auto"
                  value={shareHours}
                  onChange={(e) => setShareHours(Number(e.target.value))}
                >
                  {EXPIRES_OPTIONS.map((o) => (
                    <option key={o.hours} value={o.hours}>
                      Expires in {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-subtle"
                  disabled={createShare.isPending}
                  onClick={() => createShare.mutate()}
                >
                  {createShare.isPending ? 'Creating…' : 'Create share link'}
                </button>
              </div>
              {shareError && <p className="mt-2 text-xs text-danger">{shareError}</p>}
              {shareLinks.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {shareLinks.map((link) => (
                    <li
                      key={link.id}
                      className="flex items-center gap-2 rounded-lg border border-line/50 bg-abyss/50 px-2.5 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mute">
                        {link.url}
                      </span>
                      {link.revokedAt ? (
                        <span className="shrink-0 text-[11px] text-danger">Revoked</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn-ghost shrink-0 px-2 py-1 text-xs"
                            onClick={() => copyLink(link.url)}
                          >
                            <Copy size={12} /> {copied === link.url ? 'Copied' : 'Copy'}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost shrink-0 px-2 py-1 text-xs text-danger"
                            disabled={revokeShare.isPending}
                            onClick={() => revokeShare.mutate(link.id)}
                          >
                            Revoke
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2 border-t border-line/50 pt-4 sm:flex-row sm:flex-wrap sm:items-center">
          {!sealed && safeHttpUrl(item.url) && (
            <a className="btn-subtle min-h-11" href={safeHttpUrl(item.url)!} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Open link
            </a>
          )}
          {canDownload && (
            <button
              className="btn-subtle min-h-11"
              disabled={downloading}
              onClick={async () => {
                setDownloading(true);
                try {
                  await downloadOriginalFile(item);
                } finally {
                  setDownloading(false);
                }
              }}
            >
              <Download size={14} /> {downloading ? 'Downloading…' : 'Download original'}
            </button>
          )}
          <button
            type="button"
            className="btn-subtle min-h-11 text-danger"
            disabled={trashItem.isPending}
            onClick={() => {
              setDeleteError(null);
              setConfirmDelete(true);
            }}
          >
            <Trash2 size={14} />{' '}
            {trashItem.isPending ? 'Deleting…' : item.trashed ? 'Delete forever' : 'Move to trash'}
          </button>
          <button
            className="btn-primary min-h-11 sm:ml-auto"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
          {deleteError && <p className="w-full text-sm text-danger">{deleteError}</p>}
        </div>
      </aside>

      <ConfirmDialog
        open={confirmDelete}
        title={item.trashed ? 'Delete forever?' : 'Move to trash?'}
        message={
          item.trashed
            ? `“${item.title}” will be permanently deleted. This cannot be undone.`
            : `“${item.title}” will be moved to trash. You can restore it later from Trash.`
        }
        confirmLabel={item.trashed ? 'Delete forever' : 'Move to trash'}
        danger
        busy={trashItem.isPending}
        onCancel={() => {
          if (!trashItem.isPending) setConfirmDelete(false);
        }}
        onConfirm={() => {
          if (!trashItem.isPending) trashItem.mutate();
        }}
      />
    </div>
  );
}

export function ItemDetailHost({
  item,
  onClose,
}: {
  item: ItemDto | null;
  onClose: () => void;
}) {
  if (!item) return null;
  return <ItemDetail key={item.id} item={item} onClose={onClose} />;
}
