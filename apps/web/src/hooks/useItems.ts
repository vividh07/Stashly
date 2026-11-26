import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContentType, ItemDto } from '@vault/shared';
import { api } from '../lib/api';

export interface ItemsFilter {
  contentType?: ContentType;
  favorite?: boolean;
  archived?: boolean;
  trashed?: boolean;
  q?: string;
  sort?: 'newest' | 'oldest' | 'name' | 'size';
  tags?: string;
}

export function useItems(filter: ItemsFilter) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<ItemDto | null>(null);

  const queryKey = useMemo(() => ['items', filter], [filter]);

  const query = useQuery({
    queryKey,
    queryFn: () =>
      api.items({
        contentType: filter.contentType,
        favorite: filter.favorite,
        archived: filter.archived,
        trashed: filter.trashed,
        q: filter.q,
        sort: filter.sort || 'newest',
        tags: filter.tags,
        limit: 60,
      }),
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['items'] }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
      qc.invalidateQueries({ queryKey: ['storage-usage'] }),
    ]);
  };

  const favorite = useMutation({
    mutationFn: (item: ItemDto) => api.updateItem(item.id, { favorite: !item.favorite }),
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: ['items'] });
      const previous = qc.getQueriesData<{ items: ItemDto[] }>({ queryKey: ['items'] });
      qc.setQueriesData<{ items: ItemDto[]; total?: number; nextCursor?: string | null }>(
        { queryKey: ['items'] },
        (old) => {
          if (!old?.items) return old;
          return {
            ...old,
            items: old.items.map((i) =>
              i.id === item.id ? { ...i, favorite: !i.favorite } : i,
            ),
          };
        },
      );
      return { previous };
    },
    onError: (_err, _item, ctx) => {
      ctx?.previous?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: invalidate,
  });

  const archive = useMutation({
    mutationFn: (item: ItemDto) => api.updateItem(item.id, { archived: !item.archived }),
    onSuccess: invalidate,
  });

  const trash = useMutation({
    mutationFn: async (item: ItemDto) => {
      if (item.trashed) {
        await api.deleteItem(item.id, true);
        return;
      }
      // Dedicated trash endpoint (same auth style as purge / other POSTs)
      await api.trashItem(item.id);
    },
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: ['items'] });
      const previous = qc.getQueriesData<{ items: ItemDto[] }>({ queryKey: ['items'] });
      qc.setQueriesData<{ items: ItemDto[]; total?: number; nextCursor?: string | null }>(
        { queryKey: ['items'] },
        (old) => {
          if (!old?.items) return old;
          return {
            ...old,
            items: old.items.filter((i) => i.id !== item.id),
            total: typeof old.total === 'number' ? Math.max(0, old.total - 1) : old.total,
          };
        },
      );
      setActive((cur) => (cur?.id === item.id ? null : cur));
      setSelected((prev) => {
        if (!prev.has(item.id)) return prev;
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      return { previous };
    },
    onError: (_err, _item, ctx) => {
      ctx?.previous?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: invalidate,
  });

  const restore = useMutation({
    mutationFn: (item: ItemDto) => api.updateItem(item.id, { trashed: false }),
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: ['items'] });
      const previous = qc.getQueriesData<{ items: ItemDto[] }>({ queryKey: ['items'] });
      qc.setQueriesData<{ items: ItemDto[]; total?: number; nextCursor?: string | null }>(
        { queryKey: ['items'] },
        (old) => {
          if (!old?.items) return old;
          return {
            ...old,
            items: old.items.filter((i) => i.id !== item.id),
            total: typeof old.total === 'number' ? Math.max(0, old.total - 1) : old.total,
          };
        },
      );
      return { previous };
    },
    onError: (_err, _item, ctx) => {
      ctx?.previous?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: invalidate,
  });

  const lock = useMutation({
    mutationFn: (item: ItemDto) => api.lockItem(item.id, true),
    onSuccess: invalidate,
  });

  const bulk = useMutation({
    mutationFn: (action: string) =>
      api.bulk({ ids: Array.from(selected), action }),
    onSuccess: async () => {
      setSelected(new Set());
      await invalidate();
    },
  });

  return {
    query,
    selected,
    setSelected,
    toggleSelect,
    active,
    setActive,
    favorite,
    archive,
    trash,
    restore,
    lock,
    bulk,
  };
}
