"use client";

import { useState } from "react";
import { FlaskConical, Beaker } from "lucide-react";
import { SettingRow } from "@/components/settings/section";
import { AdvancedDisclosure, NumberField, useAdvanced } from "@/components/advanced/core";

/**
 * IntelliChem / chem-doser panel controls: setpoints + tank levels at a
 * glance and an explicit, bounded manual dose. Renders only when the panel
 * reports chemistry automation hardware.
 */
export function ChemAdvanced(): React.JSX.Element | null {
  const { advanced, isOwner, disabled, send } = useAdvanced();
  const [seconds, setSeconds] = useState(30);
  if (!isOwner || !advanced) return null;
  if (advanced.chemControllers.length === 0 && advanced.chemDosers.length === 0) return null;

  return (
    <AdvancedDisclosure
      title="Advanced — chemistry automation"
      hint="IntelliChem / doser configuration as the panel sees it. Manual doses run for a fixed number of seconds and are audited."
    >
      {advanced.chemControllers.map((c) => (
        <div key={c.id} className="px-4 py-3.5">
          <p className="mb-1 flex items-center gap-2 text-sm text-ink">
            <FlaskConical size={15} className="text-accent" /> {c.name}
            <span className="text-xs text-ink-faint">
              {c.typeName}
              {c.bodyDesc ? ` · ${c.bodyDesc}` : ""}
            </span>
          </p>
          <p className="mb-2 text-xs text-ink-dim">
            {c.phSetpoint !== null ? `pH setpoint ${c.phSetpoint}` : ""}
            {c.orpSetpoint !== null ? ` · ORP setpoint ${c.orpSetpoint} mV` : ""}
            {c.phTankLevel !== null ? ` · acid tank ${c.phTankLevel}/7` : ""}
            {c.orpTankLevel !== null ? ` · chlorine tank ${c.orpTankLevel}/7` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-xs text-ink-dim">
              dose for
              <NumberField
                value={seconds}
                min={1}
                max={300}
                suffix="s"
                disabled={disabled}
                ariaLabel="Manual dose seconds"
                onSave={(v) => setSeconds(Math.round(v))}
              />
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void send("chem-feed", { id: c.id, kind: "ph", seconds }, `Acid dose started (${seconds}s)`)}
              className="rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent disabled:opacity-40"
            >
              Dose acid (pH)
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void send("chem-feed", { id: c.id, kind: "orp", seconds }, `Chlorine dose started (${seconds}s)`)}
              className="rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent disabled:opacity-40"
            >
              Dose chlorine (ORP)
            </button>
          </div>
        </div>
      ))}
      {advanced.chemDosers.map((d) => (
        <SettingRow
          key={`doser-${d.id}`}
          icon={<Beaker size={16} />}
          label={d.name}
          hint={`${d.typeName}${d.bodyDesc ? ` · ${d.bodyDesc}` : ""}`}
        />
      ))}
    </AdvancedDisclosure>
  );
}
