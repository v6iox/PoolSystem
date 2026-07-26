"use client";

/**
 * Chemistry trend when no IntelliChem is installed: manual water tests from
 * /api/chemistry rendered as dotted point-lines (pH left axis, ORP right axis
 * when any ORP has been logged).
 */

import { memo, useMemo } from "react";
import { ChartCard } from "./chart-card";
import { MetricChart, type SeriesDef } from "./metric-chart";
import { CHART_COLORS, useChemReadings, type ChartRow, type RangeDef } from "./history-data";

function formatChem(value: number, metric: string): string {
  return metric === "ph" ? value.toFixed(2) : `${Math.round(value)} mV`;
}

const PH_SERIES: SeriesDef = {
  metric: "ph",
  name: "pH",
  color: CHART_COLORS.accent,
  kind: "line",
  dots: true,
};

const ORP_SERIES: SeriesDef = {
  metric: "orp",
  name: "ORP",
  color: CHART_COLORS.ok,
  kind: "line",
  axis: "right",
  dots: true,
};

const PH_ONLY: SeriesDef[] = [PH_SERIES];
const PH_AND_ORP: SeriesDef[] = [PH_SERIES, ORP_SERIES];

export const ManualChemChart = memo(function ManualChemChart({
  range,
  delay = 0,
}: {
  range: RangeDef;
  delay?: number;
}): React.JSX.Element {
  const query = useChemReadings();

  const rows = useMemo<ChartRow[]>(() => {
    const from = Date.now() - range.days * 86_400_000;
    return (query.data?.readings ?? [])
      .filter((r) => r.at >= from && (r.ph !== null || r.orp !== null))
      .sort((a, b) => a.at - b.at)
      .map((r) => ({ x: r.at, ph: r.ph, orp: r.orp }));
  }, [query.data, range.days]);

  const hasOrp = rows.some((r) => r.orp !== null && r.orp !== undefined);
  const series = hasOrp ? PH_AND_ORP : PH_ONLY;

  return (
    <ChartCard
      title="Chemistry · manual tests"
      legend={series.map((s) => ({ label: s.name, color: s.color }))}
      loading={query.isPending}
      error={query.isError ? (query.error instanceof Error ? query.error.message : "Request failed") : undefined}
      empty={rows.length === 0}
      emptyDetail="No water tests in this range — log one from the Chemistry page."
      delay={delay}
    >
      <MetricChart
        uid="chem-manual"
        rows={rows}
        series={series}
        mode="raw"
        rangeDays={range.days}
        format={formatChem}
        dualAxis={hasOrp}
      />
    </ChartCard>
  );
});
