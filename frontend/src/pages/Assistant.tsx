import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Bot, Eraser, Plug, Send, Sparkles, User } from 'lucide-react';
import type { AiAnalysis, ChatMessage } from '../types/api';
import { aiChat, listIncidents } from '../services/api';
import { LOCAL_MODEL_LABEL } from '../services/aiLocal';
import { useAsync } from '../hooks/useAsync';
import {
  Button,
  DemoBadge,
  ErrorState,
  IncidentStatusPill,
  Panel,
  Select,
  SeverityBadge,
  SkeletonRows,
  Toggle,
} from '../components/ui';
import { errorText } from '../lib/format';

const STARTERS = [
  'Summarise what happened',
  'What evidence supports this?',
  'Which alternative explanations fit?',
  'What should I investigate next?',
  'What should we block right now?',
  'Who and what is implicated?',
  'How confident are you?',
];

interface Turn {
  id: number;
  role: ChatMessage['role'];
  content: string;
  analysis?: AiAnalysis | null;
  failed?: boolean;
}

export function AssistantPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const incidents = useAsync(() => listIncidents({ page: 1, limit: 50 }), []);
  const [selected, setSelected] = useState<number | null>(params.get('incident') ? Number(params.get('incident')) : null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [outage, setOutage] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const activeId = useMemo(() => {
    if (selected && incidents.data?.items.some((i) => i.id === selected)) return selected;
    return incidents.data?.items[0]?.id ?? null;
  }, [selected, incidents.data]);

  const incident = incidents.data?.items.find((i) => i.id === activeId) ?? null;

  useEffect(() => {
    setTurns([]);
    if (activeId) {
      setTurns([
        {
          id: ++seq.current,
          role: 'assistant',
          content: `Loaded ${incident?.reference} — ${incident?.title}.\n\nEverything I say is computed from this incident's ${
            incident?.event_ids.length ?? 0
          } correlated events and ${incident?.alert_ids.length ?? 0} alerts. Ask for evidence, hypotheses, next steps or blocking actions.`,
          analysis: incident?.ai ?? null,
        },
      ]);
    }
  }, [activeId, incident]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns, thinking]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || !activeId) return;
    setDraft('');
    const history: ChatMessage[] = turns.filter((t) => !t.failed).map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { id: ++seq.current, role: 'user', content: message }]);
    setThinking(true);
    try {
      const response = await aiChat({ incident_id: activeId, message, history }, { simulateOutage: outage });
      setTurns((prev) => [...prev, { id: ++seq.current, role: 'assistant', content: response.reply, analysis: response.analysis }]);
    } catch (error) {
      setTurns((prev) => [
        ...prev,
        {
          id: ++seq.current,
          role: 'assistant',
          failed: true,
          content: `${errorText(error)}\n\nThe assistant never fabricates an answer. Nothing above was invented: the request failed before a response was produced, so the incident record is unchanged.`,
        },
      ]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-soc-100">
            <Bot className="size-5 text-accent" />
            AI Security Assistant
          </h1>
          <p className="mt-0.5 max-w-2xl text-sm text-soc-400">
            Answers are produced by <span className="mono text-soc-300">{LOCAL_MODEL_LABEL}</span> — a deterministic responder that reads the
            selected incident's own records. No model call is made in Phase 1, and every claim is labelled evidence, hypothesis or
            recommendation.
          </p>
        </div>
        <DemoBadge />
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Investigation chat"
          subtitle={incident ? `${incident.reference} · ${incident.event_ids.length} events in scope` : 'Select an incident'}
          icon={<Sparkles className="size-4" />}
          className="min-h-[560px]"
          bodyClassName="flex flex-col gap-3 p-0"
          actions={
            <Button size="sm" icon={<Eraser className="size-3.5" />} onClick={() => setTurns([])} disabled={!turns.length}>
              Clear
            </Button>
          }
        >
          <div className="border-b border-soc-800 px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <Select
                label="Incident in scope"
                value={String(activeId ?? '')}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setSelected(value);
                  const next = new URLSearchParams(params);
                  next.set('incident', String(value));
                  setParams(next, { replace: true });
                }}
                options={(incidents.data?.items ?? []).map((i) => ({ value: String(i.id), label: `${i.reference} · ${i.title}` }))}
              />
              <div className="pt-4 sm:pt-0">
                <Toggle
                  label="Simulate model unavailable"
                  hint="Drives the failure path for the demo"
                  checked={outage}
                  onChange={(v) => setOutage(v)}
                />
              </div>
            </div>
          </div>

          <div ref={scroller} className="min-h-[300px] flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {incidents.loading && !incidents.data ? (
              <SkeletonRows rows={3} />
            ) : !incident ? (
              <ErrorState message="No incidents are available to reason over." onRetry={() => incidents.reload()} />
            ) : (
              turns.map((turn) => <Bubble key={turn.id} turn={turn} onOpenIncident={() => navigate(`/incidents/${activeId}`)} />)
            )}
            {thinking && (
              <div className="flex items-center gap-2 text-xs text-soc-400">
                <span className="flex gap-1">
                  <span className="size-1.5 animate-pulse-dot rounded-full bg-accent" />
                  <span className="size-1.5 animate-pulse-dot rounded-full bg-accent [animation-delay:160ms]" />
                  <span className="size-1.5 animate-pulse-dot rounded-full bg-accent [animation-delay:320ms]" />
                </span>
                reading incident records…
              </div>
            )}
          </div>

          <form
            className="flex gap-2 border-t border-soc-800 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="field flex-1"
              placeholder={incident ? 'Ask about evidence, hypotheses, next steps…' : 'Select an incident first'}
              disabled={!incident || thinking}
            />
            <Button type="submit" variant="primary" icon={<Send className="size-3.5" />} disabled={!draft.trim() || !incident || thinking} busy={thinking}>
              Send
            </Button>
          </form>

          <div className="flex flex-wrap gap-1.5 px-4 pb-4">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                disabled={!incident || thinking}
                className="chip border-soc-700 bg-soc-800/60 text-soc-300 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Incident in scope" icon={<Plug className="size-4" />}>
            {incident ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-soc-400">{incident.reference}</span>
                  <SeverityBadge severity={incident.severity} />
                  <IncidentStatusPill status={incident.status} />
                </div>
                <p className="text-sm font-medium text-soc-100">{incident.title}</p>
                <p className="text-xs leading-relaxed text-soc-400">{incident.description}</p>
                <Button size="sm" onClick={() => navigate(`/incidents/${incident.id}`)}>
                  Open investigation
                </Button>
              </div>
            ) : (
              <p className="text-xs text-soc-400">Nothing selected.</p>
            )}
          </Panel>

          <Panel title="Stored analysis" subtitle="Attached to the incident record" icon={<Sparkles className="size-4" />}>
            {incident?.ai ? (
              <div className="space-y-3 text-xs">
                <p className="text-soc-300">{incident.ai.summary}</p>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wider text-soc-400">Confidence</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-soc-800">
                    <div className="h-full bg-accent" style={{ width: `${Math.round(incident.ai.confidence * 100)}%` }} />
                  </div>
                  <span className="tabular-nums text-soc-200">{Math.round(incident.ai.confidence * 100)}%</span>
                </div>
                <ul className="space-y-1 text-soc-400">
                  {incident.ai.limitations.map((l, i) => (
                    <li key={i}>· {l}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <SkeletonRows rows={3} />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Bubble({ turn, onOpenIncident }: { turn: Turn; onOpenIncident: () => void }) {
  const isUser = turn.role === 'user';
  return (
    <div className={`flex gap-2.5 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <span className={`grid size-7 shrink-0 place-items-center rounded-full ${turn.failed ? 'bg-red-500/15 text-red-300' : 'bg-accent/15 text-accent'}`}>
          {turn.failed ? <AlertTriangle className="size-3.5" /> : <Bot className="size-3.5" />}
        </span>
      )}
      <div
        className={`max-w-[46rem] rounded-lg border px-3.5 py-2.5 text-sm ${
          isUser
            ? 'border-accent/30 bg-accent/10 text-soc-100'
            : turn.failed
              ? 'border-red-500/35 bg-red-500/8 text-red-100'
              : 'border-soc-700/70 bg-soc-950/60 text-soc-200'
        }`}
      >
        {turn.content.split('\n').map((line, i) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={i} className="h-2" />;
          if (trimmed.startsWith('- ')) {
            return (
              <p key={i} className="ml-1 flex gap-2 py-0.5">
                <span className="text-soc-600">›</span>
                <span>{renderInline(trimmed.slice(2))}</span>
              </p>
            );
          }
          return <p key={i}>{renderInline(trimmed)}</p>;
        })}
        {turn.analysis && !isUser && !turn.failed && (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-soc-800 pt-2 text-[10px] uppercase tracking-wider text-soc-500">
            <span>{LOCAL_MODEL_LABEL}</span>
            <span>·</span>
            <span>{turn.analysis.evidence.length} evidence</span>
            <span>·</span>
            <span>{Math.round(turn.analysis.confidence * 100)}% confidence</span>
            <button type="button" onClick={onOpenIncident} className="ml-auto text-accent hover:underline">
              trace to records
            </button>
          </div>
        )}
      </div>
      {isUser && <span className="grid size-7 shrink-0 place-items-center rounded-full bg-soc-800 text-soc-300"><User className="size-3.5" /></span>}
    </div>
  );
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return (
        <strong key={i} className="font-semibold uppercase tracking-wider text-accent">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (/^_[^_]+_$/.test(part)) {
      return (
        <em key={i} className="text-soc-400">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (/^`[^`]+`$/.test(part)) {
      return (
        <code key={i} className="rounded bg-soc-800 px-1 py-0.5 font-mono text-[11.5px] text-soc-200">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
