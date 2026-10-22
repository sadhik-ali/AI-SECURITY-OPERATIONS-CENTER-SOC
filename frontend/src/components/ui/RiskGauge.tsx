import { riskTone } from '../../lib/format';

export function RiskGauge({ score, size = 132 }: { score: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const tone = riskTone(clamped);
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circumference;

  return (
    <div className="flex items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1c2846" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tone.hex}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            style={{ transition: 'stroke-dasharray 600ms ease' }}
          />
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <span className={`text-3xl font-semibold tabular-nums ${tone.text}`}>{clamped}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-soc-400">/ 100</span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-soc-400">Composite risk</p>
        <p className={`mt-1 text-lg font-semibold ${tone.text}`}>{tone.label}</p>
        <p className="mt-1 max-w-[16rem] text-xs text-soc-400">
          Weighted from severity, blast radius, evidence volume and asset criticality.
        </p>
      </div>
    </div>
  );
}
