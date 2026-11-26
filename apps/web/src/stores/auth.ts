import { create } from 'zustand';
import type { UserPublic } from '@vault/shared';
import { api } from '../lib/api';
import { clearArchiveGate } from '../lib/archiveGate';
import { useItemLockStore } from './itemLock';
import { applyTheme, type ThemePreference } from '../lib/theme';

function syncThemeFromUser(user: UserPublic | null) {
  if (!user?.theme) return;
  applyTheme(user.theme as ThemePreference);
}

interface AuthState {
  user: UserPublic | null;
  loading: boolean;
  hydrated: boolean;
  setUser: (user: UserPublic | null) => void;
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  hydrated: false,
  setUser: (user) => set({ user }),
  hydrate: async () => {
    try {
      const { user } = await api.me();
      syncThemeFromUser(user);
      set({ user, hydrated: true });
    } catch {
      set({ user: null, hydrated: true });
    }
  },
  login: async (email, password) => {
    set({ loading: true });
    try {
      const { user } = await api.login(email, password);
      syncThemeFromUser(user);
      set({ user, loading: false, hydrated: true });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },
  logout: async () => {
    try {
      await api.logout();
    } finally {
      clearArchiveGate();
      useItemLockStore.getState().clear();
      set({ user: null });
    }
  },
}));
