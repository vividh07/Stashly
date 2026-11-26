import { create } from 'zustand';
import type { ContentType, ItemDto } from '@vault/shared';

export type CaptureOptions = {
  contentType?: ContentType;
  url?: string;
  title?: string;
  notes?: string;
};

interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  captureOpen: boolean;
  capturePrefill: CaptureOptions | null;
  viewMode: 'grid' | 'list';
  syncStatus: 'idle' | 'syncing' | 'offline' | 'error';
  syncMessage?: string;
  syncQueueOpen: boolean;
  /** Globally-viewable item detail, used by components (duplicate banners, hygiene lists, etc.)
   * that don't own a page-local selection state. */
  viewItem: ItemDto | null;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  setMobileNavOpen: (v: boolean) => void;
  openCapture: (opts?: CaptureOptions) => void;
  closeCapture: () => void;
  setViewMode: (v: 'grid' | 'list') => void;
  setSyncStatus: (s: UiState['syncStatus'], message?: string) => void;
  openSyncQueue: () => void;
  closeSyncQueue: () => void;
  openItemView: (item: ItemDto) => void;
  closeItemView: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  mobileNavOpen: false,
  captureOpen: false,
  capturePrefill: null,
  viewMode: 'grid',
  syncStatus: 'idle',
  syncQueueOpen: false,
  viewItem: null,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  openCapture: (opts) => set({ captureOpen: true, capturePrefill: opts || null }),
  closeCapture: () => set({ captureOpen: false, capturePrefill: null }),
  setViewMode: (viewMode) => set({ viewMode }),
  setSyncStatus: (syncStatus, syncMessage) => set({ syncStatus, syncMessage }),
  openSyncQueue: () => set({ syncQueueOpen: true }),
  closeSyncQueue: () => set({ syncQueueOpen: false }),
  openItemView: (viewItem) => set({ viewItem }),
  closeItemView: () => set({ viewItem: null }),
}));
