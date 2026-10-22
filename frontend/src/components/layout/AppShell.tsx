import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar, MobileNav } from './Sidebar';
import { Topbar } from './Topbar';
import { IS_MOCK } from '../../services/api';

const NAV_KEY = 'ai-soc.nav.collapsed';

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(NAV_KEY) === '1');

  const toggle = () =>
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(NAV_KEY, next ? '1' : '0');
      return next;
    });

  return (
    <div className="flex min-h-screen">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <MobileNav />
        <main className="mx-auto w-full max-w-[1680px] flex-1 px-3 py-4 sm:px-5 sm:py-5">
          <Outlet />
        </main>
        <footer className="border-t border-soc-800 px-4 py-3 text-[11px] text-soc-500">
          AI SOC · Phase 1 interface
          {IS_MOCK ? ' — every event, alert, incident and AI answer below is synthetic demo data, no live telemetry is collected.' : ' — bound to the detection backend.'}
        </footer>
      </div>
    </div>
  );
}
