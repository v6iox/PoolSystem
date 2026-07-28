"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Thermometer } from "lucide-react";
import { apiGet, apiSend } from "@/lib/client/api";
import { usePool } from "@/lib/client/pool-state";
import { toast } from "@/stores/toast";
import { SettingRow, SettingsSection } from "@/components/settings/section";
import { Skeleton } from "@/components/ui/panel";

/**
 * Temperature-sensor offsets. On EasyTouch/IntelliTouch/IntelliCenter these
 * are applied BY MOONPOOL to everything it shows and automates — njsPC only
 * stores calibration for touch panels without ever applying it, and no
 * RS-485 message exists to push calibration into the panel (Pentair only
 * allows that at the panel's own menu). Standalone/Nixie controllers apply
 * njsPC-side calibration properly, so there the offsets write through.
 * Owner-only.
 */

interface Calibration {
  water1: number;
  water2: number | null;
  air: number | null;
  solar1: number | null;
  solar2: number | null;
  min: number;
  max: number;
}

type Field = "water1" | "water2" | "air" | "solar1" | "solar2";

function Stepper({
  value,
  min,
  max,
  unit,
  busy,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  unit: string;
  busy: boolean;
  onChange: (next: number) => void;
  label: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={busy || value <= min}
        onClick={() => onChange(value - 1)}
        aria-label={`Decrease ${label}`}
        className="rounded-lg border border-line p-1.5 text-ink-dim transition hover:text-accent disabled:opacity-30"
      >
        <Minus size={14} />
      </button>
      <span className="w-14 text-center text-sm font-medium tabular-nums text-ink">
        {value > 0 ? "+" : ""}
        {value}
        {unit}
      </span>
      <button
        type="button"
        disabled={busy || value >= max}
        onClick={() => onChange(value + 1)}
        aria-label={`Increase ${label}`}
        className="rounded-lg border border-line p-1.5 text-ink-dim transition hover:text-accent disabled:opacity-30"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

export function CalibrationSection(): React.JSX.Element | null {
  const { snapshot, backendConnected } = usePool();
  const queryClient = useQueryClient();
  const [busyField, setBusyField] = useState<Field | null>(null);
  const query = useQuery({
    queryKey: ["calibration"],
    queryFn: () => apiGet<{ calibration: Calibration }>("/api/settings/calibration"),
  });

  const cal = query.data?.calibration;
  const unit = `°${snapshot.units}`;

  const adjust = (field: Field, next: number): void => {
    if (!cal) return;
    setBusyField(field);
    void apiSend<{ calibration: Calibration }>("PUT", "/api/settings/calibration", { [field]: next })
      .then((res) => {
        queryClient.setQueryData(["calibration"], res);
        toast("success", "Calibration updated", `Sensor offset is now ${next > 0 ? "+" : ""}${next}${unit}.`);
      })
      .catch((err: unknown) => {
        toast("error", "Couldn't update calibration", err instanceof Error ? err.message : undefined);
      })
      .finally(() => setBusyField(null));
  };

  const rows: Array<{ field: Field; label: string; hint: string; value: number | null }> = cal
    ? [
        { field: "water1", label: "Water temperature", hint: "Offset applied to the water sensor reading", value: cal.water1 },
        { field: "water2", label: "Water temperature (2nd body)", hint: "Second water sensor, dual-equipment systems", value: cal.water2 },
        { field: "air", label: "Air temperature", hint: "Offset for the outdoor air sensor", value: cal.air },
        { field: "solar1", label: "Solar temperature", hint: "Offset for the solar/roof sensor", value: cal.solar1 },
        { field: "solar2", label: "Solar temperature (2nd)", hint: "Second solar sensor", value: cal.solar2 },
      ]
    : [];

  return (
    <SettingsSection
      icon={<Thermometer size={14} />}
      title="Sensor calibration"
      description={`Nudge readings to match a trusted thermometer — applied instantly to everything Moonpool shows, logs and automates. The panel's own screen keeps its factory reading (Pentair only allows calibrating that at the panel itself). Range ${cal ? `${cal.min}${unit} to +${cal.max}${unit}` : "±10°"}.`}
    >
      {query.isPending ? (
        <div className="p-4">
          <Skeleton className="h-16" />
        </div>
      ) : query.isError || !cal ? (
        <p className="px-4 py-3.5 text-sm text-ink-faint">
          Couldn&apos;t read calibration from the controller{query.error instanceof Error ? ` (${query.error.message})` : ""} — it may
          not be connected right now.
        </p>
      ) : (
        rows
          .filter((r) => r.value !== null)
          .map((r) => (
            <SettingRow key={r.field} label={r.label} hint={r.hint}>
              <Stepper
                value={r.value as number}
                min={cal.min}
                max={cal.max}
                unit={unit}
                busy={busyField === r.field || !backendConnected}
                onChange={(next) => adjust(r.field, next)}
                label={r.label}
              />
            </SettingRow>
          ))
      )}
    </SettingsSection>
  );
}
