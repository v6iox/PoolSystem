"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Clock, Loader2, Pencil, Sparkles, Users } from "lucide-react";
import type { SceneDef } from "@/types/actions";
import { usePool } from "@/lib/client/pool-state";
import { toast } from "@/stores/toast";
import { CIRCUIT_ICONS } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * Big tappable scene card. The whole face runs the scene (water-ripple +
 * scale press, check-flash on success); small corner buttons schedule/edit.
 */
export function SceneCard({
  scene,
  index,
  disabled,
  canManage,
  onEdit,
  onRunLater,
}: {
  scene: SceneDef;
  index: number;
  /** True when the controller is offline — running is blocked. */
  disabled: boolean;
  /** family+ — shows the schedule + edit corner buttons. */
  canManage: boolean;
  onEdit: (scene: SceneDef) => void;
  onRunLater: (scene: SceneDef) => void;
}): React.JSX.Element {
  const { sendAction } = usePool();
  const [running, setRunning] = useState(false);
  const [justRan, setJustRan] = useState(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const Icon = CIRCUIT_ICONS[scene.icon] ?? Sparkles;
  const stepCount = scene.actions.length;

  const ripple = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const span = document.createElement("span");
    span.className = "ripple-ink";
    span.style.width = span.style.height = `${size}px`;
    span.style.left = `${event.clientX - rect.left - size / 2}px`;
    span.style.top = `${event.clientY - rect.top - size / 2}px`;
    el.appendChild(span);
    window.setTimeout(() => span.remove(), 600);
  };

  const run = async (): Promise<void> => {
    if (running || disabled) return;
    setRunning(true);
    const ok = await sendAction({ type: "runScene", sceneId: scene.id });
    setRunning(false);
    if (ok) {
      toast("success", `${scene.name} running`, `${stepCount} ${stepCount === 1 ? "step" : "steps"} fired.`);
      setJustRan(true);
      if (doneTimer.current) clearTimeout(doneTimer.current);
      doneTimer.current = setTimeout(() => setJustRan(false), 1600);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, type: "spring", stiffness: 300, damping: 28 }}
      className={cn("glass relative rounded-panel", running && "pulse-active")}
    >
      <motion.button
        type="button"
        whileTap={disabled ? undefined : { scale: 0.96 }}
        transition={{ type: "spring", stiffness: 460, damping: 30 }}
        onPointerDown={disabled ? undefined : ripple}
        onClick={() => void run()}
        disabled={disabled || running}
        aria-label={`Run scene ${scene.name}`}
        className="relative flex min-h-40 w-full flex-col items-start gap-3 overflow-hidden rounded-panel p-4 text-left outline-none transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
      >
        <span
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-xl transition-colors",
            justRan ? "bg-ok/15 text-ok" : "bg-accent-soft text-accent"
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            {running ? (
              <motion.span key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Loader2 size={22} className="animate-spin" />
              </motion.span>
            ) : justRan ? (
              <motion.span
                key="done"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 26 }}
              >
                <Check size={22} />
              </motion.span>
            ) : (
              <motion.span key="icon" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Icon size={22} />
              </motion.span>
            )}
          </AnimatePresence>
        </span>

        <span className="min-w-0">
          <span className="block truncate font-display text-base font-semibold text-ink">{scene.name}</span>
          {scene.description ? (
            <span className="mt-0.5 line-clamp-2 block text-xs text-ink-dim">{scene.description}</span>
          ) : null}
        </span>

        <span className="mt-auto flex items-center gap-2 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
          {stepCount} {stepCount === 1 ? "action" : "actions"}
          {scene.guestVisible && canManage && (
            <span className="flex items-center gap-1 normal-case tracking-normal">
              <Users size={11} /> guests
            </span>
          )}
        </span>
      </motion.button>

      {canManage && (
        <span className="absolute right-2 top-2 flex gap-0.5">
          <button
            type="button"
            onClick={() => onRunLater(scene)}
            aria-label={`Run ${scene.name} later`}
            title="Run later tonight…"
            className="rounded-lg p-2 text-ink-faint transition-colors hover:bg-accent-soft hover:text-accent"
          >
            <Clock size={15} />
          </button>
          <button
            type="button"
            onClick={() => onEdit(scene)}
            aria-label={`Edit ${scene.name}`}
            title="Edit scene"
            className="rounded-lg p-2 text-ink-faint transition-colors hover:bg-accent-soft hover:text-ink"
          >
            <Pencil size={15} />
          </button>
        </span>
      )}
    </motion.div>
  );
}
