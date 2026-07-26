"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { CalendarClock, X } from "lucide-react";
import type { PoolAction, SceneDef } from "@/types/actions";
import { apiGet, apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Panel } from "@/components/ui/panel";
import { formatClock, formatRelative } from "@/lib/utils";

interface PendingJob {
  id: number;
  label: string;
  actions: PoolAction[];
  fireAt: number;
  source: string;
}

interface AutomationsResponse {
  pendingJobs: PendingJob[];
}

/** The scene a pending one-shot job will run, if it is a scene run at all. */
function sceneForJob(job: PendingJob, scenes: SceneDef[]): SceneDef | null {
  for (const action of job.actions) {
    if (action.type === "runScene") {
      const scene = scenes.find((s) => s.id === action.sceneId);
      if (scene) return scene;
    }
  }
  return scenes.find((s) => s.name === job.label) ?? null;
}

/**
 * Upcoming one-shot scene runs (from "Run later tonight…"), with cancel.
 * family+ only — the pending-jobs feed lives behind /api/automations.
 */
export function PendingSceneRuns({ scenes }: { scenes: SceneDef[] }): React.JSX.Element | null {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["scene-jobs"],
    queryFn: () => apiGet<AutomationsResponse>("/api/automations"),
    refetchInterval: 30_000,
  });

  const runs = (data?.pendingJobs ?? [])
    .map((job) => ({ job, scene: sceneForJob(job, scenes) }))
    .filter((x): x is { job: PendingJob; scene: SceneDef } => x.scene !== null)
    .sort((a, b) => a.job.fireAt - b.job.fireAt);

  if (runs.length === 0) return null;

  const cancel = async (job: PendingJob, scene: SceneDef): Promise<void> => {
    try {
      await apiSend<{ ok: boolean }>("DELETE", `/api/jobs/${job.id}`);
      await queryClient.invalidateQueries({ queryKey: ["scene-jobs"] });
      toast("info", "Run cancelled", `${scene.name} won't run at ${formatClock(job.fireAt)}.`);
    } catch (err) {
      toast("error", "Couldn't cancel the run", err instanceof Error ? err.message : "Unknown error");
    }
  };

  return (
    <Panel className="p-4">
      <p className="mb-2.5 text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
        Scheduled scene runs
      </p>
      <ul className="space-y-1">
        <AnimatePresence initial={false}>
          {runs.map(({ job, scene }) => (
            <motion.li
              key={job.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-accent-soft/40"
            >
              <span className="flex min-w-0 items-center gap-2.5 text-sm text-ink">
                <CalendarClock size={15} className="shrink-0 text-accent" />
                <span className="truncate">{scene.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-ink-dim">
                  {formatClock(job.fireAt)}
                  <span className="ml-1.5 text-ink-faint">{formatRelative(job.fireAt)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void cancel(job, scene)}
                  aria-label={`Cancel scheduled run of ${scene.name}`}
                  className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-danger/15 hover:text-danger"
                >
                  <X size={14} />
                </button>
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Panel>
  );
}
