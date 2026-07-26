"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import type { AutomationDef, PoolAction, SceneDef } from "@/types/actions";
import { usePool } from "@/lib/client/pool-state";
import { apiGet, apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { describeTrigger } from "@/components/automations/describe";
import { TriggerEditor } from "@/components/automations/trigger-editor";
import { ActionStepsEditor } from "@/components/automations/action-steps";
import {
  actionToDraft,
  defaultActionDraft,
  defaultTriggerDraft,
  draftToAction,
  draftToTrigger,
  triggerToDraft,
  type ActionDraft,
  type TriggerDraft,
} from "@/components/automations/drafts";

function AutomationForm({
  automation,
  close,
}: {
  automation: AutomationDef | null;
  close: () => void;
}): React.JSX.Element {
  const { snapshot, backendConnected } = usePool();
  const queryClient = useQueryClient();

  const { data: scenesData } = useQuery({
    queryKey: ["scenes"],
    queryFn: () => apiGet<{ scenes: SceneDef[] }>("/api/scenes"),
  });
  const scenes = useMemo(() => scenesData?.scenes ?? [], [scenesData]);

  const [name, setName] = useState(automation?.name ?? "");
  const [triggerDraft, setTriggerDraft] = useState<TriggerDraft>(() =>
    automation ? triggerToDraft(automation.trigger) : defaultTriggerDraft("time", snapshot)
  );
  const [actionDrafts, setActionDrafts] = useState<ActionDraft[]>(() =>
    automation ? automation.actions.map(actionToDraft) : [defaultActionDraft("setCircuit", snapshot)]
  );
  const [saving, setSaving] = useState(false);

  const trigger = useMemo(() => draftToTrigger(triggerDraft), [triggerDraft]);
  const actions = useMemo(() => actionDrafts.map(draftToAction), [actionDrafts]);
  const actionsValid = actionDrafts.length > 0 && actions.every((a): a is PoolAction => a !== null);
  const canSave = backendConnected && name.trim().length > 0 && trigger !== null && actionsValid && !saving;

  const save = async (): Promise<void> => {
    if (trigger === null || !actionsValid) return;
    const payload = { name: name.trim(), trigger, actions: actions as PoolAction[] };
    setSaving(true);
    try {
      if (automation) {
        await apiSend<{ ok: boolean }>("PUT", `/api/automations/${automation.id}`, payload);
      } else {
        await apiSend<{ ok: boolean; id: number }>("POST", "/api/automations", payload);
      }
      toast(
        "success",
        automation ? "Automation updated" : "Automation created",
        `${payload.name} · ${describeTrigger(trigger, snapshot)}`
      );
      close();
    } catch (err) {
      toast("error", "Couldn't save automation", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Lights at dusk"
          aria-label="Automation name"
          maxLength={80}
        />
      </Field>

      <TriggerEditor draft={triggerDraft} onChange={setTriggerDraft} snapshot={snapshot} />

      <div>
        <p className="mb-1.5 block text-xs font-medium tracking-wide text-ink-dim uppercase">Then run</p>
        <ActionStepsEditor
          drafts={actionDrafts}
          onChange={setActionDrafts}
          snapshot={snapshot}
          scenes={scenes}
        />
      </div>

      {trigger !== null && (
        <p className="flex items-center gap-2 rounded-xl bg-accent-soft/50 px-3 py-2 text-xs text-accent">
          <Zap size={13} className="shrink-0" />
          Runs {describeTrigger(trigger, snapshot)}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <DialogClose asChild>
          <Button variant="ghost" size="md">
            Cancel
          </Button>
        </DialogClose>
        <Button variant="primary" size="md" disabled={!canSave} onClick={() => void save()}>
          {saving ? "Saving…" : automation ? "Save changes" : "Create automation"}
        </Button>
      </div>
    </div>
  );
}

/** Create/edit builder dialog. Mount with `automation=null` to create. */
export function AutomationDialog({
  open,
  onOpenChange,
  automation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automation: AutomationDef | null;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          wide
          title={automation ? "Edit automation" : "New automation"}
          description={
            automation
              ? `${automation.name} · created by ${automation.createdByName}`
              : "When something happens, do something."
          }
        >
          <AutomationForm
            key={automation?.id ?? "new"}
            automation={automation}
            close={() => onOpenChange(false)}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}
