import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { CaptureModal } from './CaptureModal';
import { SyncQueuePanel } from './SyncQueuePanel';
import { ItemDetailHost } from './ItemDetail';
import { useEffect } from 'react';
import { flushPendingQueue } from '../lib/sync';
import { useQueryClient } from '@tanstack/react-query';
import { useUiStore } from '../stores/ui';
import { armArchiveSafeGuards, lockArchive } from '../lib/archiveGate';

export function AppShell() {
  const qc = useQueryClient();
  const setSyncStatus = useUiStore((s) => s.setSyncStatus);
  const viewItem = useUiStore((s) => s.viewItem);
  const closeItemView = useUiStore((s) => s.closeItemView);

  useEffect(() => {
    armArchiveSafeGuards();
  }, []);

  useEffect(() => {
    const sync = async () => {
      if (!navigator.onLine) return;
      setSyncStatus('syncing');
      const result = await flushPendingQueue();
      if (result.synced > 0) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['items'] }),
          qc.invalidateQueries({ queryKey: ['dashboard'] }),
          qc.invalidateQueries({ queryKey: ['storage-usage'] }),
          qc.invalidateQueries({ queryKey: ['sync-queue'] }),
        ]);
      }
      setSyncStatus(result.failed ? 'error' : 'idle', result.failed ? 'Some items failed to sync' : undefined);
    };
    void sync();
    const onOffline = () => {
      lockArchive();
      setSyncStatus('offline', 'Offline — archive sealed');
    };
    window.addEventListener('online', sync);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', onOffline);
    };
  }, [qc, setSyncStatus]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="safe-pb min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4 md:p-6">
          <Outlet />
        </main>
      </div>
      <CaptureModal />
      <SyncQueuePanel />
      <ItemDetailHost item={viewItem} onClose={closeItemView} />
    </div>
  );
}
