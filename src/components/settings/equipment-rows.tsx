"use client";

import { motion } from "motion/react";
import { EyeOff } from "lucide-react";
import { CircuitIcon } from "@/lib/icons";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { IconPicker } from "@/components/settings/icon-picker";
import { StatusPill } from "@/components/settings/section";
import { cn } from "@/lib/utils";

/** Per-circuit customization stored in circuit_meta (null/absent = defaults). */
export interface CircuitMetaEntry {
  circuitId: number;
  displayName: string | null;
  icon: string | null;
  guestVisible: boolean;
  hidden: boolean;
}

export interface EquipmentCircuit {
  id: number;
  /** Display name as currently decorated by the server (override applied). */
  name: string;
  type: string;
  isLight: boolean;
  isFeature: boolean;
  /** True when the circuit is hidden and therefore absent from the snapshot. */
  fromMetaOnly: boolean;
}

export function BodyRenameRow({
  bodyId,
  name,
  kind,
  index,
  onRename,
}: {
  bodyId: number;
  name: string;
  kind: "pool" | "spa";
  index: number;
  onRename: (bodyId: number, name: string | null) => void;
}): React.JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, type: "spring", stiffness: 300, damping: 30 }}
      className="flex items-center gap-3 px-4 py-3.5"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <CircuitIcon type={kind} isLight={false} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <Label className="mb-1">{kind === "spa" ? "Spa body" : "Pool body"}</Label>
        <Input
          key={name}
          defaultValue={name}
          maxLength={32}
          aria-label={`Rename ${name}`}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next === name) return;
            onRename(bodyId, next || null);
          }}
        />
      </div>
    </motion.div>
  );
}

export function CircuitMetaRow({
  circuit,
  meta,
  index,
  onSave,
}: {
  circuit: EquipmentCircuit;
  meta: CircuitMetaEntry | undefined;
  index: number;
  onSave: (patch: {
    circuitId: number;
    displayName?: string | null;
    icon?: string | null;
    guestVisible?: boolean;
    hidden?: boolean;
  }) => void;
}): React.JSX.Element {
  const hidden = meta?.hidden ?? false;
  const guestVisible = meta?.guestVisible ?? false;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.04, type: "spring", stiffness: 300, damping: 30 }}
      className={cn("px-4 py-3.5", hidden && "opacity-70")}
    >
      <div className="flex items-center gap-3">
        <IconPicker
          icon={meta?.icon ?? null}
          circuitType={circuit.type}
          isLight={circuit.isLight}
          onPick={(icon) => onSave({ circuitId: circuit.id, icon })}
        />
        <div className="min-w-0 flex-1">
          <Input
            key={circuit.name}
            defaultValue={circuit.name}
            maxLength={32}
            aria-label={`Rename ${circuit.name}`}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next === circuit.name) return;
              onSave({ circuitId: circuit.id, displayName: next || null });
            }}
          />
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pl-14">
        <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
          #{circuit.id} · {circuit.isFeature ? "feature" : "circuit"} · {circuit.type}
          {circuit.fromMetaOnly && (
            <StatusPill tone="neutral" className="normal-case">
              <EyeOff size={11} /> hidden
            </StatusPill>
          )}
        </span>
        <span className="flex items-center gap-5">
          <label className="flex items-center gap-2 text-xs text-ink-dim">
            Guests
            <Switch
              checked={guestVisible}
              onCheckedChange={(on) => onSave({ circuitId: circuit.id, guestVisible: on })}
              aria-label={`${circuit.name} visible to guests`}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-dim">
            Hidden
            <Switch
              checked={hidden}
              onCheckedChange={(on) => onSave({ circuitId: circuit.id, hidden: on })}
              aria-label={`Hide ${circuit.name}`}
            />
          </label>
        </span>
      </div>
    </motion.div>
  );
}
