import type { AlertStatus, IncidentStatus, Severity } from '../types/api';

export const SEVERITIES: Severity[] = ['critical', 'high', 'low', 'informational'];
export const ALERT_STATUSES: AlertStatus[] = ['new', 'acknowledged', 'investigating', 'false_positive', 'resolved'];
export const INCIDENT_STATUSES: IncidentStatus[] = ['new', 'investigating', 'resolved', 'closed'];

export interface SeverityToken {
  label: string;
  short: string;
  pill: string;
  dot: string;
  text: string;
  bar: string;
  hex: string;
}

export const SEVERITY_TOKENS: Record<Severity, SeverityToken> = {
  critical: {
    label: 'Critical',
    short: 'CRIT',
    pill: 'border-red-500/40 bg-red-500/12 text-red-300',
    dot: 'bg-red-500',
    text: 'text-red-300',
    bar: 'bg-red-500',
    hex: '#ef4444',
  },
  high: {
    label: 'High',
    short: 'HIGH',
    pill: 'border-amber-500/40 bg-amber-500/12 text-amber-300',
    dot: 'bg-amber-500',
    text: 'text-amber-300',
    bar: 'bg-amber-500',
    hex: '#f59e0b',
  },
  low: {
    label: 'Low',
    short: 'LOW',
    pill: 'border-sky-500/40 bg-sky-500/12 text-sky-300',
    dot: 'bg-sky-500',
    text: 'text-sky-300',
    bar: 'bg-sky-500',
    hex: '#0ea5e9',
  },
  informational: {
    label: 'Info',
    short: 'INFO',
    pill: 'border-slate-500/40 bg-slate-500/12 text-slate-300',
    dot: 'bg-slate-400',
    text: 'text-slate-300',
    bar: 'bg-slate-400',
    hex: '#64748b',
  },
};

export const ALERT_STATUS_TOKENS: Record<AlertStatus, { label: string; className: string }> = {
  new: { label: 'New', className: 'border-red-500/40 bg-red-500/10 text-red-300' },
  acknowledged: { label: 'Acknowledged', className: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
  investigating: { label: 'Investigating', className: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  false_positive: { label: 'False positive', className: 'border-slate-500/40 bg-slate-500/10 text-slate-300' },
  resolved: { label: 'Resolved', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
};

export const INCIDENT_STATUS_TOKENS: Record<IncidentStatus, { label: string; className: string }> = {
  new: { label: 'New', className: 'border-red-500/40 bg-red-500/10 text-red-300' },
  investigating: { label: 'Investigating', className: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  resolved: { label: 'Resolved', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  closed: { label: 'Closed', className: 'border-slate-500/40 bg-slate-500/10 text-slate-300' },
};

export const INCIDENT_STATUS_FLOW: IncidentStatus[] = ['new', 'investigating', 'resolved', 'closed'];

export function severityToken(severity: Severity): SeverityToken {
  return SEVERITY_TOKENS[severity] ?? SEVERITY_TOKENS.informational;
}

export function riskTone(score: number): { hex: string; text: string; bar: string; label: string } {
  if (score >= 85) return { hex: '#ef4444', text: 'text-red-300', bar: 'bg-red-400', label: 'Severe' };
  if (score >= 65) return { hex: '#f59e0b', text: 'text-amber-300', bar: 'bg-amber-400', label: 'Elevated' };
  if (score >= 40) return { hex: '#0ea5e9', text: 'text-sky-300', bar: 'bg-sky-400', label: 'Moderate' };
  return { hex: '#64748b', text: 'text-slate-300', bar: 'bg-slate-400', label: 'Low' };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function dateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function relative(iso: string, now = Date.now()): string {
  const delta = now - Date.parse(iso);
  if (Number.isNaN(delta)) return '—';
  const abs = Math.abs(delta);
  if (abs < 45_000) return delta >= 0 ? 'just now' : 'in a moment';
  let value: number;
  let label: string;
  if (abs < 3_600_000) {
    value = Math.round(abs / 60_000);
    label = 'm';
  } else if (abs < 86_400_000) {
    value = Math.round(abs / 3_600_000);
    label = 'h';
  } else {
    value = Math.round(abs / 86_400_000);
    label = 'd';
  }
  return delta >= 0 ? `${value}${label} ago` : `in ${value}${label}`;
}

export function compactNumber(n: number): string {
  return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function csvFromRows(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unexpected error';
}
