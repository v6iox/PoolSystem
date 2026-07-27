"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { AutomationDef } from "@/types/actions";
import { usePool } from "@/lib/client/pool-state";
import { apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { describeTrigger, triggerIcon } from "@/components/automations/describe";

/** Compact automation rows for the Schedules page — full editing lives on /automations. */
export function AutomationsStrip({
  automations,
  disabled,
}: {
  automations: AutomationDef[];
  disabled: boolean;
}): React.JSX.Element {
  const { snapshot } = usePool();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);

  const toggle = async (automation: AutomationDef, enabled: boolean): Promise<void> => {
    setBusy(automation.id);
    try {
      await apiSend<{ ok: boolean }>("PUT", `/api/automations/${automation.id}`, { enabled });
      toast("success", enabled ? "Automation resumed" : "Automation paused", automation.name);
    } catch (err) {
      toast("error", "Couldn't update", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
    }
  };

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
          Automations · {automations.length}
        </p>
        <Link href="/automations" className="flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          Manage <ArrowRight size={12} />
        </Link>
      </div>
      <Panel className="divide-y divide-line px-4">
        {automations.map((automation) => {
          const Icon = triggerIcon(automation.trigger);
          return (
            <div key={automation.id} className="flex items-center gap-3 py-3">
              <span className="shrink-0 rounded-full bg-accent-soft p-2 text-accent">
                <Icon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">
                  {automation.name}
                  {!automation.enabled && <span className="text-ink-faint"> · paused</span>}
                </p>
                <p className="truncate text-xs text-ink-dim">
                  {describeTrigger(automation.trigger, snapshot)}
                  {automation.createdVia === "copilot" && <span className="text-ink-faint"> · via copilot</span>}
                </p>
              </div>
              <Switch
                checked={automation.enabled}
                disabled={disabled || busy === automation.id}
                onCheckedChange={(v) => void toggle(automation, v)}
                aria-label={`${automation.enabled ? "Pause" : "Resume"} ${automation.name}`}
              />
            </div>
          );
        })}
      </Panel>
    </section>
  );
}
