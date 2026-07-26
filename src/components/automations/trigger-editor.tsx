"use client";

import { motion } from "motion/react";
import { AlertTriangle, Snowflake } from "lucide-react";
import type { PoolEventKind } from "@/types/actions";
import type { PoolStateSnapshot } from "@/types/pool";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn, DAY_LABELS } from "@/lib/utils";
import { describeSunOffset, describeTriggerDays, EVENT_OPTIONS } from "@/components/automations/describe";
import {
  cronProblem,
  defaultTriggerDraft,
  type TriggerDraft,
  type TriggerType,
} from "@/components/automations/drafts";

const TRIGGER_TYPE_OPTIONS: Array<{ value: TriggerType; label: string }> = [
  { value: "time", label: "Time of day" },
  { value: "sun", label: "Sunrise / sunset" },
  { value: "cron", label: "Cron expression" },
  { value: "tempThreshold", label: "Temperature threshold" },
  { value: "saltLow", label: "Salt runs low" },
  { value: "freezeProtect", label: "Freeze protection" },
  { value: "event", label: "System event" },
];

const DAY_PRESETS: Array<{ label: string; days: number[] }> = [
  { label: "Every day", days: [] },
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Weekends", days: [0, 6] },
];

/** Day-of-week pills; an empty selection means "every day". */
function DayPills({
  days,
  onChange,
}: {
  days: number[];
  onChange: (days: number[]) => void;
}): React.JSX.Element {
  const toggle = (day: number): void => {
    onChange(days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b));
  };
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="block text-xs font-medium tracking-wide text-ink-dim uppercase">Days</span>
        <span className="flex gap-2">
          {DAY_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.days)}
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
              onClick={() => toggle(day)}
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
      <p className="mt-1.5 text-xs text-ink-faint">
        {days.length === 0 ? "No days picked — runs every day." : describeTriggerDays(days)}
      </p>
    </div>
  );
}

function MissingEquipment({ what }: { what: string }): React.JSX.Element {
  return (
    <p className="flex items-center gap-2 rounded-xl border border-warn/25 bg-warn/10 px-3 py-2 text-xs text-warn">
      <AlertTriangle size={14} className="shrink-0" />
      No {what} reported by the controller — this trigger can’t fire.
    </p>
  );
}

/** Per-type editor for one automation trigger draft. */
export function TriggerEditor({
  draft,
  onChange,
  snapshot,
}: {
  draft: TriggerDraft;
  onChange: (draft: TriggerDraft) => void;
  snapshot: PoolStateSnapshot;
}): React.JSX.Element {
  const cronErr = draft.type === "cron" ? cronProblem(draft.expression) : null;

  return (
    <div className="space-y-4">
      <Field label="Trigger">
        <Select
          value={draft.type}
          onValueChange={(v) => onChange(defaultTriggerDraft(v as TriggerType, snapshot))}
          options={TRIGGER_TYPE_OPTIONS}
          aria-label="Trigger type"
        />
      </Field>

      {draft.type === "time" && (
        <>
          <Field label="At">
            <Input
              type="time"
              value={draft.at}
              onChange={(e) => onChange({ ...draft, at: e.target.value })}
              aria-label="Trigger time"
            />
          </Field>
          <DayPills days={draft.days} onChange={(days) => onChange({ ...draft, days })} />
        </>
      )}

      {draft.type === "cron" && (
        <Field
          label="Expression"
          hint={cronErr ?? "minute · hour · day-of-month · month · day-of-week, e.g. 0 20 * * 1-5 = 8 PM on weekdays"}
        >
          <Input
            value={draft.expression}
            onChange={(e) => onChange({ ...draft, expression: e.target.value })}
            placeholder="0 20 * * *"
            spellCheck={false}
            aria-label="Cron expression"
            className={cn("font-mono", cronErr && draft.expression.trim() !== "" && "border-warn/60")}
          />
        </Field>
      )}

      {draft.type === "sun" && (
        <>
          <Field label="Event">
            <Select
              value={draft.event}
              onValueChange={(v) => onChange({ ...draft, event: v as "sunrise" | "sunset" })}
              options={[
                { value: "sunrise", label: "Sunrise" },
                { value: "sunset", label: "Sunset" },
              ]}
              aria-label="Sun event"
            />
          </Field>
          <Field label="Offset">
            <div className="flex items-center gap-3">
              <Slider
                value={draft.offsetMinutes}
                onValueChange={(v) => onChange({ ...draft, offsetMinutes: v })}
                min={-120}
                max={120}
                step={5}
                aria-label="Sun offset in minutes"
                className="flex-1"
              />
              <span className="w-32 shrink-0 text-right text-sm text-ink">
                {describeSunOffset(draft.offsetMinutes, draft.event)}
              </span>
            </div>
          </Field>
          <DayPills days={draft.days} onChange={(days) => onChange({ ...draft, days })} />
        </>
      )}

      {draft.type === "tempThreshold" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Sensor">
            <Select
              value={draft.sensor}
              onValueChange={(v) => onChange({ ...draft, sensor: v })}
              options={[
                { value: "air", label: "Air temperature" },
                ...snapshot.bodies.map((b) => ({ value: `body:${b.id}`, label: `${b.name} water` })),
              ]}
              aria-label="Temperature sensor"
            />
          </Field>
          <Field label="Direction">
            <Select
              value={draft.direction}
              onValueChange={(v) => onChange({ ...draft, direction: v as "above" | "below" })}
              options={[
                { value: "above", label: "Rises above" },
                { value: "below", label: "Drops below" },
              ]}
              aria-label="Threshold direction"
            />
          </Field>
          <Field label={`Temp °${snapshot.units}`}>
            <Input
              type="number"
              value={draft.value}
              onChange={(e) => onChange({ ...draft, value: e.target.value })}
              placeholder="90"
              aria-label="Threshold temperature"
            />
          </Field>
        </div>
      )}

      {draft.type === "saltLow" &&
        (snapshot.chlorinators.length === 0 && draft.chlorId === "" ? (
          <MissingEquipment what="chlorinator" />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Chlorinator">
              <Select
                value={draft.chlorId}
                onValueChange={(v) => onChange({ ...draft, chlorId: v })}
                options={snapshot.chlorinators.map((c) => ({ value: String(c.id), label: c.name }))}
                placeholder="Pick one"
                aria-label="Chlorinator"
              />
            </Field>
            <Field label="Below ppm" hint="Fires once as salt crosses this level">
              <Input
                type="number"
                min={0}
                step={100}
                value={draft.belowPpm}
                onChange={(e) => onChange({ ...draft, belowPpm: e.target.value })}
                placeholder="2800"
                aria-label="Salt threshold in ppm"
              />
            </Field>
          </div>
        ))}

      {draft.type === "freezeProtect" && (
        <p className="flex items-center gap-2 rounded-xl border border-line bg-abyss/40 px-3 py-2.5 text-xs text-ink-dim">
          <Snowflake size={15} className="shrink-0 text-accent" />
          Runs once each time the panel activates freeze protection — no other settings needed.
        </p>
      )}

      {draft.type === "event" && (
        <Field label="When">
          <Select
            value={draft.event}
            onValueChange={(v) => onChange({ ...draft, event: v as PoolEventKind })}
            options={EVENT_OPTIONS}
            aria-label="Event kind"
          />
        </Field>
      )}
    </div>
  );
}
