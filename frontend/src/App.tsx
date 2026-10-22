import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LiveProvider } from './context/LiveContext';
import { AlertsPage } from './pages/Alerts';
import { AssistantPage } from './pages/Assistant';
import { IncidentsPage } from './pages/Incidents';
import { InvestigationPage } from './pages/Investigation';
import { LogExplorerPage } from './pages/LogExplorer';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { SplashState } from './components/ui/States';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, booting } = useAuth();
  if (booting) return <SplashState />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RedirectIfSignedIn({ children }: { children: JSX.Element }) {
  const { user, booting } = useAuth();
  if (booting) return <SplashState />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <LiveProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectIfSignedIn>
                <LoginPage />
              </RedirectIfSignedIn>
            }
          />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<OverviewPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/incidents" element={<IncidentsPage />} />
            <Route path="/incidents/:id" element={<InvestigationPage />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/logs" element={<LogExplorerPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </LiveProvider>
    </AuthProvider>
  );
}
