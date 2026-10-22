import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { AlertStatus, EventSource, IncidentStatus, Severity } from '../../types/api';
import { ALERT_STATUS_TOKENS, INCIDENT_STATUS_TOKENS, severityToken } from '../../lib/format';

export function SeverityBadge({ severity, showLabel = true }: { severity: Severity; showLabel?: boolean }) {
  const t = severityToken(severity);
  return (
    <span className={`pill ${t.pill}`}>
      <span className={`size-1.5 rounded-full ${t.dot}`} />
      {showLabel ? t.label : t.short}
    </span>
  );
}

export function AlertStatusPill({ status }: { status: AlertStatus }) {
  const t = ALERT_STATUS_TOKENS[status];
  return <span className={`pill ${t.className}`}>{t.label}</span>;
}

export function IncidentStatusPill({ status }: { status: IncidentStatus }) {
  const t = INCIDENT_STATUS_TOKENS[status];
  return <span className={`pill ${t.className}`}>{t.label}</span>;
}

export function DemoBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`pill border-accent/35 bg-accent/10 text-accent ${className}`} title="Synthetic record produced by the demo generator">
      <ShieldAlert className="size-3" />
      DEMO
    </span>
  );
}

export function SourceChip({ source }: { source: EventSource }) {
  const labels: Record<EventSource, string> = {
    wazuh: 'Wazuh',
    linux_auth: 'linux_auth',
    sysmon: 'Sysmon',
    demo_generator: 'Demo gen',
  };
  const tones: Record<EventSource, string> = {
    wazuh: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
    linux_auth: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    sysmon: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    demo_generator: 'border-accent/30 bg-accent/10 text-accent',
  };
  return <span className={`chip ${tones[source]}`}>{labels[source]}</span>;
}

export function CountPill({ value, tone = 'default' }: { value: number; tone?: 'default' | 'critical' | 'high' | 'good' }) {
  const tones = {
    default: 'border-soc-600 bg-soc-800 text-soc-200',
    critical: 'border-red-500/40 bg-red-500/12 text-red-300',
    high: 'border-amber-500/40 bg-amber-500/12 text-amber-300',
    good: 'border-emerald-500/40 bg-emerald-500/12 text-emerald-300',
  } as const;
  return <span className={`pill ${tones[tone]}`}>{value.toLocaleString()}</span>;
}

export function SectionLabel({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-soc-400">{children}</h3>
      {actions}
    </div>
  );
}
