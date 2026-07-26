"use client";

/**
 * Runtime & energy section: per-equipment totals (hours, kWh, $) from
 * /api/history/runtime plus a stacked daily bar chart of pump energy with
 * cost in the tooltip. Memoized — the page passes referentially-stable
 * equipment name lists so live snapshot frames don't re-render it.
 */

import { memo, useMemo } from "react";
import { motion } from "motion/react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Fan, Flame, Lightbulb, Zap, type LucideIcon } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { NumberTicker } from "@/components/ui/number-ticker";
import { ChartCard } from "./chart-card";
import { CHART_COLORS, dayLabel, rangeTitle, useRuntime, type RangeDef, type RuntimeRow } from "./history-data";

export interface EquipRef {
  id: number;
  name: string;
}

type EquipKind = "pump" | "heater" | "light";

interface ResolvedEquip {
  key: string;
  name: string;
  kind: EquipKind;
}

const KIND_ORDER: Record<EquipKind, number> = { pump: 0, heater: 1, light: 2 };
const KIND_ICON: Record<EquipKind, LucideIcon> = { pump: Fan, heater: Flame, light: Lightbulb };

/** Runtime keys → friendly equipment; circuits are skipped unless they're lights. */
function resolveKey(
  key: string,
  pumps: EquipRef[],
  bodies: EquipRef[],
  lights: EquipRef[]
): ResolvedEquip | null {
  const parts = key.split(":");
  const type = parts[0];
  if (type === "pump") {
    const id = Number(parts[1]);
    const name = pumps.find((p) => p.id === id)?.name ?? `Pump ${parts[1] ?? "?"}`;
    return { key, name, kind: "pump" };
  }
  if (type === "heater" && parts[1] === "body") {
    const id = Number(parts[2]);
    const body = bodies.find((b) => b.id === id);
    return { key, name: body ? `${body.name} heater` : `Heater ${parts[2] ?? "?"}`, kind: "heater" };
  }
  if (type === "circuit") {
    const id = Number(parts[1]);
    const light = lights.find((c) => c.id === id);
    return light ? { key, name: light.name, kind: "light" } : null;
  }
  return null;
}

const BAR_PALETTE = [CHART_COLORS.accent, CHART_COLORS.ok, CHART_COLORS.warn, CHART_COLORS.heat];

type EnergyRow = Record<string, number | string | undefined> & { day: string };

/* ── Energy tooltip (kWh + $ per pump per day) ─────────────────── */

interface EnergyTooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
  payload?: EnergyRow;
}

function EnergyTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: number | string;
  payload?: EnergyTooltipEntry[];
}): React.JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  let totalCost = 0;
  const rows = payload.flatMap((entry, i) => {
    if (typeof entry.value !== "number") return [];
    const base = String(entry.dataKey ?? i).replace(/__kwh$/, "");
    const costRaw = entry.payload?.[`${base}__cost`];
    const cost = typeof costRaw === "number" ? costRaw : 0;
    totalCost += cost;
    return [{ id: base, name: String(entry.name ?? base), kwh: entry.value, cost, color: entry.color }];
  });
  return (
    <div className="glass-bright rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="mb-1.5 font-medium text-ink-dim">{dayLabel(String(label ?? ""))}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <p key={r.id} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-1.5 text-ink-dim">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: r.color ?? "var(--accent)" }} />
              {r.name}
            </span>
            <span className="font-medium text-ink">
              {r.kwh.toFixed(2)} kWh · ${r.cost.toFixed(2)}
            </span>
          </p>
        ))}
        {rows.length > 1 ? (
          <p className="mt-1 flex items-center justify-between gap-5 border-t border-line pt-1 text-ink-dim">
            <span>Total</span>
            <span className="font-medium text-ink">${totalCost.toFixed(2)}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ── Section ───────────────────────────────────────────────────── */

export const RuntimeSection = memo(function RuntimeSection({
  range,
  pumps,
  bodies,
  lights,
}: {
  range: RangeDef;
  pumps: EquipRef[];
  bodies: EquipRef[];
  lights: EquipRef[];
}): React.JSX.Element {
  const query = useRuntime(range);
  const rows: RuntimeRow[] = useMemo(() => query.data?.rows ?? [], [query.data]);

  // Totals per equipment key over the whole range.
  const totals = useMemo(() => {
    const map = new Map<string, { hours: number; kwh: number; cost: number }>();
    for (const row of rows) {
      const t = map.get(row.key) ?? { hours: 0, kwh: 0, cost: 0 };
      t.hours += row.hours;
      t.kwh += row.kwh;
      t.cost += row.cost;
      map.set(row.key, t);
    }
    return map;
  }, [rows]);

  const equipment = useMemo(() => {
    return [...totals.keys()]
      .map((key) => resolveKey(key, pumps, bodies, lights))
      .filter((e): e is ResolvedEquip => e !== null)
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
  }, [totals, pumps, bodies, lights]);

  // Daily stacked pump energy.
  const pumpKeys = useMemo(
    () => [...new Set(rows.filter((r) => r.key.startsWith("pump:")).map((r) => r.key))].sort(),
    [rows]
  );
  const energyRows = useMemo<EnergyRow[]>(() => {
    const byDay = new Map<string, EnergyRow>();
    for (const row of rows) {
      if (!row.key.startsWith("pump:")) continue;
      let er = byDay.get(row.day);
      if (!er) {
        er = { day: row.day };
        byDay.set(row.day, er);
      }
      er[`${row.key}__kwh`] = row.kwh;
      er[`${row.key}__cost`] = row.cost;
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [rows]);

  const costPerKwh = query.data?.costPerKwh;

  return (
    <section className="mt-8">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-ink">
          <Zap size={17} className="text-accent" /> Runtime &amp; energy
        </h2>
        <p className="mt-0.5 text-sm text-ink-dim">
          Totals over the last {rangeTitle(range)}
          {typeof costPerKwh === "number" ? ` · $${costPerKwh.toFixed(2)}/kWh` : ""}
        </p>
      </div>

      {query.isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-28 rounded-panel" />
          ))}
        </div>
      ) : query.isError ? (
        <Panel className="p-6 text-center text-sm text-ink-dim">
          Couldn&apos;t load runtime data
          {query.error instanceof Error ? ` — ${query.error.message}` : ""}.
        </Panel>
      ) : equipment.length === 0 ? (
        <Panel className="p-8 text-center text-sm text-ink-dim">
          Collecting runtime data — check back in an hour.
        </Panel>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {equipment.map((equip, i) => {
            const t = totals.get(equip.key) ?? { hours: 0, kwh: 0, cost: 0 };
            const Icon = KIND_ICON[equip.kind];
            return (
              <motion.div
                key={equip.key}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, type: "spring", stiffness: 300, damping: 30 }}
              >
                <Panel className="h-full p-4">
                  <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
                    <Icon size={14} className={equip.kind === "heater" ? "text-heat" : "text-accent"} />
                    <span className="truncate">{equip.name}</span>
                  </p>
                  <p className="temp-display mt-2.5 text-2xl text-ink">
                    <NumberTicker value={t.hours} decimals={1} />
                    <span className="ml-1 text-xs font-normal text-ink-dim">h</span>
                  </p>
                  {equip.kind === "pump" ? (
                    <p className="mt-1 text-xs text-ink-dim">
                      {t.kwh.toFixed(1)} kWh · <span className="text-ink">${t.cost.toFixed(2)}</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-ink-faint">
                      {equip.kind === "heater" ? "run hours" : "on time"} · {rangeTitle(range)}
                    </p>
                  )}
                </Panel>
              </motion.div>
            );
          })}
        </div>
      )}

      <div className="mt-4">
        <ChartCard
          title="Pump energy · daily kWh"
          loading={query.isPending}
          error={
            query.isError ? (query.error instanceof Error ? query.error.message : "Request failed") : undefined
          }
          empty={energyRows.length === 0}
          height={220}
          delay={0.1}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={energyRows} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
              <XAxis
                dataKey="day"
                tickFormatter={dayLabel}
                tick={{ fill: CHART_COLORS.tick, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                tick={{ fill: CHART_COLORS.tick, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={38}
              />
              <Tooltip cursor={{ fill: "var(--accent-soft)" }} content={<EnergyTooltip />} />
              {pumpKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={`${key}__kwh`}
                  stackId="kwh"
                  name={pumps.find((p) => `pump:${p.id}` === key)?.name ?? key}
                  fill={BAR_PALETTE[i % BAR_PALETTE.length]}
                  radius={i === pumpKeys.length - 1 ? [4, 4, 0, 0] : undefined}
                  maxBarSize={28}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </section>
  );
});
