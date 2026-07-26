"use client";

/**
 * /history — trends (temps, pump, salt, chemistry) over a selectable range,
 * plus equipment runtime & energy cost. Family+.
 *
 * ≤3d ranges chart raw samples; longer ranges chart daily rollups as an avg
 * line over a min–max band. All chart data flows through TanStack Query keyed
 * by range; series definitions are memoized against stable snapshot keys so
 * 1 Hz SSE frames don't re-render the charts.
 */

import { useMemo, useState } from "react";
import { History } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { roleAtLeast } from "@/types/auth";
import { EmptyState, PageHeader } from "@/components/ui/panel";
import { RangeSelector } from "@/components/history/range-selector";
import {
  CHART_COLORS,
  rangeByKey,
  rangeMode,
  rangeTitle,
  type RangeKey,
} from "@/components/history/history-data";
import {
  HistoryChartCard,
  type Domain,
  type RefLineDef,
  type SeriesDef,
} from "@/components/history/metric-chart";
import { ManualChemChart } from "@/components/history/chemistry-manual-chart";
import { RuntimeSection, type EquipRef } from "@/components/history/runtime-energy";

/* ── Stable formatters / chart constants (module scope ⇒ memo-safe) ── */

const formatTempF = (value: number): string => `${Math.round(value)}°F`;
const formatTempC = (value: number): string => `${Math.round(value)}°C`;

const formatPump = (value: number, metric: string): string =>
  metric.endsWith(":rpm") ? `${Math.round(value).toLocaleString()} rpm` : `${Math.round(value).toLocaleString()} W`;

const formatSalt = (value: number): string => `${Math.round(value).toLocaleString()} ppm`;

const formatChem = (value: number, metric: string): string =>
  metric.includes(":ph") ? value.toFixed(2) : `${Math.round(value)} mV`;

const SALT_LOW_PPM = 2800;
const SALT_REF_LINES: RefLineDef[] = [{ y: SALT_LOW_PPM, label: "Low · 2800", color: CHART_COLORS.warn }];
const SALT_DOMAIN: Domain = [
  (dataMin: number) => Math.floor(Math.min(dataMin - 150, SALT_LOW_PPM - 200) / 100) * 100,
  (dataMax: number) => Math.ceil((dataMax + 150) / 100) * 100,
];

export default function HistoryPage(): React.JSX.Element {
  const { snapshot, hasLoaded, user } = usePool();
  const [rangeKey, setRangeKey] = useState<RangeKey>("24h");
  const range = rangeByKey(rangeKey);

  /* Stable keys so memos survive the ~1 Hz snapshot churn. */
  const bodiesKey = snapshot.bodies.map((b) => `${b.id}:${b.kind}:${b.name}`).join("|");
  const pump = snapshot.pumps[0];
  const pumpKey = pump ? `${pump.id}:${pump.name}` : "";
  const chlor = snapshot.chlorinators[0];
  const chlorKey = chlor ? `${chlor.id}:${chlor.name}` : "";
  const chem = snapshot.chem[0];
  const chemKey = chem ? `${chem.id}:${chem.name}` : "";
  const pumpsKey = snapshot.pumps.map((p) => `${p.id}:${p.name}`).join("|");
  const lightsKey = snapshot.circuits
    .filter((c) => c.isLight)
    .map((c) => `${c.id}:${c.name}`)
    .join("|");

  /* Water & air temps: per-body temp + spa setpoint (dashed) + air. */
  const tempsSeries = useMemo<SeriesDef[]>(() => {
    const defs: SeriesDef[] = [];
    snapshot.bodies.forEach((body, i) => {
      defs.push({
        metric: `temp:body:${body.id}`,
        name: body.name,
        color: body.kind === "spa" ? CHART_COLORS.heat : i === 0 ? CHART_COLORS.accent : CHART_COLORS.ok,
        kind: body.kind === "spa" ? "line" : i === 0 ? "area" : "line",
      });
    });
    const spa = snapshot.bodies.find((b) => b.kind === "spa");
    if (spa) {
      defs.push({
        metric: `setpoint:body:${spa.id}`,
        name: `${spa.name} setpoint`,
        color: CHART_COLORS.heat,
        kind: "line",
        dashed: true,
        noBand: true,
      });
    }
    defs.push({
      metric: "temp:air",
      name: "Air",
      color: CHART_COLORS.warn,
      kind: "line",
      noBand: true,
    });
    return defs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodiesKey]);

  /* Pump watts (area, left) + rpm (line, right). */
  const pumpSeries = useMemo<SeriesDef[] | null>(() => {
    if (!pump) return null;
    return [
      { metric: `pump:${pump.id}:watts`, name: "Watts", color: CHART_COLORS.accent, kind: "area" },
      { metric: `pump:${pump.id}:rpm`, name: "RPM", color: CHART_COLORS.ok, kind: "line", axis: "right", noBand: true },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pumpKey]);

  /* Salt ppm with the low-threshold reference line. */
  const saltSeries = useMemo<SeriesDef[] | null>(() => {
    if (!chlor) return null;
    return [{ metric: `chlor:${chlor.id}:salt`, name: "Salt", color: CHART_COLORS.accent, kind: "area" }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chlorKey]);

  /* IntelliChem pH/ORP (falls back to manual tests when absent). */
  const chemSeries = useMemo<SeriesDef[] | null>(() => {
    if (!chem) return null;
    return [
      { metric: `chem:${chem.id}:ph`, name: "pH", color: CHART_COLORS.accent, kind: "line" },
      { metric: `chem:${chem.id}:orp`, name: "ORP", color: CHART_COLORS.ok, kind: "line", axis: "right", noBand: true },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chemKey]);

  /* Stable equipment refs for the runtime section's friendly names. */
  const pumpsRef = useMemo<EquipRef[]>(
    () => snapshot.pumps.map((p) => ({ id: p.id, name: p.name })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pumpsKey]
  );
  const bodiesRef = useMemo<EquipRef[]>(
    () => snapshot.bodies.map((b) => ({ id: b.id, name: b.name })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bodiesKey]
  );
  const lightsRef = useMemo<EquipRef[]>(
    () => snapshot.circuits.filter((c) => c.isLight).map((c) => ({ id: c.id, name: c.name })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lightsKey]
  );

  const formatTemp = snapshot.units === "C" ? formatTempC : formatTempF;

  if (!roleAtLeast(user.role, "family")) {
    return (
      <div>
        <PageHeader title="History" subtitle="Trends, runtime and energy" />
        <EmptyState
          icon={<History size={40} />}
          title="Family access required"
          detail="History is available to family members and owners. Ask the pool owner to upgrade your account."
        />
      </div>
    );
  }

  if (!hasLoaded) {
    return (
      <div>
        <PageHeader title="History" subtitle="Waiting for controller…" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-80 rounded-panel" />
          ))}
        </div>
      </div>
    );
  }

  const mode = rangeMode(range);
  const hasTemps = snapshot.bodies.length > 0 || snapshot.airTemp !== null;

  return (
    <div>
      <PageHeader
        title="History"
        subtitle={`Last ${rangeTitle(range)} · ${mode === "raw" ? "raw samples" : "daily min · max · avg"}`}
        action={<RangeSelector value={rangeKey} onChange={setRangeKey} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {hasTemps ? (
          <HistoryChartCard
            uid="temps"
            title="Water & air temps"
            range={range}
            series={tempsSeries}
            format={formatTemp}
            delay={0}
          />
        ) : null}
        {pump && pumpSeries ? (
          <HistoryChartCard
            uid="pump"
            title={`Pump · ${pump.name}`}
            range={range}
            series={pumpSeries}
            format={formatPump}
            dualAxis
            delay={0.05}
          />
        ) : null}
        {chlor && saltSeries ? (
          <HistoryChartCard
            uid="salt"
            title={`Salt · ${chlor.name}`}
            range={range}
            series={saltSeries}
            format={formatSalt}
            leftDomain={SALT_DOMAIN}
            refLines={SALT_REF_LINES}
            delay={0.1}
          />
        ) : null}
        {chem && chemSeries ? (
          <HistoryChartCard
            uid="chem"
            title={`Chemistry · ${chem.name}`}
            range={range}
            series={chemSeries}
            format={formatChem}
            dualAxis
            delay={0.15}
          />
        ) : (
          <ManualChemChart range={range} delay={0.15} />
        )}
      </div>

      {!hasTemps && !pump && !chlor ? (
        <div className="mt-4">
          <EmptyState
            icon={<History size={40} />}
            title="Nothing to chart yet"
            detail="Once the controller reports bodies, pumps or a chlorinator, their history will collect here automatically."
          />
        </div>
      ) : null}

      <RuntimeSection range={range} pumps={pumpsRef} bodies={bodiesRef} lights={lightsRef} />
    </div>
  );
}
