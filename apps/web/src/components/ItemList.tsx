import type { ItemDto } from '@vault/shared';
import { ItemCard } from './ItemCard';
import { useUiStore } from '../stores/ui';
import clsx from 'clsx';

interface Props {
  items: ItemDto[];
  selected: Set<string>;
  onSelect: (id: string) => void;
  onOpen: (item: ItemDto) => void;
  onFavorite: (item: ItemDto) => void;
  onArchive: (item: ItemDto) => void;
  onTrash: (item: ItemDto) => void;
  onLock?: (item: ItemDto) => void;
  trashedView?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
}

export function ItemList({
  items,
  selected,
  onSelect,
  onOpen,
  onFavorite,
  onArchive,
  onTrash,
  onLock,
  trashedView,
  emptyTitle = 'Nothing here yet',
  emptyBody = 'Use Quick Capture to save a link, note, or file.',
}: Props) {
  const viewMode = useUiStore((s) => s.viewMode);

  if (!items.length) {
    return (
      <div className="glass flex min-h-[240px] flex-col items-center justify-center rounded-3xl p-10 text-center">
        <div className="mb-2 text-lg font-semibold text-fog">{emptyTitle}</div>
        <p className="max-w-md text-sm text-mute">{emptyBody}</p>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        viewMode === 'grid'
          ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
          : 'space-y-3',
      )}
    >
      {items.map((item, i) => (
        <div key={item.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
          <ItemCard
            item={item}
            selected={selected.has(item.id)}
            onSelect={onSelect}
            onOpen={onOpen}
            onFavorite={onFavorite}
            onArchive={onArchive}
            onTrash={onTrash}
            onLock={onLock}
            trashedView={trashedView}
            compact={viewMode === 'list'}
          />
        </div>
      ))}
    </div>
  );
}
