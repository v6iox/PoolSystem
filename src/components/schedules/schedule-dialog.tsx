"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CalendarCheck, Repeat, Timer, Trash2 } from "lucide-react";
import type { CircuitState, ScheduleInput, ScheduleState } from "@/types/pool";
import { usePool } from "@/lib/client/pool-state";
import { apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn, DAY_LABELS, formatDays, formatMinutes } from "@/lib/utils";
import { findConflicts, minutesToTimeValue, timeValueToMinutes } from "@/components/schedules/helpers";

const HEAT_SOURCES = [
  { value: "none", label: "No heat change" },
  { value: "off", label: "Off" },
  { value: "heater", label: "Heater" },
  { value: "solar", label: "Solar" },
  { value: "solarpref", label: "Solar preferred" },
];

const DAY_PRESETS: Array<{ label: string; days: number[] }> = [
  { label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] },
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Weekends", days: [0, 6] },
];

function TypePicker({
  value,
  onChange,
}: {
  value: "repeat" | "runonce";
  onChange: (v: "repeat" | "runonce") => void;
}): React.JSX.Element {
  const options = [
    { value: "repeat" as const, label: "Repeats", icon: Repeat },
    { value: "runonce" as const, label: "Run once", icon: CalendarCheck },
  ];
  return (
    <div role="radiogroup" aria-label="Schedule type" className="flex rounded-xl border border-line bg-abyss/40 p-1">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors duration-200",
              selected ? "text-accent" : "text-ink-faint hover:text-ink-dim"
            )}
          >
            {selected && (
              <motion.span
                layoutId="schedule-type-pill"
                className="absolute inset-0 rounded-lg bg-accent-soft"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <opt.icon size={13} className="relative z-10" />
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ScheduleForm({
  schedule,
  circuits,
  close,
}: {
  schedule: ScheduleState | null;
  circuits: CircuitState[];
  close: () => void;
}): React.JSX.Element {
  const { snapshot, backendConnected } = usePool();

  const [circuitId, setCircuitId] = useState<string>(
    schedule ? String(schedule.circuitId) : String(circuits[0]?.id ?? "")
  );
  const [start, setStart] = useState(schedule ? minutesToTimeValue(schedule.startTime) : "09:00");
  const [end, setEnd] = useState(schedule ? minutesToTimeValue(schedule.endTime) : "17:00");
  const [days, setDays] = useState<number[]>(schedule?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [type, setType] = useState<"repeat" | "runonce">(schedule?.scheduleType ?? "repeat");
  const [heatSetpoint, setHeatSetpoint] = useState(
    schedule?.heatSetpoint !== null && schedule?.heatSetpoint !== undefined ? String(schedule.heatSetpoint) : ""
  );
  const [heatSource, setHeatSource] = useState(schedule?.heatSource ?? "none");

  const startMin = timeValueToMinutes(start);
  const endMin = timeValueToMinutes(end);
  const circuitNum = Number(circuitId);
  const body = snapshot.bodies.find((b) => b.circuitId === circuitNum);
  const circuitName = circuits.find((c) => c.id === circuitNum)?.name ?? `Circuit ${circuitId}`;

  const setpointNum = heatSetpoint === "" ? null : Number(heatSetpoint);
  const setpointInvalid =
    setpointNum !== null && (!Number.isFinite(setpointNum) || setpointNum < 60 || setpointNum > 104);

  const conflicts = useMemo(() => {
    if (startMin === null || endMin === null || !Number.isFinite(circuitNum)) return [];
    return findConflicts(
      { id: schedule?.id, circuitId: circuitNum, startTime: startMin, endTime: endMin, days },
      snapshot.schedules
    );
  }, [schedule?.id, circuitNum, startMin, endMin, days, snapshot.schedules]);

  const overnight = startMin !== null && endMin !== null && endMin < startMin;
  const zeroLength = startMin !== null && endMin !== null && endMin === startMin;
  const canSave =
    backendConnected &&
    circuitId !== "" &&
    Number.isFinite(circuitNum) &&
    startMin !== null &&
    endMin !== null &&
    !zeroLength &&
    days.length > 0 &&
    !setpointInvalid;

  const toggleDay = (day: number): void => {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));
  };

  const save = async (): Promise<void> => {
    if (startMin === null || endMin === null) return;
    const input: ScheduleInput = {
      id: schedule?.id,
      circuitId: circuitNum,
      startTime: startMin,
      endTime: endMin,
      days: [...days].sort((a, b) => a - b),
      scheduleType: type,
      heatSetpoint: body && setpointNum !== null && !setpointInvalid ? Math.round(setpointNum) : null,
      heatSource: body && heatSource !== "none" ? heatSource : null,
    };
    close(); // optimistic — the SSE snapshot will reflect the change
    try {
      await apiSend<{ ok: boolean }>("POST", "/api/schedules", input);
      toast(
        "success",
        schedule ? "Schedule updated" : "Schedule created",
        `${circuitName} · ${formatMinutes(startMin)} – ${formatMinutes(endMin)}`
      );
    } catch (err) {
      toast("error", "Couldn't save schedule", err instanceof Error ? err.message : "Unknown error");
    }
  };

  const remove = async (): Promise<void> => {
    if (!schedule) return;
    close();
    try {
      await apiSend<{ ok: boolean }>("DELETE", `/api/schedules?id=${schedule.id}`);
      toast("success", "Schedule deleted", `${schedule.circuitName} no longer scheduled.`);
    } catch (err) {
      toast("error", "Couldn't delete schedule", err instanceof Error ? err.message : "Unknown error");
    }
  };

  return (
    <div className="space-y-4">
      {schedule?.isEggTimer && (
        <p className="flex items-center gap-2 rounded-xl border border-line bg-abyss/40 px-3 py-2 text-xs text-ink-dim">
          <Timer size={14} className="shrink-0 text-accent" />
          This is an egg timer — it runs for a duration after the circuit turns on rather than at fixed times.
        </p>
      )}

      <Field label="Circuit">
        <Select
          value={circuitId}
          onValueChange={setCircuitId}
          options={circuits.map((c) => ({ value: String(c.id), label: c.name }))}
          placeholder="Pick a circuit"
          aria-label="Circuit"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts">
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start time" />
        </Field>
        <Field
          label="Ends"
          hint={zeroLength ? "End must differ from start" : overnight ? "Ends next day (overnight run)" : undefined}
        >
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End time" />
        </Field>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="block text-xs font-medium tracking-wide text-ink-dim uppercase">Days</span>
          <span className="flex gap-2">
            {DAY_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setDays(preset.days)}
                className="text-[11px] text-ink-faint transition-colors hover:text-accent"
              >
                {preset.label}
              </button>
            ))}
          </span>
        </div>
        <div className="flex justify-between gap-1">
          {DAY_LABELS.map((label, day) => {
            const on = days.includes(day);
            return (
              <motion.button
                key={label}
                type="button"
                whileTap={{ scale: 0.9 }}
                transition={{ type: "spring", stiffness: 500, damping: 28 }}
                onClick={() => toggleDay(day)}
                aria-pressed={on}
                aria-label={label}
                className={cn(
                  "h-11 w-11 rounded-full text-xs font-semibold transition-colors duration-200",
                  on
                    ? "bg-accent text-abyss shadow-[0_2px_12px_-2px] shadow-accent/50"
                    : "border border-line bg-abyss/40 text-ink-faint hover:text-ink-dim"
                )}
              >
                {label.slice(0, 2)}
              </motion.button>
            );
          })}
        </div>
        {days.length === 0 && <p className="mt-1.5 text-xs text-warn">Pick at least one day.</p>}
      </div>

      <TypePicker value={type} onChange={setType} />

      <AnimatePresence initial={false}>
        {body && (
          <motion.div
            key="heat"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 rounded-xl border border-heat/20 bg-heat-soft/40 p-3">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-heat uppercase">
                Heat while running · {body.name}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Setpoint" hint={setpointInvalid ? "Must be 60–104" : "60–104, blank = none"}>
                  <Input
                    type="number"
                    min={60}
                    max={104}
                    step={1}
                    placeholder="—"
                    value={heatSetpoint}
                    onChange={(e) => setHeatSetpoint(e.target.value)}
                    aria-label="Heat setpoint"
                    className={cn(setpointInvalid && "border-warn/60")}
                  />
                </Field>
                <Field label="Heat source">
                  <Select
                    value={heatSource}
                    onValueChange={setHeatSource}
                    options={HEAT_SOURCES}
                    aria-label="Heat source"
                  />
                </Field>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {conflicts.length > 0 && (
        <div className="flex gap-2.5 rounded-xl border border-warn/25 bg-warn/10 px-3 py-2.5 text-xs">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
          <div className="space-y-1 text-warn">
            <p className="font-semibold">
              Overlaps {conflicts.length} other {conflicts.length === 1 ? "schedule" : "schedules"} for {circuitName}:
            </p>
            <ul className="space-y-0.5 text-warn/90">
              {conflicts.slice(0, 3).map((c) => (
                <li key={c.id}>
                  {formatDays(c.days)} · {formatMinutes(c.startTime)} – {formatMinutes(c.endTime)}
                </li>
              ))}
              {conflicts.length > 3 && <li>…and {conflicts.length - 3} more</li>}
            </ul>
            <p className="text-warn/80">You can still save — the circuit simply stays on through the overlap.</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        {schedule ? (
          <Button variant="danger" size="sm" disabled={!backendConnected} onClick={() => void remove()}>
            <Trash2 size={14} /> Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="md">
              Cancel
            </Button>
          </DialogClose>
          <Button variant="primary" size="md" disabled={!canSave} onClick={() => void save()}>
            {schedule ? "Save changes" : "Add schedule"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Create/edit dialog for one njsPC schedule. Mount with `schedule=null` to create. */
export function ScheduleDialog({
  open,
  onOpenChange,
  schedule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: ScheduleState | null;
}): React.JSX.Element {
  const { snapshot } = usePool();

  // All circuits + features, deduped by id (schedules can target either).
  const circuits = useMemo(() => {
    const seen = new Set<number>();
    return [...snapshot.circuits, ...snapshot.features].filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [snapshot.circuits, snapshot.features]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title={schedule ? "Edit schedule" : "New schedule"}
          description={schedule ? `${schedule.circuitName} · schedule #${schedule.id}` : "Run a circuit automatically."}
        >
          <ScheduleForm
            key={schedule?.id ?? "new"}
            schedule={schedule}
            circuits={circuits}
            close={() => onOpenChange(false)}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}
