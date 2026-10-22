import type { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
}

export function Panel({ title, subtitle, icon, actions, children, className = '', bodyClassName = '', flush = false }: PanelProps) {
  return (
    <section className={`panel flex flex-col ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && <span className="text-accent">{icon}</span>}
            <div className="min-w-0">
              {title && <h2 className="panel-title truncate">{title}</h2>}
              {subtitle && <p className="mt-0.5 truncate text-xs text-soc-400">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'min-h-0 flex-1' : `min-h-0 flex-1 ${bodyClassName || 'p-4'}`}>{children}</div>
    </section>
  );
}

interface MetricCardProps {
  label: string;
  value: number | string;
  hint?: string;
  icon: ReactNode;
  tone?: 'default' | 'critical' | 'high' | 'good' | 'live';
  loading?: boolean;
}

const TONES: Record<NonNullable<MetricCardProps['tone']>, { ring: string; icon: string; value: string }> = {
  default: { ring: 'border-soc-700/60', icon: 'bg-soc-800 text-accent', value: 'text-soc-100' },
  critical: { ring: 'border-red-500/30', icon: 'bg-red-500/12 text-red-300', value: 'text-red-300' },
  high: { ring: 'border-amber-500/30', icon: 'bg-amber-500/12 text-amber-300', value: 'text-amber-300' },
  good: { ring: 'border-emerald-500/30', icon: 'bg-emerald-500/12 text-emerald-300', value: 'text-emerald-300' },
  live: { ring: 'border-accent/30', icon: 'bg-accent/12 text-accent', value: 'text-accent' },
};

export function MetricCard({ label, value, hint, icon, tone = 'default', loading = false }: MetricCardProps) {
  const t = TONES[tone];
  return (
    <div className={`panel ${t.ring} p-4 transition-transform hover:-translate-y-px`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-soc-400">{label}</p>
          <p className={`mt-2 text-2xl font-semibold tabular-nums ${t.value}`}>
            {loading ? <span className="inline-block h-7 w-14 animate-pulse rounded bg-soc-800" /> : value}
          </p>
          {hint && <p className="mt-1 truncate text-[11px] text-soc-400">{hint}</p>}
        </div>
        <span className={`grid size-9 shrink-0 place-items-center rounded-md ${t.icon}`}>{icon}</span>
      </div>
    </div>
  );
}

export function KeyValue({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-soc-400">{label}</dt>
      <dd className="mt-1 text-sm text-soc-100">{children}</dd>
    </div>
  );
}
