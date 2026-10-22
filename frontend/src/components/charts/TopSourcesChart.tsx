import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TopSource } from '../../types/api';
import { SEVERITY_TOKENS } from '../../lib/format';

export function TopSourcesChart({ sources, height = 260 }: { sources: TopSource[]; height?: number }) {
  const data = sources.slice(0, 8).map((s) => ({ ...s, label: s.ip }));
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }} barSize={13}>
          <CartesianGrid stroke="#1c2846" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fill: '#8b9ac0', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#1c2846' }} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            width={104}
            tick={{ fill: '#b6c2e0', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: string) => v}
          />
          <Tooltip
            cursor={{ fill: 'rgba(56,189,248,0.07)' }}
            contentStyle={{ background: '#0b1120', border: '1px solid #1c2846', borderRadius: 8, fontSize: 12 }}
            itemStyle={{ color: '#dee5f5' }}
            formatter={(value: number | string, name: string) => [value, name === 'events' ? 'Events' : 'Alerts']}
          />
          <Bar dataKey="events" name="events" isAnimationActive={false} radius={[0, 3, 3, 0]}>
            {data.map((d) => (
              <Cell key={d.ip} fill={SEVERITY_TOKENS[d.max_severity].hex} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
