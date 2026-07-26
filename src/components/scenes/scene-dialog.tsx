"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { PoolAction, SceneDef } from "@/types/actions";
import { usePool } from "@/lib/client/pool-state";
import { apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CIRCUIT_ICONS } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { ActionBuilder } from "@/components/scenes/action-builder";
import { stepFromAction, stepToAction, type StepDraft } from "@/components/scenes/steps";

function IconPicker({ value, onChange }: { value: string; onChange: (key: string) => void }): React.JSX.Element {
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {Object.entries(CIRCUIT_ICONS).map(([key, Icon]) => {
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-label={`Icon ${key}`}
            aria-pressed={selected}
            className={cn(
              "flex h-10 items-center justify-center rounded-xl border transition-all duration-150 active:scale-90",
              selected
                ? "border-accent/60 bg-accent-soft text-accent shadow-[0_0_12px_-2px] shadow-accent/40"
                : "border-line bg-abyss/40 text-ink-faint hover:border-line-bright hover:text-ink-dim"
            )}
          >
            <Icon size={17} />
          </button>
        );
      })}
    </div>
  );
}

function SceneForm({
  scene,
  scenes,
  close,
}: {
  scene: SceneDef | null;
  scenes: SceneDef[];
  close: () => void;
}): React.JSX.Element {
  const { snapshot } = usePool();
  const queryClient = useQueryClient();

  const [name, setName] = useState(scene?.name ?? "");
  const [icon, setIcon] = useState(scene?.icon ?? "sparkles");
  const [description, setDescription] = useState(scene?.description ?? "");
  const [guestVisible, setGuestVisible] = useState(scene?.guestVisible ?? false);
  const [steps, setSteps] = useState<StepDraft[]>(() => (scene?.actions ?? []).map(stepFromAction));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Prevent self-reference: a scene can never be offered as its own "run scene" target.
  const otherScenes = useMemo(() => scenes.filter((s) => s.id !== scene?.id), [scenes, scene?.id]);

  const results = useMemo(() => steps.map((s) => stepToAction(s, snapshot)), [steps, snapshot]);
  const allValid = results.length > 0 && results.every((r) => r.ok);
  const canSave = name.trim().length > 0 && allValid && !saving;

  const save = async (): Promise<void> => {
    if (!canSave) return;
    const actions: PoolAction[] = [];
    for (const r of results) {
      if (r.ok) actions.push(r.action);
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        icon,
        description: description.trim(),
        actions,
        guestVisible,
      };
      if (scene) {
        await apiSend<{ ok: boolean }>("PUT", `/api/scenes/${scene.id}`, payload);
      } else {
        await apiSend<{ ok: boolean; id: number }>("POST", "/api/scenes", payload);
      }
      await queryClient.invalidateQueries({ queryKey: ["scenes"] });
      toast(
        "success",
        scene ? "Scene updated" : "Scene created",
        `${name.trim()} · ${actions.length} ${actions.length === 1 ? "step" : "steps"}`
      );
      close();
    } catch (err) {
      toast("error", "Couldn't save scene", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!scene) return;
    setSaving(true);
    try {
      await apiSend<{ ok: boolean }>("DELETE", `/api/scenes/${scene.id}`);
      await queryClient.invalidateQueries({ queryKey: ["scenes"] });
      toast("success", "Scene deleted", scene.name);
      close();
    } catch (err) {
      toast("error", "Couldn't delete scene", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Movie night"
            maxLength={40}
            aria-label="Scene name"
          />
        </Field>
        <Field label="Description">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this set up?"
            maxLength={120}
            aria-label="Scene description"
          />
        </Field>
      </div>

      <Field label="Icon">
        <IconPicker value={icon} onChange={setIcon} />
      </Field>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-abyss/40 px-3.5 py-2.5">
        <div>
          <p className="text-sm font-medium text-ink">Visible to guests</p>
          <p className="text-xs text-ink-faint">Guests can see and run this scene.</p>
        </div>
        <Switch checked={guestVisible} onCheckedChange={setGuestVisible} aria-label="Visible to guests" />
      </div>

      <ActionBuilder steps={steps} onChange={setSteps} otherScenes={otherScenes} results={results} />

      <div className="flex items-center justify-between gap-3 pt-1">
        {scene ? (
          confirmDelete ? (
            <span className="flex items-center gap-2">
              <Button variant="danger" size="sm" disabled={saving} onClick={() => void remove()}>
                <Trash2 size={14} /> Really delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </span>
          ) : (
            <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} /> Delete
            </Button>
          )
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="md">
              Cancel
            </Button>
          </DialogClose>
          <Button variant="primary" size="md" disabled={!canSave} onClick={() => void save()}>
            {scene ? "Save changes" : "Create scene"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Create/edit dialog for a scene. Mount with `scene=null` to create. */
export function SceneDialog({
  open,
  onOpenChange,
  scene,
  scenes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scene: SceneDef | null;
  /** All scenes (used for "run scene" steps, minus the one being edited). */
  scenes: SceneDef[];
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          wide
          title={scene ? "Edit scene" : "New scene"}
          description={
            scene ? `${scene.name} · one tap runs every step` : "Bundle a few controls into one big tappable card."
          }
        >
          <SceneForm key={scene?.id ?? "new"} scene={scene} scenes={scenes} close={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}
