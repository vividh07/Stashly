export type ThemePreference = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'vault-theme';

export function getStoredTheme(): ThemePreference {
  const value = localStorage.getItem(STORAGE_KEY);
  if (value === 'dark' || value === 'light' || value === 'system') return value;
  return 'dark';
}

export function resolveTheme(preference: ThemePreference): 'dark' | 'light' {
  if (preference === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return preference;
}

export function applyTheme(preference: ThemePreference) {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;

  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  localStorage.setItem(STORAGE_KEY, preference);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? '#07090f' : '#f3f6fb');
  }

  // Force a layout paint so body/background tokens refresh immediately
  document.body?.style.setProperty('background', 'var(--body-bg)');
}

export function initTheme(preference?: ThemePreference | null) {
  applyTheme(preference || getStoredTheme());
}

export function watchSystemTheme(preference: ThemePreference) {
  if (preference !== 'system') return () => undefined;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => applyTheme('system');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
