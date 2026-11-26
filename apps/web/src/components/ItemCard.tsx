import { useState, type MouseEvent } from 'react';
import {
  Archive,
  Download,
  ExternalLink,
  FileText,
  Film,
  Heart,
  Image as ImageIcon,
  Lock,
  MoreHorizontal,
  Music2,
  StickyNote,
  Trash2,
  FolderKanban,
  Bookmark,
} from 'lucide-react';
import type { ContentType, ItemDto } from '@vault/shared';
import { formatBytes } from '@vault/shared';
import clsx from 'clsx';
import { formatRelative } from '../lib/nav';
import { safeHttpUrl } from '../lib/safeUrl';
import { downloadOriginalFile, itemHasOriginalFile } from '../lib/api';
import { useItemLockStore } from '../stores/itemLock';
import { ItemMediaPreview } from './ItemMediaPreview';

const icons: Record<ContentType, typeof Bookmark> = {
  bookmark: Bookmark,
  image: ImageIcon,
  video: Film,
  file: FileText,
  project: FolderKanban,
  audio: Music2,
  note: StickyNote,
};

interface Props {
  item: ItemDto;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onOpen?: (item: ItemDto) => void;
  onFavorite?: (item: ItemDto) => void;
  onArchive?: (item: ItemDto) => void;
  onTrash?: (item: ItemDto) => void;
  onLock?: (item: ItemDto) => void;
  trashedView?: boolean;
  compact?: boolean;
}

export function ItemCard({
  item,
  selected,
  onSelect,
  onOpen,
  onFavorite,
  onArchive,
  onTrash,
  onLock,
  trashedView,
  compact,
}: Props) {
  const Icon = icons[item.contentType] || FileText;
  const favicon = safeHttpUrl(item.metadata?.favicon as string | undefined);
  const unlockedInSession = useItemLockStore((s) => s.isUnlocked(item.id));
  const isSealed = item.locked && !unlockedInSession;
  const itemUrl = isSealed ? null : safeHttpUrl(item.url);
  const canDownload = !isSealed && itemHasOriginalFile(item);
  const [downloading, setDownloading] = useState(false);

  const onDownload = async (e: MouseEvent) => {
    e.stopPropagation();
    if (!canDownload || downloading) return;
    setDownloading(true);
    try {
      await downloadOriginalFile(item);
    } catch {
      // keep UI quiet; toast system not present
    } finally {
      setDownloading(false);
    }
  };

  return (
    <article
      className={clsx(
        'group relative overflow-hidden rounded-2xl border border-line/60 bg-panel/80 transition duration-300 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-glow',
        selected && 'border-accent/50 shadow-glow',
        compact ? 'p-3' : 'p-4',
      )}
    >
      <div className="mb-3 flex items-start gap-3">
        {onSelect && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onSelect(item.id)}
            className="mt-1 accent-accent"
            aria-label={`Select ${item.title}`}
          />
        )}
        <button className="min-w-0 flex-1 text-left" onClick={() => onOpen?.(item)}>
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-accent/10 text-accent">
              {favicon && !isSealed ? (
                <img src={favicon} alt="" className="h-4 w-4 rounded" />
              ) : (
                <Icon size={16} />
              )}
            </span>
            <span className="rounded-full bg-mist/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-mute">
              {item.contentType}
            </span>
            {item.locked && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-warn"
                title={unlockedInSession ? 'Unlocked this session' : 'Locked'}
              >
                <Lock size={10} /> {unlockedInSession ? 'Unlocked' : 'Locked'}
              </span>
            )}
            {item.status !== 'synced' && (
              <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-warn">
                {item.status}
              </span>
            )}
          </div>
          <h3 className="line-clamp-2 text-sm font-semibold text-fog">{item.title}</h3>
          {isSealed ? (
            <p className="mt-1 text-xs italic text-mute">Locked — open to unlock with your archive PIN.</p>
          ) : (
            <>
              {(item.description || item.notes) && (
                <p className="mt-1 line-clamp-2 text-xs text-mute">{item.description || item.notes}</p>
              )}
              {item.fileName && (
                <p className="mt-1 truncate text-[11px] text-mute/80">{item.fileName}</p>
              )}
            </>
          )}
        </button>
        <button
          type="button"
          className={clsx(
            'touch-target shrink-0 rounded-lg p-1.5 transition',
            item.favorite
              ? 'text-accent'
              : 'text-mute opacity-100 sm:opacity-0 sm:group-hover:opacity-100',
          )}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onFavorite?.(item);
          }}
          aria-label={item.favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={item.favorite}
        >
          <Heart size={16} fill={item.favorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      {!isSealed && <ItemMediaPreview item={item} />}

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-mute">
        <span>{formatRelative(item.createdAt)}</span>
        {item.fileSize ? <span>· {formatBytes(item.fileSize)}</span> : null}
        {itemUrl ? (
          <a
            href={itemUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={12} /> Open
          </a>
        ) : null}
      </div>

      {!isSealed && item.tags?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.tags.slice(0, 4).map((t) => (
            <span key={t} className="rounded-md bg-mist/50 px-2 py-0.5 text-[10px] text-mute">
              #{t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {canDownload && (
            <button
              className="btn-ghost shrink-0 px-2 py-1 text-xs"
              onClick={onDownload}
              disabled={downloading}
              aria-label="Download original"
            >
              <Download size={14} /> {downloading ? 'Downloading…' : 'Download'}
            </button>
          )}
        {trashedView ? (
          <>
            <button
              type="button"
              className="btn-ghost shrink-0 px-2 py-1 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onArchive?.(item);
              }}
            >
              <Archive size={14} /> Restore
            </button>
            <button
              type="button"
              className="btn-ghost shrink-0 px-2 py-1 text-xs text-danger"
              onClick={(e) => {
                e.stopPropagation();
                onTrash?.(item);
              }}
            >
              <Trash2 size={14} /> Delete forever
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-ghost shrink-0 px-2 py-1 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onArchive?.(item);
              }}
            >
              <Archive size={14} /> {item.archived ? 'Unarchive' : 'Archive'}
            </button>
            <button
              type="button"
              className="btn-ghost shrink-0 px-2 py-1 text-xs text-danger"
              onClick={(e) => {
                e.stopPropagation();
                onTrash?.(item);
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
            {!item.locked && onLock && (
              <button
                className="btn-ghost shrink-0 px-2 py-1 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onLock(item);
                }}
              >
                <Lock size={14} /> Lock
              </button>
            )}
          </>
        )}
        </div>
        <button
          className="btn-ghost shrink-0 px-2 py-1 text-xs"
          onClick={() => onOpen?.(item)}
          aria-label="More"
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    </article>
  );
}
