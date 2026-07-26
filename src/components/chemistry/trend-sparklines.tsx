"use client";

import { useMemo } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { Panel } from "@/components/ui/panel";
import { formatChemNumber } from "@/lib/dosing";
import { formatClock } from "@/lib/utils";
import { METRICS, type ChemReading, type MetricDef } from "@/components/chemistry/chem-shared";

/** One small accent-stroked sparkline per metric with at least two readings. */

interface SparkPoint {
  at: number;
  value: number;
}

function SparkTooltip(props: TooltipProps<number, string> & { unit: string }): React.JSX.Element | null {
  const { active, payload, unit } = props;
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload as SparkPoint | undefined;
  if (!datum) return null;
  return (
    <div className="glass-bright rounded-lg px-2.5 py-1.5 text-xs">
      <p className="temp-display text-sm text-ink">
        {formatChemNumber(datum.value)}
        {unit ? <span className="ml-1 text-[10px] font-normal text-ink-faint">{unit}</span> : null}
      </p>
      <p className="mt-0.5 text-[10px] text-ink-faint">
        {new Date(datum.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {formatClock(datum.at)}
      </p>
    </div>
  );
}

function SparkCell({ def, points }: { def: MetricDef; points: SparkPoint[] }): React.JSX.Element {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.15 || Math.max(Math.abs(max) * 0.05, 0.1);
  const last = points[points.length - 1];

  return (
    <Panel className="p-3.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">{def.short}</span>
        <span className="temp-display text-sm text-ink">
          {last ? formatChemNumber(last.value) : "—"}
          {def.unit ? <span className="ml-1 text-[10px] font-normal text-ink-faint">{def.unit}</span> : null}
        </span>
      </div>
      <div className="h-14">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 3, bottom: 2, left: 3 }}>
            <XAxis dataKey="at" type="number" domain={["dataMin", "dataMax"]} hide />
            <YAxis domain={[min - pad, max + pad]} hide />
            <Tooltip
              content={<SparkTooltip unit={def.unit} />}
              cursor={{ stroke: "var(--accent)", strokeOpacity: 0.35, strokeDasharray: "3 3" }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, fill: "var(--accent)", stroke: "none" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[10px] text-ink-faint">
        {points.length} {points.length === 1 ? "test" : "tests"}
      </p>
    </Panel>
  );
}

export function TrendSparklines({ readings }: { readings: ChemReading[] }): React.JSX.Element | null {
  const series = useMemo(() => {
    const ascending = [...readings].sort((a, b) => a.at - b.at);
    return METRICS.map((def) => ({
      def,
      points: ascending.flatMap((reading): SparkPoint[] => {
        const value = reading[def.key];
        return value === null ? [] : [{ at: reading.at, value }];
      }),
    })).filter((s) => s.points.length >= 2);
  }, [readings]);

  if (series.length === 0) return null;

  return (
    <section>
      <p className="mb-2.5 text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">Trends</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {series.map(({ def, points }) => (
          <SparkCell key={def.key} def={def} points={points} />
        ))}
      </div>
    </section>
  );
}
