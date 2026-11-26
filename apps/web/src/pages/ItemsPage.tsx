import { useMemo, useState } from 'react';
import { LayoutGrid, List, Tag } from 'lucide-react';
import type { ContentType, ItemDto } from '@vault/shared';
import { ItemList } from '../components/ItemList';
import { ItemDetailHost } from '../components/ItemDetail';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useItems } from '../hooks/useItems';
import { useUiStore } from '../stores/ui';

type PendingConfirm = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => void | Promise<void>;
};

interface Props {
  title: string;
  subtitle?: string;
  contentType?: ContentType;
  favorite?: boolean;
  archived?: boolean;
  trashed?: boolean;
}

export function ItemsPage({
  title,
  subtitle,
  contentType,
  favorite,
  archived,
  trashed,
}: Props) {
  const { viewMode, setViewMode, openCapture } = useUiStore();
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name' | 'size'>('newest');
  const [q, setQ] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const filter = useMemo(
    () => ({
      contentType,
      favorite,
      // Archived items leave libraries (Images/Videos/…) and only appear in Archive.
      archived: archived !== undefined ? archived : trashed ? undefined : false,
      trashed: trashed ?? false,
      sort,
      q: q.trim() || undefined,
      tags: tagFilter.trim() || undefined,
    }),
    [contentType, favorite, archived, trashed, sort, q, tagFilter],
  );

  const {
    query,
    selected,
    toggleSelect,
    setSelected,
    active,
    setActive,
    favorite: favMut,
    archive,
    trash,
    restore,
    lock,
    bulk,
  } = useItems(filter);

  const items = query.data?.items || [];
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  const selectAll = () => setSelected(new Set(items.map((item) => item.id)));
  const clearSelection = () => setSelected(new Set());

  const askTrashItem = (item: ItemDto) => {
    setActionError(null);
    if (item.trashed) {
      setConfirm({
        title: 'Delete forever?',
        message: `“${item.title}” will be permanently deleted. This cannot be undone.`,
        confirmLabel: 'Delete forever',
        danger: true,
        run: async () => {
          await trash.mutateAsync(item);
        },
      });
      return;
    }
    setConfirm({
      title: 'Move to trash?',
      message: `“${item.title}” will be moved to trash. You can restore it later from Trash.`,
      confirmLabel: 'Move to trash',
      danger: true,
      run: async () => {
        await trash.mutateAsync(item);
      },
    });
  };

  const askBulkTrash = () => {
    setActionError(null);
    const count = selected.size;
    if (trashed) {
      setConfirm({
        title: 'Delete forever?',
        message: `${count} selected item${count === 1 ? '' : 's'} will be permanently deleted. This cannot be undone.`,
        confirmLabel: 'Delete forever',
        danger: true,
        run: async () => {
          await bulk.mutateAsync('delete');
        },
      });
      return;
    }
    setConfirm({
      title: 'Move to trash?',
      message: `${count} selected item${count === 1 ? '' : 's'} will be moved to trash. You can restore later.`,
      confirmLabel: 'Move to trash',
      run: async () => {
        await bulk.mutateAsync('trash');
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fog">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-mute">{subtitle}</p>}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
          <input
            className="input min-w-0 flex-1 basis-[140px] md:max-w-xs md:flex-none"
            placeholder="Filter…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="relative min-w-0 flex-1 basis-[100px] md:flex-none">
            <Tag size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
            <input
              className="input w-full pl-8 md:max-w-[160px]"
              placeholder="tag"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
            />
          </div>
          <select
            className="input min-w-0 flex-1 basis-[110px] md:max-w-[140px] md:flex-none"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>
          <div className="flex gap-2">
            <button
              className={`btn-subtle touch-target px-3 ${viewMode === 'grid' ? 'text-accent' : ''}`}
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={`btn-subtle touch-target px-3 ${viewMode === 'list' ? 'text-accent' : ''}`}
              onClick={() => setViewMode('list')}
              aria-label="List view"
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      {!query.isLoading && items.length > 0 && (
        <div className="glass flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3">
          <button
            type="button"
            className="btn-subtle"
            onClick={() => (allSelected ? clearSelection() : selectAll())}
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-sm text-mute">
            {selected.size > 0 ? `${selected.size} selected` : `${items.length} item${items.length === 1 ? '' : 's'}`}
          </span>

          {selected.size > 0 && (
            <>
              {trashed ? (
                <>
                  <button className="btn-subtle" onClick={() => bulk.mutate('restore')}>
                    Restore
                  </button>
                  <button className="btn-subtle text-danger" onClick={askBulkTrash}>
                    Delete forever
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-subtle" onClick={() => bulk.mutate('favorite')}>
                    Favorite
                  </button>
                  <button className="btn-subtle" onClick={() => bulk.mutate('archive')}>
                    Archive
                  </button>
                  <button className="btn-subtle" onClick={askBulkTrash}>
                    Trash
                  </button>
                </>
              )}
              <button className="btn-ghost ml-auto" onClick={clearSelection}>
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {actionError && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {actionError}
        </div>
      )}

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass h-40 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : query.isError ? (
        <div className="text-danger">Failed to load items</div>
      ) : (
        <ItemList
          items={items}
          selected={selected}
          onSelect={toggleSelect}
          onOpen={setActive}
          onFavorite={(item) => favMut.mutate(item)}
          onArchive={(item) => (trashed ? restore.mutate(item) : archive.mutate(item))}
          onTrash={askTrashItem}
          onLock={(item) => lock.mutate(item)}
          trashedView={trashed}
          emptyTitle={trashed ? 'Trash is empty' : undefined}
          emptyBody={
            trashed
              ? 'Deleted items will show up here until you restore or delete them forever.'
              : undefined
          }
        />
      )}

      {!query.isLoading && !items.length && !trashed && (
        <div className="text-center">
          <button className="btn-primary" onClick={() => openCapture(contentType ? { contentType } : undefined)}>
            Capture something
          </button>
        </div>
      )}

      <ItemDetailHost item={active} onClose={() => setActive(null)} />

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        busy={confirmBusy}
        onCancel={() => {
          if (!confirmBusy) setConfirm(null);
        }}
        onConfirm={() => {
          if (!confirm || confirmBusy) return;
          const action = confirm.run;
          setConfirmBusy(true);
          setActionError(null);
          void (async () => {
            try {
              await action();
              setConfirm(null);
            } catch (err) {
              setActionError(err instanceof Error ? err.message : 'Delete failed');
              setConfirm(null);
            } finally {
              setConfirmBusy(false);
            }
          })();
        }}
      />
    </div>
  );
}
