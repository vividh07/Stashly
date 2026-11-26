import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatBytes, type DashboardDto, type ItemDto } from '@vault/shared';
import { AlarmClock, Plus, AlertTriangle, HardDrive } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { ItemCard } from '../components/ItemCard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useUiStore } from '../stores/ui';
import { useNavigate } from 'react-router-dom';

type PendingConfirm = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => void | Promise<void>;
};

function patchLists(
  old: { dashboard: DashboardDto } | undefined,
  mapItem: (item: ItemDto) => ItemDto | null,
): { dashboard: DashboardDto } | undefined {
  if (!old) return old;
  const apply = (list: ItemDto[]) =>
    list.map(mapItem).filter((i): i is ItemDto => i != null);
  return {
    dashboard: {
      ...old.dashboard,
      recentItems: apply(old.dashboard.recentItems),
      favorites: apply(old.dashboard.favorites).filter((i) => i.favorite && !i.trashed && !i.archived),
      recentlyAccessed: apply(old.dashboard.recentlyAccessed),
    },
  };
}

export function DashboardPage() {
  const openCapture = useUiStore((s) => s.openCapture);
  const openItemView = useUiStore((s) => s.openItemView);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard(),
  });
  const due = useQuery({ queryKey: ['due-items'], queryFn: () => api.dueItems() });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
      qc.invalidateQueries({ queryKey: ['items'] }),
      qc.invalidateQueries({ queryKey: ['due-items'] }),
      qc.invalidateQueries({ queryKey: ['storage-usage'] }),
    ]);
  };

  const favorite = useMutation({
    mutationFn: (item: ItemDto) => api.updateItem(item.id, { favorite: !item.favorite }),
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: ['dashboard'] });
      const previous = qc.getQueryData<{ dashboard: DashboardDto }>(['dashboard']);
      qc.setQueryData<{ dashboard: DashboardDto }>(['dashboard'], (old) =>
        patchLists(old, (i) => (i.id === item.id ? { ...i, favorite: !i.favorite } : i)),
      );
      return { previous };
    },
    onError: (_e, _i, ctx) => {
      if (ctx?.previous) qc.setQueryData(['dashboard'], ctx.previous);
    },
    onSettled: () => void invalidate(),
  });

  const archive = useMutation({
    mutationFn: (item: ItemDto) => api.updateItem(item.id, { archived: !item.archived }),
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: ['dashboard'] });
      const previous = qc.getQueryData<{ dashboard: DashboardDto }>(['dashboard']);
      // Archiving removes from overview lists
      qc.setQueryData<{ dashboard: DashboardDto }>(['dashboard'], (old) =>
        patchLists(old, (i) => {
          if (i.id !== item.id) return i;
          const next = { ...i, archived: !i.archived };
          return next.archived ? null : next;
        }),
      );
      return { previous };
    },
    onError: (_e, _i, ctx) => {
      if (ctx?.previous) qc.setQueryData(['dashboard'], ctx.previous);
    },
    onSettled: () => void invalidate(),
  });

  const trash = useMutation({
    mutationFn: async (item: ItemDto) => {
      if (item.trashed) {
        await api.deleteItem(item.id, true);
        return;
      }
      await api.trashItem(item.id);
    },
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: ['dashboard'] });
      const previous = qc.getQueryData<{ dashboard: DashboardDto }>(['dashboard']);
      qc.setQueryData<{ dashboard: DashboardDto }>(['dashboard'], (old) =>
        patchLists(old, (i) => (i.id === item.id ? null : i)),
      );
      return { previous };
    },
    onError: (_e, _i, ctx) => {
      if (ctx?.previous) qc.setQueryData(['dashboard'], ctx.previous);
    },
    onSettled: () => void invalidate(),
  });

  const askTrash = (item: ItemDto) => {
    setActionError(null);
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

  if (isLoading) {
    return <div className="glass h-48 animate-pulse rounded-3xl" />;
  }
  if (error || !data) {
    return <div className="text-danger">Failed to load dashboard</div>;
  }

  const d = data.dashboard;

  const cardProps = {
    onOpen: openItemView,
    onFavorite: (it: ItemDto) => favorite.mutate(it),
    onArchive: (it: ItemDto) => archive.mutate(it),
    onTrash: askTrash,
  };

  return (
    <div className="space-y-6">
      <section className="glass relative overflow-hidden rounded-3xl p-6 md:p-8">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm text-mute">Welcome back</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-fog md:text-4xl">
              {d.welcomeName}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-mute">
              Your vault holds {d.totalItems} items across devices. Capture something in seconds and
              retrieve it later from anywhere.
            </p>
          </div>
          <button className="btn-primary" onClick={() => openCapture()}>
            <Plus size={16} /> Quick Capture
          </button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total items" value={String(d.totalItems)} />
        <Stat
          label="Storage"
          value={`${formatBytes(d.storage.usedBytes)} / ${formatBytes(d.storage.quotaBytes)}`}
          icon={<HardDrive size={16} />}
        />
        <Stat label="Pending uploads" value={String(d.pendingUploads)} />
        <Stat
          label="Failed syncs"
          value={String(d.failedSyncs)}
          warn={d.failedSyncs > 0}
          icon={d.failedSyncs > 0 ? <AlertTriangle size={16} /> : undefined}
        />
      </section>

      {d.failedSyncs > 0 && (
        <div className="rounded-2xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
          {d.failedSyncs} item{d.failedSyncs === 1 ? '' : 's'} failed to synchronize. Open All Items to retry.
        </div>
      )}

      {actionError && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {actionError}
        </div>
      )}

      {!!due.data?.items.length && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-fog">
              <AlarmClock size={18} className="text-accent" /> Due soon
            </h2>
            <button className="text-sm text-accent" onClick={() => navigate('/reminders')}>
              View all
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {due.data.items.slice(0, 4).map((item) => (
              <ItemCard key={item.id} item={item} compact {...cardProps} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fog">Recently saved</h2>
          <button className="text-sm text-accent" onClick={() => navigate('/items')}>
            View all
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {d.recentItems.map((item) => (
            <ItemCard key={item.id} item={item} {...cardProps} />
          ))}
          {!d.recentItems.length && (
            <div className="glass col-span-full rounded-2xl p-8 text-center text-sm text-mute">
              Nothing captured yet. Hit Quick Capture to start your vault.
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold text-fog">Favorites</h2>
          <div className="space-y-3">
            {d.favorites.map((item) => (
              <ItemCard key={item.id} item={item} compact {...cardProps} />
            ))}
            {!d.favorites.length && <p className="text-sm text-mute">Star items to pin them here.</p>}
          </div>
        </div>
        <div>
          <h2 className="mb-3 text-lg font-semibold text-fog">Library mix</h2>
          <div className="glass grid grid-cols-2 gap-3 rounded-2xl p-4 sm:grid-cols-3">
            {Object.entries(d.byType).map(([type, count]) => {
              const routes: Record<string, string> = {
                bookmark: '/bookmarks',
                image: '/images',
                video: '/videos',
                file: '/files',
                project: '/projects',
                audio: '/audio',
                note: '/notes',
              };
              return (
                <button
                  key={type}
                  className="rounded-xl border border-line/50 bg-mist/20 px-3 py-4 text-left transition hover:border-accent/30"
                  onClick={() => navigate(routes[type] || '/items')}
                >
                  <div className="text-2xl font-semibold text-fog">{count}</div>
                  <div className="text-xs capitalize text-mute">{type}</div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

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
              setActionError(
                err instanceof ApiError
                  ? err.message
                  : err instanceof Error
                    ? err.message
                    : 'Action failed',
              );
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

function Stat({
  label,
  value,
  warn,
  icon,
}: {
  label: string;
  value: string;
  warn?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className={`glass rounded-2xl p-4 ${warn ? 'border-warn/40' : ''}`}>
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-mute">
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold text-fog">{value}</div>
    </div>
  );
}
