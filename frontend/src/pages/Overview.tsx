import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileWarning,
  GitCompare,
  Radar,
  RefreshCw,
  Server,
  Siren,
  Sparkles,
} from 'lucide-react';
import { dashboardSummary, dashboardTopSources, dashboardTrends, listAlerts, severityDistribution } from '../services/api';
import { useAsync, useInterval } from '../hooks/useAsync';
import { useLive } from '../context/LiveContext';
import { ActivityFeed } from '../components/ActivityFeed';
import { MetricCard, Panel, SeverityBadge, AlertStatusPill, SkeletonRows, ErrorState, Button } from '../components/ui';
import { TrendChart } from '../components/charts/TrendChart';
import { SeverityDonut } from '../components/charts/SeverityDonut';
import { TopSourcesChart } from '../components/charts/TopSourcesChart';
import { clock, relative, stamp } from '../lib/format';
import type { Alert } from '../types/api';

const HOUR_OPTIONS = [
  { value: '12', label: '12 hours' },
  { value: '24', label: '24 hours' },
  { value: '48', label: '48 hours' },
  { value: '72', label: '3 days' },
];

const AUTO_REFRESH_MS = 15000;

export function OverviewPage() {
  const navigate = useNavigate();
  const { stream, status, refresh } = useLive();
  const [hours, setHours] = useState(24);

  const summary = useAsync(() => dashboardSummary(), []);
  const trends = useAsync(() => dashboardTrends(hours), [hours]);
  const distribution = useAsync(() => severityDistribution(), []);
  const topSources = useAsync(() => dashboardTopSources(8), []);
  const recent = useAsync(() => listAlerts({ page: 1, limit: 8 }), []);

  const reloadAll = () => {
    summary.reload();
    trends.reload();
    distribution.reload();
    topSources.reload();
    recent.reload();
  };

  useInterval(reloadAll, AUTO_REFRESH_MS);

  const mergedAlerts = useMemo<Alert[]>(() => {
    const fetched = recent.data?.items ?? [];
    const seen = new Set(fetched.map((a) => a.id));
    return [...stream.filter((a) => !seen.has(a.id)), ...fetched].slice(0, 8);
  }, [recent.data, stream]);

  const lastUpdated = summary.lastLoadedAt ?? status.lastFrameAt;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-soc-100">SOC Overview</h1>
          <p className="mt-0.5 text-sm text-soc-400">
            Fleet posture across {topSources.data?.hosts.length ?? 0} monitored assets ·{' '}
            <span className="text-soc-300">{status.mode === 'offline' ? 'feed offline' : 'live feed active'}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-soc-400">
            <Clock className="size-3.5" />
            {lastUpdated ? `updated ${relative(new Date(lastUpdated).toISOString())}` : 'loading…'}
          </span>
          <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={reloadAll} busy={summary.loading}>
            Refresh
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Total events" value={summary.data?.total_events.toLocaleString() ?? '—'} icon={<Activity className="size-4" />} loading={summary.loading} hint="Ingested telemetry" />
        <MetricCard label="Total alerts" value={summary.data?.total_alerts.toLocaleString() ?? '—'} icon={<Siren className="size-4" />} tone="live" loading={summary.loading} hint="Rule matches" />
        <MetricCard
          label="Critical + High"
          value={(summary.data ? summary.data.critical_alerts + summary.data.high_alerts : 0).toLocaleString()}
          icon={<AlertTriangle className="size-4" />}
          tone="critical"
          loading={summary.loading}
          hint={`${summary.data?.critical_alerts ?? 0} critical · ${summary.data?.high_alerts ?? 0} high`}
        />
        <MetricCard label="Open incidents" value={summary.data?.open_incidents ?? '—'} icon={<FileWarning className="size-4" />} tone="high" loading={summary.loading} hint="New + investigating" />
        <MetricCard label="Investigating" value={summary.data?.investigating_incidents ?? '—'} icon={<GitCompare className="size-4" />} loading={summary.loading} hint="Assigned casework" />
        <MetricCard label="Resolved" value={summary.data?.resolved_incidents ?? '—'} icon={<CheckCircle2 className="size-4" />} tone="good" loading={summary.loading} hint="Resolved + closed" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Events & alerts over time"
          subtitle={`Per-hour aggregation, last ${hours}h`}
          icon={<Radar className="size-4" />}
          actions={
            <div className="flex items-center gap-1">
              {HOUR_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setHours(Number(o.value))}
                  className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                    hours === Number(o.value) ? 'border-accent/50 bg-accent/15 text-accent' : 'border-soc-700 bg-soc-800/60 text-soc-300 hover:bg-soc-750'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          }
        >
          {trends.error ? (
            <ErrorState message={trends.error} onRetry={() => trends.reload()} />
          ) : trends.loading && !trends.data ? (
            <SkeletonRows rows={5} />
          ) : (
            <TrendChart points={trends.data ?? []} height={264} />
          )}
        </Panel>

        <Panel title="Severity distribution" subtitle="Alerts by severity" icon={<Sparkles className="size-4" />}>
          {distribution.loading && !distribution.data ? (
            <SkeletonRows rows={4} />
          ) : (
            <SeverityDonut data={distribution.data ?? []} />
          )}
          <div className="mt-4 grid grid-cols-2 gap-2 text-center">
            {(distribution.data ?? []).map((d) => (
              <div key={d.severity} className="rounded-md border border-soc-800 bg-soc-950/50 px-2 py-2">
                <p className="text-lg font-semibold tabular-nums text-soc-100">{d.count}</p>
                <p className="text-[10px] uppercase tracking-wider text-soc-400">{d.severity}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title="Top external sources"
          subtitle="Events per source IP · colour = max severity"
          icon={<Activity className="size-4" />}
          className="xl:col-span-2"
        >
          {topSources.loading && !topSources.data ? <SkeletonRows rows={5} /> : <TopSourcesChart sources={topSources.data?.sources ?? []} height={252} />}
        </Panel>

        <Panel title="Most affected hosts" subtitle="Event volume per asset" icon={<Server className="size-4" />}>
          {topSources.loading && !topSources.data ? (
            <SkeletonRows rows={6} />
          ) : (
            <ul className="space-y-1">
              {(topSources.data?.hosts ?? []).map((h) => {
                const max = Math.max(1, ...[...(topSources.data?.hosts ?? [])].map((x) => x.events));
                return (
                  <li key={h.hostname}>
                    <button
                      type="button"
                      onClick={() => navigate(`/logs?host=${encodeURIComponent(h.hostname)}`)}
                      className="group w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-soc-800/70"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-mono text-[12.5px] text-soc-100 group-hover:text-accent">{h.hostname}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-soc-400">
                          {h.events} ev · {h.alerts} al
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-soc-800">
                        <div className="h-full rounded-full bg-accent/70 transition-all" style={{ width: `${Math.round((h.events / max) * 100)}%` }} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Recent alerts"
          subtitle="Newest detections — click a row to investigate"
          icon={<Siren className="size-4" />}
          flush
          actions={
            <Button size="sm" onClick={() => navigate('/alerts')}>
              Open alert queue
            </Button>
          }
          bodyClassName=""
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Time</th>
                  <th className="th">Sev</th>
                  <th className="th">Rule</th>
                  <th className="th">Source</th>
                  <th className="th">Host</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody>
                {mergedAlerts.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => navigate(a.incident_id ? `/incidents/${a.incident_id}` : `/incidents?alert=${a.id}`)}
                    className="row-hover"
                  >
                    <td className="td whitespace-nowrap font-mono text-[12px] text-soc-300">{clock(a.timestamp)}</td>
                    <td className="td">
                      <SeverityBadge severity={a.severity} showLabel={false} />
                    </td>
                    <td className="td max-w-[24rem] truncate">{a.rule_name}</td>
                    <td className="td mono text-soc-300">{a.src_ip ?? '—'}</td>
                    <td className="td mono text-soc-300">{a.hostname ?? '—'}</td>
                    <td className="td">
                      <AlertStatusPill status={a.investigation_status} />
                    </td>
                  </tr>
                ))}
                {!mergedAlerts.length && (
                  <tr>
                    <td colSpan={6} className="td">
                      <SkeletonRows rows={3} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Incident activity" subtitle="Latest movement across open cases" icon={<GitCompare className="size-4" />}>
          <ActivityFeed onOpen={(id) => navigate(`/incidents/${id}`)} />
        </Panel>
      </div>

      <p className="text-[11px] text-soc-500">
        Auto-refresh every {AUTO_REFRESH_MS / 1000}s · live frames {status.frames} · last frame{' '}
        {status.lastFrameAt ? stamp(new Date(status.lastFrameAt).toISOString()) : 'n/a'}
        <button type="button" className="ml-2 text-accent hover:underline" onClick={refresh}>
          sync now
        </button>
      </p>
    </div>
  );
}
