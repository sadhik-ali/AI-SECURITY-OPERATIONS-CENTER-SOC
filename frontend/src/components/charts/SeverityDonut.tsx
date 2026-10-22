import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { Severity } from '../../types/api';
import { SEVERITY_TOKENS } from '../../lib/format';

interface Slice {
  severity: Severity;
  count: number;
}

export function SeverityDonut({ data, height = 220 }: { data: Slice[]; height?: number }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const slices = data.filter((d) => d.count > 0);
  return (
    <div className="flex items-center gap-4">
      <div className="relative flex-1" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              contentStyle={{ background: '#0b1120', border: '1px solid #1c2846', borderRadius: 8, fontSize: 12 }}
              itemStyle={{ color: '#dee5f5' }}
              formatter={(value: number | string, name: string) => [`${value}`, name]}
            />
            <Pie
              data={slices}
              dataKey="count"
              nameKey="severity"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={2}
              stroke="#070a12"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((s) => (
                <Cell key={s.severity} fill={SEVERITY_TOKENS[s.severity].hex} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-content-center">
          <span className="text-2xl font-semibold tabular-nums text-soc-100">{total.toLocaleString()}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-soc-400">alerts</span>
        </div>
      </div>
      <ul className="w-32 shrink-0 space-y-1.5">
        {data.map((d) => (
          <li key={d.severity} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2 text-soc-300">
              <span className="size-2 rounded-full" style={{ background: SEVERITY_TOKENS[d.severity].hex }} />
              {SEVERITY_TOKENS[d.severity].label}
            </span>
            <span className="tabular-nums text-soc-200">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
