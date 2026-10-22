import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FolderSearch, ShieldPlus, X } from 'lucide-react';
import type { IncidentStatus, Severity } from '../types/api';
import { createIncident, getAlert, listIncidents } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useLive } from '../context/LiveContext';
import { useAuth } from '../context/AuthContext';
import {
  Button,
  DemoBadge,
  EmptyState,
  ErrorState,
  IncidentStatusPill,
  Pagination,
  Panel,
  SearchField,
  Select,
  SeverityBadge,
  SkeletonRows,
} from '../components/ui';
import { INCIDENT_STATUSES, SEVERITIES, SEVERITY_TOKENS, errorText, relative, riskTone, stamp } from '../lib/format';

const LABEL: Record<IncidentStatus, string> = {
  new: 'New',
  investigating: 'Investigating',
  resolved: 'Resolved',
  closed: 'Closed',
};

export function IncidentsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { nonce } = useLive();
  const { user } = useAuth();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const alertParam = params.get('alert');

  const query = useMemo(
    () => ({
      page: Number(params.get('page') ?? 1),
      limit: 12,
      q: params.get('q') ?? undefined,
      severity: (params.get('severity') ?? 'all') as Severity | 'all',
      status: (params.get('status') ?? 'all') as IncidentStatus | 'all',
    }),
    [params],
  );

  const state = useAsync(() => listIncidents(query), [JSON.stringify(query), nonce], { silent: true });
  const orphanAlert = useAsync(
    async () => {
      if (!alertParam) return null;
      return getAlert(Number(alertParam));
    },
    [alertParam],
    { silent: true },
  );

  useEffect(() => setSearch(params.get('q') ?? ''), [params]);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const escalate = async () => {
    if (!orphanAlert.data) return;
    setBusy(true);
    setProblem(null);
    try {
      const incident = await createIncident(
        {
          title: `${orphanAlert.data.rule_name} — ${orphanAlert.data.hostname ?? 'unknown host'}`,
          description: orphanAlert.data.detection_reason,
          severity: orphanAlert.data.severity,
          alert_ids: [orphanAlert.data.id],
        },
        user?.full_name ?? 'analyst',
      );
      navigate(`/incidents/${incident.id}`);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-soc-100">
            <FolderSearch className="size-5 text-accent" />
            Incidents
          </h1>
          <p className="mt-0.5 text-sm text-soc-400">
            {state.data?.total ?? '—'} cases · open work is prioritised by severity then risk score
          </p>
        </div>
        <DemoBadge />
      </header>

      {alertParam && orphanAlert.data && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/35 bg-amber-500/8 px-4 py-3">
          <X className="size-4 shrink-0 text-amber-300" />
          <p className="min-w-0 flex-1 text-sm text-amber-100">
            Alert <span className="font-mono">#{orphanAlert.data.id}</span> — {orphanAlert.data.rule_name} is not attached to any incident yet.
          </p>
          <Button size="sm" variant="primary" busy={busy} icon={<ShieldPlus className="size-3.5" />} onClick={escalate}>
            Create incident from this alert
          </Button>
        </div>
      )}
      {problem && <p className="text-xs text-red-300">{problem}</p>}

      <Panel bodyClassName="p-3">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <SearchField
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              set('q', e.target.value.trim());
            }}
            onClear={() => {
              setSearch('');
              set('q', '');
            }}
            placeholder="Search reference, title, description, assignee…"
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
            options={[{ value: 'all', label: 'All statuses' }, ...INCIDENT_STATUSES.map((s) => ({ value: s, label: LABEL[s] }))]}
          />
        </div>
      </Panel>

      {state.error ? (
        <Panel>
          <ErrorState message={state.error} onRetry={() => state.reload()} />
        </Panel>
      ) : state.loading && !state.data ? (
        <Panel>
          <SkeletonRows rows={6} />
        </Panel>
      ) : !state.data?.items.length ? (
        <Panel>
          <EmptyState title="No incidents match" message="Adjust the filters, or escalate an alert from the live queue to open a case." />
        </Panel>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {state.data.items.map((inc) => {
            const tone = riskTone(inc.risk_score);
            return (
              <button
                key={inc.id}
                type="button"
                onClick={() => navigate(`/incidents/${inc.id}`)}
                className="panel group p-4 text-left transition-colors hover:border-accent/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] text-soc-400">{inc.reference}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-soc-100 group-hover:text-accent">{inc.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-soc-400">{inc.description}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <SeverityBadge severity={inc.severity} />
                    <IncidentStatusPill status={inc.status} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-soc-800 pt-3 text-[11px] text-soc-400">
                  <span className="flex items-center gap-1.5">
                    risk
                    <span className={`h-1.5 w-16 overflow-hidden rounded-full bg-soc-800`}>
                      <span className={`block h-full ${tone.bar}`} style={{ width: `${inc.risk_score}%` }} />
                    </span>
                    <span className={`tabular-nums ${tone.text}`}>{inc.risk_score}</span>
                  </span>
                  <span>{inc.alert_ids.length} alerts</span>
                  <span>{inc.event_ids.length} events</span>
                  <span>{inc.notes.length} notes</span>
                  <span>assignee: <span className="text-soc-200">{inc.assignee ?? 'unassigned'}</span></span>
                  <span className="ml-auto" title={inc.updated_at}>
                    {stamp(inc.created_at)} · {relative(inc.updated_at)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {state.data && (
        <Panel flush>
          <Pagination page={state.data.page} pages={state.data.pages} total={state.data.total} limit={query.limit} onPage={(p) => set('page', String(p))} />
        </Panel>
      )}
    </div>
  );
}
