import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CONTENT_TYPES, type ContentType } from '@vault/shared';
import { api } from '../lib/api';
import { ItemList } from '../components/ItemList';
import { ItemDetailHost } from '../components/ItemDetail';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { ItemDto } from '@vault/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [contentType, setContentType] = useState<ContentType | ''>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<ItemDto | null>(null);
  const [pendingTrash, setPendingTrash] = useState<ItemDto | null>(null);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['search', q, contentType],
    queryFn: () =>
      api.search({
        q,
        contentType: contentType || undefined,
        archived: false,
        limit: 50,
      }),
    enabled: q.trim().length > 0,
  });

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['search'] }),
      qc.invalidateQueries({ queryKey: ['items'] }),
    ]);

  const favorite = useMutation({
    mutationFn: (item: ItemDto) => api.updateItem(item.id, { favorite: !item.favorite }),
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: (item: ItemDto) => api.updateItem(item.id, { archived: true }),
    onSuccess: invalidate,
  });
  const trash = useMutation({
    mutationFn: (item: ItemDto) => api.trashItem(item.id),
    onSuccess: invalidate,
  });

  const title = useMemo(() => (q ? `Results for “${q}”` : 'Search'), [q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fog">{title}</h1>
          <p className="text-sm text-mute">
            Search titles, notes, filenames, tags, URLs
          </p>
        </div>
        <div className="flex gap-2">
          <input
            className="input max-w-sm"
            value={q}
            onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {})}
            placeholder="Search titles, notes, filenames, tags, URLs…"
          />
          <select
            className="input max-w-[160px]"
            value={contentType}
            onChange={(e) => setContentType(e.target.value as ContentType | '')}
          >
            <option value="">All types</option>
            {CONTENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!q.trim() ? (
        <div className="glass rounded-3xl p-10 text-center text-sm text-mute">
          Type a query in the top bar or here to search your vault.
        </div>
      ) : query.isLoading ? (
        <div className="glass h-40 animate-pulse rounded-3xl" />
      ) : (
        <ItemList
          items={query.data?.items || []}
          selected={selected}
          onSelect={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onOpen={setActive}
          onFavorite={(item) => favorite.mutate(item)}
          onArchive={(item) => archive.mutate(item)}
          onTrash={(item) => setPendingTrash(item)}
          emptyTitle="No matches"
          emptyBody="Try a different keyword or clear the type filter."
        />
      )}

      <ItemDetailHost item={active} onClose={() => setActive(null)} />

      <ConfirmDialog
        open={Boolean(pendingTrash)}
        title="Move to trash?"
        message={
          pendingTrash
            ? `“${pendingTrash.title}” will be moved to trash. You can restore it later.`
            : ''
        }
        confirmLabel="Move to trash"
        busy={trash.isPending}
        onCancel={() => {
          if (!trash.isPending) setPendingTrash(null);
        }}
        onConfirm={() => {
          if (!pendingTrash) return;
          trash.mutate(pendingTrash, {
            onSettled: () => setPendingTrash(null),
          });
        }}
      />
    </div>
  );
}
