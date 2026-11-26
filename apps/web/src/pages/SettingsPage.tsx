import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ExternalLink, Trash2 } from 'lucide-react';
import { formatBytes, type ItemDto, type UserPublic } from '@vault/shared';
import { api, ApiError } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useUiStore } from '../stores/ui';
import { applyTheme, getStoredTheme, type ThemePreference } from '../lib/theme';
import { lockArchive } from '../lib/archiveGate';
import { decryptJsonWithPassword, encryptJsonWithPassword } from '../lib/clientCrypto';
import { clearPendingQueue } from '../lib/sync';

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const qc = useQueryClient();

  const usage = useQuery({ queryKey: ['storage-usage'], queryFn: () => api.storageUsage() });
  const [name, setName] = useState(user?.name || '');
  const [theme, setTheme] = useState<ThemePreference>(
    (user?.theme as ThemePreference) || getStoredTheme(),
  );
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveProfile = useMutation({
    mutationFn: () => api.updateProfile({ name, theme }),
    onSuccess: (data) => {
      setUser(data.user);
      applyTheme((data.user.theme as ThemePreference) || theme);
      setMessage('Profile updated');
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const changePassword = useMutation({
    mutationFn: () => api.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setMessage('Password changed — please sign in again');
      setCurrentPassword('');
      setNewPassword('');
      void logout();
    },
    onError: (err: Error) => setError(err instanceof ApiError ? err.message : err.message),
  });

  const onExport = async () => {
    const data = await api.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aether-vault-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const u = usage.data?.usage;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-fog">Settings</h1>
        <p className="text-sm text-mute">Profile, security, storage, and export.</p>
      </div>

      {message && <div className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-accent">{message}</div>}
      {error && <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      <section className="glass rounded-3xl p-5">
        <h2 className="mb-4 text-lg font-semibold">Profile</h2>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            saveProfile.mutate();
          }}
        >
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Email</label>
            {/* Plain text — an <input type="email"> makes Chrome dump the address into Search */}
            <div className="input flex items-center text-mute">{user?.email || '—'}</div>
          </div>
          <div>
            <label className="label">Theme</label>
            <select
              className="input"
              value={theme}
              onChange={(e) => {
                const next = e.target.value as ThemePreference;
                setTheme(next);
                applyTheme(next);
                if (user) setUser({ ...user, theme: next });
              }}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </div>
          <button className="btn-primary" disabled={saveProfile.isPending}>
            Save profile
          </button>
        </form>
      </section>

      <InstallOnAndroid />

      <section className="glass rounded-3xl p-5">
        <h2 className="mb-4 text-lg font-semibold">Password</h2>
        <form
          className="space-y-3"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            changePassword.mutate();
          }}
        >
          <div>
            <label className="label">Current password</label>
            <input
              className="input"
              type="password"
              name="current-password"
              autoComplete="new-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div>
            <label className="label">New password</label>
            <input
              className="input"
              type="password"
              name="new-password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <button className="btn-subtle" disabled={changePassword.isPending}>
            Change password
          </button>
        </form>
      </section>

      <AuthenticatorSettings
        enabled={Boolean(user?.totpEnabled)}
        onUser={(u) => setUser(u)}
        onMessage={setMessage}
        onError={setError}
      />

      <ArchivePinSettings
        totpEnabled={Boolean(user?.totpEnabled)}
        onMessage={setMessage}
        onError={setError}
      />

      <section className="glass rounded-3xl p-5">
        <h2 className="mb-2 text-lg font-semibold">Storage</h2>
        {u && (
          <>
            <p className="mb-3 text-sm text-mute">
              {formatBytes(u.usedBytes)} used of {formatBytes(u.quotaBytes)} ({u.percentUsed.toFixed(1)}%)
              {u.reservedBytes > 0 ? ` · ${formatBytes(u.reservedBytes)} reserved` : ''}
            </p>
            <div className="mb-4 h-2 overflow-hidden rounded-full bg-void">
              <div className="h-full bg-accent" style={{ width: `${Math.min(100, u.percentUsed)}%` }} />
            </div>
            <h3 className="mb-2 text-sm font-medium text-fog">Largest files</h3>
            <div className="space-y-2">
              {u.largestFiles.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between rounded-xl border border-line/50 bg-mist/20 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate text-fog">{f.title}</div>
                    <div className="text-xs text-mute">{f.fileName || f.contentType}</div>
                  </div>
                  <div className="shrink-0 text-mute">{formatBytes(f.fileSize)}</div>
                </div>
              ))}
              {!u.largestFiles.length && <p className="text-sm text-mute">No files stored yet.</p>}
            </div>
            <button
              className="btn-ghost mt-3 text-sm"
              onClick={() => qc.invalidateQueries({ queryKey: ['storage-usage'] })}
            >
              Refresh usage
            </button>
          </>
        )}
      </section>

      <section className="glass rounded-3xl p-5">
        <h2 className="mb-2 text-lg font-semibold">Data export</h2>
        <p className="mb-3 text-sm text-mute">
          Download item metadata and tags as JSON. Binary files remain in R2 and are not bundled.
        </p>
        <button className="btn-subtle" onClick={onExport}>
          Export JSON
        </button>
      </section>

      <EncryptedExportSettings />

      <StorageHygieneSettings />

      <section className="glass rounded-3xl p-5">
        <h2 className="mb-2 text-lg font-semibold">Session</h2>
        <button className="btn-subtle text-danger" onClick={() => logout()}>
          Log out
        </button>
      </section>

      <PurgeVaultSettings
        onMessage={setMessage}
        onError={setError}
        onUser={(u) => setUser(u)}
      />
    </div>
  );
}

function PurgeVaultSettings({
  onMessage,
  onError,
  onUser,
}: {
  onMessage: (m: string | null) => void;
  onError: (m: string | null) => void;
  onUser: (u: UserPublic) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const canPurge = password.length >= 8 && confirmText === 'DELETE';

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, busy]);

  const runPurge = async () => {
    if (!canPurge || busy) return;
    setBusy(true);
    onError(null);
    try {
      const res = await api.purgeVault(password);
      await clearPendingQueue();
      onUser(res.user);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['items'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['storage-usage'] }),
        qc.invalidateQueries({ queryKey: ['hygiene'] }),
        qc.invalidateQueries({ queryKey: ['due-items'] }),
        qc.invalidateQueries({ queryKey: ['sync-queue'] }),
        qc.invalidateQueries({ queryKey: ['tags'] }),
      ]);
      onMessage(
        `Vault wiped — ${res.deletedItems} item${res.deletedItems === 1 ? '' : 's'} removed` +
          (res.filesRemoved ? ` · ${res.filesRemoved} file${res.filesRemoved === 1 ? '' : 's'} deleted` : '') +
          '. Login credentials kept.',
      );
      setOpen(false);
      setPassword('');
      setConfirmText('');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Purge failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass rounded-3xl border border-danger/20 p-5">
      <h2 className="mb-2 text-lg font-semibold text-danger">Danger zone</h2>
      <p className="mb-3 text-sm text-mute">
        Permanently delete every item, file, tag, share link, and offline queue entry. Your account,
        password, authenticator, and archive PIN stay intact.
      </p>
      <button type="button" className="btn-danger" onClick={() => setOpen(true)}>
        Delete all vault data
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4"
            style={{ zIndex: 99999 }}
            role="presentation"
          >
            <button
              type="button"
              className="absolute inset-0 cursor-default bg-black/70"
              aria-label="Dismiss"
              disabled={busy}
              onClick={() => {
                if (!busy) setOpen(false);
              }}
            />
            <div
              role="alertdialog"
              aria-modal="true"
              className="safe-pb relative flex max-h-[min(90dvh,640px)] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-line/70 bg-abyss shadow-glass sm:rounded-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5 sm:p-6">
                <h3 className="text-lg font-semibold text-fog">Delete all vault data?</h3>
                <p className="text-sm text-mute">
                  This cannot be undone. Type{' '}
                  <span className="font-semibold text-fog">DELETE</span> and enter your password to
                  confirm. Login credentials are not removed.
                </p>
                <div>
                  <label className="label">Type DELETE</label>
                  <input
                    className="input"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    autoComplete="off"
                    placeholder="DELETE"
                    disabled={busy}
                  />
                </div>
                <div>
                  <label className="label">Password</label>
                  <input
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    disabled={busy}
                    minLength={8}
                  />
                </div>
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-line/50 bg-abyss p-4 sm:flex sm:justify-end sm:px-6 sm:pb-6">
                <button
                  type="button"
                  className="btn-subtle min-h-11"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger min-h-11"
                  disabled={!canPurge || busy}
                  onClick={() => void runPurge()}
                >
                  {busy ? 'Wiping…' : 'Wipe vault'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}

function InstallOnAndroid() {
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(
    () => window.matchMedia('(display-mode: standalone)').matches,
  );
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setCanInstall(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setCanInstall(false);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setCanInstall(false);
  };

  return (
    <section className="glass rounded-3xl p-5">
      <h2 className="mb-2 text-lg font-semibold">Install on Android</h2>
      <p className="mb-3 text-sm text-mute">
        Install Aether from Chrome to get <span className="text-fog">Share → Aether Vault</span> from
        Photos, Files, and the browser. Files and media save straight into their library; links and
        text open Quick Capture.
      </p>
      {installed ? (
        <p className="text-sm text-accent">Installed — use Android’s share sheet to capture.</p>
      ) : canInstall ? (
        <button type="button" className="btn-primary" onClick={() => void promptInstall()}>
          Install app
        </button>
      ) : (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-mute">
          <li>Open this site in Chrome on your phone</li>
          <li>Tap the menu (⋮) → <span className="text-fog">Install app</span> / Add to Home screen</li>
          <li>Open Aether from the home screen, then share into it</li>
        </ol>
      )}
    </section>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function EncryptedExportSettings() {
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [decrypted, setDecrypted] = useState<{ items: unknown[]; tags: unknown[]; exportedAt: string } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onEncryptedExport = async () => {
    if (exportPassword.length < 8) {
      setError('Use a password with at least 8 characters');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api.exportData();
      const blob = await encryptJsonWithPassword(data, exportPassword);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aether-vault-export-${new Date().toISOString().slice(0, 10)}.vault.json.enc`;
      a.click();
      URL.revokeObjectURL(url);
      setExportPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
    if (!importFile) {
      setError('Choose a .vault.json.enc file');
      return;
    }
    setBusy(true);
    setError(null);
    setSummary(null);
    setDecrypted(null);
    try {
      const data = (await decryptJsonWithPassword(importFile, importPassword)) as {
        items?: unknown[];
        tags?: unknown[];
        exportedAt?: string;
      };
      const items = Array.isArray(data.items) ? data.items : [];
      const tags = Array.isArray(data.tags) ? data.tags : [];
      setDecrypted({ items, tags, exportedAt: data.exportedAt || 'unknown' });
      setSummary(
        `Decrypted ${items.length} item${items.length === 1 ? '' : 's'} and ${tags.length} tag${
          tags.length === 1 ? '' : 's'
        } (exported ${data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'unknown date'}).`,
      );
      setImportPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decryption failed');
    } finally {
      setBusy(false);
    }
  };

  const downloadDecrypted = () => {
    if (!decrypted) return;
    const blob = new Blob([JSON.stringify(decrypted, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aether-vault-import-preview.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="glass rounded-3xl p-5">
      <h2 className="mb-2 text-lg font-semibold">Encrypted export</h2>
      <p className="mb-4 text-sm text-mute">
        Password-protect your metadata export with AES-GCM. Only someone with the password can read
        the file.
      </p>

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      <div className="mb-5 space-y-2">
        <label className="label">Export password</label>
        <div className="flex flex-wrap gap-2">
          <input
            className="input max-w-xs"
            type="password"
            placeholder="At least 8 characters"
            value={exportPassword}
            onChange={(e) => setExportPassword(e.target.value)}
          />
          <button type="button" className="btn-subtle" disabled={busy} onClick={() => void onEncryptedExport()}>
            Download encrypted export
          </button>
        </div>
      </div>

      <div className="border-t border-line/50 pt-4">
        <label className="label">Import encrypted (metadata only)</label>
        <p className="mb-2 text-xs text-mute">
          Decrypts a previous export locally in your browser and shows a summary — items are not
          re-created in your vault automatically.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            className="input max-w-xs file:mr-3 file:rounded-lg file:border-0 file:bg-accent/15 file:px-3 file:py-1.5 file:text-accent"
            type="file"
            accept=".enc,.json"
            onChange={(e) => setImportFile(e.target.files?.[0] || null)}
          />
          <input
            className="input max-w-[200px]"
            type="password"
            placeholder="Password"
            value={importPassword}
            onChange={(e) => setImportPassword(e.target.value)}
          />
          <button type="button" className="btn-subtle" disabled={busy} onClick={() => void onImport()}>
            Decrypt
          </button>
        </div>
        {summary && (
          <div className="mt-3 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2.5 text-sm text-accent">
            {summary}
            <button type="button" className="ml-3 underline underline-offset-2" onClick={downloadDecrypted}>
              Download JSON
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function StorageHygieneSettings() {
  const qc = useQueryClient();
  const openItemView = useUiStore((s) => s.openItemView);
  const query = useQuery({ queryKey: ['hygiene'], queryFn: () => api.hygiene() });

  const trash = useMutation({
    mutationFn: (item: ItemDto) => api.trashItem(item.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hygiene'] }),
  });

  const h = query.data;

  return (
    <section className="glass rounded-3xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Storage hygiene</h2>
        <Link to="/duplicates" className="text-sm text-accent hover:underline">
          View duplicates page
        </Link>
      </div>

      {query.isLoading ? (
        <div className="glass-soft h-24 animate-pulse rounded-2xl" />
      ) : !h ? (
        <p className="text-sm text-danger">Failed to load storage hygiene</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <HygieneStat label="Trash" value={h.trashCount} />
            <HygieneStat label="Expired" value={h.expiredItems.length} />
            <HygieneStat label="Archive candidates" value={h.unusedArchiveCandidates.length} />
            <HygieneStat label="Duplicate groups" value={h.duplicateGroups.length} />
          </div>

          {h.expiredItems.length > 0 && (
            <HygieneList
              title="Expired items"
              items={h.expiredItems}
              onOpen={openItemView}
              onTrash={(item) => trash.mutate(item)}
            />
          )}

          {h.unusedArchiveCandidates.length > 0 && (
            <HygieneList
              title="Rarely-accessed archive candidates"
              items={h.unusedArchiveCandidates}
              onOpen={openItemView}
              onTrash={(item) => trash.mutate(item)}
            />
          )}

          {h.largestFiles.length > 0 && (
            <HygieneList title="Largest files" items={h.largestFiles} onOpen={openItemView} showSize />
          )}
        </div>
      )}
    </section>
  );
}

function HygieneStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line/50 bg-mist/20 px-3 py-3 text-center">
      <div className="text-xl font-semibold text-fog">{value}</div>
      <div className="text-xs text-mute">{label}</div>
    </div>
  );
}

function HygieneList({
  title,
  items,
  onOpen,
  onTrash,
  showSize,
}: {
  title: string;
  items: ItemDto[];
  onOpen: (item: ItemDto) => void;
  onTrash?: (item: ItemDto) => void;
  showSize?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-fog">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-xl border border-line/50 bg-mist/20 px-3 py-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-fog">{item.title}</div>
              <div className="truncate text-xs text-mute">
                {item.fileName || item.contentType}
                {showSize && item.fileSize ? ` · ${formatBytes(item.fileSize)}` : ''}
              </div>
            </div>
            <button type="button" className="btn-ghost shrink-0 px-2 py-1 text-xs" onClick={() => onOpen(item)}>
              <ExternalLink size={13} /> Open
            </button>
            {onTrash && (
              <button
                type="button"
                className="btn-ghost shrink-0 px-2 py-1 text-xs text-danger"
                onClick={() => onTrash(item)}
              >
                <Trash2 size={13} /> Trash
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AuthenticatorSettings({
  enabled,
  onUser,
  onMessage,
  onError,
}: {
  enabled: boolean;
  onUser: (u: UserPublic) => void;
  onMessage: (m: string | null) => void;
  onError: (m: string | null) => void;
}) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const startSetup = async () => {
    setBusy(true);
    onError(null);
    try {
      const res = await api.totpSetup();
      setSetup(res);
      onMessage('Scan the QR code with Google Authenticator / Authy, then enter a code.');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  const enable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const res = await api.totpEnable(code);
      onUser(res.user);
      setSetup(null);
      setCode('');
      onMessage('Authenticator enabled — you can reset login & archive PIN with app codes.');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  const disable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const res = await api.totpDisable(code, password);
      onUser(res.user);
      setCode('');
      setPassword('');
      onMessage('Authenticator disabled');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not disable');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass rounded-3xl p-5">
      <h2 className="mb-2 text-lg font-semibold">Authenticator app</h2>
      <p className="mb-4 text-sm text-mute">
        Use Google Authenticator, Authy, or 1Password to reset your vault password and archive PIN
        without email.
      </p>
      {enabled ? (
        <form className="space-y-3" onSubmit={disable}>
          <p className="text-sm text-accent">Status: enabled</p>
          <div>
            <label className="label">Authenticator code</label>
            <input
              className="input"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              minLength={6}
              maxLength={6}
            />
          </div>
          <div>
            <label className="label">Account password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="btn-subtle text-danger" disabled={busy}>
            Disable authenticator
          </button>
        </form>
      ) : setup ? (
        <form className="space-y-3" onSubmit={enable}>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setup.otpauthUrl)}`}
              alt="Authenticator QR code"
              className="h-[180px] w-[180px] rounded-xl border border-line/60 bg-white p-2"
            />
            <div className="min-w-0 flex-1 text-left">
              <p className="text-xs text-mute">Or enter this key manually:</p>
              <code className="mt-1 block break-all rounded-xl bg-mist/40 px-3 py-2 text-sm text-fog">
                {setup.secret}
              </code>
            </div>
          </div>
          <div>
            <label className="label">Confirm with 6-digit code</label>
            <input
              className="input"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              minLength={6}
              maxLength={6}
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={() => setSetup(null)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={busy}>
              Enable
            </button>
          </div>
        </form>
      ) : (
        <button className="btn-primary" disabled={busy} onClick={() => void startSetup()}>
          Set up authenticator
        </button>
      )}
    </section>
  );
}

function ArchivePinSettings({
  totpEnabled,
  onMessage,
  onError,
}: {
  totpEnabled: boolean;
  onMessage: (m: string | null) => void;
  onError: (m: string | null) => void;
}) {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!totpEnabled) {
      onError('Enable authenticator first');
      return;
    }
    setBusy(true);
    onError(null);
    try {
      const res = await api.resetArchivePin(code, pin);
      lockArchive();
      setCode('');
      setPin('');
      onMessage(res.message);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass rounded-3xl p-5">
      <h2 className="mb-4 text-lg font-semibold">Archive PIN</h2>
      {!totpEnabled ? (
        <p className="text-sm text-warn">Set up an authenticator app above to change the archive PIN.</p>
      ) : (
        <form className="space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="label">Authenticator code</label>
            <input
              className="input"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              minLength={6}
              maxLength={6}
            />
          </div>
          <div>
            <label className="label">New 4-digit PIN</label>
            <input
              className="input"
              inputMode="numeric"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              required
              minLength={4}
              maxLength={4}
            />
          </div>
          <button className="btn-subtle" disabled={busy}>
            Update archive PIN
          </button>
        </form>
      )}
    </section>
  );
}
