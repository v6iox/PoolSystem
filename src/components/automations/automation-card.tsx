"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Pencil, Sparkles, Trash2 } from "lucide-react";
import type { AutomationDef, SceneDef } from "@/types/actions";
import { usePool } from "@/lib/client/pool-state";
import { apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { cn, formatRelative } from "@/lib/utils";
import {
  describeAction,
  describeTrigger,
  triggerIcon,
  type AutomationsResponse,
} from "@/components/automations/describe";

export function AutomationCard({
  automation,
  scenes,
  disabled,
  onEdit,
}: {
  automation: AutomationDef;
  scenes: SceneDef[];
  disabled: boolean;
  onEdit: (automation: AutomationDef) => void;
}): React.JSX.Element {
  const { snapshot } = usePool();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  const armDelete = (): void => {
    setConfirming(true);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirming(false), 5000);
  };

  const toggle = async (enabled: boolean): Promise<void> => {
    queryClient.setQueryData<AutomationsResponse>(["automations"], (prev) =>
      prev
        ? { ...prev, automations: prev.automations.map((a) => (a.id === automation.id ? { ...a, enabled } : a)) }
        : prev
    );
    try {
      await apiSend<{ ok: boolean }>("PUT", `/api/automations/${automation.id}`, { enabled });
    } catch (err) {
      toast("error", "Couldn't update automation", err instanceof Error ? err.message : "Unknown error");
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
    }
  };

  const remove = async (): Promise<void> => {
    setDeleting(true);
    try {
      await apiSend<{ ok: boolean }>("DELETE", `/api/automations/${automation.id}`);
      toast("success", "Automation deleted", automation.name);
    } catch (err) {
      toast("error", "Couldn't delete automation", err instanceof Error ? err.message : "Unknown error");
      setDeleting(false);
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
    }
  };

  const TriggerIcon = triggerIcon(automation.trigger);
  const lastFailed = automation.lastResult !== null && automation.lastResult.includes("failed");

  return (
    <Panel className={cn("flex h-full flex-col p-4", deleting && "pointer-events-none opacity-40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-ink">{automation.name}</h3>
            {automation.createdVia === "copilot" && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold tracking-wide text-accent uppercase">
                <Sparkles size={10} /> copilot
              </span>
            )}
          </div>
          <p className={cn("mt-1 flex items-center gap-1.5 text-sm text-ink-dim", !automation.enabled && "opacity-60")}>
            <TriggerIcon size={14} className="shrink-0 text-accent" />
            <span className={cn("truncate", automation.trigger.type === "cron" && "font-mono text-xs")}>
              {describeTrigger(automation.trigger, snapshot)}
            </span>
          </p>
        </div>
        <Switch
          checked={automation.enabled}
          onCheckedChange={(v) => void toggle(v)}
          disabled={disabled}
          aria-label={`${automation.name} enabled`}
        />
      </div>

      <ul className={cn("mt-3 flex-1 space-y-1", !automation.enabled && "opacity-60")}>
        {automation.actions.map((action, i) => (
          <li key={i} className="flex items-start gap-1.5 text-sm text-ink-dim">
            <ChevronRight size={13} className="mt-1 shrink-0 text-ink-faint" />
            <span className="min-w-0 truncate">{describeAction(action, snapshot, scenes)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 border-t border-line pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-ink-faint">
            {automation.lastRunAt !== null ? `Ran ${formatRelative(automation.lastRunAt)}` : "Never run"}
            {` · by ${automation.createdByName}`}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {confirming ? (
              <>
                <Button variant="danger" size="sm" disabled={disabled} onClick={() => void remove()}>
                  Delete?
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="iconSm"
                  disabled={disabled}
                  aria-label={`Edit ${automation.name}`}
                  onClick={() => onEdit(automation)}
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="iconSm"
                  disabled={disabled}
                  aria-label={`Delete ${automation.name}`}
                  className="hover:text-danger"
                  onClick={armDelete}
                >
                  <Trash2 size={14} />
                </Button>
              </>
            )}
          </div>
        </div>
        {automation.lastResult !== null && automation.lastResult !== "" && (
          <p
            className={cn("mt-1 truncate text-xs", lastFailed ? "text-danger" : "text-ink-faint")}
            title={automation.lastResult}
          >
            {automation.lastResult}
          </p>
        )}
      </div>
    </Panel>
  );
}
