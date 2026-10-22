import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';

type Variant = 'primary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  busy?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', icon, busy = false, children, className = '', disabled, ...rest },
  ref,
) {
  return (
    <button ref={ref} className={`${VARIANTS[variant]} ${size === 'sm' ? 'btn-sm' : ''} ${className}`} disabled={disabled || busy} {...rest}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
});

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, hint, error, className = '', ...rest }: TextFieldProps) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="label">{label}</span>}
      <input className={`field ${error ? 'border-red-500/60 focus:border-red-500 focus:ring-red-500/30' : ''}`} {...rest} />
      {(error || hint) && <span className={`mt-1 block text-xs ${error ? 'text-red-400' : 'text-soc-400'}`}>{error ?? hint}</span>}
    </label>
  );
}

interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  onClear?: () => void;
}

export function SearchField({ onClear, className = '', ...rest }: SearchFieldProps) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-soc-400" />
      <input className="field pl-8 pr-8" {...rest} />
      {rest.value && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-soc-400 hover:bg-soc-800 hover:text-soc-100"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, hint, options, className = '', ...rest }: SelectProps) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="label">{label}</span>}
      <select className="field appearance-none bg-soc-900 pr-8" {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="mt-1 block text-xs text-soc-400">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p className="text-sm text-soc-100">{label}</p>
        {hint && <p className="text-xs text-soc-400">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
          checked ? 'border-accent/50 bg-accent/30' : 'border-soc-600 bg-soc-800'
        }`}
      >
        <span className={`absolute top-0.5 size-3.5 rounded-full transition-all ${checked ? 'left-[18px] bg-accent' : 'left-0.5 bg-soc-400'}`} />
      </button>
    </div>
  );
}

interface PaginationProps {
  page: number;
  pages: number;
  total: number;
  limit: number;
  onPage: (page: number) => void;
}

export function Pagination({ page, pages, total, limit, onPage }: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const windowSize = 5;
  const start = Math.max(1, Math.min(page - 2, pages - windowSize + 1));
  const numbers = Array.from({ length: Math.min(windowSize, pages) }, (_, i) => start + i);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-soc-700/60 px-4 py-3">
      <p className="text-xs text-soc-400">
        Showing <span className="text-soc-200">{from.toLocaleString()}</span>–<span className="text-soc-200">{to.toLocaleString()}</span> of{' '}
        <span className="text-soc-200">{total.toLocaleString()}</span>
      </p>
      <div className="flex items-center gap-1">
        <Button size="sm" icon={<ChevronLeft className="size-3.5" />} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          Prev
        </Button>
        {numbers.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onPage(n)}
            className={`size-7 rounded-md border text-xs font-medium transition-colors ${
              n === page ? 'border-accent/50 bg-accent/20 text-accent' : 'border-soc-700 bg-soc-800/60 text-soc-300 hover:bg-soc-750'
            }`}
          >
            {n}
          </button>
        ))}
        <Button size="sm" icon={<ChevronRight className="size-3.5" />} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          Next
        </Button>
      </div>
    </div>
  );
}
