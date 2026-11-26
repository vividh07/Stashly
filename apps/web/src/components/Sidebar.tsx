import { NavLink } from 'react-router-dom';
import { LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { formatBytes } from '@vault/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { mainNav } from '../lib/nav';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useUiStore } from '../stores/ui';

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { sidebarCollapsed, toggleSidebar, mobileNavOpen, setMobileNavOpen } = useUiStore();
  const usage = useQuery({ queryKey: ['storage-usage'], queryFn: () => api.storageUsage() });

  const used = usage.data?.usage.usedBytes ?? user?.storageUsedBytes ?? 0;
  const quota = usage.data?.usage.quotaBytes ?? user?.storageQuotaBytes ?? 0;
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
      isActive
        ? 'bg-accent/10 text-accent shadow-glow'
        : 'text-mute hover:bg-mist/40 hover:text-fog',
      sidebarCollapsed && 'lg:justify-center lg:px-0',
    );

  return (
    <>
      {mobileNavOpen && (
        <button
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        className={clsx(
          'safe-pt safe-pb fixed inset-y-0 left-0 z-50 flex h-full max-h-dvh w-[min(288px,86vw)] shrink-0 flex-col overflow-hidden border-r border-line/60 bg-abyss/95 backdrop-blur-xl transition-transform duration-300 lg:relative lg:inset-auto lg:z-auto lg:h-full lg:max-h-none lg:translate-x-0',
          sidebarCollapsed ? 'lg:w-[76px]' : 'lg:w-[260px]',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex shrink-0 items-center gap-3 px-4 py-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-accent shadow-glow">
            <span className="font-semibold">Æ</span>
          </div>
          <div className={clsx('min-w-0 animate-fade-up', sidebarCollapsed && 'lg:hidden')}>
            <div className="truncate text-sm font-semibold tracking-wide text-fog">Aether Vault</div>
            <div className="truncate text-xs text-mute">
              {user?.name || 'Personal digital vault'}
            </div>
          </div>
          <button
            className="ml-auto hidden rounded-lg p-2 text-mute hover:bg-mist/50 hover:text-fog lg:inline-flex"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="sidebar-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 pb-3 [-webkit-overflow-scrolling:touch]">
          {mainNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMobileNavOpen(false)}
              className={linkClass}
              title={item.label}
            >
              <item.icon size={18} className="shrink-0 opacity-90" />
              <span className={clsx('truncate', sidebarCollapsed && 'lg:hidden')}>{item.label}</span>
            </NavLink>
          ))}

          <button
            type="button"
            className={clsx(
              'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-mute transition hover:bg-danger/10 hover:text-danger',
              sidebarCollapsed && 'lg:justify-center lg:px-0',
            )}
            onClick={() => {
              setMobileNavOpen(false);
              void logout();
            }}
            title="Logout"
          >
            <LogOut size={18} className="shrink-0" />
            <span className={clsx('truncate', sidebarCollapsed && 'lg:hidden')}>Logout</span>
          </button>

          <div
            className={clsx(
              'mt-2 rounded-xl border border-line/50 bg-mist/30 p-3',
              sidebarCollapsed && 'lg:hidden',
            )}
          >
            <div className="mb-2 flex items-center justify-between text-xs text-mute">
              <span>Storage</span>
              <span>
                {formatBytes(used)} / {formatBytes(quota)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-void">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent-dim to-accent transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </nav>
      </aside>
    </>
  );
}
