"use client";

import { AlertTriangle, FlaskConical } from "lucide-react";
import type { ChemControllerState } from "@/types/pool";
import { Panel } from "@/components/ui/panel";
import { NumberTicker } from "@/components/ui/number-ticker";
import { formatChemNumber } from "@/lib/dosing";
import { cn } from "@/lib/utils";

/** Live IntelliChem readouts — only rendered when the panel reports a chem controller. */

function dosingTone(dosing: string): "active" | "warn" | "idle" {
  const d = dosing.toLowerCase();
  if (d.includes("dos")) return "active";
  if (d.includes("mix") || d.includes("delay")) return "warn";
  return "idle";
}

function Readout({
  label,
  value,
  decimals,
  unit,
  setpoint,
  dosing,
}: {
  label: string;
  value: number | null;
  decimals: number;
  unit: string;
  setpoint: number | null;
  dosing: string;
}): React.JSX.Element {
  const tone = dosingTone(dosing);
  return (
    <div className="rounded-xl border border-line bg-abyss/30 px-4 py-3 text-center">
      <p className="text-[10px] font-semibold tracking-wider text-ink-faint uppercase">{label}</p>
      <p className="temp-display mt-1 text-4xl text-ink">
        {value !== null ? <NumberTicker value={value} decimals={decimals} /> : "—"}
        {unit && value !== null ? <span className="ml-1 text-xs font-normal text-ink-dim">{unit}</span> : null}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[11px]">
        {setpoint !== null && <span className="text-ink-faint">target {formatChemNumber(setpoint)}</span>}
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-medium capitalize",
            tone === "active" && "bg-accent-soft text-accent pulse-active",
            tone === "warn" && "bg-warn/10 text-warn",
            tone === "idle" && "bg-abyss/50 text-ink-faint"
          )}
        >
          {dosing || "monitoring"}
        </span>
      </div>
    </div>
  );
}

export function IntelliChemCard({ controllers }: { controllers: ChemControllerState[] }): React.JSX.Element {
  return (
    <div className="space-y-4">
      {controllers.map((chem) => (
        <Panel key={chem.id} bright className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <FlaskConical size={16} className="text-accent" />
              {chem.name}
            </p>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold tracking-wide text-accent uppercase">
              live probe
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Readout label="pH" value={chem.ph} decimals={2} unit="" setpoint={chem.phSetpoint} dosing={chem.phDosing} />
            <Readout label="ORP" value={chem.orp} decimals={0} unit="mV" setpoint={chem.orpSetpoint} dosing={chem.orpDosing} />
          </div>
          {chem.alarms.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {chem.alarms.map((alarm) => (
                <span
                  key={alarm}
                  className="flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-medium text-danger"
                >
                  <AlertTriangle size={11} /> {alarm}
                </span>
              ))}
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}
