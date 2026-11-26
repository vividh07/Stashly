import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Trash2 } from 'lucide-react';
import type { ItemDto } from '@vault/shared';
import { formatBytes } from '@vault/shared';
import { api } from '../lib/api';
import { useUiStore } from '../stores/ui';

export function DuplicatesPage() {
  const qc = useQueryClient();
  const openItemView = useUiStore((s) => s.openItemView);
  const query = useQuery({ queryKey: ['hygiene'], queryFn: () => api.hygiene() });

  const trash = useMutation({
    mutationFn: (item: ItemDto) => api.trashItem(item.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hygiene'] }),
  });

  const groups = query.data?.duplicateGroups || [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-fog">
          <Copy size={22} className="text-accent" /> Duplicates
        </h1>
        <p className="mt-1 text-sm text-mute">
          Files that share the exact same content hash. Keep one copy and trash the rest.
        </p>
      </div>

      {query.isLoading ? (
        <div className="glass h-40 animate-pulse rounded-3xl" />
      ) : query.isError ? (
        <div className="text-danger">Failed to load duplicates</div>
      ) : !groups.length ? (
        <div className="glass rounded-3xl p-10 text-center text-sm text-mute">
          No duplicate files found — your vault is tidy.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.contentHash} className="glass rounded-2xl p-4">
              <div className="mb-3 flex items-center justify-between text-xs text-mute">
                <span className="font-mono">{group.contentHash.slice(0, 16)}…</span>
                <span>{group.count} copies</span>
              </div>
              <ul className="space-y-2">
                {group.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 rounded-xl border border-line/50 bg-mist/20 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-fog">{item.title}</div>
                      <div className="truncate text-xs text-mute">
                        {item.fileName || item.contentType}
                        {item.fileSize ? ` · ${formatBytes(item.fileSize)}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost shrink-0 px-2 py-1 text-xs"
                      onClick={() => openItemView(item)}
                    >
                      <ExternalLink size={13} /> Open
                    </button>
                    <button
                      type="button"
                      className="btn-ghost shrink-0 px-2 py-1 text-xs text-danger"
                      disabled={trash.isPending}
                      onClick={() => trash.mutate(item)}
                    >
                      <Trash2 size={13} /> Trash
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
