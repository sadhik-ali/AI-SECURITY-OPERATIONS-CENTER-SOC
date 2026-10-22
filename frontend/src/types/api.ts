/**
 * Phase 1 type contract for the AI SOC platform.
 * Mirrors the FastAPI backend schema exactly so Phase 3 needs no reshaping.
 */

export type Severity = 'informational' | 'low' | 'high' | 'critical';
export type AlertStatus = 'new' | 'acknowledged' | 'investigating' | 'false_positive' | 'resolved';
export type IncidentStatus = 'new' | 'investigating' | 'resolved' | 'closed';
export type EventSource = 'wazuh' | 'linux_auth' | 'sysmon' | 'demo_generator';
export type UserRole = 'admin' | 'analyst';
export type TokenType = 'bearer';

/* ---------- auth ---------- */

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  preferred_timezone: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: TokenType;
  user: User;
}

/* ---------- dashboard ---------- */

export interface DashboardSummary {
  total_events: number;
  total_alerts: number;
  critical_alerts: number;
  high_alerts: number;
  open_incidents: number;
  investigating_incidents: number;
  resolved_incidents: number;
}

export interface TrendPoint {
  t: string;
  events: number;
  alerts: number;
}

export interface TrendSeries {
  points: TrendPoint[];
}

export interface TopSource {
  ip: string;
  events: number;
  alerts: number;
  max_severity: Severity;
}

export interface TopHost {
  hostname: string;
  events: number;
  alerts: number;
}

export interface TopSources {
  sources: TopSource[];
  hosts: TopHost[];
}

/* ---------- alerts ---------- */

export interface Alert {
  id: number;
  timestamp: string;
  severity: Severity;
  rule_name: string;
  src_ip: string | null;
  dst_ip: string | null;
  username: string | null;
  hostname: string | null;
  event_category: string;
  detection_reason: string;
  investigation_status: AlertStatus;
  incident_id: number | null;
  event_ids: number[];
  source: EventSource;
  demo: boolean;
}

/* ---------- events ---------- */

export interface SecurityEvent {
  id: number;
  timestamp: string;
  source: EventSource;
  event_type: string;
  hostname: string | null;
  username: string | null;
  src_ip: string | null;
  dst_ip: string | null;
  severity: Severity;
  raw: string;
  normalized: Record<string, unknown>;
  alert_id: number | null;
  incident_id: number | null;
  demo: boolean;
}

/* ---------- incidents ---------- */

export type TimelineEntryType =
  | 'detection'
  | 'alert'
  | 'event'
  | 'analyst'
  | 'status'
  | 'ai'
  | 'assignment';

export interface TimelineEntry {
  id: string;
  timestamp: string;
  actor: string;
  type: TimelineEntryType;
  title: string;
  detail: string;
  severity?: Severity;
  demo: boolean;
}

export interface AnalystNote {
  id: number;
  author: string;
  created_at: string;
  body: string;
  demo: boolean;
}

export interface ImplicatedEntity {
  kind: 'ip' | 'user' | 'host';
  value: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  note: string;
}

export interface Incident {
  id: number;
  reference: string;
  title: string;
  description: string;
  severity: Severity;
  status: IncidentStatus;
  risk_score: number;
  created_at: string;
  updated_at: string;
  assignee: string | null;
  alert_ids: number[];
  event_ids: number[];
  rules_triggered: string[];
  notes: AnalystNote[];
  ai: AiAnalysis | null;
  demo: boolean;
}

export interface IncidentCreateRequest {
  title: string;
  description: string;
  severity: Severity;
  alert_ids: number[];
  assignee?: string | null;
}

/* ---------- AI ---------- */

export interface AiAnalysis {
  summary: string;
  severity_assessment: string;
  evidence: string[];
  possible_explanations: string[];
  investigation_steps: string[];
  recommended_actions: string[];
  confidence: number;
  limitations: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AiChatRequest {
  incident_id?: number | null;
  message: string;
  history: ChatMessage[];
}

export interface AiChatResponse {
  reply: string;
  analysis: AiAnalysis | null;
  model: string;
  degraded: boolean;
}

export interface AnalyzeAlertRequest {
  alert_id: number;
}

export interface AnalyzeIncidentRequest {
  incident_id: number;
}

/* ---------- reports ---------- */

export type ReportSectionKey =
  | 'overview'
  | 'timeline'
  | 'evidence'
  | 'severity_risk'
  | 'rules_triggered'
  | 'ai_summary'
  | 'remediation'
  | 'analyst_notes';

export interface ReportSection {
  key: ReportSectionKey;
  title: string;
  content: string;
  rows?: Record<string, string | number>[];
}

export interface IncidentReport {
  incident_id: number;
  reference: string;
  title: string;
  generated_at: string;
  generated_by: string;
  sections: ReportSection[];
  demo: boolean;
}

/* ---------- settings ---------- */

export interface DetectionSettings {
  brute_force_threshold: number;
  brute_force_window_seconds: number;
  portscan_port_threshold: number;
  failed_login_alert_severity: Severity;
  min_ai_confidence: number;
}

export interface RetentionSettings {
  event_retention_days: number;
  alert_retention_days: number;
  incident_retention_days: number;
  raw_log_storage_mb: number;
}

export interface AiProviderSettings {
  provider: 'openai' | 'anthropic' | 'ollama' | 'disabled';
  model: string;
  temperature: number;
  max_output_tokens: number;
  api_key_masked: string;
  api_key_is_secret: boolean;
}

export interface WazuhSettings {
  enabled: boolean;
  manager_url: string;
  api_port: number;
  index_pattern: string;
  user: string;
  password_masked: string;
  password_is_secret: boolean;
  verify_ssl: boolean;
}

export interface OpenSearchSettings {
  enabled: boolean;
  hosts: string[];
  index_prefix: string;
  username: string;
  password_masked: string;
  password_is_secret: boolean;
  tls: boolean;
}

export interface ManagedUser {
  id: number;
  full_name: string;
  email: string;
  role: UserRole;
  status: 'active' | 'suspended';
  last_seen: string;
  demo: boolean;
}

export interface DemoGenerationSettings {
  enabled: boolean;
  events_per_minute: number;
  attack_chain_every_minutes: number;
  include_critical: boolean;
}

export interface Settings {
  detection: DetectionSettings;
  retention: RetentionSettings;
  ai: AiProviderSettings;
  wazuh: WazuhSettings;
  opensearch: OpenSearchSettings;
  users: ManagedUser[];
  demo: DemoGenerationSettings;
  timezone: string;
}

/* ---------- pagination & queries ---------- */

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

export interface AlertQuery {
  page?: number;
  limit?: number;
  severity?: Severity | 'all';
  start?: string;
  end?: string;
  src_ip?: string;
  host?: string;
  status?: AlertStatus | 'all';
  q?: string;
}

export type IncidentQuery = Pick<AlertQuery, 'page' | 'limit'> & {
  severity?: Severity | 'all';
  status?: IncidentStatus | 'all';
  q?: string;
};

export interface EventQuery {
  page?: number;
  limit?: number;
  q?: string;
  source?: EventSource | 'all';
  severity?: Severity | 'all';
  host?: string;
  username?: string;
  src_ip?: string;
  start?: string;
  end?: string;
  sort?: 'asc' | 'desc';
}

/* ---------- websocket ---------- */

export type WsFrameType = 'alert' | 'event' | 'incident_update';

export interface WsFrame {
  type: WsFrameType;
  data: Alert | SecurityEvent | Incident;
}
