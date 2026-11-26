import { create } from 'zustand';

/** In-memory only — unlocked item ids reset on refresh/new tab, same spirit as the archive gate. */
interface ItemLockState {
  unlockedIds: Set<string>;
  isUnlocked: (id: string) => boolean;
  unlock: (id: string) => void;
  lock: (id: string) => void;
  clear: () => void;
}

export const useItemLockStore = create<ItemLockState>((set, get) => ({
  unlockedIds: new Set(),
  isUnlocked: (id) => get().unlockedIds.has(id),
  unlock: (id) =>
    set((s) => {
      const next = new Set(s.unlockedIds);
      next.add(id);
      return { unlockedIds: next };
    }),
  lock: (id) =>
    set((s) => {
      const next = new Set(s.unlockedIds);
      next.delete(id);
      return { unlockedIds: next };
    }),
  clear: () => set({ unlockedIds: new Set() }),
}));
