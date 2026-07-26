"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronDown,
  ChevronUp,
  Droplets,
  Fan,
  Flame,
  Layers,
  Lightbulb,
  MoonStar,
  Power,
  ToggleRight,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { SceneDef } from "@/types/actions";
import type { PoolStateSnapshot } from "@/types/pool";
import { usePool } from "@/lib/client/pool-state";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  allCircuits,
  describeAction,
  heatModeLabel,
  newStep,
  stepToAction,
  type StepDraft,
  type StepKind,
  type StepResult,
} from "@/components/scenes/steps";

/** Step kinds a user can add (kind "raw" is passthrough-only). */
const ADDABLE_STEPS: Array<{ kind: StepKind; label: string; icon: LucideIcon }> = [
  { kind: "circuit", label: "Circuit", icon: ToggleRight },
  { kind: "heat", label: "Heat", icon: Flame },
  { kind: "light", label: "Light theme", icon: Lightbulb },
  { kind: "chlorinator", label: "Chlorinator", icon: Droplets },
  { kind: "pump", label: "Pump speed", icon: Fan },
  { kind: "scene", label: "Run scene", icon: Layers },
  { kind: "allOff", label: "All off", icon: MoonStar },
];

const STEP_META: Record<StepKind, { label: string; icon: LucideIcon }> = {
  circuit: { label: "Circuit", icon: ToggleRight },
  heat: { label: "Heat", icon: Flame },
  light: { label: "Light theme", icon: Lightbulb },
  chlorinator: { label: "Chlorinator", icon: Droplets },
  pump: { label: "Pump speed", icon: Fan },
  scene: { label: "Run scene", icon: Layers },
  allOff: { label: "Everything off", icon: MoonStar },
  raw: { label: "Advanced step", icon: Power },
};

function StepEditor({
  step,
  snapshot,
  otherScenes,
  update,
}: {
  step: StepDraft;
  snapshot: PoolStateSnapshot;
  otherScenes: SceneDef[];
  update: (patch: Partial<StepDraft>) => void;
}): React.JSX.Element {
  const circuits = allCircuits(snapshot);

  switch (step.kind) {
    case "circuit":
      return (
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <Field label="Circuit">
              <Select
                value={step.circuitId}
                onValueChange={(v) => update({ circuitId: v })}
                options={circuits.map((c) => ({ value: String(c.id), label: c.name }))}
                placeholder="Pick a circuit"
                aria-label="Circuit"
              />
            </Field>
          </div>
          <div className="flex h-11 shrink-0 items-center gap-2 pb-0.5">
            <span className="text-xs font-medium text-ink-dim uppercase">{step.on ? "On" : "Off"}</span>
            <Switch checked={step.on} onCheckedChange={(on) => update({ on })} aria-label="Circuit state" />
          </div>
        </div>
      );

    case "heat": {
      const body = snapshot.bodies.find((b) => String(b.id) === step.bodyId);
      const modeOptions = [
        { value: "keep", label: "Keep current mode" },
        ...(body?.supportedHeatModes ?? []).map((m) => ({ value: m, label: heatModeLabel(m) })),
      ];
      return (
        <div className="space-y-3">
          <Field label="Body of water">
            <Select
              value={step.bodyId}
              onValueChange={(v) => update({ bodyId: v })}
              options={snapshot.bodies.map((b) => ({ value: String(b.id), label: b.name }))}
              placeholder="Pick a body"
              aria-label="Body of water"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Heat mode">
              <Select
                value={step.heatMode}
                onValueChange={(v) => update({ heatMode: v })}
                options={modeOptions}
                aria-label="Heat mode"
              />
            </Field>
            <Field label="Setpoint" hint="60–104, blank = keep">
              <Input
                type="number"
                min={60}
                max={104}
                step={1}
                placeholder="—"
                value={step.setPoint}
                onChange={(e) => update({ setPoint: e.target.value })}
                aria-label="Heat setpoint"
              />
            </Field>
          </div>
        </div>
      );
    }

    case "light": {
      const lightCircuits = circuits.filter((c) => c.isLight);
      const targets = [
        ...snapshot.lightGroups.map((g) => ({ value: `g:${g.id}`, label: `${g.name} (all lights)` })),
        ...lightCircuits.map((c) => ({ value: `c:${c.id}`, label: c.name })),
      ];
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Light">
            <Select
              value={step.lightTarget}
              onValueChange={(v) => update({ lightTarget: v })}
              options={targets}
              placeholder="Pick a light"
              aria-label="Light or group"
            />
          </Field>
          <Field label="Theme">
            <Select
              value={step.theme}
              onValueChange={(v) => update({ theme: v })}
              options={snapshot.lightThemes.map((t) => ({ value: String(t.val), label: t.name }))}
              placeholder="Pick a theme"
              aria-label="Light theme"
            />
          </Field>
        </div>
      );
    }

    case "chlorinator":
      return (
        <div className="space-y-3">
          {snapshot.chlorinators.length > 1 && (
            <Field label="Chlorinator">
              <Select
                value={step.chlorId}
                onValueChange={(v) => update({ chlorId: v })}
                options={snapshot.chlorinators.map((c) => ({ value: String(c.id), label: c.name }))}
                placeholder="Pick a chlorinator"
                aria-label="Chlorinator"
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pool output %">
              <Input
                type="number"
                min={0}
                max={100}
                step={5}
                placeholder="—"
                value={step.poolPct}
                onChange={(e) => update({ poolPct: e.target.value })}
                aria-label="Pool output percent"
              />
            </Field>
            <Field label="Spa output %">
              <Input
                type="number"
                min={0}
                max={100}
                step={5}
                placeholder="—"
                value={step.spaPct}
                onChange={(e) => update({ spaPct: e.target.value })}
                aria-label="Spa output percent"
              />
            </Field>
          </div>
        </div>
      );

    case "pump": {
      const pump = snapshot.pumps.find((p) => String(p.id) === step.pumpId);
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pump">
            <Select
              value={step.pumpId}
              onValueChange={(v) => update({ pumpId: v })}
              options={snapshot.pumps.map((p) => ({ value: String(p.id), label: p.name }))}
              placeholder="Pick a pump"
              aria-label="Pump"
            />
          </Field>
          <Field label="Speed (RPM)" hint={pump ? `${pump.minSpeed}–${pump.maxSpeed}` : undefined}>
            <Input
              type="number"
              min={pump?.minSpeed}
              max={pump?.maxSpeed}
              step={50}
              value={step.rpm}
              onChange={(e) => update({ rpm: e.target.value })}
              aria-label="Pump RPM"
            />
          </Field>
        </div>
      );
    }

    case "scene":
      return otherScenes.length > 0 ? (
        <Field label="Scene" hint="A scene can't run itself.">
          <Select
            value={step.sceneId}
            onValueChange={(v) => update({ sceneId: v })}
            options={otherScenes.map((s) => ({ value: String(s.id), label: s.name }))}
            placeholder="Pick a scene"
            aria-label="Scene to run"
          />
        </Field>
      ) : (
        <p className="text-xs text-ink-faint">No other scenes exist yet — save another scene first.</p>
      );

    case "allOff":
      return <p className="text-xs text-ink-faint">Turns every running circuit and feature off.</p>;

    case "raw":
      return (
        <p className="text-xs text-ink-faint">
          {step.raw ? describeAction(step.raw, snapshot, otherScenes) : "Unknown step"} — kept as-is (no editor for
          this step type).
        </p>
      );
  }
}

/**
 * Ordered list of scene steps with add / remove / reorder and a per-kind
 * editor. Emits validation through `results` (parallel to `steps`).
 */
export function ActionBuilder({
  steps,
  onChange,
  otherScenes,
  results,
}: {
  steps: StepDraft[];
  onChange: (steps: StepDraft[]) => void;
  /** Scenes offered as "run scene" targets — must already exclude the scene being edited. */
  otherScenes: SceneDef[];
  /** stepToAction results, parallel to steps (computed by the parent so it can also gate save). */
  results: StepResult[];
}): React.JSX.Element {
  const { snapshot } = usePool();

  const move = (index: number, delta: -1 | 1): void => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    onChange(next);
  };

  const remove = (index: number): void => {
    onChange(steps.filter((_, i) => i !== index));
  };

  const update = (index: number, patch: Partial<StepDraft>): void => {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const add = (kind: StepKind): void => {
    onChange([...steps, newStep(kind, snapshot, otherScenes)]);
  };

  const addable = useMemo(
    () =>
      ADDABLE_STEPS.filter((s) => {
        if (s.kind === "heat") return snapshot.bodies.length > 0;
        if (s.kind === "light") {
          return snapshot.lightGroups.length > 0 || allCircuits(snapshot).some((c) => c.isLight);
        }
        if (s.kind === "chlorinator") return snapshot.chlorinators.length > 0;
        if (s.kind === "pump") return snapshot.pumps.length > 0;
        if (s.kind === "circuit") return allCircuits(snapshot).length > 0;
        if (s.kind === "scene") return otherScenes.length > 0;
        return true;
      }),
    [snapshot, otherScenes]
  );

  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-dim uppercase">
        Steps · run in order
      </span>

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {steps.map((step, index) => {
            const meta = STEP_META[step.kind];
            const result = results[index];
            return (
              <motion.div
                key={step.key}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="rounded-xl border border-line bg-abyss/40 p-3"
              >
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-ink">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-[10px] text-accent">
                      {index + 1}
                    </span>
                    <meta.icon size={14} className="shrink-0 text-accent" />
                    <span className="truncate">{meta.label}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label="Move step up"
                      className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-accent-soft hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === steps.length - 1}
                      aria-label="Move step down"
                      className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-accent-soft hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ChevronDown size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      aria-label="Remove step"
                      className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-danger/15 hover:text-danger"
                    >
                      <Trash2 size={15} />
                    </button>
                  </span>
                </div>

                <StepEditor
                  step={step}
                  snapshot={snapshot}
                  otherScenes={otherScenes}
                  update={(patch) => update(index, patch)}
                />

                {result && !result.ok && <p className="mt-2 text-xs text-warn">{result.error}</p>}
                {result?.ok && (
                  <p className="mt-2 truncate text-[11px] text-ink-faint">
                    {describeAction(result.action, snapshot, otherScenes)}
                  </p>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {steps.length === 0 && (
          <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-ink-faint">
            No steps yet — add what this scene should do.
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {addable.map((s) => (
          <Button key={s.kind} variant="glass" size="sm" onClick={() => add(s.kind)}>
            <s.icon size={13} className="text-accent" /> {s.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
