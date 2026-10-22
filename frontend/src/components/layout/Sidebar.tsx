import { PanelLeftClose, PanelLeftOpen, ShieldCheck } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from './nav';
import { IS_MOCK } from '../../services/api';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={`sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r border-soc-800 bg-soc-900/80 backdrop-blur-sm transition-[width] duration-200 sm:flex ${
        collapsed ? 'w-[68px]' : 'w-[232px]'
      }`}
    >
      <div className="flex h-[60px] items-center gap-2.5 border-b border-soc-800 px-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md border border-accent/30 bg-accent/12 text-accent">
          <ShieldCheck className="size-4" />
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold tracking-tight text-soc-100">AI SOC</p>
            <p className="truncate text-[10px] uppercase tracking-wider text-soc-400">{IS_MOCK ? 'Sample data' : 'Live backend'}</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            title={collapsed ? item.label : item.hint}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
                collapsed ? 'justify-center' : ''
              } ${isActive ? 'bg-accent/12 text-accent shadow-[inset_2px_0_0_0_#38bdf8]' : 'text-soc-300 hover:bg-soc-800 hover:text-soc-100'}`
            }
          >
            <item.icon className="size-4 shrink-0" />
            {!collapsed && <span className="truncate font-medium">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-soc-800 p-2">
        <button
          type="button"
          onClick={onToggle}
          className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs text-soc-400 transition-colors hover:bg-soc-800 hover:text-soc-100 ${
            collapsed ? 'justify-center' : ''
          }`}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

/** Compact horizontal nav for narrow viewports (tablet portrait and below). */
export function MobileNav() {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-soc-800 bg-soc-900/90 px-2 py-1.5 backdrop-blur sm:hidden" aria-label="Primary">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs ${
              isActive ? 'bg-accent/12 text-accent' : 'text-soc-300 hover:bg-soc-800'
            }`
          }
        >
          <item.icon className="size-3.5" />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
