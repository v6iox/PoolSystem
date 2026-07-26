"use client";

import { motion } from "motion/react";
import { AlertTriangle, Plus, Power, Trash2 } from "lucide-react";
import type { HeatModeInput, SceneDef } from "@/types/actions";
import type { PoolStateSnapshot } from "@/types/pool";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  defaultActionDraft,
  type ActionDraft,
  type ActionKind,
} from "@/components/automations/drafts";

const KIND_OPTIONS: Array<{ value: ActionKind; label: string }> = [
  { value: "setCircuit", label: "Circuit on / off" },
  { value: "setHeat", label: "Heat mode / setpoint" },
  { value: "lightTheme", label: "Light theme" },
  { value: "setPumpSpeed", label: "Pump speed" },
  { value: "setChlorinator", label: "Chlorinator output" },
  { value: "superChlorinate", label: "Super-chlorinate" },
  { value: "runScene", label: "Run a scene" },
  { value: "allOff", label: "Everything off" },
];

function SegmentedBool({
  value,
  onChange,
  trueLabel,
  falseLabel,
  ariaLabel,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  trueLabel: string;
  falseLabel: string;
  ariaLabel: string;
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex h-11 rounded-xl border border-line bg-abyss/40 p-1">
      {[
        { v: true, label: trueLabel },
        { v: false, label: falseLabel },
      ].map((opt) => (
        <button
          key={opt.label}
          type="button"
          role="radio"
          aria-checked={value === opt.v}
          onClick={() => onChange(opt.v)}
          className={cn(
            "flex-1 rounded-lg text-xs font-medium transition-colors duration-200",
            value === opt.v ? "bg-accent-soft text-accent" : "text-ink-faint hover:text-ink-dim"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function NoEquipment({ what }: { what: string }): React.JSX.Element {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-warn/25 bg-warn/10 px-3 py-2 text-xs text-warn">
      <AlertTriangle size={13} className="shrink-0" /> No {what} available for this step.
    </p>
  );
}

function StepFields({
  draft,
  onChange,
  snapshot,
  scenes,
}: {
  draft: ActionDraft;
  onChange: (draft: ActionDraft) => void;
  snapshot: PoolStateSnapshot;
  scenes: SceneDef[];
}): React.JSX.Element {
  switch (draft.kind) {
    case "setCircuit": {
      const seen = new Set<number>();
      const circuits = [...snapshot.circuits, ...snapshot.features].filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
      if (circuits.length === 0 && draft.circuitId === "") return <NoEquipment what="circuits" />;
      return (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Select
            value={draft.circuitId}
            onValueChange={(v) => onChange({ ...draft, circuitId: v })}
            options={circuits.map((c) => ({ value: String(c.id), label: c.name }))}
            placeholder="Pick a circuit"
            aria-label="Circuit"
          />
          <SegmentedBool
            value={draft.state}
            onChange={(state) => onChange({ ...draft, state })}
            trueLabel="On"
            falseLabel="Off"
            ariaLabel="Circuit state"
          />
        </div>
      );
    }
    case "setHeat": {
      if (snapshot.bodies.length === 0 && draft.bodyId === "") return <NoEquipment what="bodies of water" />;
      const invalid = draft.mode === "keep" && draft.setPoint.trim() === "";
      return (
        <div className="grid grid-cols-3 gap-2">
          <Select
            value={draft.bodyId}
            onValueChange={(v) => onChange({ ...draft, bodyId: v })}
            options={snapshot.bodies.map((b) => ({ value: String(b.id), label: b.name }))}
            placeholder="Body"
            aria-label="Body of water"
          />
          <Select
            value={draft.mode}
            onValueChange={(v) => onChange({ ...draft, mode: v as HeatModeInput | "keep" })}
            options={[
              { value: "keep", label: "Keep mode" },
              { value: "off", label: "Heat off" },
              { value: "heater", label: "Heater" },
              { value: "solar", label: "Solar" },
              { value: "solarpref", label: "Solar preferred" },
            ]}
            aria-label="Heat mode"
          />
          <div>
            <Input
              type="number"
              min={40}
              max={110}
              value={draft.setPoint}
              onChange={(e) => onChange({ ...draft, setPoint: e.target.value })}
              placeholder="Setpoint°"
              aria-label="Heat setpoint"
              className={cn(invalid && "border-warn/60")}
            />
            {invalid && <p className="mt-1 text-[11px] text-warn">Pick a mode or a setpoint</p>}
          </div>
        </div>
      );
    }
    case "setPumpSpeed": {
      const pump = snapshot.pumps.find((p) => String(p.id) === draft.pumpId);
      if (snapshot.pumps.length === 0 && draft.pumpId === "") return <NoEquipment what="pumps" />;
      const min = pump && pump.minSpeed > 0 ? pump.minSpeed : 450;
      const max = pump && pump.maxSpeed > min ? pump.maxSpeed : 3450;
      return (
        <div className="space-y-2">
          <Select
            value={draft.pumpId}
            onValueChange={(v) => onChange({ ...draft, pumpId: v })}
            options={snapshot.pumps.map((p) => ({ value: String(p.id), label: p.name }))}
            placeholder="Pick a pump"
            aria-label="Pump"
          />
          <div className="flex items-center gap-3">
            <Slider
              value={Math.min(max, Math.max(min, draft.rpm))}
              onValueChange={(rpm) => onChange({ ...draft, rpm })}
              min={min}
              max={max}
              step={10}
              aria-label="Pump RPM"
              className="flex-1"
            />
            <span className="w-20 shrink-0 text-right text-sm text-ink">
              {Math.round(draft.rpm).toLocaleString()} <span className="text-xs text-ink-faint">RPM</span>
            </span>
          </div>
        </div>
      );
    }
    case "setChlorinator": {
      if (snapshot.chlorinators.length === 0 && draft.chlorId === "") return <NoEquipment what="chlorinators" />;
      const bothBlank = draft.poolSetpoint.trim() === "" && draft.spaSetpoint.trim() === "";
      return (
        <div className="grid grid-cols-3 gap-2">
          <Select
            value={draft.chlorId}
            onValueChange={(v) => onChange({ ...draft, chlorId: v })}
            options={snapshot.chlorinators.map((c) => ({ value: String(c.id), label: c.name }))}
            placeholder="Chlorinator"
            aria-label="Chlorinator"
          />
          <Field label="Pool %">
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.poolSetpoint}
              onChange={(e) => onChange({ ...draft, poolSetpoint: e.target.value })}
              placeholder="—"
              aria-label="Pool output percent"
              className={cn(bothBlank && "border-warn/60")}
            />
          </Field>
          <Field label="Spa %" hint={bothBlank ? "Set at least one" : "Blank = unchanged"}>
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.spaSetpoint}
              onChange={(e) => onChange({ ...draft, spaSetpoint: e.target.value })}
              placeholder="—"
              aria-label="Spa output percent"
              className={cn(bothBlank && "border-warn/60")}
            />
          </Field>
        </div>
      );
    }
    case "superChlorinate": {
      if (snapshot.chlorinators.length === 0 && draft.chlorId === "") return <NoEquipment what="chlorinators" />;
      return (
        <div className="grid grid-cols-3 gap-2">
          <Select
            value={draft.chlorId}
            onValueChange={(v) => onChange({ ...draft, chlorId: v })}
            options={snapshot.chlorinators.map((c) => ({ value: String(c.id), label: c.name }))}
            placeholder="Chlorinator"
            aria-label="Chlorinator"
          />
          <SegmentedBool
            value={draft.on}
            onChange={(on) => onChange({ ...draft, on })}
            trueLabel="Start"
            falseLabel="Stop"
            ariaLabel="Super-chlorinate state"
          />
          <Input
            type="number"
            min={1}
            max={96}
            value={draft.hours}
            onChange={(e) => onChange({ ...draft, hours: e.target.value })}
            placeholder="Hours"
            disabled={!draft.on}
            aria-label="Super-chlorinate hours"
          />
        </div>
      );
    }
    case "lightTheme": {
      const lights = snapshot.circuits.filter((c) => c.isLight);
      const targets = [
        ...snapshot.lightGroups.map((g) => ({ value: `g:${g.id}`, label: `${g.name} (group)` })),
        ...lights.map((c) => ({ value: `c:${c.id}`, label: c.name })),
      ];
      if (targets.length === 0 && draft.target === "") return <NoEquipment what="lights or light groups" />;
      return (
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={draft.target}
            onValueChange={(v) => onChange({ ...draft, target: v })}
            options={targets}
            placeholder="Light"
            aria-label="Light target"
          />
          <Select
            value={draft.theme}
            onValueChange={(v) => onChange({ ...draft, theme: v })}
            options={snapshot.lightThemes.map((t) => ({ value: String(t.val), label: t.name }))}
            placeholder="Theme"
            aria-label="Light theme"
          />
        </div>
      );
    }
    case "runScene": {
      if (scenes.length === 0) {
        return <NoEquipment what="scenes — create one on the Scenes page first" />;
      }
      return (
        <Select
          value={draft.sceneId}
          onValueChange={(v) => onChange({ ...draft, sceneId: v })}
          options={scenes.map((s) => ({ value: String(s.id), label: s.name }))}
          placeholder="Pick a scene"
          aria-label="Scene"
        />
      );
    }
    case "allOff":
      return (
        <p className="flex items-center gap-2 text-xs text-ink-dim">
          <Power size={13} className="shrink-0 text-accent" /> Turns every circuit and feature off.
        </p>
      );
  }
}

/** Ordered list of action steps with inline per-type editors. */
export function ActionStepsEditor({
  drafts,
  onChange,
  snapshot,
  scenes,
}: {
  drafts: ActionDraft[];
  onChange: (drafts: ActionDraft[]) => void;
  snapshot: PoolStateSnapshot;
  scenes: SceneDef[];
}): React.JSX.Element {
  const setStep = (index: number, draft: ActionDraft): void => {
    onChange(drafts.map((d, i) => (i === index ? draft : d)));
  };

  return (
    <div className="space-y-2.5">
      {drafts.map((draft, i) => (
        <motion.div
          key={i}
          layout
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
          className="rounded-xl border border-line bg-abyss/30 p-3"
        >
          <div className="mb-2.5 flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-[11px] font-semibold text-accent">
              {i + 1}
            </span>
            <Select
              value={draft.kind}
              onValueChange={(v) => setStep(i, defaultActionDraft(v as ActionKind, snapshot))}
              options={KIND_OPTIONS}
              aria-label={`Step ${i + 1} type`}
              className="h-9 flex-1"
            />
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={`Remove step ${i + 1}`}
              onClick={() => onChange(drafts.filter((_, j) => j !== i))}
            >
              <Trash2 size={14} />
            </Button>
          </div>
          <StepFields draft={draft} onChange={(d) => setStep(i, d)} snapshot={snapshot} scenes={scenes} />
        </motion.div>
      ))}

      {drafts.length === 0 && (
        <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-ink-faint">
          No actions yet — add at least one step to run when this fires.
        </p>
      )}

      <Button
        variant="glass"
        size="sm"
        disabled={drafts.length >= 25}
        onClick={() => onChange([...drafts, defaultActionDraft("setCircuit", snapshot)])}
      >
        <Plus size={14} /> Add action
      </Button>
    </div>
  );
}
