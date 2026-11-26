import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Menu, Moon, Plus, Search, Sun, Wifi, WifiOff, Loader2 } from 'lucide-react';
import type { ContentType } from '@vault/shared';
import { useUiStore } from '../stores/ui';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';
import { listPendingQueue } from '../lib/sync';
import { applyTheme, getStoredTheme, resolveTheme, type ThemePreference } from '../lib/theme';

function captureTypeFromPath(pathname: string): ContentType | undefined {
  const map: Record<string, ContentType> = {
    '/bookmarks': 'bookmark',
    '/images': 'image',
    '/videos': 'video',
    '/files': 'file',
    '/projects': 'project',
    '/audio': 'audio',
    '/notes': 'note',
  };
  return map[pathname];
}

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const { openCapture, setMobileNavOpen, syncStatus, setSyncStatus, openSyncQueue } = useUiStore();
  const [q, setQ] = useState('');
  /** Chrome ignores autocomplete=off; readonly-until-focus blocks credential autofill. */
  const [searchLocked, setSearchLocked] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchDebounce = useRef<number | null>(null);
  const userTyped = useRef(false);
  const pendingQueue = useQuery({
    queryKey: ['sync-queue'],
    queryFn: listPendingQueue,
    refetchInterval: 6000,
  });
  const pendingCount = pendingQueue.data?.length || 0;
  const [themePref, setThemePref] = useState<ThemePreference>(
    () => (user?.theme as ThemePreference) || getStoredTheme(),
  );
  const resolved = resolveTheme(themePref);

  useEffect(() => {
    if (user?.theme) setThemePref(user.theme as ThemePreference);
  }, [user?.theme]);

  useEffect(() => {
    const onOnline = () => setSyncStatus('idle', 'Online');
    const onOffline = () => setSyncStatus('offline', 'Offline — pending sync queued');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (!navigator.onLine) setSyncStatus('offline', 'Offline');
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [setSyncStatus]);

  // Keep the bar in sync when already on Search; clear elsewhere.
  useEffect(() => {
    userTyped.current = false;
    setSearchLocked(true);
    if (location.pathname !== '/search') {
      setQ('');
      if (searchRef.current) searchRef.current.value = '';
      return;
    }
    const params = new URLSearchParams(location.search);
    setQ(params.get('q') || '');
  }, [location.pathname, location.search]);

  // Catch late browser autofill that writes into the search DOM after navigation.
  useEffect(() => {
    if (location.pathname === '/search') return;
    const el = searchRef.current;
    if (!el) return;
    const scrub = () => {
      if (userTyped.current && document.activeElement === el) return;
      const val = el.value.trim();
      const email = user?.email?.trim().toLowerCase();
      const looksLikeCredential =
        (email && val.toLowerCase() === email) ||
        (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) && document.activeElement !== el);
      if (looksLikeCredential || (!userTyped.current && val && document.activeElement !== el)) {
        el.value = '';
        setQ('');
      }
    };
    scrub();
    const id = window.setInterval(scrub, 200);
    const stop = window.setTimeout(() => window.clearInterval(id), 2500);
    el.addEventListener('change', scrub);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
      el.removeEventListener('change', scrub);
    };
  }, [location.pathname, user?.email]);

  useEffect(() => {
    return () => {
      if (searchDebounce.current != null) window.clearTimeout(searchDebounce.current);
    };
  }, []);

  const goSearch = (value: string) => {
    const next = value.trim();
    if (!next) return;
    navigate(`/search?q=${encodeURIComponent(next)}`);
  };

  return (
    <header className="safe-pt z-30 flex shrink-0 items-center gap-2 border-b border-line/50 bg-void/70 px-3 py-2.5 backdrop-blur-xl sm:gap-3 sm:px-4 sm:py-3">
      {/* Decoy fields so Chrome dumps credentials here instead of Search */}
      <div className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0" aria-hidden>
        <input type="text" name="username" autoComplete="username" tabIndex={-1} defaultValue="" />
        <input type="password" name="password" autoComplete="current-password" tabIndex={-1} defaultValue="" />
      </div>

      <button
        className="touch-target rounded-xl p-2.5 text-mute hover:bg-mist/50 lg:hidden"
        onClick={() => setMobileNavOpen(true)}
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      <div className="relative min-w-0 flex-1">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
        <input
          ref={searchRef}
          className="input pl-9"
          type="search"
          name="aether-vault-search"
          placeholder="Search…"
          value={q}
          readOnly={searchLocked}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="search"
          role="searchbox"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          onFocus={() => {
            setSearchLocked(false);
            userTyped.current = true;
          }}
          onBlur={() => {
            setSearchLocked(true);
            userTyped.current = false;
          }}
          onChange={(e) => {
            const value = e.target.value;
            // Ignore unsolicited autofill while the field isn't being typed in.
            if (!userTyped.current && document.activeElement !== e.target) {
              e.target.value = '';
              setQ('');
              return;
            }
            const email = user?.email?.trim().toLowerCase();
            if (
              email &&
              value.trim().toLowerCase() === email &&
              location.pathname === '/settings'
            ) {
              e.target.value = '';
              setQ('');
              return;
            }
            setQ(value);
            if (searchDebounce.current != null) window.clearTimeout(searchDebounce.current);
            if (location.pathname === '/search') {
              searchDebounce.current = window.setTimeout(() => goSearch(value), 320);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') goSearch(q);
          }}
        />
      </div>

      <button
        className="btn-primary touch-target shrink-0 px-3"
        onClick={() => {
          const contentType = captureTypeFromPath(location.pathname);
          openCapture(contentType ? { contentType } : undefined);
        }}
        aria-label="Quick Capture"
      >
        <Plus size={16} />
        <span className="hidden sm:inline">Capture</span>
      </button>

      <button
        type="button"
        className="btn-subtle touch-target shrink-0 px-3"
        aria-label={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={resolved === 'dark' ? 'Light mode' : 'Dark mode'}
        onClick={() => {
          const next: ThemePreference = resolved === 'dark' ? 'light' : 'dark';
          setThemePref(next);
          applyTheme(next);
          if (user) {
            setUser({ ...user, theme: next });
            void api.updateProfile({ theme: next }).catch(() => undefined);
          }
        }}
      >
        {resolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <button
        type="button"
        className="relative hidden items-center gap-2 rounded-xl border border-line/60 bg-mist/30 px-3 py-2 text-xs text-mute transition hover:bg-mist/50 sm:flex"
        title={syncStatus}
        onClick={openSyncQueue}
      >
        {syncStatus === 'offline' ? (
          <WifiOff size={14} className="text-warn" />
        ) : syncStatus === 'syncing' ? (
          <Loader2 size={14} className="animate-spin text-accent" />
        ) : (
          <Wifi size={14} className="text-accent" />
        )}
        <span className="max-w-[120px] truncate">
          {syncStatus === 'offline' ? 'Offline' : syncStatus === 'syncing' ? 'Syncing' : 'Synced'}
        </span>
        {pendingCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-ink">
            {pendingCount > 99 ? '99+' : pendingCount}
          </span>
        )}
      </button>
      {pendingCount > 0 && (
        <button
          type="button"
          className="touch-target relative shrink-0 rounded-xl p-2.5 text-mute hover:bg-mist/50 sm:hidden"
          onClick={openSyncQueue}
          aria-label={`${pendingCount} pending sync items`}
        >
          {syncStatus === 'offline' ? <WifiOff size={18} className="text-warn" /> : <Wifi size={18} />}
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-ink">
            {pendingCount > 99 ? '99+' : pendingCount}
          </span>
        </button>
      )}

      <div className="hidden h-9 w-9 items-center justify-center rounded-full border border-line/70 bg-mist/50 text-xs font-semibold text-accent md:flex">
        {(user?.name || 'U').slice(0, 1).toUpperCase()}
      </div>
    </header>
  );
}
