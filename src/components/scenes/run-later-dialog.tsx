"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import type { SceneDef } from "@/types/actions";
import { apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { formatClock } from "@/lib/utils";

/** "HH:MM" today → epoch ms; rolls to tomorrow when already past. */
function fireAtFromTime(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  const h = match?.[1];
  const m = match?.[2];
  if (h === undefined || m === undefined) return null;
  const d = new Date();
  d.setHours(Number(h), Number(m), 0, 0);
  let at = d.getTime();
  if (at <= Date.now()) at += 24 * 60 * 60 * 1000;
  return at;
}

function defaultTime(): string {
  // Suggest 9 PM if it's still ahead of us, otherwise about an hour from now.
  const now = new Date();
  if (now.getHours() < 21) return "21:00";
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  return `${String(later.getHours()).padStart(2, "0")}:${String(later.getMinutes()).padStart(2, "0")}`;
}

const PRESETS: Array<{ label: string; time: () => string }> = [
  {
    label: "In 1 hour",
    time: () => {
      const d = new Date(Date.now() + 60 * 60 * 1000);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    },
  },
  { label: "9 PM", time: () => "21:00" },
  { label: "10 PM", time: () => "22:00" },
];

/**
 * "Run later tonight…" — schedules a one-shot job that fires runScene at the
 * chosen time (today, or tomorrow if the time already passed).
 */
export function RunLaterDialog({
  scene,
  onClose,
}: {
  /** Scene to schedule; null = dialog closed. */
  scene: SceneDef | null;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [time, setTime] = useState(defaultTime);
  const [saving, setSaving] = useState(false);

  const fireAt = fireAtFromTime(time);
  const isToday = fireAt !== null && new Date(fireAt).getDate() === new Date().getDate();

  const schedule = async (): Promise<void> => {
    if (!scene || fireAt === null || saving) return;
    setSaving(true);
    try {
      await apiSend<{ ok: boolean; id: number }>("POST", "/api/jobs", {
        label: scene.name,
        actions: [{ type: "runScene", sceneId: scene.id }],
        at: fireAt,
      });
      await queryClient.invalidateQueries({ queryKey: ["scene-jobs"] });
      toast("success", `${scene.name} scheduled`, `Runs ${isToday ? "tonight" : "tomorrow"} at ${formatClock(fireAt)}.`);
      onClose();
    } catch (err) {
      toast("error", "Couldn't schedule the run", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={scene !== null} onOpenChange={(open) => !open && onClose()}>
      {scene && (
        <DialogContent
          title="Run later tonight…"
          description={`One-shot run of "${scene.name}" — no repeat, easy to cancel.`}
        >
          <div className="space-y-4">
            <Field
              label="Run at"
              hint={
                fireAt !== null
                  ? `${isToday ? "Tonight" : "Tomorrow"} at ${formatClock(fireAt)}`
                  : "Pick a time"
              }
            >
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Run time" />
            </Field>

            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button key={p.label} variant="glass" size="sm" onClick={() => setTime(p.time())}>
                  {p.label}
                </Button>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <DialogClose asChild>
                <Button variant="ghost" size="md">
                  Cancel
                </Button>
              </DialogClose>
              <Button variant="primary" size="md" disabled={fireAt === null || saving} onClick={() => void schedule()}>
                <Clock size={15} /> Schedule
              </Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
