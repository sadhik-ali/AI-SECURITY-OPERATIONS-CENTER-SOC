import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownUp, ArrowUp, Download, ScrollText, Upload } from 'lucide-react';
import type { EventSource, SecurityEvent, Severity } from '../types/api';
import { ingestEvent, listEvents, sampleHostNames } from '../services/api';
import { useAsync, useDebounced } from '../hooks/useAsync';
import { useLive } from '../context/LiveContext';
import {
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
import { SEVERITIES, SEVERITY_TOKENS, csvFromRows, download, errorText, relative, stamp } from '../lib/format';

const SOURCES: { value: EventSource | 'all'; label: string }[] = [
  { value: 'all', label: 'All feeds' },
  { value: 'wazuh', label: 'wazuh' },
  { value: 'linux_auth', label: 'linux_auth' },
  { value: 'sysmon', label: 'sysmon' },
  { value: 'demo_generator', label: 'demo_generator' },
];

const SAMPLE_LINE = 'Jan 15 04:12:33 web-01 sshd[24311]: Failed password for invalid user oracle from 203.0.113.44 port 52114 ssh2';

export function LogExplorerPage() {
  const [params, setParams] = useSearchParams();
  const { liveEvents } = useLive();
  const urlQ = params.get('q') ?? '';
  const [draft, setDraft] = useState(urlQ);
  const debounced = useDebounced(draft, 260);
  const [detail, setDetail] = useState<SecurityEvent | null>(null);
  const [ingestRaw, setIngestRaw] = useState('');
  const [ingestHost, setIngestHost] = useState('web-01');
  const [ingestSource, setIngestSource] = useState<EventSource>('linux_auth');
  const [ingestNote, setIngestNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => setDraft(urlQ), [urlQ]);
  useEffect(() => {
    if (debounced !== urlQ) set('q', debounced.trim());
  }, [debounced, urlQ, set]);

  const query = useMemo(
    () => ({
      page: Number(params.get('page') ?? 1),
      limit: 30,
      q: params.get('q') ?? undefined,
      source: (params.get('source') ?? 'all') as EventSource | 'all',
      severity: (params.get('severity') ?? 'all') as Severity | 'all',
      host: params.get('host') ?? undefined,
      username: params.get('username') ?? undefined,
      src_ip: params.get('src_ip') ?? undefined,
      start: params.get('start') ?? undefined,
      end: params.get('end') ?? undefined,
      sort: (params.get('sort') ?? 'desc') as 'asc' | 'desc',
    }),
    [params],
  );

  const state = useAsync(() => listEvents(query), [JSON.stringify(query)], { silent: true });

  const rows = useMemo(() => {
    const fetched = state.data?.items ?? [];
    if (query.page !== 1) return fetched;
    const seen = new Set(fetched.map((e) => e.id));
    return [...liveEvents.filter((e) => !seen.has(e.id)), ...fetched];
  }, [state.data, liveEvents, query.page]);

  const submitIngest = async () => {
    const line = ingestRaw.trim() || SAMPLE_LINE;
    setBusy(true);
    setIngestNote(null);
    try {
      const event = await ingestEvent(line, ingestSource, ingestHost);
      setIngestRaw('');
      setIngestNote(`Ingested as event #${event.id} — visible in this view and in the store.`);
      state.reload();
    } catch (error) {
      setIngestNote(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const exportPage = () => {
    const csv = csvFromRows(
      rows.map((e) => ({
        timestamp: e.timestamp,
        source: e.source,
        event_type: e.event_type,
        hostname: e.hostname ?? '',
        username: e.username ?? '',
        src_ip: e.src_ip ?? '',
        dst_ip: e.dst_ip ?? '',
        severity: e.severity,
        detail: e.raw.split('\n')[0].slice(0, 220),
      })),
    );
    download(`soc-logs-page-${query.page}.csv`, csv, 'text/csv');
  };

  const activeFilters = ['q', 'source', 'severity', 'host', 'username', 'src_ip', 'start', 'end'].filter((k) => params.get(k));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-soc-100">
            <ScrollText className="size-5 text-accent" />
            Log Explorer
          </h1>
          <p className="mt-0.5 text-sm text-soc-400">{state.data?.total.toLocaleString() ?? '—'} events match · newest first unless re-sorted</p>
        </div>
        <div className="flex items-center gap-2">
          <DemoBadge />
          <Button size="sm" icon={<Download className="size-3.5" />} onClick={exportPage} disabled={!rows.length}>
            Export page CSV
          </Button>
        </div>
      </header>

      <Panel bodyClassName="p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SearchField
            className="xl:col-span-2"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClear={() => {
              setDraft('');
              set('q', '');
            }}
            placeholder="Full-text across raw logs, event types, hosts, accounts, IPs…"
          />
          <Select label="Feed" value={params.get('source') ?? 'all'} onChange={(e) => set('source', e.target.value)} options={SOURCES} />
          <Select
            label="Severity"
            value={params.get('severity') ?? 'all'}
            onChange={(e) => set('severity', e.target.value)}
            options={[{ value: 'all', label: 'All severities' }, ...SEVERITIES.map((s) => ({ value: s, label: SEVERITY_TOKENS[s].label }))]}
          />
          <Select
            label="Host"
            value={params.get('host') ?? 'all'}
            onChange={(e) => set('host', e.target.value === 'all' ? '' : e.target.value)}
            options={[{ value: 'all', label: 'All hosts' }, ...sampleHostNames().map((h) => ({ value: h, label: h }))]}
          />
          <TextField label="Account" value={params.get('username') ?? ''} onChange={(e) => set('username', e.target.value)} placeholder="deploy" />
          <TextField label="Source IP" value={params.get('src_ip') ?? ''} onChange={(e) => set('src_ip', e.target.value)} placeholder="198.51.100.23" />
          <div className="grid grid-cols-2 gap-2">
            <TextField label="From" type="date" value={params.get('start') ?? ''} onChange={(e) => set('start', e.target.value)} />
            <TextField label="To" type="date" value={params.get('end') ?? ''} onChange={(e) => set('end', e.target.value)} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-soc-800 pt-3">
          <Button size="sm" icon={query.sort === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDownUp className="size-3.5" />} onClick={() => set('sort', query.sort === 'asc' ? 'desc' : 'asc')}>
            Timestamp: {query.sort === 'asc' ? 'oldest first' : 'newest first'}
          </Button>
          {activeFilters.map((key) => (
            <button key={key} type="button" onClick={() => set(key, '')} className="chip border-accent/30 bg-accent/10 text-accent hover:bg-accent/20">
              {key}: {params.get(key)}
            </button>
          ))}
          {activeFilters.length > 0 && (
            <button type="button" onClick={() => setParams(new URLSearchParams(), { replace: true })} className="text-[11px] text-soc-400 underline-offset-2 hover:text-soc-100 hover:underline">
              Clear all
            </button>
          )}
        </div>
      </Panel>

      <Panel title="Event stream" subtitle={`${rows.length} rows on this page`} flush>
        {state.error ? (
          <ErrorState message={state.error} onRetry={() => state.reload()} />
        ) : state.loading && !state.data ? (
          <div className="p-4">
            <SkeletonRows rows={8} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No events found" message="The filters exclude everything in the retention window. Clear a filter to widen the search." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead className="sticky top-0 z-10 bg-soc-900">
                <tr>
                  <th className="th">Timestamp</th>
                  <th className="th">Feed</th>
                  <th className="th">Event type</th>
                  <th className="th">Host</th>
                  <th className="th">Account</th>
                  <th className="th">Source IP</th>
                  <th className="th">Destination</th>
                  <th className="th">Sev</th>
                  <th className="th">Raw detail</th>
                  <th className="th">Fields</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className={`row-hover ${liveEvents.some((l) => l.id === e.id) && Date.now() - Date.parse(e.timestamp) < 5000 ? 'animate-row-flash' : ''}`} onClick={() => setDetail(e)}>
                    <td className="td whitespace-nowrap">
                      <span className="mono text-soc-200">{stamp(e.timestamp)}</span>
                      <span className="ml-2 text-[11px] text-soc-500">{relative(e.timestamp)}</span>
                    </td>
                    <td className="td">
                      <SourceChip source={e.source} />
                    </td>
                    <td className="td mono text-soc-200">{e.event_type}</td>
                    <td className="td mono">{e.hostname ?? '—'}</td>
                    <td className="td mono text-soc-300">{e.username ?? '—'}</td>
                    <td className="td mono text-soc-300">{e.src_ip ?? '—'}</td>
                    <td className="td mono text-soc-300">{e.dst_ip ?? '—'}</td>
                    <td className="td">
                      <SeverityBadge severity={e.severity} showLabel={false} />
                    </td>
                    <td className="td max-w-[26rem]">
                      <span className="block truncate font-mono text-[11.5px] text-soc-400">{e.raw.split('\n')[0]}</span>
                    </td>
                    <td className="td text-[11px] text-soc-400">{Object.keys(e.normalized).length} keys</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {state.data && <Pagination page={state.data.page} pages={state.data.pages} total={state.data.total} limit={query.limit} onPage={(p) => set('page', String(p))} />}
      </Panel>

      <Panel title="Ingest a raw log line" subtitle="POST /api/events/ingest — the record is added to this view immediately" icon={<Upload className="size-4" />}>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <textarea
            rows={3}
            className="field resize-y font-mono text-[12px]"
            value={ingestRaw}
            onChange={(e) => setIngestRaw(e.target.value)}
            placeholder={SAMPLE_LINE}
          />
          <div className="grid gap-2 sm:grid-cols-3 lg:w-[320px]">
            <Select label="Feed" value={ingestSource} onChange={(e) => setIngestSource(e.target.value as EventSource)} options={SOURCES.slice(1)} />
            <Select label="Host" value={ingestHost} onChange={(e) => setIngestHost(e.target.value)} options={sampleHostNames().map((h) => ({ value: h, label: h }))} />
            <div className="flex items-end">
              <Button variant="primary" className="w-full" busy={busy} onClick={() => void submitIngest()}>
                Ingest
              </Button>
            </div>
          </div>
        </div>
        {ingestNote && <p className="mt-2 text-xs text-accent">{ingestNote}</p>}
      </Panel>

      {detail && (
        <Drawer open title={`Event #${detail.id}`} subtitle={`${stamp(detail.timestamp)} · ${detail.event_type}`} onClose={() => setDetail(null)}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={detail.severity} />
              <SourceChip source={detail.source} />
              {detail.demo && <DemoBadge />}
              {detail.alert_id ? <span className="chip border-soc-700 bg-soc-800/70 text-soc-300">alert #{detail.alert_id}</span> : null}
              {detail.incident_id ? <span className="chip border-soc-700 bg-soc-800/70 text-soc-300">incident #{detail.incident_id}</span> : null}
            </div>
            <section>
              <h3 className="panel-title mb-2">Raw</h3>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-soc-700/60 bg-soc-950/85 p-3 font-mono text-[11.5px] leading-relaxed text-soc-200">
                {detail.raw}
              </pre>
            </section>
            <section>
              <h3 className="panel-title mb-2">Normalised fields</h3>
              <JsonBlock value={detail.normalized} />
            </section>
            <section>
              <h3 className="panel-title mb-2">Full record</h3>
              <JsonBlock value={detail} />
            </section>
          </div>
        </Drawer>
      )}
    </div>
  );
}
