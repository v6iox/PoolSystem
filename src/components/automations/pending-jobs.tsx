"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Timer, X } from "lucide-react";
import type { SceneDef } from "@/types/actions";
import { usePool } from "@/lib/client/pool-state";
import { apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { formatClock, formatRelative } from "@/lib/utils";
import { describeAction, type PendingJob } from "@/components/automations/describe";

/** Queued one-shot jobs (e.g. "turn the spa off in 2 hours") with live countdowns. */
export function PendingJobs({
  jobs,
  scenes,
  disabled,
}: {
  jobs: PendingJob[];
  scenes: SceneDef[];
  disabled: boolean;
}): React.JSX.Element {
  const { snapshot } = usePool();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState<number | null>(null);

  // Re-render every 30s so the countdowns stay fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const cancel = async (job: PendingJob): Promise<void> => {
    setCancelling(job.id);
    try {
      await apiSend<{ ok: boolean }>("DELETE", `/api/jobs/${job.id}`);
      toast("success", "One-shot cancelled", job.label || "Scheduled actions won't run.");
    } catch (err) {
      toast("error", "Couldn't cancel", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCancelling(null);
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
    }
  };

  return (
    <section>
      <p className="mb-2.5 text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
        Queued one-shots · {jobs.length}
      </p>
      <Panel className="divide-y divide-line px-4">
        {jobs.map((job) => {
          const summary = job.actions.map((a) => describeAction(a, snapshot, scenes)).join(" · ");
          const soon = job.fireAt - Date.now() < 60_000;
          return (
            <div key={job.id} className="flex items-center gap-3 py-3">
              <span className="shrink-0 rounded-full bg-accent-soft p-2 text-accent">
                <Timer size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{job.label || summary}</p>
                <p className="text-xs text-ink-dim">
                  {soon ? "fires any moment" : `fires ${formatRelative(job.fireAt)}`} · {formatClock(job.fireAt)}
                  {job.source !== "ui" && <span className="text-ink-faint"> · via {job.source}</span>}
                </p>
                {job.label !== "" && <p className="truncate text-xs text-ink-faint">{summary}</p>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 hover:text-danger"
                disabled={disabled || cancelling === job.id}
                onClick={() => void cancel(job)}
                aria-label={`Cancel ${job.label || "one-shot job"}`}
              >
                <X size={14} /> Cancel
              </Button>
            </div>
          );
        })}
      </Panel>
    </section>
  );
}
