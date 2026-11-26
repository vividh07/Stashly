import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, ShieldAlert } from 'lucide-react';
import {
  ARCHIVE_UNLOCK_TTL_MS,
  getArchiveUnlockState,
  lockArchive,
  subscribeArchiveGate,
  tryUnlockArchive,
  type ArchiveUnlockState,
} from '../lib/archiveGate';

interface Props {
  children: React.ReactNode;
}

function formatRemain(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}m ${r.toString().padStart(2, '0')}s`;
}

function scrubArchiveCache(qc: ReturnType<typeof useQueryClient>) {
  // Drop any cached archive payloads so content cannot linger in memory/UI after lock.
  qc.removeQueries({
    predicate: (q) => {
      const key = q.queryKey;
      if (!Array.isArray(key) || key[0] !== 'items') return false;
      const filter = key[1] as { archived?: boolean } | undefined;
      return filter?.archived === true;
    },
  });
}

export function ArchiveGate({ children }: Props) {
  const qc = useQueryClient();
  const [state, setState] = useState<ArchiveUnlockState>(() => getArchiveUnlockState());
  const [digits, setDigits] = useState(['', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const wasUnlocked = useRef(false);

  const sync = () => {
    const next = getArchiveUnlockState();
    setState(next);
    setNow(Date.now());
    if (wasUnlocked.current && !next.unlocked) {
      scrubArchiveCache(qc);
      setDigits(['', '', '', '']);
      setError(null);
    }
    wasUnlocked.current = next.unlocked;
  };

  useEffect(() => {
    sync();
    const unsub = subscribeArchiveGate(sync);
    const id = window.setInterval(sync, 400);
    return () => {
      unsub();
      window.clearInterval(id);
      // Leaving Archive always seals the safe.
      lockArchive();
      scrubArchiveCache(qc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
  }, [qc]);

  useEffect(() => {
    if (!state.unlocked) {
      window.setTimeout(() => inputs.current[0]?.focus(), 50);
    }
  }, [state.unlocked]);

  const locked =
    state.lockedUntil != null && state.lockedUntil > now ? state.lockedUntil - now : 0;

  const submit = async (pin: string) => {
    if (busy || locked > 0) return;
    setBusy(true);
    setError(null);
    const result = await tryUnlockArchive(pin);
    setBusy(false);
    if (result.ok) {
      sync();
      setDigits(['', '', '', '']);
      return;
    }
    setShake(true);
    window.setTimeout(() => setShake(false), 450);
    setDigits(['', '', '', '']);
    inputs.current[0]?.focus();
    if (result.reason === 'locked') {
      setError(
        `Too many attempts. Locked for ${formatRemain((result.lockedUntil || 0) - Date.now())}.`,
      );
    } else if (result.reason === 'format') {
      setError('Enter all 4 digits.');
    } else {
      setError(`Wrong PIN. ${result.fails} failed attempt${result.fails === 1 ? '' : 's'}.`);
    }
    sync();
  };

  const onDigit = (index: number, raw: string) => {
    if (locked > 0 || busy) return;
    const value = raw.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = value;
    setDigits(next);
    setError(null);
    if (value && index < 3) inputs.current[index + 1]?.focus();
    if (value && index === 3 && next.every((d) => d.length === 1)) {
      void submit(next.join(''));
    }
  };

  const onKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') {
      void submit(digits.join(''));
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    if (locked > 0 || busy) return;
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (!text) return;
    const next = ['', '', '', ''];
    for (let i = 0; i < text.length; i++) next[i] = text[i]!;
    setDigits(next);
    if (text.length === 4) void submit(text);
    else inputs.current[text.length]?.focus();
  };

  // Never mount archive content while locked — prevents direct UI/API access to the safe.
  if (!state.unlocked) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
        <div
          className={`glass w-full rounded-3xl p-6 shadow-glass sm:p-8 ${shake ? 'animate-shake' : ''}`}
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-warn/40 bg-warn/10 text-warn">
            <ShieldAlert size={28} />
          </div>
          <h1 className="text-xl font-semibold text-fog">Archive sealed</h1>
          <p className="mt-2 text-sm text-mute">
            This safe stays locked after refresh, network loss, tab switch, or leaving Archive.
            Unlock lasts {Math.round(ARCHIVE_UNLOCK_TTL_MS / 60000)} minutes.
          </p>

          <div className="mt-6 flex justify-center gap-2 sm:gap-3" onPaste={onPaste}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={1}
                value={d}
                disabled={busy || locked > 0}
                aria-label={`PIN digit ${i + 1}`}
                className="input h-14 w-12 text-center text-2xl tracking-widest sm:h-16 sm:w-14"
                onChange={(e) => onDigit(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
              />
            ))}
          </div>

          {locked > 0 ? (
            <p className="mt-4 text-sm font-medium text-danger">
              Locked — try again in {formatRemain(locked)}
            </p>
          ) : error ? (
            <p className="mt-4 text-sm text-danger">{error}</p>
          ) : (
            <p className="mt-4 text-xs text-mute">{busy ? 'Verifying…' : 'Enter 4-digit PIN'}</p>
          )}
        </div>
      </div>
    );
  }

  const remain = state.expiresAt ? Math.max(0, state.expiresAt - now) : 0;

  return (
    <div className="space-y-3">
      <div className="glass flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-2.5 text-xs text-mute">
        <span className="inline-flex items-center gap-1.5 text-accent">
          <Lock size={12} /> Safe open
        </span>
        <div className="flex items-center gap-3">
          <span>Seals in {formatRemain(remain)}</span>
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() => {
              lockArchive();
              scrubArchiveCache(qc);
              sync();
            }}
          >
            Lock now
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
