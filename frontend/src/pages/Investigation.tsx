import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  Download,
  ListChecks,
  MessagesSquare,
  RefreshCw,
  Route,
  ScanEye,
  ShieldAlert,
  Swords,
  UserPlus,
} from 'lucide-react';
import type { ImplicatedEntity, IncidentStatus, SecurityEvent } from '../types/api';
import {
  addIncidentNote,
  aiAnalyzeIncident,
  analystDirectory,
  getIncident,
  incidentEntities,
  incidentEvents,
  incidentReport,
  incidentTimeline,
  patchIncident,
} from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useLive } from '../context/LiveContext';
import { useAuth } from '../context/AuthContext';
import {
  Button,
  DemoBadge,
  Drawer,
  EmptyState,
  ErrorState,
  IncidentStatusPill,
  JsonBlock,
  Panel,
  RiskGauge,
  Select,
  SeverityBadge,
  SkeletonRows,
  SourceChip,
} from '../components/ui';
import { INCIDENT_STATUS_TOKENS, clock, errorText, relative, severityToken, stamp } from '../lib/format';

const TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  new: ['investigating'],
  investigating: ['resolved', 'new'],
  resolved: ['closed', 'investigating'],
  closed: ['investigating'],
};

export function InvestigationPage() {
  const { id } = useParams();
  const incidentId = Number(id);
  const navigate = useNavigate();
  const { nonce } = useLive();
  const { user } = useAuth();
  const author = user?.full_name ?? 'analyst';

  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [eventDetail, setEventDetail] = useState<SecurityEvent | null>(null);
  const [reanalysis, setReanalysis] = useState<string | null>(null);

  const incident = useAsync(() => getIncident(incidentId), [incidentId, nonce], { silent: true });
  const timeline = useAsync(() => incidentTimeline(incidentId), [incidentId, nonce], { silent: true });
  const events = useAsync(() => incidentEvents(incidentId), [incidentId, nonce], { silent: true });
  const entities = useAsync(() => incidentEntities(incidentId), [incidentId, nonce], { silent: true });

  const flow = useMemo<IncidentStatus[]>(() => {
    const status = incident.data?.status;
    return status ? TRANSITIONS[status] : [];
  }, [incident.data]);

  if (!incident.data && incident.loading) {
    return (
      <div className="space-y-4">
        <SkeletonRows rows={3} />
        <Panel title="Loading incident">
          <SkeletonRows rows={6} />
        </Panel>
      </div>
    );
  }
  if (!incident.data) {
    return <ErrorState message={incident.error ?? `Incident ${incidentId} was not found`} onRetry={() => navigate('/incidents')} />;
  }

  const inc = incident.data;
  const ai = inc.ai;

  const transitionTo = async (status: IncidentStatus) => {
    setBusy(status);
    setFeedback(null);
    try {
      await patchIncident(incidentId, { status });
      setFeedback(`Status moved to ${INCIDENT_STATUS_TOKENS[status].label.toLowerCase()}.`);
      incident.reload();
      timeline.reload();
    } catch (error) {
      setFeedback(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const assignTo = async (assignee: string) => {
    setBusy('assign');
    try {
      await patchIncident(incidentId, { assignee: assignee === 'unassigned' ? null : assignee });
      setFeedback(assignee === 'unassigned' ? 'Assignment cleared.' : `Assigned to ${assignee}.`);
      incident.reload();
      timeline.reload();
    } catch (error) {
      setFeedback(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const submitNote = async () => {
    if (note.trim().length < 3) {
      setFeedback('Write at least a few words before saving the note.');
      return;
    }
    setBusy('note');
    setFeedback(null);
    try {
      await addIncidentNote(incidentId, note.trim(), author);
      setNote('');
      setFeedback('Note saved to the incident record.');
      incident.reload();
      timeline.reload();
    } catch (error) {
      setFeedback(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const exportReport = async () => {
    setBusy('report');
    setFeedback(null);
    try {
      const report = await incidentReport(incidentId, author);
      const blob = JSON.stringify(report, null, 2);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${inc.reference}-report.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setFeedback(`${inc.reference}-report.json downloaded (${report.sections.length} sections).`);
    } catch (error) {
      setFeedback(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const rerunAnalysis = async () => {
    setBusy('ai');
    try {
      const analysis = await aiAnalyzeIncident(incidentId);
      setReanalysis(analysis.summary);
      setFeedback('AI analysis recomputed against the current incident record.');
    } catch (error) {
      setFeedback(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" icon={<ArrowLeft className="size-3.5" />} onClick={() => navigate('/incidents')}>
          Incidents
        </Button>
        <span className="text-xs text-soc-500">/</span>
        <span className="font-mono text-xs text-soc-400">{inc.reference}</span>
      </div>

      <Panel bodyClassName="p-0">
        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="mr-1 text-lg font-semibold tracking-tight text-soc-100">{inc.title}</h1>
              <SeverityBadge severity={inc.severity} />
              <IncidentStatusPill status={inc.status} />
              {inc.demo && <DemoBadge />}
            </div>
            <p className="mt-2 max-w-3xl text-sm text-soc-300">{inc.description}</p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Reference" value={<span className="mono">{inc.reference}</span>} />
              <Fact label="Opened" value={<span title={inc.created_at}>{stamp(inc.created_at)}</span>} />
              <Fact label="Last update" value={<span title={inc.updated_at}>{relative(inc.updated_at)}</span>} />
              <Fact label="Signals" value={`${inc.alert_ids.length} alerts · ${inc.event_ids.length} events`} />
            </dl>
          </div>
          <div className="flex flex-col gap-4 border-t border-soc-800 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <RiskGauge score={inc.risk_score} size={120} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-soc-700/60 bg-soc-900/60 px-4 py-3">
          <span className="text-[11px] uppercase tracking-wider text-soc-400">Transition</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled title={`Current status: ${INCIDENT_STATUS_TOKENS[inc.status].label}`}>
              {INCIDENT_STATUS_TOKENS[inc.status].label}
            </Button>
            {flow.map((next) => (
              <Button
                key={next}
                size="sm"
                variant={next === 'investigating' ? 'primary' : next === 'resolved' ? 'ghost' : 'ghost'}
                busy={busy === next}
                onClick={() => transitionTo(next)}
              >
                → {INCIDENT_STATUS_TOKENS[next].label}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-soc-400">Assign</span>
            <Select
              value={inc.assignee ?? 'unassigned'}
              onChange={(e) => void assignTo(e.target.value)}
              className="w-44"
              options={[{ value: 'unassigned', label: 'Unassigned' }, ...analystDirectory().map((a) => ({ value: a, label: a }))]}
            />
            <Button size="sm" variant="primary" icon={<Download className="size-3.5" />} busy={busy === 'report'} onClick={() => void exportReport()}>
              Export report
            </Button>
          </div>
        </div>
        {feedback && <p className="border-t border-soc-800 px-4 py-2 text-xs text-accent">{feedback}</p>}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="AI investigation summary" subtitle="Deterministic responder · evidence separated from hypothesis" icon={<Bot className="size-4" />} className="xl:col-span-2">
          {ai ? (
            <div className="space-y-4">
              <p className="rounded-md border border-soc-800 bg-soc-950/60 p-3 text-sm leading-relaxed text-soc-200">{ai.summary}</p>
              <p className="text-xs text-amber-200">{ai.severity_assessment}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <Block icon={<ScanEye className="size-3.5" />} title="Evidence (observed)" tone="text-emerald-300" items={ai.evidence} />
                <Block icon={<Route className="size-3.5" />} title="Possible explanations" tone="text-amber-300" items={ai.possible_explanations} />
                <Block icon={<ListChecks className="size-3.5" />} title="Suggested investigation steps" tone="text-sky-300" items={ai.investigation_steps} />
                <Block icon={<Swords className="size-3.5" />} title="Recommended defensive actions" tone="text-red-300" items={ai.recommended_actions} />
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-soc-800 pt-3">
                <span className="text-[11px] uppercase tracking-wider text-soc-400">Confidence {Math.round(ai.confidence * 100)}%</span>
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-soc-800">
                  <div className={`h-full ${severityToken(inc.severity).bar}`} style={{ width: `${Math.round(ai.confidence * 100)}%` }} />
                </div>
                <Button size="sm" className="ml-auto" icon={<RefreshCw className="size-3.5" />} busy={busy === 'ai'} onClick={() => void rerunAnalysis()}>
                  Re-run analysis
                </Button>
              </div>
              {reanalysis && <p className="rounded-md border border-accent/25 bg-accent/8 px-3 py-2 text-xs text-soc-200">{reanalysis}</p>}
              <ul className="space-y-1 text-[11px] text-soc-500">
                {ai.limitations.map((l, i) => (
                  <li key={i}>· {l}</li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState title="No analysis attached" message="Run the analyser to generate a summary for this incident." />
          )}
        </Panel>

        <Panel title="Analyst notes" subtitle={`${inc.notes.length} recorded`} icon={<MessagesSquare className="size-4" />}>
          <div className="space-y-2.5">
            {inc.notes.length === 0 && <p className="text-xs text-soc-400">No notes yet. Everything written here is stored on the incident record.</p>}
            {inc.notes.map((n) => (
              <article key={n.id} className="rounded-md border border-soc-800 bg-soc-950/50 p-3">
                <p className="flex items-center justify-between text-[11px] text-soc-400">
                  <span className="font-medium text-soc-200">{n.author}</span>
                  <span title={n.created_at}>{relative(n.created_at)}</span>
                </p>
                <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-soc-200">{n.body}</p>
              </article>
            ))}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="field resize-y"
              placeholder="Add an observation, action taken or decision…"
            />
            <Button size="sm" variant="primary" icon={<UserPlus className="size-3.5" />} busy={busy === 'note'} onClick={() => void submitNote()}>
              Save note as {author}
            </Button>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Incident timeline" subtitle={`${timeline.data?.length ?? 0} entries, newest first`} icon={<CalendarClock className="size-4" />} bodyClassName="max-h-[520px] overflow-y-auto">
          {timeline.loading && !timeline.data ? (
            <SkeletonRows rows={6} />
          ) : (
            <ol className="space-y-3">
              {(timeline.data ?? []).map((entry) => (
                <li key={entry.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`mt-1.5 size-2 rounded-full ${severityToken(entry.severity ?? inc.severity).dot}`} />
                    <span className="w-px flex-1 bg-soc-800" />
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <p className="flex flex-wrap items-baseline gap-2">
                      <span className="mono text-soc-400">{clock(entry.timestamp)}</span>
                      <span className="text-[13px] font-medium text-soc-100">{entry.title}</span>
                      <span className="chip border-soc-700 bg-soc-800/70 text-soc-300">{entry.type}</span>
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-soc-400">{entry.detail}</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-wider text-soc-500">{entry.actor}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title="Implicated entities" subtitle="Aggregated from correlated events" icon={<ShieldAlert className="size-4" />} bodyClassName="max-h-[520px] overflow-y-auto">
          <div className="space-y-4">
            <EntityGroup title="Source IPs" rows={entities.data?.ips ?? []} />
            <EntityGroup title="Accounts" rows={entities.data?.users ?? []} />
            <EntityGroup title="Hosts" rows={entities.data?.hosts ?? []} />
          </div>
        </Panel>
      </div>

      <Panel title="Related events" subtitle={`${events.data?.length ?? 0} raw records attached to this case`} icon={<ScanEye className="size-4" />} flush>
        {events.loading && !events.data ? (
          <div className="p-4">
            <SkeletonRows rows={5} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr>
                  <th className="th">Timestamp</th>
                  <th className="th">Sev</th>
                  <th className="th">Event type</th>
                  <th className="th">Feed</th>
                  <th className="th">Host</th>
                  <th className="th">Account</th>
                  <th className="th">Source</th>
                  <th className="th">Detail</th>
                </tr>
              </thead>
              <tbody>
                {(events.data ?? []).map((e) => (
                  <tr key={e.id} className="row-hover" onClick={() => setEventDetail(e)}>
                    <td className="td whitespace-nowrap mono">{stamp(e.timestamp)}</td>
                    <td className="td">
                      <SeverityBadge severity={e.severity} showLabel={false} />
                    </td>
                    <td className="td mono text-soc-200">{e.event_type}</td>
                    <td className="td">
                      <SourceChip source={e.source} />
                    </td>
                    <td className="td mono">{e.hostname ?? '—'}</td>
                    <td className="td mono text-soc-300">{e.username ?? '—'}</td>
                    <td className="td mono text-soc-300">{e.src_ip ?? '—'}</td>
                    <td className="td max-w-[22rem] truncate text-[12.5px] text-soc-400">{e.raw.split('\n')[0]}</td>
                  </tr>
                ))}
                {!events.data?.length && (
                  <tr>
                    <td colSpan={8} className="td">
                      <EmptyState title="No events attached" message="This incident has alerts but no raw events were correlated." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {eventDetail && (
        <Drawer open title={`Event #${eventDetail.id} · ${eventDetail.event_type}`} subtitle={`${stamp(eventDetail.timestamp)} · ${eventDetail.hostname ?? '—'}`} onClose={() => setEventDetail(null)}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={eventDetail.severity} />
              <SourceChip source={eventDetail.source} />
              {eventDetail.alert_id ? <span className="chip border-soc-700 bg-soc-800/70 text-soc-300">alert #{eventDetail.alert_id}</span> : null}
              {eventDetail.demo && <DemoBadge />}
            </div>
            <section>
              <h3 className="panel-title mb-2">Raw log</h3>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-soc-700/60 bg-soc-950/80 p-3 font-mono text-[11.5px] text-soc-200">
                {eventDetail.raw}
              </pre>
            </section>
            <section>
              <h3 className="panel-title mb-2">Normalised fields</h3>
              <JsonBlock value={eventDetail.normalized} />
            </section>
            <section>
              <h3 className="panel-title mb-2">Envelope</h3>
              <JsonBlock value={eventDetail} />
            </section>
          </div>
        </Drawer>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-soc-800 bg-soc-950/50 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-soc-400">{label}</dt>
      <dd className="mt-1 text-sm text-soc-100">{value}</dd>
    </div>
  );
}

function Block({ title, items, tone, icon }: { title: string; items: string[]; tone: string; icon: ReactNode }) {
  return (
    <div className="rounded-md border border-soc-800 bg-soc-950/50 p-3">
      <p className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}>
        {icon}
        {title}
      </p>
      <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-soc-300">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-soc-600">›</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EntityGroup({ title, rows }: { title: string; rows: ImplicatedEntity[] }) {
  return (
    <div>
      <h3 className="panel-title mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-soc-500">None observed.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={`${title}-${r.value}`}
              className="flex items-center justify-between gap-3 rounded-md border border-soc-800 bg-soc-950/50 px-3 py-1.5"
              title={`${r.note} · first seen ${stamp(r.first_seen)} · last seen ${stamp(r.last_seen)}`}
            >
              <span className="min-w-0">
                <span className="mono block truncate text-[12.5px] text-soc-100">{r.value}</span>
                <span className="block truncate text-[10px] text-soc-500">{r.note}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[11px] tabular-nums text-soc-300">{r.occurrences}×</span>
                <span className="block text-[10px] text-soc-500">{relative(r.last_seen)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
