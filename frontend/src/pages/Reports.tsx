import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  ClipboardList,
  Download,
  FileBarChart2,
  FileJson,
  FileSpreadsheet,
  Siren,
  Table2,
  Users,
} from 'lucide-react';
import type { Incident, ReportSection, ReportSectionKey, Severity } from '../types/api';
import {
  dashboardSummary,
  dashboardTopSources,
  incidentReport,
  listAlerts,
  listIncidents,
  severityDistribution,
} from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../context/AuthContext';
import { useLive } from '../context/LiveContext';
import { SeverityDonut } from '../components/charts/SeverityDonut';
import { TopSourcesChart } from '../components/charts/TopSourcesChart';
import {
  Button,
  DemoBadge,
  EmptyState,
  ErrorState,
  InlineNote,
  MetricCard,
  Panel,
  Select,
  SeverityBadge,
  SkeletonRows,
  Spinner,
} from '../components/ui';
import { csvFromRows, download, errorText, relative, stamp } from '../lib/format';

const SECTION_ORDER: ReportSectionKey[] = [
  'overview',
  'timeline',
  'evidence',
  'severity_risk',
  'rules_triggered',
  'ai_summary',
  'remediation',
  'analyst_notes',
];

const SEVERITY_RANK: Record<Severity, number> = { informational: 0, low: 1, high: 2, critical: 3 };

function reportCsv(sections: ReportSection[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const section of sections) {
    if (section.rows?.length) {
      for (const row of section.rows) rows.push({ section: section.title, ...row });
    } else {
      for (const line of section.content.split('\n')) {
        if (line.trim()) rows.push({ section: section.title, detail: line });
      }
    }
  }
  return rows;
}

function sectionRows(sections: ReportSection[]): Record<string, string | number>[] {
  return sections.flatMap((s) => (s.rows ? s.rows.map((r) => ({ section: s.title, ...r })) : []));
}

export function ReportsPage() {
  const { user } = useAuth();
  const { nonce } = useLive();
  const [params, setParams] = useSearchParams();
  const author = user?.full_name ?? 'unassigned analyst';
  const [excluded, setExcluded] = useState<ReportSectionKey[]>([]);
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const incidents = useAsync(() => listIncidents({ page: 1, limit: 100 }), [nonce], { silent: true });
  const requested = Number(params.get('incident'));
  const selected: Incident | undefined = useMemo(() => {
    const items = incidents.data?.items ?? [];
    return items.find((i) => i.id === requested) ?? items[0];
  }, [incidents.data, requested]);

  const report = useAsync(
    () => (selected ? incidentReport(selected.id, author) : Promise.reject(new Error('No incident available to report on'))),
    [selected?.id, author],
    { silent: true },
  );
  const summary = useAsync(() => dashboardSummary(), [nonce], { silent: true });
  const spread = useAsync(() => severityDistribution(), [nonce], { silent: true });
  const sources = useAsync(() => dashboardTopSources(8), [nonce], { silent: true });
  const alertFeed = useAsync(() => listAlerts({ page: 1, limit: 200 }), [nonce], { silent: true });

  const sections = (report.data?.sections ?? []).filter((s) => !excluded.includes(s.key));

  const ruleLeaderboard = useMemo(() => {
    const map = new Map<string, { rule: string; severity: Severity; hits: number }>();
    for (const a of alertFeed.data?.items ?? []) {
      const cur = map.get(a.rule_name) ?? { rule: a.rule_name, severity: a.severity, hits: 0 };
      cur.hits += 1;
      if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[cur.severity]) cur.severity = a.severity;
      map.set(a.rule_name, cur);
    }
    return [...map.values()].sort((a, b) => b.hits - a.hits).slice(0, 10);
  }, [alertFeed.data]);

  const workload = useMemo(() => {
    const items = incidents.data?.items ?? [];
    const map = new Map<string, { assignee: string; cases: number; open: number; resolved: number; risk: number }>();
    for (const inc of items) {
      const key = inc.assignee ?? 'unassigned';
      const cur = map.get(key) ?? { assignee: key, cases: 0, open: 0, resolved: 0, risk: 0 };
      cur.cases += 1;
      cur.risk += inc.risk_score;
      if (inc.status === 'new' || inc.status === 'investigating') cur.open += 1;
      else cur.resolved += 1;
      map.set(key, cur);
    }
    return [...map.values()]
      .map((r) => ({ ...r, avg_risk: Math.round(r.risk / Math.max(1, r.cases)) }))
      .sort((a, b) => b.open - a.open || b.avg_risk - a.avg_risk);
  }, [incidents.data]);

  const toggleSection = (key: ReportSectionKey) =>
    setExcluded((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const exportJson = () => {
    if (!report.data || busy) return;
    setBusy('json');
    try {
      const payload = { ...report.data, sections, exported_at: new Date().toISOString(), exported_by: author };
      download(`${report.data.reference.toLowerCase()}-report.json`, JSON.stringify(payload, null, 2), 'application/json');
      setFlash(`JSON export written — ${sections.length} of ${report.data.sections.length} sections.`);
    } catch (error) {
      setFlash(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = () => {
    if (!report.data || busy) return;
    setBusy('csv');
    try {
      const rows = reportCsv(sections);
      download(`${report.data.reference.toLowerCase()}-report.csv`, csvFromRows(rows), 'text/csv;charset=utf-8');
      setFlash(`CSV export written — ${rows.length} rows.`);
    } catch (error) {
      setFlash(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const exportTable = (name: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) {
      setFlash('Nothing to export for this table yet.');
      return;
    }
    download(`${name}.csv`, csvFromRows(rows), 'text/csv;charset=utf-8');
    setFlash(`${name}.csv written — ${rows.length} rows.`);
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-soc-100">
            <FileBarChart2 className="size-5 text-accent" />
            Reports &amp; Analytics
          </h1>
          <p className="mt-0.5 text-sm text-soc-400">
            Build a case report from live incident data, then export it as JSON or CSV. Analytics below are recomputed from the same records.
          </p>
        </div>
        <DemoBadge />
      </header>

      {selected && (
        <Panel
          title="Report builder"
          subtitle={`${selected.reference} · ${selected.title}`}
          icon={<ClipboardList className="size-4" />}
          actions={
            <>
              <Button size="sm" icon={<FileJson className="size-3.5" />} onClick={exportJson} busy={busy === 'json'} disabled={!report.data}>
                Export JSON
              </Button>
              <Button size="sm" variant="primary" icon={<FileSpreadsheet className="size-3.5" />} onClick={exportCsv} busy={busy === 'csv'} disabled={!report.data}>
                Export CSV
              </Button>
            </>
          }
          bodyClassName="p-4 space-y-4"
        >
          <div className="grid gap-3 md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
            <Select
              label="Incident"
              value={selected.id}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                next.set('incident', e.target.value);
                setParams(next, { replace: true });
              }}
              options={(incidents.data?.items ?? []).map((i) => ({ value: String(i.id), label: `${i.reference} — ${i.title}` }))}
            />
            <div className="min-w-0">
              <span className="label">Sections included</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {SECTION_ORDER.map((key) => {
                  const on = !excluded.includes(key);
                  const title = report.data?.sections.find((s) => s.key === key)?.title ?? key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleSection(key)}
                      className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                        on ? 'border-accent/40 bg-accent/12 text-accent' : 'border-soc-700 bg-soc-800/70 text-soc-400 line-through'
                      }`}
                    >
                      {title}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-soc-400">
                {sections.length} of {(report.data?.sections ?? []).length} sections in scope · generated by {author}
              </p>
            </div>
          </div>
          {flash && <InlineNote>{flash}</InlineNote>}
        </Panel>
      )}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-soc-400">
            <Table2 className="size-3.5" />
            Report preview
          </h2>
          {selected && (
            <Link to={`/incidents/${selected.id}`} className="flex items-center gap-1 text-xs text-accent hover:underline">
              Open investigation <ArrowUpRight className="size-3.5" />
            </Link>
          )}
        </div>

        {report.error ? (
          <Panel>
            <ErrorState message={report.error} onRetry={report.reload} />
          </Panel>
        ) : report.loading && !report.data ? (
          <Panel>
            <Spinner label="Assembling report sections" />
          </Panel>
        ) : (
          sections.map((section) => <SectionBlock key={section.key} section={section} />)
        )}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-soc-400">
          <BarChart3 className="size-3.5" />
          Platform analytics
        </h2>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Events ingested" value={summary.data?.total_events.toLocaleString() ?? '—'} icon={<Table2 className="size-4" />} loading={summary.loading && !summary.data} hint="Retained demo telemetry" />
          <MetricCard label="Alerts raised" value={summary.data?.total_alerts.toLocaleString() ?? '—'} icon={<Siren className="size-4" />} tone="live" loading={summary.loading && !summary.data} hint="Detection queue volume" />
          <MetricCard label="Critical alerts" value={summary.data?.critical_alerts ?? '—'} icon={<AlertTriangle className="size-4" />} tone="critical" loading={summary.loading && !summary.data} hint="Level 12+ rules" />
          <MetricCard label="Cases closed" value={summary.data?.resolved_incidents ?? '—'} icon={<Users className="size-4" />} tone="good" loading={summary.loading && !summary.data} hint="Resolved + closed" />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Alert severity mix" subtitle="Whole demo corpus, not filtered" icon={<FileBarChart2 className="size-4" />} bodyClassName="p-4">
            {spread.error ? (
              <ErrorState message={spread.error} onRetry={spread.reload} />
            ) : spread.data ? (
              <SeverityDonut data={spread.data} />
            ) : (
              <SkeletonRows rows={4} />
            )}
          </Panel>
          <Panel title="Most active external sources" subtitle="Events + weighted alerts" icon={<BarChart3 className="size-4" />} bodyClassName="p-4">
            {sources.error ? (
              <ErrorState message={sources.error} onRetry={sources.reload} />
            ) : sources.data ? (
              <TopSourcesChart sources={sources.data.sources} height={240} />
            ) : (
              <SkeletonRows rows={5} />
            )}
          </Panel>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Panel
            title="Detection rule leaderboard"
            subtitle="Top rules across the last 200 alerts"
            actions={
              <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => exportTable('rule-leaderboard', ruleLeaderboard)}>
                CSV
              </Button>
            }
            flush
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="th">Rule</th>
                    <th className="th">Severity</th>
                    <th className="th text-right">Hits</th>
                  </tr>
                </thead>
                <tbody>
                  {ruleLeaderboard.map((r) => (
                    <tr key={r.rule} className="row-hover">
                      <td className="td">{r.rule}</td>
                      <td className="td">
                        <SeverityBadge severity={r.severity} showLabel={false} />
                      </td>
                      <td className="td text-right tabular-nums text-soc-100">{r.hits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!ruleLeaderboard.length && <EmptyState title="No alerts yet" message="The rule leaderboard fills in as detections arrive." />}
            </div>
          </Panel>

          <Panel
            title="Analyst workload"
            subtitle="Cases per assignee, with mean risk score"
            actions={
              <Button
                size="sm"
                icon={<Download className="size-3.5" />}
                onClick={() =>
                  exportTable(
                    'analyst-workload',
                    workload.map((w) => ({ assignee: w.assignee, cases: w.cases, open: w.open, closed: w.resolved, avg_risk: w.avg_risk })),
                  )
                }
              >
                CSV
              </Button>
            }
            flush
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="th">Assignee</th>
                    <th className="th text-right">Cases</th>
                    <th className="th text-right">Open</th>
                    <th className="th text-right">Closed</th>
                    <th className="th text-right">Avg risk</th>
                  </tr>
                </thead>
                <tbody>
                  {workload.map((w) => (
                    <tr key={w.assignee} className="row-hover">
                      <td className="td">{w.assignee}</td>
                      <td className="td text-right tabular-nums">{w.cases}</td>
                      <td className="td text-right tabular-nums text-amber-300">{w.open}</td>
                      <td className="td text-right tabular-nums text-emerald-300">{w.resolved}</td>
                      <td className="td text-right tabular-nums text-soc-100">{w.avg_risk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!workload.length && <EmptyState title="No incidents yet" message="Escalate an alert to open the first case." />}
            </div>
          </Panel>
        </div>

        <Panel title="Case index" subtitle="Every incident available for reporting" flush>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="th">Reference</th>
                  <th className="th">Title</th>
                  <th className="th">Severity</th>
                  <th className="th">Status</th>
                  <th className="th">Assignee</th>
                  <th className="th text-right">Risk</th>
                  <th className="th">Opened</th>
                  <th className="th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(incidents.data?.items ?? []).map((inc) => (
                  <tr key={inc.id} className={`row-hover ${selected?.id === inc.id ? 'bg-accent/8' : ''}`}>
                    <td className="td font-mono text-xs text-soc-300">{inc.reference}</td>
                    <td className="td max-w-[22rem] truncate">{inc.title}</td>
                    <td className="td">
                      <SeverityBadge severity={inc.severity} showLabel={false} />
                    </td>
                    <td className="td capitalize text-soc-300">{inc.status}</td>
                    <td className="td text-soc-300">{inc.assignee ?? 'unassigned'}</td>
                    <td className="td text-right tabular-nums">{inc.risk_score}</td>
                    <td className="td whitespace-nowrap text-xs text-soc-400" title={inc.created_at}>
                      {stamp(inc.created_at)} · {relative(inc.updated_at)}
                    </td>
                    <td className="td whitespace-nowrap">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            const next = new URLSearchParams(params);
                            next.set('incident', String(inc.id));
                            setParams(next, { replace: true });
                            setExcluded([]);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                        >
                          Build
                        </Button>
                        <Link
                          to={`/incidents/${inc.id}`}
                          className="btn-ghost btn-sm inline-flex items-center gap-1.5"
                          aria-label={`Open ${inc.reference}`}
                        >
                          Open
                        </Link>
                        <Button
                          size="sm"
                          icon={<Download className="size-3.5" />}
                          onClick={async () => {
                            const full = await incidentReport(inc.id, author);
                            download(`${full.reference.toLowerCase()}-report.csv`, csvFromRows(sectionRows(full.sections)), 'text/csv;charset=utf-8');
                            setFlash(`${full.reference} exported as CSV.`);
                          }}
                        >
                          CSV
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {incidents.error ? (
              <ErrorState message={incidents.error} onRetry={incidents.reload} />
            ) : incidents.loading && !incidents.data ? (
              <SkeletonRows rows={5} />
            ) : !incidents.data?.items.length ? (
              <EmptyState title="No incidents" message="Open the alerts queue and escalate a detection to create a case." />
            ) : null}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function SectionBlock({ section }: { section: ReportSection }) {
  const [expanded, setExpanded] = useState(true);
  const preview = section.rows?.slice(0, 12) ?? [];
  return (
    <article className="panel">
      <header className="panel-head">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-accent">
            <Table2 className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="panel-title truncate">{section.title}</h3>
            <p className="mt-0.5 text-[11px] uppercase tracking-wider text-soc-500">{section.key}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {section.rows && <span className="chip">{section.rows.length} rows</span>}
          <Button size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Collapse' : 'Expand'}
          </Button>
        </div>
      </header>
      {expanded && (
        <div className="space-y-3 p-4">
          <pre className="whitespace-pre-wrap break-words rounded-md border border-soc-800 bg-soc-950/60 p-3 text-[12.5px] leading-relaxed text-soc-200">
            {section.content}
          </pre>
          {preview.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-soc-800">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {Object.keys(preview[0]).map((h) => (
                      <th key={h} className="th sticky top-0 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="row-hover">
                      {Object.keys(preview[0]).map((h) => (
                        <td key={h} className="td whitespace-nowrap align-top">
                          {String(row[h] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {section.rows && section.rows.length > preview.length && (
                <p className="border-t border-soc-800 px-3 py-2 text-[11px] text-soc-400">
                  {section.rows.length - preview.length} more rows are included in the JSON and CSV exports.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
