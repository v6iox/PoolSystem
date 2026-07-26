"use client";

import { useState } from "react";
import { Droplets, Waves } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { Panel } from "@/components/ui/panel";
import { Slider } from "@/components/ui/slider";
import { NumberTicker } from "@/components/ui/number-ticker";
import { roleAtLeast } from "@/types/auth";
import { cn } from "@/lib/utils";
import type { ChlorinatorState } from "@/types/pool";
import { patchChlorinator } from "./optimistic";
import { OutputRing } from "./output-ring";

/** Full scale for the salt bar — comfortably above any healthy salt level. */
const SALT_SCALE_MAX = 4500;

/** Salt-level hero: big ppm readout, low/ok pill, level bar with target marker, output ring. */
export function ChlorSaltHero({ chlor }: { chlor: ChlorinatorState }): React.JSX.Element {
  const barPct = Math.max(0, Math.min(100, (chlor.saltLevel / SALT_SCALE_MAX) * 100));
  const targetPct = Math.max(0, Math.min(100, (chlor.saltTarget / SALT_SCALE_MAX) * 100));

  return (
    <Panel
      className={cn(
        "p-5 sm:p-6",
        chlor.superChlor ? "pulse-heat" : chlor.isActive && "pulse-active"
      )}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "shrink-0 rounded-full p-2.5",
              chlor.superChlor
                ? "bg-heat-soft text-heat"
                : chlor.isActive
                  ? "bg-accent-soft text-accent"
                  : "bg-abyss/50 text-ink-faint"
            )}
          >
            <Droplets size={22} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold text-ink">{chlor.name}</p>
            <p className="text-xs capitalize text-ink-dim">
              {chlor.superChlor ? "Super-chlorinating" : chlor.isActive ? "Generating" : "Standby"} · {chlor.status}
            </p>
          </div>
        </div>
        {chlor.superChlor && (
          <span className="shrink-0 rounded-full bg-heat-soft px-2.5 py-1 text-[10px] font-semibold tracking-wide text-heat uppercase">
            boost
          </span>
        )}
      </div>

      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">Salt level</p>
          <div className="mt-1 flex items-end gap-3">
            <span className="temp-display text-5xl text-ink">
              <NumberTicker value={chlor.saltLevel} />
            </span>
            <span className="mb-1.5 text-sm text-ink-dim">ppm</span>
            <span
              className={cn(
                "mb-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                chlor.saltRequired ? "bg-danger/15 text-danger" : "bg-ok/15 text-ok"
              )}
            >
              {chlor.saltRequired ? "Salt low" : "Salt OK"}
            </span>
          </div>
          <div className="relative mt-4 h-2 rounded-full bg-abyss/60">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-700",
                chlor.saltRequired ? "bg-danger" : "bg-gradient-to-r from-accent/50 to-accent"
              )}
              style={{ width: `${barPct}%` }}
            />
            <div
              className="absolute -top-1 h-4 w-0.5 rounded bg-ink-faint/80"
              style={{ left: `${targetPct}%` }}
              title={`Target ${chlor.saltTarget} ppm`}
            />
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            target {chlor.saltTarget.toLocaleString()} ppm
            {chlor.saltRequired && <span className="ml-2 text-warn">add salt to raise the level</span>}
          </p>
        </div>
        <OutputRing value={chlor.currentOutput} heat={chlor.superChlor} />
      </div>
    </Panel>
  );
}

/** Pool / spa output-setpoint sliders. */
export function ChlorOutputs({
  chlor,
  hasSpa,
}: {
  chlor: ChlorinatorState;
  hasSpa: boolean;
}): React.JSX.Element {
  const { sendAction, backendConnected, user } = usePool();
  const canControl = backendConnected && roleAtLeast(user.role, "family");
  const [poolDraft, setPoolDraft] = useState<number | null>(null);
  const [spaDraft, setSpaDraft] = useState<number | null>(null);

  const commit = (field: "poolSetpoint" | "spaSetpoint", value: number): void => {
    if (field === "poolSetpoint") {
      setPoolDraft(null);
      void sendAction(
        { type: "setChlorinator", chlorId: chlor.id, poolSetpoint: value },
        patchChlorinator(chlor.id, { poolSetpoint: value })
      );
    } else {
      setSpaDraft(null);
      void sendAction(
        { type: "setChlorinator", chlorId: chlor.id, spaSetpoint: value },
        patchChlorinator(chlor.id, { spaSetpoint: value })
      );
    }
  };

  const rows: Array<{
    field: "poolSetpoint" | "spaSetpoint";
    label: string;
    shown: number;
    accent: "accent" | "heat";
    setDraft: (v: number) => void;
  }> = [
    {
      field: "poolSetpoint",
      label: "Pool output",
      shown: poolDraft ?? chlor.poolSetpoint,
      accent: "accent",
      setDraft: setPoolDraft,
    },
  ];
  if (hasSpa) {
    rows.push({
      field: "spaSetpoint",
      label: "Spa output",
      shown: spaDraft ?? chlor.spaSetpoint,
      accent: "heat",
      setDraft: setSpaDraft,
    });
  }

  return (
    <Panel className="flex h-full flex-col gap-5 p-5">
      <div className="flex items-center gap-2">
        <Waves size={15} className="text-accent" />
        <p className="text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">Output setpoints</p>
      </div>
      {rows.map((row) => (
        <div key={row.field}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm text-ink">{row.label}</span>
            <span className="temp-display text-sm text-ink-dim">{row.shown}%</span>
          </div>
          <Slider
            value={row.shown}
            min={0}
            max={100}
            step={1}
            accent={row.accent}
            disabled={!canControl}
            onValueChange={row.setDraft}
            onValueCommit={(v) => commit(row.field, v)}
            aria-label={row.label}
          />
        </div>
      ))}
      <p className="mt-auto text-xs text-ink-faint">
        Percent of pump runtime the cell spends generating chlorine.
      </p>
    </Panel>
  );
}
