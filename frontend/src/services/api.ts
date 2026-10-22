import axios, { type AxiosError, type AxiosInstance } from 'axios';
import type {
  AiAnalysis,
  AiChatRequest,
  AiChatResponse,
  Alert,
  AlertQuery,
  AlertStatus,
  DashboardSummary,
  EventQuery,
  EventSource,
  Incident,
  IncidentCreateRequest,
  IncidentQuery,
  IncidentReport,
  IncidentStatus,
  ImplicatedEntity,
  LoginResponse,
  Page,
  SecurityEvent,
  Settings,
  Severity,
  TimelineEntry,
  TopSources,
  TrendPoint,
  User,
  WsFrame,
} from '../types/api';
import { defaultSettings, store } from './mockStore';
import { DEMO_ANALYSTS } from '../data/fixtures';
import { analyzeIncident, chatReply, LOCAL_MODEL_LABEL } from './aiLocal';
import { DEMO_CREDENTIALS, getStoredUser, getToken } from './auth';

export type DataSource = 'mock' | 'api';

export const DATA_SOURCE: DataSource = import.meta.env.VITE_DATA_SOURCE === 'api' ? 'api' : 'mock';
export const IS_MOCK = DATA_SOURCE === 'mock';

/** Simulated round-trip so mock mode exercises real loading states. */
const MOCK_LATENCY_MS = 160;

let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(fn: () => void): void {
  unauthorizedHandler = fn;
}

export const http: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 15000,
});

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) unauthorizedHandler?.();
    return Promise.reject(error);
  },
);

function mock<T>(resolve: () => T, latency = MOCK_LATENCY_MS): Promise<T> {
  return new Promise((innerResolve) => {
    window.setTimeout(() => innerResolve(resolve()), latency);
  });
}

function fail(message: string, code = 503): never {
  const error = new Error(message) as Error & { code: number };
  error.code = code;
  throw error;
}

function apiError(error: unknown): never {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail ?? error.message;
    fail(detail, error.response?.status ?? 500);
  }
  fail(error instanceof Error ? error.message : 'Request failed');
}

/** Unwraps a non-null field or raises a typed error the UI can render. */
function required<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) fail(`${what} was not found`, 404);
  return value;
}

/* ------------------------------- auth ------------------------------- */

export async function login(email: string, password: string): Promise<LoginResponse> {
  if (IS_MOCK) {
    return mock(() => {
      const match = DEMO_CREDENTIALS.find((c) => c.email.toLowerCase() === email.trim().toLowerCase());
      if (!match || match.password !== password) {
        fail(
          'Invalid credentials. Phase 1 demo sign-in accepts only the seeded analyst or admin identity with password SocDemo!23.',
          401,
        );
      }
      return {
        access_token: `demo-jwt.${match.role}.${Date.now().toString(36)}`,
        token_type: 'bearer' as const,
        user: {
          id: match.role === 'admin' ? 2 : 1,
          email: match.email,
          full_name: match.full_name,
          role: match.role,
          preferred_timezone: store.settings.timezone,
        },
      };
    }, 420);
  }
  try {
    const { data } = await http.post<LoginResponse>('/auth/login', { email, password });
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function me(): Promise<User> {
  if (IS_MOCK) {
    return mock(
      () =>
        required(
          getStoredUser() ?? {
            id: 1,
            email: 'analyst@aisoc.dev',
            full_name: 'Adnan Sardhi',
            role: 'analyst' as const,
            preferred_timezone: store.settings.timezone,
          },
          'Session',
        ),
    );
  }
  try {
    const { data } = await http.get<User>('/auth/me');
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function logout(): Promise<void> {
  if (IS_MOCK) {
    return mock(() => undefined, 60);
  }
  try {
    await http.post('/auth/logout');
  } catch (error) {
    apiError(error);
  }
}

/* ------------------------------ dashboard ------------------------------ */

export async function dashboardSummary(): Promise<DashboardSummary> {
  if (IS_MOCK) return mock(() => store.summary());
  try {
    const { data } = await http.get<DashboardSummary>('/dashboard/summary');
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function dashboardTrends(hours = 24): Promise<TrendPoint[]> {
  if (IS_MOCK) return mock(() => store.trends(hours));
  try {
    const { data } = await http.get<{ points: TrendPoint[] }>('/dashboard/trends', { params: { hours } });
    return data.points;
  } catch (error) {
    return apiError(error);
  }
}

export async function dashboardTopSources(limit = 10): Promise<TopSources> {
  if (IS_MOCK) return mock(() => store.topSources(limit));
  try {
    const { data } = await http.get<TopSources>('/dashboard/top-sources', { params: { limit } });
    return data;
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Severity split for the donut. The contract has no dedicated endpoint, so api mode
 * derives it from the alerts list exactly as the UI would with a paginated table.
 */
export async function severityDistribution(): Promise<{ severity: Severity; count: number }[]> {
  if (IS_MOCK) return mock(() => store.severityDistribution());
  try {
    const { data } = await http.get<Page<Alert>>('/alerts', { params: { page: 1, limit: 200 } });
    const counts = new Map<Severity, number>();
    for (const a of data.items) counts.set(a.severity, (counts.get(a.severity) ?? 0) + 1);
    return (['critical', 'high', 'low', 'informational'] as Severity[]).map((severity) => ({ severity, count: counts.get(severity) ?? 0 }));
  } catch (error) {
    return apiError(error);
  }
}

/* -------------------------------- alerts -------------------------------- */

export async function listAlerts(query: AlertQuery): Promise<Page<Alert>> {
  if (IS_MOCK) return mock(() => store.queryAlerts(query));
  try {
    const { data } = await http.get<Page<Alert>>('/alerts', { params: query });
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function getAlert(id: number): Promise<Alert> {
  if (IS_MOCK) return mock(() => required(store.alertById(id), `Alert ${id}`));
  try {
    const { data } = await http.get<Alert>(`/alerts/${id}`);
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function patchAlert(id: number, status: AlertStatus): Promise<Alert> {
  if (IS_MOCK) return mock(() => store.patchAlert(id, status));
  try {
    const { data } = await http.patch<Alert>(`/alerts/${id}`, { status });
    return data;
  } catch (error) {
    return apiError(error);
  }
}

/* ------------------------------- incidents ------------------------------- */

export async function listIncidents(query: IncidentQuery): Promise<Page<Incident>> {
  if (IS_MOCK) return mock(() => store.queryIncidents(query));
  try {
    const { data } = await http.get<Page<Incident>>('/incidents', { params: query });
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function createIncident(payload: IncidentCreateRequest, author: string): Promise<Incident> {
  if (IS_MOCK) return mock(() => store.createIncident(payload, author));
  try {
    const { data } = await http.post<Incident>('/incidents', payload);
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function getIncident(id: number): Promise<Incident> {
  if (IS_MOCK) return mock(() => required(store.incidentById(id), `Incident ${id}`));
  try {
    const { data } = await http.get<Incident>(`/incidents/${id}`);
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function patchIncident(
  id: number,
  patch: { status?: IncidentStatus; assignee?: string | null; severity?: Severity },
): Promise<Incident> {
  if (IS_MOCK) return mock(() => store.patchIncident(id, patch));
  try {
    const { data } = await http.patch<Incident>(`/incidents/${id}`, patch);
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function addIncidentNote(id: number, body: string, author: string): Promise<void> {
  if (IS_MOCK) {
    return mock(() => {
      store.addNote(id, body, author);
    });
  }
  try {
    await http.post(`/incidents/${id}/notes`, { body });
  } catch (error) {
    apiError(error);
  }
}

export async function incidentTimeline(id: number): Promise<TimelineEntry[]> {
  if (IS_MOCK) return mock(() => store.timeline(id));
  try {
    const { data } = await http.get<{ items: TimelineEntry[] }>(`/incidents/${id}/timeline`);
    return data.items;
  } catch (error) {
    return apiError(error);
  }
}

export async function incidentReport(id: number, author: string): Promise<IncidentReport> {
  if (IS_MOCK) return mock(() => required(store.report(id, author), 'Incident'));
  try {
    const { data } = await http.get<IncidentReport>(`/incidents/${id}/report`);
    return data;
  } catch (error) {
    return apiError(error);
  }
}

/** Detail view helpers. api mode reads the event list filtered to the incident. */
export async function incidentEvents(id: number): Promise<SecurityEvent[]> {
  if (IS_MOCK) return mock(() => store.incidentEvents(required(store.incidentById(id), 'Incident')));
  try {
    const { data } = await http.get<Page<SecurityEvent>>('/events', { params: { incident_id: id, page: 1, limit: 200 } });
    return data.items;
  } catch (error) {
    return apiError(error);
  }
}

export async function alertsForIncident(id: number): Promise<Alert[]> {
  if (IS_MOCK) return mock(() => store.incidentAlerts(required(store.incidentById(id), 'Incident')));
  try {
    const { data } = await http.get<Page<Alert>>('/alerts', { params: { incident_id: id, page: 1, limit: 200 } });
    return data.items;
  } catch (error) {
    return apiError(error);
  }
}

/* --------------------------------- events --------------------------------- */

export async function listEvents(query: EventQuery): Promise<Page<SecurityEvent>> {
  if (IS_MOCK) return mock(() => store.queryEvents(query));
  try {
    const { data } = await http.get<Page<SecurityEvent>>('/events', { params: query });
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function getEvent(id: number): Promise<SecurityEvent> {
  if (IS_MOCK) return mock(() => required(store.eventById(id), `Event ${id}`));
  try {
    const { data } = await http.get<SecurityEvent>(`/events/${id}`);
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function ingestEvent(raw: string, source: EventSource, hostname: string): Promise<SecurityEvent> {
  if (IS_MOCK) return mock(() => store.ingest(raw, source, hostname));
  try {
    const { data } = await http.post<SecurityEvent>('/events/ingest', { raw, source, hostname });
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function alertEvents(id: number): Promise<SecurityEvent[]> {
  if (IS_MOCK) return mock(() => store.eventsForAlert(id));
  try {
    const { data } = await http.get<Page<SecurityEvent>>('/events', { params: { alert_id: id, page: 1, limit: 100 } });
    return data.items;
  } catch (error) {
    return apiError(error);
  }
}

/* ----------------------------------- ai ----------------------------------- */

export interface AiChatOptions {
  /** Drives the "model unavailable" state demo. Ignored when talking to the backend. */
  simulateOutage?: boolean;
}

export async function aiAnalyzeAlert(alertId: number): Promise<AiAnalysis> {
  if (IS_MOCK) return mock(() => store.analyzeAlertById(alertId), 520);
  try {
    const { data } = await http.post<AiAnalysis>('/ai/analyze-alert', { alert_id: alertId });
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function aiAnalyzeIncident(incidentId: number): Promise<AiAnalysis> {
  if (IS_MOCK) {
    return mock(() => {
      const inc = required(store.incidentById(incidentId), 'Incident');
      return analyzeIncident(inc, store.incidentAlerts(inc), store.incidentEvents(inc));
    }, 520);
  }
  try {
    const { data } = await http.post<AiAnalysis>('/ai/analyze-incident', { incident_id: incidentId });
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function aiChat(request: AiChatRequest, options: AiChatOptions = {}): Promise<AiChatResponse> {
  if (IS_MOCK) {
    if (options.simulateOutage || store.settings.ai.provider === 'disabled') {
      return mock(() => {
        fail('AI provider unreachable — the configured backend did not answer within 10s. Falling back to rule-based triage.', 503);
      }, 700);
    }
    return mock(() => {
      const incident = request.incident_id != null ? store.incidentById(request.incident_id) ?? null : null;
      const alerts = incident ? store.incidentAlerts(incident) : [];
      const events = incident ? store.incidentEvents(incident) : [];
      const response = chatReply(request.message, { incident, alerts, events }, request.history);
      return { ...response, model: LOCAL_MODEL_LABEL };
    }, 620);
  }
  try {
    const { data } = await http.post<AiChatResponse>('/ai/chat', request);
    return data;
  } catch (error) {
    return apiError(error);
  }
}

/* -------------------------------- settings -------------------------------- */

export async function getSettings(): Promise<Settings> {
  if (IS_MOCK) return mock(() => store.settings);
  try {
    const { data } = await http.get<Settings>('/settings');
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function putSettings(patch: Partial<Settings>): Promise<Settings> {
  if (IS_MOCK) return mock(() => store.updateSettings(patch), 260);
  try {
    const { data } = await http.put<Settings>('/settings', patch);
    return data;
  } catch (error) {
    return apiError(error);
  }
}

export async function resetSettings(): Promise<Settings> {
  if (IS_MOCK) return mock(() => store.resetSettings(), 260);
  try {
    const { data } = await http.put<Settings>('/settings', defaultSettings());
    return data;
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Immediately injects one synthetic detection into the sample feed so the Settings
 * page can prove the demo-generator controls work. Only meaningful in mock mode.
 */
export async function generateDemoBurst(): Promise<WsFrame[]> {
  if (!IS_MOCK) fail('The bundled demo generator is inactive when VITE_DATA_SOURCE=api — telemetry comes from the backend scheduler.', 409);
  return mock(() => store.tickLive(), 90);
}

/* ------------------------------ live feed data ------------------------------ */

export interface IncidentEntities {
  ips: ImplicatedEntity[];
  users: ImplicatedEntity[];
  hosts: ImplicatedEntity[];
}

/**
 * Entity roll-up for the investigation page. No dedicated endpoint exists in the contract,
 * so api mode derives it from the incident's event list; mock mode uses the store's richer index.
 */
export async function incidentEntities(id: number): Promise<IncidentEntities> {
  if (IS_MOCK) return mock(() => store.implicated(id));
  const events = await incidentEvents(id);
  return {
    ips: aggregate(events, (e) => e.src_ip, (value) => (value.startsWith('10.') ? 'Internal asset' : 'External source')),
    users: aggregate(events, (e) => e.username, () => 'Seen in correlated events'),
    hosts: aggregate(events, (e) => e.hostname, () => 'Affected asset'),
  };
}

function aggregate(
  events: SecurityEvent[],
  key: (event: SecurityEvent) => string | null,
  note: (value: string) => string,
): ImplicatedEntity[] {
  const map = new Map<string, { count: number; first: number; last: number }>();
  for (const event of events) {
    const value = key(event);
    if (!value) continue;
    const ts = Date.parse(event.timestamp);
    const current = map.get(value) ?? { count: 0, first: ts, last: ts };
    current.count += 1;
    current.first = Math.min(current.first, ts);
    current.last = Math.max(current.last, ts);
    map.set(value, current);
  }
  return [...map.entries()]
    .map(([value, v]) => ({
      kind: 'ip' as const,
      value,
      occurrences: v.count,
      first_seen: new Date(v.first).toISOString(),
      last_seen: new Date(v.last).toISOString(),
      note: note(value),
    }))
    .sort((a, b) => b.occurrences - a.occurrences);
}

/** Analyst roster used by the assignment control. Phase 2 replaces this with the user directory. */
export function analystDirectory(): string[] {
  return DEMO_ANALYSTS.filter((a) => a !== 'unassigned');
}

export function sampleHostNames(): string[] {
  return store.hostNames();
}

/** Current sample-feed cadence in ms (0 when running against the backend). */
export function demoCadenceMs(): number {
  return IS_MOCK ? store.feedIntervalMs() : 0;
}
