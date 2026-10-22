import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  Database,
  Gauge,
  KeyRound,
  Lock,
  Radio,
  RotateCcw,
  Save,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Wrench,
} from 'lucide-react';
import type { AiProviderSettings, ManagedUser, Settings, UserRole } from '../types/api';
import { DATA_SOURCE, demoCadenceMs, generateDemoBurst, getSettings, putSettings, resetSettings } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../context/AuthContext';
import { useLive } from '../context/LiveContext';
import {
  Button,
  DemoBadge,
  EmptyState,
  ErrorState,
  InlineNote,
  Panel,
  Select,
  SkeletonRows,
  TextField,
  Toggle,
} from '../components/ui';
import { SEVERITIES, SEVERITY_TOKENS, errorText, formatBytes, stamp } from '../lib/format';

const AI_MODELS: Record<AiProviderSettings['provider'], string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4.1', 'o4-mini'],
  anthropic: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
  ollama: ['llama3.1:8b-instruct', 'qwen2.5:14b', 'phi4:latest'],
  disabled: ['none'],
};

const TIMEZONES = ['Asia/Karachi', 'UTC', 'Europe/London', 'America/New_York', 'Asia/Singapore'];

const maskOf = (secret: string) => `••••••••••••${secret.slice(-4)}`;
const toNumber = (value: string, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

function SecretField({
  label,
  masked,
  disabled,
  value,
  onChange,
}: {
  label: string;
  masked: string;
  disabled: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-soc-800 bg-soc-950/60 px-3 py-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-soc-400">
          <Lock className="size-3" /> {label}
          <span className="ml-auto rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">admin only</span>
        </p>
        <p className="mt-1 font-mono text-sm text-soc-300">{masked}</p>
        <p className="mt-1 text-[11px] text-soc-500">The plaintext value is never sent to the browser; only a mask is stored here.</p>
      </div>
      <TextField
        label="Replace credential"
        type="password"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="paste new secret to rotate"
        hint="Saved as a new mask; the raw string is dropped after this request."
      />
    </div>
  );
}

export function SettingsPage() {
  const { isAdmin, user } = useAuth();
  const { refresh } = useLive();
  const state = useAsync(() => getSettings(), [], { silent: true });

  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [secrets, setSecrets] = useState({ ai: '', wazuh: '', opensearch: '' });
  const [newUser, setNewUser] = useState({ full_name: '', email: '', role: 'analyst' as UserRole });

  useEffect(() => {
    if (state.data && !saved) {
      setSaved(state.data);
      setDraft(structuredClone(state.data));
    }
  }, [state.data, saved]);

  const corpus = useAsync(
    async () => {
      const page = await import('../services/api').then((m) => m.listEvents({ page: 1, limit: 500 }));
      const bytes = page.items.reduce((sum, e) => sum + e.raw.length, 0);
      return { sampled: page.items.length, total: page.total, bytesPerEvent: bytes / Math.max(1, page.items.length) };
    },
    [],
    { silent: true },
  );

  const patch = (fn: (s: Settings) => void) =>
    setDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });

  const save = async (key: string, part: Partial<Settings>) => {
    if (!draft) return;
    setSaving(key);
    setProblem(null);
    try {
      const next = await putSettings(part);
      setSaved(next);
      setDraft(structuredClone(next));
      setSecrets({ ai: '', wazuh: '', opensearch: '' });
      setNotice(`${key} updated and persisted to this browser profile.`);
      refresh();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setSaving(null);
    }
  };

  const dirty = useMemo(() => {
    if (!draft || !saved) return {} as Record<string, boolean>;
    return {
      Detection: JSON.stringify(draft.detection) !== JSON.stringify(saved.detection),
      Retention: JSON.stringify(draft.retention) !== JSON.stringify(saved.retention),
      'AI provider': JSON.stringify(draft.ai) !== JSON.stringify(saved.ai) || secrets.ai.length > 0,
      Wazuh: JSON.stringify(draft.wazuh) !== JSON.stringify(saved.wazuh) || secrets.wazuh.length > 0,
      OpenSearch: JSON.stringify(draft.opensearch) !== JSON.stringify(saved.opensearch) || secrets.opensearch.length > 0,
      'Demo generator': JSON.stringify(draft.demo) !== JSON.stringify(saved.demo),
      'Users & roles': JSON.stringify(draft.users) !== JSON.stringify(saved.users),
    };
  }, [draft, saved, secrets]);

  if (state.error) {
    return (
      <Panel title="Settings" icon={<SettingsIcon className="size-4" />}>
        <ErrorState message={state.error} onRetry={state.reload} />
      </Panel>
    );
  }
  if (!draft) {
    return (
      <div className="space-y-4">
        <Panel title="Settings" icon={<SettingsIcon className="size-4" />}>
          <SkeletonRows rows={8} />
        </Panel>
      </div>
    );
  }

  const locked = !isAdmin;
  const eventsPerMinute = draft.demo.events_per_minute;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-soc-100">
            <SettingsIcon className="size-5 text-accent" />
            Settings
          </h1>
          <p className="mt-0.5 text-sm text-soc-400">
            Data source <span className="font-mono text-soc-200">{DATA_SOURCE}</span> · signed in as{' '}
            <span className="font-mono text-soc-200">{user?.email ?? '—'}</span> ({user?.role ?? 'unknown'})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DemoBadge />
          <Button
            size="sm"
            icon={<RotateCcw className="size-3.5" />}
            busy={saving === 'reset'}
            onClick={async () => {
              setSaving('reset');
              try {
                const next = await resetSettings();
                setSaved(next);
                setDraft(structuredClone(next));
                setNotice('All settings restored to the shipped defaults.');
                refresh();
              } catch (error) {
                setProblem(errorText(error));
              } finally {
                setSaving(null);
              }
            }}
          >
            Restore defaults
          </Button>
        </div>
      </header>

      {locked && (
        <InlineNote tone="warn">
          Read-only: integrations, credentials and the user directory require the <span className="font-mono">admin</span> role. Sign in as{' '}
          <span className="font-mono">admin@aisoc.dev</span> to edit them. Detection and retention are analyst-editable.
        </InlineNote>
      )}
      {notice && <InlineNote>{notice}</InlineNote>}
      {problem && <InlineNote tone="warn">{problem}</InlineNote>}

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel
          title="Detection thresholds"
          subtitle="Applied by the correlation engine; analyst-editable"
          icon={<Gauge className="size-4" />}
          bodyClassName="p-4 space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Failed SSH attempts before alert"
              type="number"
              min={3}
              max={200}
              value={draft.detection.brute_force_threshold}
              onChange={(e) => patch((s) => void (s.detection.brute_force_threshold = Math.max(3, toNumber(e.target.value, 3))))}
            />
            <TextField
              label="Detection window (seconds)"
              type="number"
              min={60}
              step={60}
              value={draft.detection.brute_force_window_seconds}
              onChange={(e) => patch((s) => void (s.detection.brute_force_window_seconds = Math.max(60, toNumber(e.target.value, 60))))}
            />
            <TextField
              label="Distinct ports = port scan"
              type="number"
              min={5}
              value={draft.detection.portscan_port_threshold}
              onChange={(e) => patch((s) => void (s.detection.portscan_port_threshold = Math.max(5, toNumber(e.target.value, 5))))}
            />
            <Select
              label="Failed-login alert severity"
              value={draft.detection.failed_login_alert_severity}
              onChange={(e) => patch((s) => void (s.detection.failed_login_alert_severity = e.target.value as Settings['detection']['failed_login_alert_severity']))}
              options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_TOKENS[s].label }))}
            />
            <TextField
              label="Minimum AI confidence"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={draft.detection.min_ai_confidence}
              onChange={(e) => patch((s) => void (s.detection.min_ai_confidence = Math.min(1, Math.max(0, toNumber(e.target.value, 0)))))}
              hint="Analysis below this score is labelled a hypothesis, never a conclusion."
            />
          </div>
          <SaveRow label="Detection thresholds" dirty={dirty.Detection} saving={saving === 'Detection thresholds'} disabled={!dirty.Detection} onSave={() => save('Detection thresholds', { detection: draft.detection })} />
        </Panel>

        <Panel
          title="Retention and storage"
          subtitle="How long the platform keeps telemetry before pruning"
          icon={<Database className="size-4" />}
          bodyClassName="p-4 space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Event retention (days)"
              type="number"
              min={7}
              value={draft.retention.event_retention_days}
              onChange={(e) => patch((s) => void (s.retention.event_retention_days = Math.max(7, toNumber(e.target.value, 7))))}
            />
            <TextField
              label="Alert retention (days)"
              type="number"
              min={7}
              value={draft.retention.alert_retention_days}
              onChange={(e) => patch((s) => void (s.retention.alert_retention_days = Math.max(7, toNumber(e.target.value, 7))))}
            />
            <TextField
              label="Incident retention (days)"
              type="number"
              min={30}
              value={draft.retention.incident_retention_days}
              onChange={(e) => patch((s) => void (s.retention.incident_retention_days = Math.max(30, toNumber(e.target.value, 30))))}
            />
            <TextField
              label="Raw log ceiling (MB)"
              type="number"
              min={512}
              step={512}
              value={draft.retention.raw_log_storage_mb}
              onChange={(e) => patch((s) => void (s.retention.raw_log_storage_mb = Math.max(512, toNumber(e.target.value, 512))))}
            />
          </div>
          <div className="rounded-md border border-soc-800 bg-soc-950/60 p-3 text-xs text-soc-300">
            <p className="mb-1 font-semibold uppercase tracking-wider text-soc-400">Current corpus</p>
            {corpus.data ? (
              <p>
                <span className="tabular-nums text-soc-100">{corpus.data.total.toLocaleString()}</span> events retained ·{' '}
                <span className="tabular-nums text-soc-100">{formatBytes(corpus.data.bytesPerEvent)}</span> mean raw size · estimated{' '}
                <span className="tabular-nums text-soc-100">{formatBytes(corpus.data.total * corpus.data.bytesPerEvent)}</span> against a{' '}
                <span className="tabular-nums text-soc-100">{draft.retention.raw_log_storage_mb.toLocaleString()} MB</span> ceiling.
              </p>
            ) : (
              <p>Measuring raw payload sizes…</p>
            )}
          </div>
          <SaveRow label="Retention and storage" dirty={dirty.Retention} saving={saving === 'Retention and storage'} disabled={!dirty.Retention} onSave={() => save('Retention and storage', { retention: draft.retention })} />
        </Panel>

        <Panel
          title="AI assistant provider"
          subtitle="Phase 1 answers come from the bundled deterministic responder"
          icon={<Bot className="size-4" />}
          bodyClassName="p-4 space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Provider"
              value={draft.ai.provider}
              onChange={(e) =>
                patch((s) => {
                  s.ai.provider = e.target.value as AiProviderSettings['provider'];
                  s.ai.model = AI_MODELS[s.ai.provider][0];
                })
              }
              options={[
                { value: 'ollama', label: 'Ollama (self-hosted)' },
                { value: 'openai', label: 'OpenAI' },
                { value: 'anthropic', label: 'Anthropic' },
                { value: 'disabled', label: 'Disabled — force outage demo' },
              ]}
            />
            <Select
              label="Model"
              value={draft.ai.model}
              onChange={(e) => patch((s) => void (s.ai.model = e.target.value))}
              options={AI_MODELS[draft.ai.provider].map((m) => ({ value: m, label: m }))}
            />
            <TextField
              label="Temperature"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={draft.ai.temperature}
              onChange={(e) => patch((s) => void (s.ai.temperature = Math.min(1, Math.max(0, toNumber(e.target.value, 0)))))}
            />
            <TextField
              label="Max output tokens"
              type="number"
              min={256}
              step={128}
              value={draft.ai.max_output_tokens}
              onChange={(e) => patch((s) => void (s.ai.max_output_tokens = Math.max(256, toNumber(e.target.value, 256))))}
            />
          </div>
          <SecretField
            label="Provider API key"
            masked={draft.ai.api_key_masked}
            disabled={locked}
            value={secrets.ai}
            onChange={(v) => setSecrets((p) => ({ ...p, ai: v }))}
          />
          {draft.ai.provider === 'disabled' && (
            <InlineNote tone="warn">
              With the provider disabled the assistant returns its documented outage state.{' '}
              <Link to="/assistant" className="text-accent hover:underline">
                Try it in the assistant
              </Link>
              .
            </InlineNote>
          )}
          <SaveRow
            label="AI provider"
            dirty={Boolean(dirty['AI provider'])}
            saving={saving === 'AI provider'}
            disabled={!dirty['AI provider']}
            onSave={() =>
              save('AI provider', {
                ai: { ...draft.ai, api_key_masked: secrets.ai ? maskOf(secrets.ai) : draft.ai.api_key_masked },
              })
            }
          />
        </Panel>

        <Panel
          title="Wazuh integration"
          subtitle="Manager API and alert index pattern"
          icon={<ShieldCheck className="size-4" />}
          bodyClassName="p-4 space-y-4"
        >
          <Toggle
            label="Index Wazuh alerts"
            hint={locked ? 'Enabled — read-only for analysts' : 'Turns the Wazuh source feed on or off'}
            checked={draft.wazuh.enabled}
            onChange={(v) => !locked && patch((s) => void (s.wazuh.enabled = v))}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Manager URL"
              value={draft.wazuh.manager_url}
              disabled={locked}
              onChange={(e) => patch((s) => void (s.wazuh.manager_url = e.target.value))}
            />
            <TextField
              label="API port"
              type="number"
              value={draft.wazuh.api_port}
              disabled={locked}
              onChange={(e) => patch((s) => void (s.wazuh.api_port = toNumber(e.target.value, 55000)))}
            />
            <TextField
              label="Index pattern"
              value={draft.wazuh.index_pattern}
              disabled={locked}
              onChange={(e) => patch((s) => void (s.wazuh.index_pattern = e.target.value))}
            />
            <TextField
              label="API user"
              value={draft.wazuh.user}
              disabled={locked}
              onChange={(e) => patch((s) => void (s.wazuh.user = e.target.value))}
            />
          </div>
          <Toggle
            label="Verify manager TLS"
            hint={
              draft.wazuh.verify_ssl
                ? 'Certificate chain must validate.'
                : 'Currently off — this demo trusts an internal CA instead of disabling verification in the client.'
            }
            checked={draft.wazuh.verify_ssl}
            onChange={(v) => !locked && patch((s) => void (s.wazuh.verify_ssl = v))}
          />
          <SecretField
            label="Wazuh password"
            masked={draft.wazuh.password_masked}
            disabled={locked}
            value={secrets.wazuh}
            onChange={(v) => setSecrets((p) => ({ ...p, wazuh: v }))}
          />
          <SaveRow
            label="Wazuh"
            dirty={Boolean(dirty.Wazuh)}
            saving={saving === 'Wazuh'}
            disabled={!dirty.Wazuh || locked}
            onSave={() =>
              save('Wazuh', { wazuh: { ...draft.wazuh, password_masked: secrets.wazuh ? maskOf(secrets.wazuh) : draft.wazuh.password_masked } })
            }
          />
        </Panel>

        <Panel
          title="OpenSearch integration"
          subtitle="Searchable sink for normalised events"
          icon={<ScrollText className="size-4" />}
          bodyClassName="p-4 space-y-4"
        >
          <Toggle
            label="Write to OpenSearch"
            hint={locked ? 'Enabled — read-only for analysts' : 'Controls the log pipeline sink'}
            checked={draft.opensearch.enabled}
            onChange={(v) => !locked && patch((s) => void (s.opensearch.enabled = v))}
          />
          <TextField
            label="Hosts (comma separated)"
            value={draft.opensearch.hosts.join(', ')}
            disabled={locked}
            onChange={(e) => patch((s) => void (s.opensearch.hosts = e.target.value.split(',').map((h) => h.trim()).filter(Boolean)))}
            hint={draft.opensearch.hosts.length > 0 ? `${draft.opensearch.hosts.length} endpoint(s) configured` : 'Add at least one endpoint'}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Index prefix"
              value={draft.opensearch.index_prefix}
              disabled={locked}
              onChange={(e) => patch((s) => void (s.opensearch.index_prefix = e.target.value))}
            />
            <TextField
              label="Username"
              value={draft.opensearch.username}
              disabled={locked}
              onChange={(e) => patch((s) => void (s.opensearch.username = e.target.value))}
            />
          </div>
          <Toggle label="TLS" checked={draft.opensearch.tls} onChange={(v) => !locked && patch((s) => void (s.opensearch.tls = v))} />
          <SecretField
            label="OpenSearch password"
            masked={draft.opensearch.password_masked}
            disabled={locked}
            value={secrets.opensearch}
            onChange={(v) => setSecrets((p) => ({ ...p, opensearch: v }))}
          />
          <SaveRow
            label="OpenSearch"
            dirty={Boolean(dirty.OpenSearch)}
            saving={saving === 'OpenSearch'}
            disabled={!dirty.OpenSearch || locked}
            onSave={() =>
              save('OpenSearch', {
                opensearch: {
                  ...draft.opensearch,
                  password_masked: secrets.opensearch ? maskOf(secrets.opensearch) : draft.opensearch.password_masked,
                },
              })
            }
          />
        </Panel>

        <Panel
          title="Demo event generation"
          subtitle="Drives the live sample feed running in this browser"
          icon={<Radio className="size-4" />}
          bodyClassName="p-4 space-y-4"
        >
          {DATA_SOURCE === 'api' ? (
            <InlineNote tone="warn">
              Running against the backend, so these values are shipped to the server-side scheduler and the in-browser generator is inactive.
            </InlineNote>
          ) : (
            <>
              <Toggle
                label="Generate synthetic detections"
                hint={draft.demo.enabled ? 'The live queue is receiving frames.' : 'Live feed is idle — nothing is emitted.'}
                checked={draft.demo.enabled}
                onChange={(v) => patch((s) => void (s.demo.enabled = v))}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Events per minute"
                  type="number"
                  min={1}
                  max={60}
                  value={eventsPerMinute}
                  onChange={(e) => patch((s) => void (s.demo.events_per_minute = Math.min(60, Math.max(1, toNumber(e.target.value, 1)))))}
                  hint={`Next detection lands roughly every ${(demoCadenceMs() / 1000).toFixed(1)}s`}
                />
                <TextField
                  label="Attack chain every (minutes)"
                  type="number"
                  min={1}
                  max={120}
                  value={draft.demo.attack_chain_every_minutes}
                  onChange={(e) => patch((s) => void (s.demo.attack_chain_every_minutes = Math.max(1, toNumber(e.target.value, 1))))}
                />
              </div>
              <Toggle
                label="Escalate chains to critical"
                hint="Adds the MITRE ATT&CK tag on emitted detections."
                checked={draft.demo.include_critical}
                onChange={(v) => patch((s) => void (s.demo.include_critical = v))}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  icon={<Sparkles className="size-3.5" />}
                  busy={saving === 'burst'}
                  disabled={!draft.demo.enabled}
                  onClick={async () => {
                    setSaving('burst');
                    try {
                      const frames = await generateDemoBurst();
                      setNotice(
                        frames.length
                          ? `Injected ${frames.length} frame(s) into the live feed — check the alerts queue.`
                          : 'Generator is disabled, nothing was injected.',
                      );
                      refresh();
                    } catch (error) {
                      setProblem(errorText(error));
                    } finally {
                      setSaving(null);
                    }
                  }}
                >
                  Generate one detection now
                </Button>
                <Link to="/alerts" className="btn-ghost btn-sm inline-flex items-center gap-1.5">
                  Watch the queue
                </Link>
              </div>
            </>
          )}
          <SaveRow
            label="Demo generator"
            dirty={Boolean(dirty['Demo generator'])}
            saving={saving === 'Demo generator'}
            disabled={!dirty['Demo generator']}
            onSave={() => save('Demo generator', { demo: draft.demo })}
          />
        </Panel>
      </div>

      <Panel
        title="Users and roles"
        subtitle={locked ? 'Visible to analysts, editable by admins' : 'Role and status changes persist to this profile'}
        icon={<Users className="size-4" />}
        actions={<span className="chip">{draft.users.length} accounts</span>}
        flush
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="th">Analyst</th>
                <th className="th">Email</th>
                <th className="th">Role</th>
                <th className="th">Status</th>
                <th className="th">Last seen</th>
                <th className="th">Remove</th>
              </tr>
            </thead>
            <tbody>
              {draft.users.map((row) => {
                const self = row.email.toLowerCase() === (user?.email ?? '').toLowerCase();
                return (
                  <tr key={row.id} className="row-hover">
                    <td className="td">
                      {row.full_name}
                      {self && <span className="ml-2 chip">you</span>}
                      {row.demo && <span className="ml-2 chip text-accent">demo</span>}
                    </td>
                    <td className="td font-mono text-xs text-soc-300">{row.email}</td>
                    <td className="td">
                      <select
                        className="field h-8 w-32 bg-soc-900 text-xs"
                        disabled={locked || self}
                        value={row.role}
                        onChange={(e) =>
                          patch((s) => {
                            const target = s.users.find((u) => u.id === row.id);
                            if (target) target.role = e.target.value as UserRole;
                          })
                        }
                      >
                        <option value="analyst">analyst</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="td">
                      <button
                        type="button"
                        disabled={locked || self}
                        onClick={() =>
                          patch((s) => {
                            const target = s.users.find((u) => u.id === row.id);
                            if (target) target.status = target.status === 'active' ? 'suspended' : 'active';
                          })
                        }
                        className={`pill ${
                          row.status === 'active' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-slate-500/40 bg-slate-500/10 text-slate-300'
                        } disabled:opacity-50`}
                      >
                        {row.status}
                      </button>
                    </td>
                    <td className="td whitespace-nowrap text-xs text-soc-400">{stamp(row.last_seen)}</td>
                    <td className="td">
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={locked || self}
                        onClick={() => patch((s) => void (s.users = s.users.filter((u) => u.id !== row.id)))}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!draft.users.length && <EmptyState title="No accounts" message="Add at least one analyst before saving." />}
        </div>

        <div className="grid gap-3 border-t border-soc-800 p-4 sm:grid-cols-[1fr_1fr_auto_auto]">
          <TextField
            label="Full name"
            value={newUser.full_name}
            disabled={locked}
            onChange={(e) => setNewUser((p) => ({ ...p, full_name: e.target.value }))}
            placeholder="Priya Raman"
          />
          <TextField
            label="Email"
            value={newUser.email}
            disabled={locked}
            onChange={(e) => setNewUser((p) => ({ ...p, email: e.target.value }))}
            placeholder="p.raman@aisoc.dev"
          />
          <Select
            label="Role"
            value={newUser.role}
            disabled={locked}
            onChange={(e) => setNewUser((p) => ({ ...p, role: e.target.value as UserRole }))}
            options={[
              { value: 'analyst', label: 'analyst' },
              { value: 'admin', label: 'admin' },
            ]}
          />
          <div className="flex items-end">
            <Button
              size="sm"
              icon={<UserPlus className="size-3.5" />}
              disabled={locked || !newUser.full_name.trim() || !/^\S+@\S+\.\S+$/.test(newUser.email)}
              onClick={() => {
                const row: ManagedUser = {
                  id: Math.max(0, ...draft.users.map((u) => u.id)) + 1,
                  full_name: newUser.full_name.trim(),
                  email: newUser.email.trim().toLowerCase(),
                  role: newUser.role,
                  status: 'active',
                  last_seen: new Date().toISOString(),
                  demo: true,
                };
                patch((s) => void (s.users = [...s.users, row]));
                setNewUser({ full_name: '', email: '', role: 'analyst' });
              }}
            >
              Add analyst
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-soc-800 px-4 py-3">
          <p className="flex items-center gap-2 text-xs text-soc-400">
            <KeyRound className="size-3.5" /> Role changes take effect for the next sign-in; the demo directory has no password store in Phase 1.
          </p>
          <SaveRow label="Users and roles" dirty={Boolean(dirty['Users & roles'])} saving={saving === 'Users and roles'} disabled={!dirty['Users & roles'] || locked} onSave={() => save('Users and roles', { users: draft.users })} compact />
        </div>
      </Panel>

      <Panel title="Workspace" subtitle="Presentation preferences kept in this browser" icon={<Wrench className="size-4" />} bodyClassName="p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Display timezone"
            value={draft.timezone}
            onChange={(e) => patch((s) => void (s.timezone = e.target.value))}
            options={TIMEZONES.map((t) => ({ value: t, label: t }))}
            hint="Timestamps in this build render in the browser locale; the value is shipped with every API call."
          />
        </div>
        <div className="mt-3">
          <SaveRow
            label="Workspace"
            dirty={Boolean(saved && draft.timezone !== saved.timezone)}
            saving={saving === 'Workspace'}
            disabled={!saved || draft.timezone === saved.timezone}
            onSave={() => save('Workspace', { timezone: draft.timezone })}
          />
        </div>
      </Panel>
    </div>
  );
}

function SaveRow({
  label,
  dirty,
  saving,
  disabled,
  onSave,
  compact = false,
}: {
  label: string;
  dirty: boolean;
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'flex items-center gap-2' : 'flex items-center gap-2 border-t border-soc-800 pt-3'}>
      <Button variant="primary" size="sm" icon={<Save className="size-3.5" />} busy={saving} disabled={disabled} onClick={onSave}>
        Save {label}
      </Button>
      <span className={`text-xs ${dirty ? 'text-amber-300' : 'text-soc-500'}`}>{dirty ? 'unsaved changes' : 'in sync'}</span>
    </div>
  );
}
