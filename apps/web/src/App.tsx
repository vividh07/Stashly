import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './stores/auth';
import { AppShell } from './components/AppShell';
import { ThemeProvider } from './components/ThemeProvider';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ItemsPage } from './pages/ItemsPage';
import { ArchiveGate } from './components/ArchiveGate';

const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const SearchPage = lazy(() =>
  import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const SharePage = lazy(() =>
  import('./pages/SharePage').then((m) => ({ default: m.SharePage })),
);
const SharePublicPage = lazy(() =>
  import('./pages/SharePublicPage').then((m) => ({ default: m.SharePublicPage })),
);
const RemindersPage = lazy(() =>
  import('./pages/RemindersPage').then((m) => ({ default: m.RemindersPage })),
);
const DuplicatesPage = lazy(() =>
  import('./pages/DuplicatesPage').then((m) => ({ default: m.DuplicatesPage })),
);
const CaptureExtPage = lazy(() =>
  import('./pages/CaptureExtPage').then((m) => ({ default: m.CaptureExtPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function Protected({ children }: { children: React.ReactNode }) {
  const { user, hydrated, hydrate } = useAuthStore();
  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center text-mute">
        Loading vault…
      </div>
    );
  }
  if (!user) {
    const next = `${window.location.pathname}${window.location.search}`;
    const to = next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login';
    return <Navigate to={to} replace />;
  }
  return <>{children}</>;
}

function FallBack() {
  return <div className="glass h-40 animate-pulse rounded-3xl" />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/s/:token"
            element={
              <Suspense fallback={<FallBack />}>
                <SharePublicPage />
              </Suspense>
            }
          />
          <Route
            element={
              <Protected>
                <AppShell />
              </Protected>
            }
          >
            <Route
              index
              element={
                <Suspense fallback={<FallBack />}>
                  <DashboardPage />
                </Suspense>
              }
            />
            <Route path="inbox" element={<Navigate to="/" replace />} />
            <Route
              path="items"
              element={<ItemsPage title="All Items" subtitle="Your complete vault library." />}
            />
            <Route
              path="bookmarks"
              element={<ItemsPage title="Bookmarks" contentType="bookmark" />}
            />
            <Route path="images" element={<ItemsPage title="Images" contentType="image" />} />
            <Route path="videos" element={<ItemsPage title="Videos" contentType="video" />} />
            <Route path="files" element={<ItemsPage title="Files" contentType="file" />} />
            <Route
              path="projects"
              element={<ItemsPage title="Projects" contentType="project" />}
            />
            <Route path="audio" element={<ItemsPage title="Audio" contentType="audio" />} />
            <Route path="notes" element={<ItemsPage title="Notes" contentType="note" />} />
            <Route
              path="favorites"
              element={<ItemsPage title="Favorites" favorite archived={false} />}
            />
            <Route
              path="archive"
              element={
                <ArchiveGate>
                  <ItemsPage title="Archive" archived trashed={false} />
                </ArchiveGate>
              }
            />
            <Route path="trash" element={<ItemsPage title="Trash" trashed />} />
            <Route
              path="reminders"
              element={
                <Suspense fallback={<FallBack />}>
                  <RemindersPage />
                </Suspense>
              }
            />
            <Route
              path="duplicates"
              element={
                <Suspense fallback={<FallBack />}>
                  <DuplicatesPage />
                </Suspense>
              }
            />
            <Route
              path="search"
              element={
                <Suspense fallback={<FallBack />}>
                  <SearchPage />
                </Suspense>
              }
            />
            <Route
              path="settings"
              element={
                <Suspense fallback={<FallBack />}>
                  <SettingsPage />
                </Suspense>
              }
            />
            <Route
              path="share"
              element={
                <Suspense fallback={<FallBack />}>
                  <SharePage />
                </Suspense>
              }
            />
            <Route
              path="capture-ext"
              element={
                <Suspense fallback={<FallBack />}>
                  <CaptureExtPage />
                </Suspense>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
