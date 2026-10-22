import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { Button } from './Controls';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-soc-400">
      <Loader2 className="size-4 animate-spin text-accent" />
      {label}…
    </div>
  );
}

export function SplashState({ label = 'Restoring session' }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-soc-950">
      <Loader2 className="size-6 animate-spin text-accent" />
      <p className="text-sm text-soc-400">{label}…</p>
    </div>
  );
}

export function SkeletonRows({ rows = 6, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-md bg-soc-800/70" style={{ animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, message, icon }: { title: string; message: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <span className="grid size-10 place-items-center rounded-full border border-soc-700 bg-soc-800 text-soc-400">
        {icon ?? <Inbox className="size-5" />}
      </span>
      <p className="text-sm font-medium text-soc-200">{title}</p>
      <p className="max-w-md text-xs text-soc-400">{message}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-full border border-red-500/40 bg-red-500/10 text-red-300">
        <AlertTriangle className="size-5" />
      </span>
      <p className="max-w-lg text-sm text-red-200">{message}</p>
      {onRetry && (
        <Button size="sm" variant="primary" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function InlineNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const tones = {
    info: 'border-accent/25 bg-accent/8 text-soc-200',
    warn: 'border-amber-500/30 bg-amber-500/8 text-amber-100',
  } as const;
  return <div className={`rounded-md border px-3 py-2 text-xs ${tones[tone]}`}>{children}</div>;
}
