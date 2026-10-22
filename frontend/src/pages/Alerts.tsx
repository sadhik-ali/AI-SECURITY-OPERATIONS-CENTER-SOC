import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, Filter, ShieldPlus, Siren, X } from 'lucide-react';
import type { Alert, AlertStatus, Severity } from '../types/api';
import { alertEvents, aiAnalyzeAlert, createIncident, listAlerts, patchAlert, sampleHostNames } from '../services/api';
import { useAsync, useDebounced } from '../hooks/useAsync';
import { useLive } from '../context/LiveContext';
import { useAuth } from '../context/AuthContext';
import {
  AlertStatusPill,
  Button,
  DemoBadge,
  Drawer,
  EmptyState,
  ErrorState,
  JsonBlock,
  Pagination,
  Panel,
  SearchField,
  Select,
  SeverityBadge,
  SkeletonRows,
  SourceChip,
  TextField,
} from '../components/ui';
import { ALERT_STATUSES, SEVERITIES, SEVERITY_TOKENS, errorText, relative, stamp } from '../lib/format';

const STATUS_LABEL: Record<AlertStatus, string> = {
  new: 'New',
  acknowledged: 'Acknowledged',
  investigating: 'Investigating',
  false_positive: 'False positive',
  resolved: 'Resolved',
};

export function AlertsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { stream, flash } = useLive();
  const { user } = useAuth();
  const urlQ = params.get('q') ?? '';
  const [draftSearch, setDraftSearch] = useState(urlQ);
  const debounced = useDebounced(draftSearch, 260);
  const [selected, setSelected] = useState<Alert | null>(null);

  const set = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params);
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
      if (key !== 'page') next.delete('page');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => setDraftSearch(urlQ), [urlQ]);
  useEffect(() => {
    if (debounced !== urlQ) set('q', debounced.trim());
  }, [debounced, urlQ, set]);

  const query = useMemo(
    () => ({
      page: Number(params.get('page') ?? 1),
      limit: 20,
      q: params.get('q') ?? undefined,
      severity: (params.get('severity') ?? 'all') as Severity | 'all',
      status: (params.get('status') ?? 'all') as AlertStatus | 'all',
      src_ip: params.get('src_ip') ?? undefined,
      host: params.get('host') ?? undefined,
      start: params.get('start') ?? undefined,
      end: params.get('end') ?? undefined,
    }),
    [params],
  );

  const state = useAsync(() => listAlerts(query), [JSON.stringify(query)], { silent: true });

  const rows = useMemo(() => {
    const fetched = state.data?.items ?? [];
    if (query.page !== 1) return fetched;
    const seen = new Set(fetched.map((a) => a.id));
    const matchesLive = stream.filter(
      (a) =>
        !seen.has(a.id) &&
        (!query.severity || query.severity === 'all' || a.severity === query.severity) &&
        (!query.status || query.status === 'all' || a.investigation_status === query.status) &&
        (!query.host || a.hostname === query.host) &&
        (!query.src_ip || a.src_ip === query.src_ip) &&
        (!query.q || `${a.rule_name} ${a.detection_reason} ${a.hostname} ${a.src_ip}`.toLowerCase().includes(query.q.toLowerCase())),
    );
    return [...matchesLive, ...fetched];
  }, [state.data, stream, query]);

  const activeFilters = ['severity', 'status', 'src_ip', 'host', 'start', 'end', 'q'].filter((k) => params.get(k));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-soc-100">
            <Siren className="size-5 text-accent" />
            Live Security Alerts
          </h1>
          <p className="mt-0.5 text-sm text-soc-400">
            {state.data?.total.toLocaleString() ?? '—'} alerts match this view ·{' '}
            <span className="text-sky-300">{stream.length}</span> received from the live feed this session
          </p>
        </div>
        <Button size="sm" onClick={() => navigate('/incidents')} icon={<ShieldPlus className="size-3.5" />}>
          Incident queue
        </Button>
      </header>

      <Panel bodyClassName="p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <SearchField
            className="xl:col-span-2"
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
            onClear={() => {
              setDraftSearch('');
              set('q', '');
            }}
            placeholder="Rule, reason, host, account, IP…"
          />
          <Select
            label="Severity"
            value={params.get('severity') ?? 'all'}
            onChange={(e) => set('severity', e.target.value)}
            options={[{ value: 'all', label: 'All severities' }, ...SEVERITIES.map((s) => ({ value: s, label: SEVERITY_TOKENS[s].label }))]}
          />
          <Select
            label="Status"
            value={params.get('status') ?? 'all'}
            onChange={(e) => set('status', e.target.value)}
            options={[{ value: 'all', label: 'All statuses' }, ...ALERT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
          />
          <Select
            label="Host"
            value={params.get('host') ?? 'all'}
            onChange={(e) => set('host', e.target.value === 'all' ? '' : e.target.value)}
            options={[{ value: 'all', label: 'All hosts' }, ...sampleHostNames().map((h) => ({ value: h, label: h }))]}
          />
          <TextField label="Source IP" placeholder="203.0.113.44" value={params.get('src_ip') ?? ''} onChange={(e) => set('src_ip', e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <TextField label="From" type="date" value={params.get('start') ?? ''} onChange={(e) => set('start', e.target.value)} />
            <TextField label="To" type="date" value={params.get('end') ?? ''} onChange={(e) => set('end', e.target.value)} />
          </div>
        </div>

        {activeFilters.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-soc-800 pt-3">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-soc-400">
              <Filter className="size-3" /> Active
            </span>
            {activeFilters.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => set(key, '')}
                className="chip border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"
              >
                {key}: {params.get(key)}
                <X className="size-3" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setParams(new URLSearchParams(), { replace: true });
                setDraftSearch('');
              }}
              className="ml-auto text-[11px] text-soc-400 underline-offset-2 hover:text-soc-100 hover:underline"
            >
              Clear all
            </button>
          </div>
        )}
      </Panel>

      <Panel
        title="Detection queue"
        subtitle={`Sorted newest first · page ${state.data?.page ?? 1} of ${state.data?.pages ?? 1}`}
        icon={<ArrowDownUp className="size-4" />}
        actions={<DemoBadge />}
        flush
      >
        {state.error ? (
          <ErrorState message={state.error} onRetry={() => state.reload()} />
        ) : state.loading && !state.data ? (
          <div className="p-4">
            <SkeletonRows rows={8} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No alerts match these filters" message="Widen the time range or clear a filter. New detections still stream in from the live feed." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px]">
              <thead className="sticky top-0 z-10 bg-soc-900">
                <tr>
                  <th className="th">Timestamp</th>
                  <th className="th">Sev</th>
                  <th className="th">Rule name</th>
                  <th className="th">Source IP</th>
                  <th className="th">Destination</th>
                  <th className="th">Account</th>
                  <th className="th">Host</th>
                  <th className="th">Category</th>
                  <th className="th">Detection reason</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => (a.incident_id ? navigate(`/incidents/${a.incident_id}`) : setSelected(a))}
                    className={`row-hover ${flash.has(a.id) ? 'animate-row-flash' : ''}`}
                  >
                    <td className="td whitespace-nowrap">
                      <span className="mono text-soc-200">{stamp(a.timestamp)}</span>
                      <span className="ml-2 text-[11px] text-soc-500">{relative(a.timestamp)}</span>
                    </td>
                    <td className="td">
                      <SeverityBadge severity={a.severity} showLabel={false} />
                    </td>
                    <td className="td max-w-[16rem] truncate font-medium text-soc-100">{a.rule_name}</td>
                    <td className="td mono">{a.src_ip ?? '—'}</td>
                    <td className="td mono text-soc-300">{a.dst_ip ?? '—'}</td>
                    <td className="td mono text-soc-300">{a.username ?? '—'}</td>
                    <td className="td mono text-soc-300">{a.hostname ?? '—'}</td>
                    <td className="td whitespace-nowrap text-soc-300">{a.event_category}</td>
                    <td className="td max-w-[22rem]">
                      <span className="line-clamp-2 text-[12.5px] text-soc-400">{a.detection_reason}</span>
                    </td>
                    <td className="td whitespace-nowrap">
                      <AlertStatusPill status={a.investigation_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {state.data && (
          <Pagination
            page={state.data.page}
            pages={state.data.pages}
            total={state.data.total}
            limit={query.limit}
            onPage={(p) => set('page', String(p))}
          />
        )}
      </Panel>

      {selected && (
        <AlertDrawer
          alert={selected}
          analyst={user?.full_name ?? 'analyst'}
          onClose={() => setSelected(null)}
          onOpenIncident={(id) => {
            setSelected(null);
            navigate(`/incidents/${id}`);
          }}
        />
      )}
    </div>
  );
}

function AlertDrawer({ alert, analyst, onClose, onOpenIncident }: { alert: Alert; analyst: string; onClose: () => void; onOpenIncident: (id: number) => void }) {
  const events = useAsync(() => alertEvents(alert.id), [alert.id]);
  const analysis = useAsync(() => aiAnalyzeAlert(alert.id), [alert.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const changeStatus = async (status: AlertStatus) => {
    setBusy(status);
    try {
      await patchAlert(alert.id, status);
      setNote(`Status set to ${STATUS_LABEL[status]}`);
      onClose();
    } catch (error) {
      setNote(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const escalate = async () => {
    setBusy('escalate');
    try {
      const incident = await createIncident(
        {
          title: `${alert.rule_name} — ${alert.hostname ?? 'unknown host'}`,
          description: alert.detection_reason,
          severity: alert.severity,
          alert_ids: [alert.id],
        },
        analyst,
      );
      onOpenIncident(incident.id);
    } catch (error) {
      setNote(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer
      open
      title={`Alert #${alert.id} · ${alert.rule_name}`}
      subtitle={`${stamp(alert.timestamp)} · ${alert.event_category}`}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-soc-400">Set status</span>
          {ALERT_STATUSES.map((s) => (
            <Button key={s} size="sm" busy={busy === s} disabled={s === alert.investigation_status} onClick={() => changeStatus(s)}>
              {STATUS_LABEL[s]}
            </Button>
          ))}
          <Button size="sm" variant="primary" className="ml-auto" icon={<ShieldPlus className="size-3.5" />} busy={busy === 'escalate'} onClick={escalate}>
            Escalate to incident
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {note && <div className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">{note}</div>}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(
            [
              { label: 'Severity', value: <SeverityBadge severity={alert.severity} /> },
              { label: 'Status', value: <AlertStatusPill status={alert.investigation_status} /> },
              { label: 'Feed', value: <SourceChip source={alert.source} /> },
              { label: 'Source IP', value: alert.src_ip ?? '—' },
              { label: 'Destination', value: alert.dst_ip ?? '—' },
              { label: 'Account', value: alert.username ?? '—' },
              { label: 'Hostname', value: alert.hostname ?? '—' },
              { label: 'Correlated events', value: String(alert.event_ids.length) },
              { label: 'Incident', value: alert.incident_id ? `#${alert.incident_id}` : 'unassigned' },
            ] as { label: string; value: ReactNode }[]
          ).map((fact) => (
            <div key={fact.label} className="rounded-md border border-soc-800 bg-soc-950/50 px-3 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-soc-400">{fact.label}</dt>
              <dd className="mt-1 text-sm text-soc-100">{fact.value}</dd>
            </div>
          ))}
        </dl>

        <section>
          <h3 className="panel-title mb-2">Detection reason</h3>
          <p className="rounded-md border border-soc-800 bg-soc-950/50 p-3 text-sm text-soc-200">{alert.detection_reason}</p>
        </section>

        <section>
          <h3 className="panel-title mb-2">AI triage (deterministic, evidence-grounded)</h3>
          {analysis.loading && !analysis.data ? (
            <SkeletonRows rows={3} />
          ) : analysis.data ? (
            <div className="space-y-3 rounded-md border border-soc-800 bg-soc-950/50 p-3">
              <p className="text-sm text-soc-200">{analysis.data.summary}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <BulletBlock title="Evidence" tone="text-emerald-300" items={analysis.data.evidence} />
                <BulletBlock title="Hypotheses" tone="text-amber-300" items={analysis.data.possible_explanations} />
                <BulletBlock title="Next steps" tone="text-sky-300" items={analysis.data.investigation_steps} />
                <BulletBlock title="Defensive actions" tone="text-red-300" items={analysis.data.recommended_actions} />
              </div>
              <p className="text-[11px] text-soc-500">
                Confidence {Math.round(analysis.data.confidence * 100)}% · {analysis.data.limitations[0]}
              </p>
            </div>
          ) : (
            <ErrorState message={analysis.error ?? 'No analysis available'} onRetry={() => analysis.reload()} />
          )}
        </section>

        <section>
          <h3 className="panel-title mb-2">Correlated events</h3>
          {events.loading && !events.data ? (
            <SkeletonRows rows={3} />
          ) : (
            <div className="space-y-2">
              {(events.data ?? []).slice(0, 12).map((e) => (
                <details key={e.id} className="rounded-md border border-soc-800 bg-soc-950/50">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-soc-300 hover:text-soc-100">
                    <span className="mono mr-2 text-soc-400">{stamp(e.timestamp)}</span>
                    {e.event_type} · <SourceChip source={e.source} />
                  </summary>
                  <div className="space-y-2 border-t border-soc-800 px-3 py-2">
                    <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-soc-300">{e.raw}</pre>
                    <JsonBlock value={e.normalized} maxHeight="max-h-40" />
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function BulletBlock({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return (
    <div>
      <p className={`text-[10px] font-semibold uppercase tracking-wider ${tone}`}>{title}</p>
      <ul className="mt-1 space-y-1 text-xs text-soc-300">
        {items.slice(0, 4).map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-soc-600">›</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
