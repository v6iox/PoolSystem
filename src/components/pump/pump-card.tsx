"use client";

import { useState } from "react";
import { Fan } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { Panel } from "@/components/ui/panel";
import { Slider } from "@/components/ui/slider";
import { NumberTicker } from "@/components/ui/number-ticker";
import { roleAtLeast } from "@/types/auth";
import { cn } from "@/lib/utils";
import type { PumpState } from "@/types/pool";
import { patchPump } from "./optimistic";
import { PumpRuntime } from "./pump-runtime";

const PUMP_TYPE_LABELS: Record<string, string> = {
  vs: "Variable speed",
  vsf: "Variable speed + flow",
  vf: "Variable flow",
  ss: "Single speed",
};

function BigStat({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-line bg-abyss/30 px-2 py-3 text-center">
      <p className="temp-display text-3xl text-ink">{children}</p>
      <p className="mt-0.5 text-[10px] tracking-wider text-ink-faint uppercase">{label}</p>
    </div>
  );
}

/** Hero card for one pump: live stats, RPM slider, circuit speed presets, runtime cost. */
export function PumpCard({ pump }: { pump: PumpState }): React.JSX.Element {
  const { sendAction, backendConnected, user } = usePool();
  const canControl = backendConnected && roleAtLeast(user.role, "family");
  const [draft, setDraft] = useState<number | null>(null);

  const shownRpm = draft ?? pump.rpm;
  const hasSpeedControl = pump.maxSpeed > pump.minSpeed;
  const spinSeconds = pump.isRunning && pump.rpm > 0 ? Math.min(6, Math.max(0.5, 3600 / pump.rpm)) : 0;

  const commit = (rpm: number): void => {
    setDraft(null);
    void sendAction({ type: "setPumpSpeed", pumpId: pump.id, rpm }, patchPump(pump.id, { rpm }));
  };

  return (
    <Panel className={cn("flex h-full flex-col gap-5 p-5 sm:p-6", pump.isRunning && "pulse-active")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "shrink-0 rounded-full p-2.5",
              pump.isRunning ? "bg-accent-soft text-accent" : "bg-abyss/50 text-ink-faint"
            )}
          >
            <Fan
              size={22}
              className={pump.isRunning ? "animate-spin" : undefined}
              style={pump.isRunning ? { animationDuration: `${spinSeconds}s` } : undefined}
            />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold text-ink">{pump.name}</p>
            <p className="text-xs text-ink-dim">{PUMP_TYPE_LABELS[pump.type] ?? pump.type.toUpperCase()}</p>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase",
            pump.isRunning ? "bg-accent-soft text-accent" : "bg-abyss/50 text-ink-faint"
          )}
        >
          {pump.isRunning ? "Running" : "Off"}
        </span>
      </div>

      <div className={cn("grid gap-2.5", pump.flow !== null ? "grid-cols-3" : "grid-cols-2")}>
        <BigStat label="RPM">
          <NumberTicker value={shownRpm} />
        </BigStat>
        <BigStat label="Watts">
          <NumberTicker value={pump.watts} />
        </BigStat>
        {pump.flow !== null && (
          <BigStat label="GPM">
            <NumberTicker value={pump.flow} />
          </BigStat>
        )}
      </div>

      {hasSpeedControl && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">Speed</span>
            <span className="text-xs text-ink-dim">
              {shownRpm} <span className="text-ink-faint">rpm</span>
            </span>
          </div>
          <Slider
            value={shownRpm}
            min={pump.minSpeed}
            max={pump.maxSpeed}
            step={10}
            accent="accent"
            disabled={!canControl}
            onValueChange={(v) => setDraft(v)}
            onValueCommit={commit}
            aria-label={`${pump.name} speed`}
          />
          <div className="mt-0.5 flex justify-between text-[10px] text-ink-faint">
            <span>{pump.minSpeed}</span>
            <span>{pump.maxSpeed}</span>
          </div>
        </div>
      )}

      {pump.circuits.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">Circuit presets</p>
          <div className="flex flex-wrap gap-2">
            {pump.circuits.map((c) => {
              const active = c.units === "rpm" && c.speed === shownRpm;
              return (
                <button
                  key={c.circuitId}
                  type="button"
                  disabled={!canControl || c.units !== "rpm"}
                  onClick={() => commit(c.speed)}
                  className={cn(
                    "flex min-h-[44px] items-center gap-2 rounded-full border px-3.5 py-2 text-xs transition-colors",
                    "disabled:pointer-events-none disabled:opacity-40",
                    active
                      ? "border-accent/60 bg-accent-soft text-accent"
                      : "border-line bg-abyss/40 text-ink-dim hover:border-line-bright hover:text-ink"
                  )}
                >
                  <span className="font-medium">{c.circuitName}</span>
                  <span className={cn("temp-display", active ? "text-accent" : "text-ink-faint")}>
                    {c.speed}
                    <span className="ml-0.5 text-[9px] uppercase">{c.units}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-auto">
        <PumpRuntime pumpId={pump.id} />
      </div>
    </Panel>
  );
}
