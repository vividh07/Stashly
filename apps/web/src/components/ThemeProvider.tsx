import { useEffect } from 'react';
import { useAuthStore } from '../stores/auth';
import { applyTheme, getStoredTheme, watchSystemTheme, type ThemePreference } from '../lib/theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const userTheme = useAuthStore((s) => s.user?.theme) as ThemePreference | undefined;

  useEffect(() => {
    // localStorage is source of truth after user toggles; profile theme seeds it on login
    const preference = getStoredTheme() || userTheme || 'dark';
    applyTheme(preference);
    return watchSystemTheme(preference);
  }, [userTheme]);

  return <>{children}</>;
}
