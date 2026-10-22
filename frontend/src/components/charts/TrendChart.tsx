import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrendPoint } from '../../types/api';

const TOOLTIP_STYLE = {
  background: '#0b1120',
  border: '1px solid #1c2846',
  borderRadius: 8,
  fontSize: 12,
  padding: '6px 10px',
} as const;

const AXIS_TICK = { fill: '#8b9ac0', fontSize: 11 } as const;

export function TrendChart({ points, height = 260 }: { points: TrendPoint[]; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="eventsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="alertsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1c2846" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#1c2846' }} interval="preserveStartEnd" minTickGap={26} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={52} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#b6c2e0', marginBottom: 4 }} itemStyle={{ color: '#dee5f5' }} cursor={{ stroke: '#3a4a72' }} />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, color: '#8b9ac0', paddingTop: 6 }} />
          <Area
            type="monotone"
            dataKey="events"
            name="Events"
            stroke="#38bdf8"
            strokeWidth={1.8}
            fill="url(#eventsFill)"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3 }}
          />
          <Area
            type="monotone"
            dataKey="alerts"
            name="Alerts"
            stroke="#ef4444"
            strokeWidth={1.8}
            fill="url(#alertsFill)"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
