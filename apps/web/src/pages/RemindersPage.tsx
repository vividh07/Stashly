import { useQuery } from '@tanstack/react-query';
import { AlarmClock, Clock3 } from 'lucide-react';
import { api } from '../lib/api';
import { ItemCard } from '../components/ItemCard';
import { useUiStore } from '../stores/ui';

export function RemindersPage() {
  const openItemView = useUiStore((s) => s.openItemView);
  const query = useQuery({ queryKey: ['due-items'], queryFn: () => api.dueItems() });
  const items = query.data?.items || [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-fog">
          <AlarmClock size={22} className="text-accent" /> Reminders
        </h1>
        <p className="mt-1 text-sm text-mute">
          Items with a reminder due, or that are about to expire.
        </p>
      </div>

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass h-40 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : query.isError ? (
        <div className="text-danger">Failed to load reminders</div>
      ) : !items.length ? (
        <div className="glass flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-3xl p-10 text-center">
          <Clock3 size={28} className="text-mute" />
          <div className="text-lg font-semibold text-fog">Nothing due</div>
          <p className="max-w-md text-sm text-mute">
            Set a reminder or expiry date on any item from its detail panel to see it here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} onOpen={openItemView} />
          ))}
        </div>
      )}
    </div>
  );
}
