"use client";

/**
 * Generic history chart. Raw mode draws gradient areas / lines per metric;
 * rollup mode draws an avg line plus a translucent min–max band per metric.
 * `HistoryChartCard` wires a series definition to /api/history via TanStack
 * Query and renders it inside a ChartCard (memoized — the page hands it
 * referentially-stable series arrays so 1 Hz snapshot frames don't re-render
 * the charts).
 */

import { memo, useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard, GlassTooltip, type LegendItem } from "./chart-card";
import {
  CHART_COLORS,
  buildRawRows,
  buildRollupRows,
  formatTooltipLabel,
  makeTickFormatter,
  rangeMode,
  useHistory,
  type ChartMode,
  type ChartRow,
  type RangeDef,
} from "./history-data";

export interface SeriesDef {
  metric: string;
  name: string;
  /** CSS color (var(--accent) etc.). */
  color: string;
  kind: "line" | "area";
  dashed?: boolean;
  /** Which y-axis this series reads against (needs `dualAxis`). */
  axis?: "left" | "right";
  /** Skip the min/max band in rollup mode (setpoints, secondary series). */
  noBand?: boolean;
  /** Draw point dots (sparse data like manual water tests). */
  dots?: boolean;
}

export interface RefLineDef {
  y: number;
  label: string;
  color: string;
}

type DomainItem = string | number | ((value: number) => number);
export type Domain = [DomainItem, DomainItem];

const AUTO_DOMAIN: Domain = ["auto", "auto"];
const AXIS_TICK = { fill: CHART_COLORS.tick, fontSize: 11 } as const;

/** Metric keys contain colons — sanitize before use as an SVG gradient id. */
function gradientId(uid: string, metric: string): string {
  return `hist-${uid}-${metric.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

export function MetricChart({
  uid,
  rows,
  series,
  mode,
  rangeDays,
  format,
  dualAxis = false,
  leftDomain = AUTO_DOMAIN,
  refLines,
  height = 260,
}: {
  /** Unique id prefix so gradient defs never collide between cards. */
  uid: string;
  rows: ChartRow[];
  series: SeriesDef[];
  mode: ChartMode;
  rangeDays: number;
  format: (value: number, metric: string) => string;
  dualAxis?: boolean;
  leftDomain?: Domain;
  refLines?: RefLineDef[];
  height?: number;
}): React.JSX.Element {
  const tickFormatter = makeTickFormatter(mode, rangeDays);
  const areas = series.filter((s) => s.kind === "area");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 6, right: dualAxis ? 0 : 10, bottom: 0, left: 0 }}>
        <defs>
          {areas.map((s) => (
            <linearGradient key={s.metric} id={gradientId(uid, s.metric)} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="x"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={tickFormatter}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          minTickGap={rangeDays <= 1 ? 44 : 64}
        />
        <YAxis
          yAxisId="left"
          domain={leftDomain}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={42}
        />
        {dualAxis ? (
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={AUTO_DOMAIN}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={44}
          />
        ) : null}
        <Tooltip
          cursor={{ stroke: CHART_COLORS.cursor, strokeDasharray: "4 4" }}
          content={
            <GlassTooltip
              labelFormatter={(x) => formatTooltipLabel(mode, rangeDays, x)}
              format={format}
            />
          }
        />
        {refLines?.map((r) => (
          <ReferenceLine
            key={r.y}
            yAxisId="left"
            y={r.y}
            stroke={r.color}
            strokeDasharray="6 4"
            label={{ value: r.label, fill: r.color, fontSize: 10, position: "insideTopRight" }}
          />
        ))}
        {mode === "rollup"
          ? series
              .filter((s) => !s.noBand)
              .map((s) => (
                <Area
                  key={`${s.metric}__band`}
                  yAxisId={s.axis ?? "left"}
                  dataKey={`${s.metric}__band`}
                  name={`${s.name} range`}
                  stroke="none"
                  fill={s.color}
                  fillOpacity={0.14}
                  connectNulls
                  activeDot={false}
                  isAnimationActive={false}
                />
              ))
          : null}
        {series.map((s) =>
          mode === "raw" && s.kind === "area" ? (
            <Area
              key={s.metric}
              yAxisId={s.axis ?? "left"}
              dataKey={s.metric}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "6 4" : undefined}
              fill={`url(#${gradientId(uid, s.metric)})`}
              connectNulls
              dot={s.dots ? { r: 3, strokeWidth: 0, fill: s.color } : false}
              activeDot={{ r: 3, strokeWidth: 0 }}
            />
          ) : (
            <Line
              key={s.metric}
              yAxisId={s.axis ?? "left"}
              dataKey={mode === "raw" ? s.metric : `${s.metric}__avg`}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "6 4" : undefined}
              connectNulls
              dot={
                s.dots || mode === "rollup"
                  ? { r: 2.5, strokeWidth: 0, fill: s.color }
                  : false
              }
              activeDot={{ r: 3, strokeWidth: 0 }}
            />
          )
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ── Query-wired card ──────────────────────────────────────────── */

export interface HistoryChartCardProps {
  uid: string;
  title: string;
  range: RangeDef;
  series: SeriesDef[];
  format: (value: number, metric: string) => string;
  dualAxis?: boolean;
  leftDomain?: Domain;
  refLines?: RefLineDef[];
  emptyDetail?: string;
  delay?: number;
}

export const HistoryChartCard = memo(function HistoryChartCard({
  uid,
  title,
  range,
  series,
  format,
  dualAxis,
  leftDomain,
  refLines,
  emptyDetail,
  delay = 0,
}: HistoryChartCardProps): React.JSX.Element {
  const mode = rangeMode(range);
  const metricsKey = series.map((s) => s.metric).join(",");
  const metrics = useMemo(() => metricsKey.split(",").filter(Boolean), [metricsKey]);
  const query = useHistory(range, metrics);
  const rows = useMemo<ChartRow[]>(() => {
    if (!query.data) return [];
    return mode === "raw" ? buildRawRows(query.data, metrics) : buildRollupRows(query.data, metrics);
  }, [query.data, mode, metrics]);
  const legend = useMemo<LegendItem[]>(
    () => series.map((s) => ({ label: s.name, color: s.color, dashed: s.dashed })),
    [series]
  );

  return (
    <ChartCard
      title={title}
      legend={legend}
      loading={query.isPending}
      error={query.isError ? (query.error instanceof Error ? query.error.message : "Request failed") : undefined}
      empty={rows.length === 0}
      emptyDetail={emptyDetail}
      delay={delay}
    >
      <MetricChart
        uid={uid}
        rows={rows}
        series={series}
        mode={mode}
        rangeDays={range.days}
        format={format}
        dualAxis={dualAxis}
        leftDomain={leftDomain}
        refLines={refLines}
      />
    </ChartCard>
  );
});
