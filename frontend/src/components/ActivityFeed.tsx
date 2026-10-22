import { AlertTriangle, CheckCircle2, MessageSquareText, RadioTower, UserCheck } from 'lucide-react';
import { listIncidents, incidentTimeline } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useLive } from '../context/LiveContext';
import type { TimelineEntry } from '../types/api';
import { EmptyState, SeverityBadge, SkeletonRows } from './ui';
import { relative } from '../lib/format';

const TYPE_ICON = {
  detection: RadioTower,
  alert: AlertTriangle,
  event: RadioTower,
  analyst: MessageSquareText,
  status: CheckCircle2,
  assignment: UserCheck,
  ai: RadioTower,
} as const;

interface Row {
  incidentId: number;
  reference: string;
  title: string;
  entry: TimelineEntry;
}

export function ActivityFeed({ onOpen }: { onOpen: (incidentId: number) => void }) {
  const { nonce } = useLive();
  const incidents = useAsync(
    async () => {
      const page = await listIncidents({ page: 1, limit: 5 });
      const timelines = await Promise.all(
        page.items.map(async (inc) => ({ inc, entries: (await incidentTimeline(inc.id)).slice(0, 3) })),
      );
      const rows: Row[] = timelines.flatMap(({ inc, entries }) =>
        entries.map((entry) => ({ incidentId: inc.id, reference: inc.reference, title: inc.title, entry })),
      );
      return rows.sort((a, b) => Date.parse(b.entry.timestamp) - Date.parse(a.entry.timestamp)).slice(0, 9);
    },
    [nonce],
    { silent: true },
  );

  if (incidents.loading && !incidents.data) return <SkeletonRows rows={5} />;
  if (!incidents.data?.length) return <EmptyState title="No incident movement" message="Open cases have not produced timeline entries yet." />;

  return (
    <ol className="relative space-y-3 pl-1">
      {incidents.data.map(({ incidentId, reference, title, entry }) => {
        const Icon = TYPE_ICON[entry.type];
        return (
          <li key={entry.id} className="relative flex gap-3">
            <span className="relative mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-soc-700 bg-soc-800 text-soc-300">
              <Icon className="size-3" />
            </span>
            <div className="min-w-0 flex-1 border-b border-soc-800/70 pb-2.5">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(incidentId)}
                  className="min-w-0 text-left text-[13px] font-medium text-soc-100 hover:text-accent"
                >
                  <span className="mr-1.5 font-mono text-[11px] text-soc-400">{reference}</span>
                  {title}
                </button>
                {entry.severity && <SeverityBadge severity={entry.severity} showLabel={false} />}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-soc-400">{entry.detail}</p>
              <p className="mt-1 text-[11px] text-soc-500">
                {relative(entry.timestamp)} · {entry.actor} · {entry.title}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
