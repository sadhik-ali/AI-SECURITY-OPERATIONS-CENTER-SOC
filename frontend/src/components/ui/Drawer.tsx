import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Drawer({ open, title, subtitle, onClose, children, footer }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="flex-1 bg-black/60 backdrop-blur-[1px]" onClick={onClose} aria-label="Close panel" />
      <aside
        role="dialog"
        aria-label={title}
        className="flex h-full w-full max-w-2xl animate-fade-in flex-col border-l border-soc-700 bg-soc-900 shadow-panel"
      >
        <header className="flex items-start justify-between gap-4 border-b border-soc-700/60 px-4 py-3">
          <div className="min-w-0">
            <h2 className="panel-title truncate">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-soc-400">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-soc-300 hover:bg-soc-800 hover:text-soc-100" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="border-t border-soc-700/60 px-4 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}

export function JsonBlock({ value, maxHeight = 'max-h-[420px]' }: { value: unknown; maxHeight?: string }) {
  return (
    <pre
      className={`${maxHeight} overflow-auto rounded-md border border-soc-700/60 bg-soc-950/80 p-3 font-mono text-[11.5px] leading-relaxed text-soc-200`}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
