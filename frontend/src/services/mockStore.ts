import type {
  Alert,
  AlertStatus,
  AnalystNote,
  EventQuery,
  Incident,
  IncidentCreateRequest,
  IncidentQuery,
  IncidentReport,
  Page,
  ReportSection,
  SecurityEvent,
  Settings,
  TimelineEntry,
  AlertQuery,
  DashboardSummary,
  TopHost,
  TopSource,
  TrendPoint,
  Severity,
  WsFrame,
} from '../types/api';
import { buildWorld, type World } from '../data/world';
import { ATTACKER_IPS, HOSTS, HOST_BY_NAME } from '../data/fixtures';
import { Rng } from '../lib/rng';
import { connTrack, isoTime, sshdFailed, sudoLine, sysmonProcessCreate, wazuhAlert } from '../data/logs';
import { analyzeAlert, analyzeIncident } from './aiLocal';

const SETTINGS_KEY = 'ai-soc.settings.v1';

const SEVERITY_ORDER: Record<Severity, number> = { informational: 0, low: 1, high: 2, critical: 3 };

const DEFAULT_SETTINGS: Settings = {
  detection: {
    brute_force_threshold: 15,
    brute_force_window_seconds: 600,
    portscan_port_threshold: 25,
    failed_login_alert_severity: 'low',
    min_ai_confidence: 0.6,
  },
  retention: { event_retention_days: 90, alert_retention_days: 180, incident_retention_days: 365, raw_log_storage_mb: 51200 },
  ai: { provider: 'ollama', model: 'llama3.1:8b-instruct', temperature: 0.2, max_output_tokens: 1200, api_key_masked: '••••••••••••4471', api_key_is_secret: true },
  wazuh: {
    enabled: true,
    manager_url: 'https://monitor-01.internal:55000',
    api_port: 55000,
    index_pattern: 'wazuh-alerts-4.x-*',
    user: 'wazuh-readonly',
    password_masked: '••••••••••••9c2f',
    password_is_secret: true,
    verify_ssl: false,
  },
  opensearch: {
    enabled: true,
    hosts: ['https://opensearch-01.internal:9200'],
    index_prefix: 'logs',
    username: 'soc_reader',
    password_masked: '••••••••••••a18d',
    password_is_secret: true,
    tls: true,
  },
  users: [
    { id: 1, full_name: 'Adnan Sardhi', email: 'analyst@aisoc.dev', role: 'analyst', status: 'active', last_seen: '2026-10-22T09:12:00Z', demo: true },
    { id: 2, full_name: 'Dana Novak', email: 'admin@aisoc.dev', role: 'admin', status: 'active', last_seen: '2026-10-22T10:04:00Z', demo: true },
    { id: 3, full_name: 'Kamran Iqbal', email: 'k.iqbal@aisoc.dev', role: 'analyst', status: 'active', last_seen: '2026-10-21T22:41:00Z', demo: true },
    { id: 4, full_name: 'Micah Okafor', email: 'm.okafor@aisoc.dev', role: 'analyst', status: 'active', last_seen: '2026-10-22T07:55:00Z', demo: true },
    { id: 5, full_name: 'Tobias Brooks', email: 't.brooks@aisoc.dev', role: 'analyst', status: 'suspended', last_seen: '2026-09-30T16:02:00Z', demo: true },
  ],
  demo: { enabled: true, events_per_minute: 4, attack_chain_every_minutes: 12, include_critical: true },
  timezone: 'Asia/Karachi',
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...structuredClone(DEFAULT_SETTINGS), ...parsed } as Settings;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

interface LiveTemplate {
  rule: string;
  category: string;
  severity: Severity;
  reason: (t: { host: string; srcIp: string; user: string; port: number; bytes: number }) => string;
  kind: 'brute' | 'sudo' | 'scan' | 'process' | 'transfer';
  /** Attack-chain template: emitted on the attack_chain_every_minutes cadence. */
  chain?: boolean;
}

const LIVE_TEMPLATES: LiveTemplate[] = [
  {
    rule: 'SSHD: authentication failure flood (5710)',
    category: 'Authentication',
    severity: 'low',
    kind: 'brute',
    reason: ({ host, srcIp }) => `11 failed password attempts against ${host} from ${srcIp} in the last 90 seconds`,
  },
  {
    rule: 'sudo: privileged command executed',
    category: 'Privilege Escalation',
    severity: 'low',
    kind: 'sudo',
    reason: ({ host, user }) => `${user} executed a root command on ${host} from an interactive TTY`,
  },
  {
    rule: 'Firewall: SYN flood against multiple ports (5712)',
    category: 'Reconnaissance',
    severity: 'informational',
    kind: 'scan',
    reason: ({ host, port }) => `${port} blocked TCP destinations observed against ${host}`,
  },
  {
    rule: 'Sysmon: process created in user-writable path (EID 1)',
    category: 'Execution',
    severity: 'high',
    kind: 'process',
    chain: true,
    reason: ({ host, user }) => `Unsigned binary executed on ${host} under ${user} from %TEMP%`,
  },
  {
    rule: 'Network: outbound transfer above baseline (530)',
    category: 'Exfiltration',
    severity: 'high',
    kind: 'transfer',
    reason: ({ host, bytes }) => `${Math.round(bytes / 1_000_000)} MB egress from ${host} exceeds the host baseline`,
  },
];

class MockStore {
  private world: World;
  private frames: WsFrame[] = [];
  private statusLog = new Map<number, TimelineEntry[]>();
  private liveSeq = 0;
  private lastChainAt = 0;
  private rng = new Rng(77213);
  settings: Settings = loadSettings();

  constructor() {
    this.world = buildWorld(Date.now());
  }

  private nextEventId(): number {
    return this.world.events.reduce((m, e) => Math.max(m, e.id), 0) + 1;
  }
  private nextAlertId(): number {
    return this.world.alerts.reduce((m, a) => Math.max(m, a.id), 0) + 1;
  }
  private nextIncidentId(): number {
    return this.world.incidents.reduce((m, i) => Math.max(m, i.id), 0) + 1;
  }

  /* ------------------------------- reads ------------------------------- */

  get events(): SecurityEvent[] {
    return this.world.events;
  }
  get alerts(): Alert[] {
    return this.world.alerts;
  }
  get incidents(): Incident[] {
    return this.world.incidents;
  }

  summary(): DashboardSummary {
    const alerts = this.world.alerts;
    const incidents = this.world.incidents;
    return {
      total_events: this.world.events.length,
      total_alerts: alerts.length,
      critical_alerts: alerts.filter((a) => a.severity === 'critical').length,
      high_alerts: alerts.filter((a) => a.severity === 'high').length,
      open_incidents: incidents.filter((i) => i.status === 'new' || i.status === 'investigating').length,
      investigating_incidents: incidents.filter((i) => i.status === 'investigating').length,
      resolved_incidents: incidents.filter((i) => i.status === 'resolved' || i.status === 'closed').length,
    };
  }

  trends(hours = 24): TrendPoint[] {
    const now = Date.now();
    const size = 3_600_000;
    const buckets = Math.min(Math.max(hours, 1), 168);
    const events = new Array(buckets).fill(0);
    const alerts = new Array(buckets).fill(0);
    const idxOf = (ts: number) => Math.floor((now - ts) / size);
    for (const e of this.world.events) {
      const i = buckets - 1 - idxOf(Date.parse(e.timestamp));
      if (i >= 0 && i < buckets) events[i] += 1;
    }
    for (const a of this.world.alerts) {
      const i = buckets - 1 - idxOf(Date.parse(a.timestamp));
      if (i >= 0 && i < buckets) alerts[i] += 1;
    }
    return Array.from({ length: buckets }, (_, i) => {
      const t = new Date(now - (buckets - 1 - i) * size);
      return {
        t: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`,
        events: events[i],
        alerts: alerts[i],
      };
    });
  }

  topSources(limit = 10): { sources: TopSource[]; hosts: TopHost[] } {
    const src = new Map<string, { events: number; alerts: number; max: Severity }>();
    const byHost = new Map<string, { events: number; alerts: number }>();
    for (const e of this.world.events) {
      if (e.src_ip && !e.src_ip.startsWith('10.')) {
        const cur = src.get(e.src_ip) ?? { events: 0, alerts: 0, max: 'informational' as Severity };
        cur.events += 1;
        if (SEVERITY_ORDER[e.severity] > SEVERITY_ORDER[cur.max]) cur.max = e.severity;
        src.set(e.src_ip, cur);
      }
      if (e.hostname) {
        const cur = byHost.get(e.hostname) ?? { events: 0, alerts: 0 };
        cur.events += 1;
        byHost.set(e.hostname, cur);
      }
    }
    for (const a of this.world.alerts) {
      if (a.src_ip && !a.src_ip.startsWith('10.')) {
        const cur = src.get(a.src_ip) ?? { events: 0, alerts: 0, max: 'informational' as Severity };
        cur.alerts += 1;
        if (SEVERITY_ORDER[a.severity] > SEVERITY_ORDER[cur.max]) cur.max = a.severity;
        src.set(a.src_ip, cur);
      }
      if (a.hostname) {
        const cur = byHost.get(a.hostname) ?? { events: 0, alerts: 0 };
        cur.alerts += 1;
        byHost.set(a.hostname, cur);
      }
    }
    return {
      sources: [...src.entries()]
        .map(([ip, v]) => ({ ip, events: v.events, alerts: v.alerts, max_severity: v.max }))
        .sort((a, b) => b.events + b.alerts * 3 - (a.events + a.alerts * 3))
        .slice(0, limit),
      hosts: [...byHost.entries()]
        .map(([hostname, v]) => ({ hostname, events: v.events, alerts: v.alerts }))
        .sort((a, b) => b.events - a.events)
        .slice(0, limit),
    };
  }

  severityDistribution(): { severity: Severity; count: number }[] {
    const counts: Record<Severity, number> = { informational: 0, low: 0, high: 0, critical: 0 };
    for (const a of this.world.alerts) counts[a.severity] += 1;
    return (Object.keys(counts) as Severity[]).map((severity) => ({ severity, count: counts[severity] }));
  }

  queryAlerts(q: AlertQuery): Page<Alert> {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.max(1, Math.min(q.limit ?? 25, 200));
    const needle = q.q?.trim().toLowerCase();
    let items = this.world.alerts.slice().sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    if (q.severity && q.severity !== 'all') items = items.filter((a) => a.severity === q.severity);
    if (q.status && q.status !== 'all') items = items.filter((a) => a.investigation_status === q.status);
    if (q.src_ip) items = items.filter((a) => a.src_ip === q.src_ip);
    if (q.host) items = items.filter((a) => a.hostname === q.host);
    if (q.start) items = items.filter((a) => Date.parse(a.timestamp) >= Date.parse(q.start!));
    if (q.end) items = items.filter((a) => Date.parse(a.timestamp) <= Date.parse(q.end!));
    if (needle) {
      items = items.filter((a) =>
        [a.rule_name, a.detection_reason, a.hostname, a.username, a.src_ip, a.dst_ip, a.event_category, String(a.id)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle),
      );
    }
    return paginate(items, page, limit);
  }

  alertById(id: number): Alert | undefined {
    return this.world.alerts.find((a) => a.id === id);
  }

  eventsForAlert(id: number): SecurityEvent[] {
    const alert = this.alertById(id);
    if (!alert) return [];
    const set = new Set(alert.event_ids);
    return this.world.events.filter((e) => set.has(e.id));
  }

  queryEvents(q: EventQuery): Page<SecurityEvent> {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.max(1, Math.min(q.limit ?? 50, 500));
    const dir = q.sort === 'asc' ? 1 : -1;
    const needle = q.q?.trim().toLowerCase();
    let items = this.world.events
      .slice()
      .sort((a, b) => dir * (Date.parse(b.timestamp) - Date.parse(a.timestamp)));
    if (q.source && q.source !== 'all') items = items.filter((e) => e.source === q.source);
    if (q.severity && q.severity !== 'all') items = items.filter((e) => e.severity === q.severity);
    if (q.host) items = items.filter((e) => e.hostname === q.host);
    if (q.username) items = items.filter((e) => e.username === q.username);
    if (q.src_ip) items = items.filter((e) => e.src_ip === q.src_ip);
    if (q.start) items = items.filter((e) => Date.parse(e.timestamp) >= Date.parse(q.start!));
    if (q.end) items = items.filter((e) => Date.parse(e.timestamp) <= Date.parse(q.end!));
    if (needle) {
      items = items.filter((e) =>
        [e.raw, e.event_type, e.hostname, e.username, e.src_ip, e.dst_ip, JSON.stringify(e.normalized)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle),
      );
    }
    return paginate(items, page, limit);
  }

  eventById(id: number): SecurityEvent | undefined {
    return this.world.events.find((e) => e.id === id);
  }

  incidentById(id: number): Incident | undefined {
    return this.world.incidents.find((i) => i.id === id);
  }

  incidentAlerts(inc: Incident): Alert[] {
    return inc.alert_ids.map((id) => this.alertById(id)).filter((a): a is Alert => Boolean(a));
  }

  incidentEvents(inc: Incident): SecurityEvent[] {
    const set = new Set(inc.event_ids);
    return this.world.events
      .filter((e) => set.has(e.id))
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  }

  queryIncidents(q: IncidentQuery): Page<Incident> {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.max(1, Math.min(q.limit ?? 25, 100));
    const needle = q.q?.trim().toLowerCase();
    let items = this.world.incidents.slice().sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || Date.parse(b.created_at) - Date.parse(a.created_at));
    if (q.severity && q.severity !== 'all') items = items.filter((i) => i.severity === q.severity);
    if (q.status && q.status !== 'all') items = items.filter((i) => i.status === q.status);
    if (needle) {
      items = items.filter((i) => [i.reference, i.title, i.description, i.assignee ?? ''].join(' ').toLowerCase().includes(needle));
    }
    return paginate(items, page, limit);
  }

  timeline(incidentId: number): TimelineEntry[] {
    const inc = this.incidentById(incidentId);
    if (!inc) return [];
    const out: TimelineEntry[] = [];
    out.push({
      id: `t-created-${inc.id}`,
      timestamp: inc.created_at,
      actor: 'detection-engine',
      type: 'detection',
      title: 'Incident opened',
      detail: `${inc.reference} created automatically from ${inc.alert_ids.length} correlated alert(s).`,
      severity: inc.severity,
      demo: true,
    });
    for (const a of this.incidentAlerts(inc)) {
      out.push({
        id: `t-alert-${a.id}`,
        timestamp: a.timestamp,
        actor: 'wazuh / rule engine',
        type: 'alert',
        title: `Alert #${a.id} · ${a.rule_name}`,
        detail: a.detection_reason,
        severity: a.severity,
        demo: true,
      });
    }
    for (const e of this.incidentEvents(inc).slice(0, 25)) {
      out.push({
        id: `t-event-${e.id}`,
        timestamp: e.timestamp,
        actor: e.source,
        type: 'event',
        title: `${e.event_type}${e.hostname ? ` on ${e.hostname}` : ''}`,
        detail: e.raw.split('\n')[0].slice(0, 240),
        severity: e.severity,
        demo: true,
      });
    }
    for (const n of inc.notes) {
      out.push({
        id: `t-note-${n.id}`,
        timestamp: n.created_at,
        actor: n.author,
        type: 'analyst',
        title: 'Analyst note added',
        detail: n.body,
        demo: true,
      });
    }
    for (const t of this.statusLog.get(inc.id) ?? []) out.push(t);
    return out.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  }

  implicated(incidentId: number) {
    const inc = this.incidentById(incidentId);
    if (!inc) return { ips: [], users: [], hosts: [] };
    const events = this.incidentEvents(inc);
    const bucket = (key: (e: SecurityEvent) => string | null) => {
      const map = new Map<string, { count: number; first: number; last: number }>();
      for (const e of events) {
        const k = key(e);
        if (!k) continue;
        const ts = Date.parse(e.timestamp);
        const cur = map.get(k) ?? { count: 0, first: ts, last: ts };
        cur.count += 1;
        cur.first = Math.min(cur.first, ts);
        cur.last = Math.max(cur.last, ts);
        map.set(k, cur);
      }
      return [...map.entries()]
        .map(([value, v]) => ({
          kind: 'ip' as const,
          value,
          occurrences: v.count,
          first_seen: isoTime(v.first),
          last_seen: isoTime(v.last),
          note: '',
        }))
        .sort((a, b) => b.occurrences - a.occurrences);
    };
    const ips = bucket((e) => e.src_ip).map((x) => ({
      ...x,
      kind: 'ip' as const,
      note: x.value.startsWith('10.') ? 'Internal asset' : 'External source — no business relationship on record',
    }));
    const users = bucket((e) => e.username).map((x) => ({ ...x, kind: 'user' as const, note: 'Seen in correlated events' }));
    const hosts = bucket((e) => e.hostname).map((x) => ({
      ...x,
      kind: 'host' as const,
      note: HOST_BY_NAME[x.value]?.role ?? 'Asset',
    }));
    return { ips, users, hosts };
  }

  report(incidentId: number, author: string): IncidentReport | null {
    const inc = this.incidentById(incidentId);
    if (!inc) return null;
    const alerts = this.incidentAlerts(inc);
    const events = this.incidentEvents(inc);
    const t = this.timeline(incidentId);
    const imp = this.implicated(incidentId);
    const sections: ReportSection[] = [
      {
        key: 'overview',
        title: 'Incident Overview',
        content: `${inc.reference} — ${inc.title}\n${inc.description}\nStatus: ${inc.status} · Severity: ${inc.severity} · Risk score: ${inc.risk_score}/100\nCreated: ${inc.created_at} · Last update: ${inc.updated_at}\nAssignee: ${inc.assignee ?? 'unassigned'} · Alerts: ${alerts.length} · Events: ${events.length}`,
      },
      {
        key: 'timeline',
        title: 'Incident Timeline',
        content: `${t.length} entries.`,
        rows: t.map((e) => ({ timestamp: e.timestamp, actor: e.actor, type: e.type, title: e.title, detail: e.detail })),
      },
      {
        key: 'evidence',
        title: 'Evidence and Correlated Events',
        content: `${events.length} raw events attached.`,
        rows: events.slice(0, 60).map((e) => ({
          event_id: e.id,
          timestamp: e.timestamp,
          source: e.source,
          event_type: e.event_type,
          hostname: e.hostname ?? '',
          username: e.username ?? '',
          src_ip: e.src_ip ?? '',
          dst_ip: e.dst_ip ?? '',
        })),
      },
      {
        key: 'severity_risk',
        title: 'Severity and Risk Assessment',
        content: `Severity ${inc.severity.toUpperCase()} (risk ${inc.risk_score}/100). ${inc.ai?.severity_assessment ?? ''}`,
        rows: [
          { metric: 'risk_score', value: inc.risk_score },
          { metric: 'severity', value: inc.severity },
          { metric: 'alerts', value: alerts.length },
          { metric: 'events', value: events.length },
          { metric: 'implicated_external_ips', value: imp.ips.filter((i) => !i.value.startsWith('10.')).length },
        ],
      },
      {
        key: 'rules_triggered',
        title: 'Detection Rules Triggered',
        content: inc.rules_triggered.join('\n'),
        rows: alerts.map((a) => ({ alert_id: a.id, rule: a.rule_name, severity: a.severity, status: a.investigation_status })),
      },
      {
        key: 'ai_summary',
        title: 'AI Investigation Summary',
        content: inc.ai
          ? `${inc.ai.summary}\n\nEvidence:\n${inc.ai.evidence.map((x) => `- ${x}`).join('\n')}\n\nHypotheses:\n${inc.ai.possible_explanations
              .map((x) => `- ${x}`)
              .join('\n')}\n\nRecommended actions:\n${inc.ai.recommended_actions.map((x) => `- ${x}`).join('\n')}\n\nConfidence: ${Math.round(
              inc.ai.confidence * 100,
            )}%\nLimitations:\n${inc.ai.limitations.map((x) => `- ${x}`).join('\n')}`
          : 'No analysis attached.',
      },
      {
        key: 'remediation',
        title: 'Remediation and Next Steps',
        content: (inc.ai?.recommended_actions ?? []).map((x, i) => `${i + 1}. ${x}`).join('\n'),
      },
      {
        key: 'analyst_notes',
        title: 'Analyst Notes',
        content: inc.notes.map((n) => `[${n.created_at}] ${n.author}: ${n.body}`).join('\n') || 'No notes recorded.',
        rows: inc.notes.map((n) => ({ created_at: n.created_at, author: n.author, body: n.body })),
      },
    ];
    return {
      incident_id: inc.id,
      reference: inc.reference,
      title: inc.title,
      generated_at: isoTime(Date.now()),
      generated_by: author,
      sections,
      demo: true,
    };
  }

  /* ------------------------------- writes ------------------------------- */

  patchAlert(id: number, status: AlertStatus): Alert {
    const alert = this.alertById(id);
    if (!alert) throw new Error(`Alert ${id} not found`);
    alert.investigation_status = status;
    if (status === 'resolved') {
      this.frames.push({ type: 'alert', data: alert });
    }
    return { ...alert };
  }

  patchIncident(id: number, patch: Partial<Pick<Incident, 'status' | 'assignee' | 'severity' | 'title' | 'description'>>): Incident {
    const inc = this.incidentById(id);
    if (!inc) throw new Error(`Incident ${id} not found`);
    const before = inc.status;
    Object.assign(inc, patch);
    inc.updated_at = isoTime(Date.now());
    if (patch.status && patch.status !== before) {
      const entry: TimelineEntry = {
        id: `t-status-${id}-${Date.now()}`,
        timestamp: isoTime(Date.now()),
        actor: 'analyst',
        type: 'status',
        title: `Status changed: ${before} → ${patch.status}`,
        detail: `Transition recorded from the investigation console. ${
          patch.status === 'resolved' ? 'Containment evidence attached.' : 'Work continues on this incident.'
        }`,
        severity: inc.severity,
        demo: true,
      };
      this.statusLog.set(id, [...(this.statusLog.get(id) ?? []), entry]);
    }
    if (patch.assignee !== undefined) {
      const entry: TimelineEntry = {
        id: `t-assign-${id}-${Date.now()}`,
        timestamp: isoTime(Date.now()),
        actor: 'analyst',
        type: 'assignment',
        title: patch.assignee ? `Assigned to ${patch.assignee}` : 'Assignment cleared',
        detail: 'Owner updated on the incident record.',
        demo: true,
      };
      this.statusLog.set(id, [...(this.statusLog.get(id) ?? []), entry]);
    }
    inc.ai = analyzeIncident(inc, this.incidentAlerts(inc), this.incidentEvents(inc));
    this.frames.push({ type: 'incident_update', data: { ...inc } });
    return { ...inc };
  }

  addNote(id: number, body: string, author: string): AnalystNote {
    const inc = this.incidentById(id);
    if (!inc) throw new Error(`Incident ${id} not found`);
    const note: AnalystNote = { id: inc.notes.length + 1, author, created_at: isoTime(Date.now()), body, demo: true };
    inc.notes = [...inc.notes, note];
    inc.updated_at = note.created_at;
    return note;
  }

  createIncident(req: IncidentCreateRequest, author: string): Incident {
    const id = this.nextIncidentId();
    const eventIds = Array.from(new Set(req.alert_ids.flatMap((aid) => this.alertById(aid)?.event_ids ?? []))).sort((a, b) => a - b);
    const nowIso = isoTime(Date.now());
    const base: Incident = {
      id,
      reference: `INC-2026-${String(480 + id).padStart(4, '0')}`,
      title: req.title,
      description: req.description,
      severity: req.severity,
      status: 'new',
      risk_score: { informational: 15, low: 35, high: 70, critical: 90 }[req.severity],
      created_at: nowIso,
      updated_at: nowIso,
      assignee: req.assignee ?? author,
      alert_ids: req.alert_ids,
      event_ids: eventIds,
      rules_triggered: req.alert_ids.map((aid) => this.alertById(aid)?.rule_name ?? '').filter(Boolean),
      notes: [],
      ai: null,
      demo: true,
    };
    base.ai = analyzeIncident(base, this.incidentAlerts(base), this.incidentEvents(base));
    this.world.incidents = [...this.world.incidents, base];
    req.alert_ids.forEach((aid) => {
      const a = this.alertById(aid);
      if (a) a.incident_id = id;
    });
    eventIds.forEach((eid) => {
      const e = this.eventById(eid);
      if (e) e.incident_id = id;
    });
    this.frames.push({ type: 'incident_update', data: { ...base } });
    return { ...base };
  }

  ingest(raw: string, source: SecurityEvent['source'], hostname: string): SecurityEvent {
    const host = HOST_BY_NAME[hostname] ?? HOSTS[0];
    const id = this.nextEventId();
    const ev: SecurityEvent = {
      id,
      timestamp: isoTime(Date.now()),
      source,
      event_type: 'ingested_line',
      hostname: host.hostname,
      username: null,
      src_ip: null,
      dst_ip: host.ip,
      severity: 'informational',
      raw,
      normalized: { ingested_via: 'POST /api/events/ingest', agent_id: host.agent_id, bytes: raw.length },
      alert_id: null,
      incident_id: null,
      demo: true,
    };
    this.world.events = [...this.world.events, ev];
    this.frames.push({ type: 'event', data: ev });
    return ev;
  }

  analyzeAlertById(id: number) {
    const alert = this.alertById(id);
    if (!alert) throw new Error(`Alert ${id} not found`);
    return analyzeAlert(alert, this.eventsForAlert(id));
  }

  /* ------------------------------- live feed ------------------------------- */

  /** Cadence for the bundled sample feed, driven by the Settings demo-generator controls. */
  feedIntervalMs(): number {
    const perMinute = Math.max(1, this.settings.demo.events_per_minute);
    return Math.min(30_000, Math.max(2_000, Math.round(60_000 / perMinute)));
  }

  /** Generates the next synthetic alert + backing events and queues it for subscribers. */
  tickLive(): WsFrame[] {
    const demo = this.settings.demo;
    if (!demo.enabled) return [];
    const at = Date.now();
    const chainDue = at - this.lastChainAt >= Math.max(1, demo.attack_chain_every_minutes) * 60_000;
    const chainTpl = LIVE_TEMPLATES.find((t) => t.chain);
    const routineTpl = LIVE_TEMPLATES.filter((t) => !t.chain);
    const tpl = chainDue && chainTpl ? chainTpl : routineTpl[this.liveSeq % routineTpl.length];
    this.lastChainAt = chainDue && tpl.chain ? at : this.lastChainAt;
    const severity: Severity = tpl.chain && demo.include_critical ? 'critical' : tpl.severity;
    const host = this.rng.pick(HOSTS);
    const srcIp = this.rng.weight(ATTACKER_IPS.map((ip, i) => [ip, 10 - i] as [string, number]));
    const user = this.rng.pick(['root', 'deploy', 'svc-backup', 'l.chen', 'sqlagent', 'oracle', 'j.rivera']);
    const port = this.rng.int(20, 600);
    const bytes = this.rng.int(40, 900) * 1_000_000;
    this.liveSeq += 1;
    const newEvents: SecurityEvent[] = [];
    const baseId = this.nextEventId();

    const push = (partial: Omit<SecurityEvent, 'id' | 'alert_id' | 'incident_id'>) => {
      newEvents.push({ id: baseId + newEvents.length, alert_id: null, incident_id: null, ...partial });
    };

    if (tpl.kind === 'brute' || tpl.kind === 'scan') {
      for (let i = 0; i < 4; i++) {
        push({
          timestamp: isoTime(at - i * 4000),
          source: tpl.kind === 'brute' ? 'linux_auth' : 'wazuh',
          event_type: tpl.kind === 'brute' ? 'sshd_authentication_failed' : 'firewall_blocked_connection',
          hostname: host.hostname,
          username: tpl.kind === 'brute' ? user : null,
          src_ip: srcIp,
          dst_ip: host.ip,
          severity,
          raw:
            tpl.kind === 'brute'
              ? sshdFailed(at - i * 4000, host, user, srcIp, 40000 + i * 131)
              : connTrack(at - i * 4000, host, srcIp, 31000 + i, host.ip, port + i),
          normalized: { live: true, template: tpl.rule, agent_id: host.agent_id },
          demo: true,
        });
      }
    } else if (tpl.kind === 'sudo') {
      push({
        timestamp: isoTime(at),
        source: 'linux_auth',
        event_type: 'sudo_command',
        hostname: host.hostname,
        username: user,
        src_ip: host.ip,
        dst_ip: host.ip,
        severity: tpl.severity,
        raw: sudoLine(at, host, user, 'pts/3', '/usr/bin/apt-get update'),
        normalized: { live: true, program: 'sudo', target_user: 'root', agent_id: host.agent_id },
        demo: true,
      });
    } else if (tpl.kind === 'process') {
      push({
        timestamp: isoTime(at),
        source: 'sysmon',
        event_type: 'sysmon_process_create',
        hostname: host.hostname,
        username: user,
        src_ip: null,
        dst_ip: null,
        severity: tpl.severity,
        raw: sysmonProcessCreate({
          ts: at,
          host,
          image: 'C:\\Users\\Public\\a.exe',
          commandLine: 'a.exe -enc JAB3AGMAPQBOAGUA',
          parent: 'C:\\Windows\\System32\\cmd.exe',
          user,
          hash: 'SHA256=7C4D' + String(at).slice(-8) + 'A1B0C3D6E9F2A5B8C1D4E7F0A3B6C9',
        }),
        normalized: { live: true, event_id: 1, provider: 'Microsoft-Windows-Sysmon', unsigned: true },
        demo: true,
      });
    } else {
      push({
        timestamp: isoTime(at),
        source: 'wazuh',
        event_type: 'egress_volume_anomaly',
        hostname: host.hostname,
        username: 'svc-backup',
        src_ip: host.ip,
        dst_ip: srcIp,
        severity: tpl.severity,
        raw: wazuhAlert({
          ts: at,
          host,
          ruleId: '530',
          level: 9,
          description: tpl.rule,
          groups: ['network', 'exfiltration', 'live'],
          srcIp: host.ip,
          dstIp: srcIp,
          user: 'svc-backup',
          fullEvent: `${host.hostname} -> ${srcIp}:443 bytes_out=${bytes}`,
        }),
        normalized: { live: true, bytes_out: bytes, baseline_mean_bytes: 9_400_000, rule_id: '530' },
        demo: true,
      });
    }

    const alert: Alert = {
      id: this.nextAlertId(),
      timestamp: isoTime(at),
      severity,
      rule_name: tpl.rule,
      src_ip: srcIp,
      dst_ip: host.ip,
      username: tpl.kind === 'scan' ? null : user,
      hostname: host.hostname,
      event_category: tpl.category,
      detection_reason: tpl.reason({ host: host.hostname, srcIp, user, port, bytes }),
      investigation_status: 'new',
      incident_id: null,
      source: tpl.kind === 'process' ? 'sysmon' : 'wazuh',
      event_ids: newEvents.map((e) => e.id),
      demo: true,
    };
    for (const e of newEvents) e.alert_id = alert.id;

    this.world.events = [...this.world.events, ...newEvents];
    this.world.alerts = [...this.world.alerts, alert];
    const frames: WsFrame[] = [
      { type: 'event', data: newEvents[newEvents.length - 1] },
      { type: 'alert', data: alert },
    ];
    this.frames.push(...frames);
    return frames;
  }

  /** Incident activity feed for the dashboard. */
  activityFeed(limit = 8): { incident: Incident; entry: TimelineEntry }[] {
    return this.world.incidents
      .flatMap((inc) => this.timeline(inc.id).slice(0, 3).map((entry) => ({ incident: inc, entry })))
      .sort((a, b) => Date.parse(b.entry.timestamp) - Date.parse(a.entry.timestamp))
      .slice(0, limit);
  }

  drainFrames(): WsFrame[] {
    const out = this.frames;
    this.frames = [];
    return out;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* storage disabled — settings stay in memory for this session */
    }
    return this.settings;
  }

  resetSettings(): Settings {
    localStorage.removeItem(SETTINGS_KEY);
    this.settings = structuredClone(DEFAULT_SETTINGS);
    return this.settings;
  }

  hostNames(): string[] {
    return HOSTS.map((h) => h.hostname);
  }

  alertCountsBySeverity(): Record<string, number> {
    return this.world.alerts.reduce<Record<string, number>>((acc, a) => {
      acc[a.severity] = (acc[a.severity] ?? 0) + 1;
      return acc;
    }, {});
  }
}

function paginate<T>(items: T[], page: number, limit: number): Page<T> {
  const pages = Math.max(1, Math.ceil(items.length / limit));
  const safePage = Math.min(page, pages);
  return {
    items: items.slice((safePage - 1) * limit, safePage * limit),
    total: items.length,
    page: safePage,
    pages,
  };
}

export const store = new MockStore();

/** Factory defaults, used by api mode to restore settings over PUT /api/settings. */
export function defaultSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}
