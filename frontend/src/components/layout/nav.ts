import {
  Bot,
  FileBarChart2,
  LayoutDashboard,
  Radio,
  ScrollText,
  Settings as SettingsIcon,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  hint: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'SOC Overview', icon: LayoutDashboard, hint: 'Fleet-wide posture and KPIs' },
  { to: '/alerts', label: 'Live Alerts', icon: Radio, hint: 'Streaming detection queue' },
  { to: '/incidents', label: 'Incidents', icon: ShieldAlert, hint: 'Investigation casework' },
  { to: '/assistant', label: 'AI Assistant', icon: Bot, hint: 'Evidence-grounded answers' },
  { to: '/logs', label: 'Log Explorer', icon: ScrollText, hint: 'Raw and normalised telemetry' },
  { to: '/reports', label: 'Reports', icon: FileBarChart2, hint: 'Case reports and exports' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, hint: 'Detection, integrations, users' },
];
