"use client";

import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus } from "lucide-react";
import type { CircuitState, LightThemeDef } from "@/types/pool";
import { usePool } from "@/lib/client/pool-state";
import { apiGet, apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/panel";
import { ComboCard } from "@/components/lights/combo-card";
import {
  captureEntries,
  comboActions,
  parseCombos,
  type LightCombo,
} from "@/components/lights/combos";
import { cn } from "@/lib/utils";

const COMBOS_KEY = ["prefs", "lightCombos"] as const;

/**
 * "Saved combos" — named snapshots of the current light look, stored in the
 * per-user prefs blob and re-applied as one batched control call.
 */
export function SavedCombos({
  lights,
  themesByVal,
  disabled,
}: {
  /** The light circuits currently visible to this user. */
  lights: CircuitState[];
  themesByVal: Map<number, LightThemeDef>;
  /** True when the controller is offline — applying is blocked, saving is not. */
  disabled: boolean;
}): React.JSX.Element {
  const { sendActions } = usePool();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const { data: combos, isLoading } = useQuery({
    queryKey: COMBOS_KEY,
    queryFn: async (): Promise<LightCombo[]> => {
      const res = await apiGet<{ prefs: Record<string, unknown> }>("/api/settings/prefs");
      return parseCombos(res.prefs["lightCombos"]);
    },
  });

  const persist = useMutation({
    mutationFn: async (next: LightCombo[]): Promise<LightCombo[]> => {
      await apiSend<{ prefs: Record<string, unknown> }>("PUT", "/api/settings/prefs", { lightCombos: next });
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData<LightCombo[]>([...COMBOS_KEY], next);
    },
    onError: (err) => {
      toast("error", "Couldn't update combos", err instanceof Error ? err.message : undefined);
    },
  });

  const saveCurrentLook = (): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const combo: LightCombo = {
      id: crypto.randomUUID(),
      name: trimmed,
      savedAt: Date.now(),
      entries: captureEntries(lights),
    };
    persist.mutate([...(combos ?? []), combo], {
      onSuccess: () => {
        setDialogOpen(false);
        setName("");
        toast("success", "Look saved", `“${trimmed}” is ready to reapply anytime.`);
      },
    });
  };

  const deleteCombo = (combo: LightCombo): void => {
    persist.mutate(
      (combos ?? []).filter((c) => c.id !== combo.id),
      { onSuccess: () => toast("info", "Combo deleted", `“${combo.name}” removed.`) }
    );
  };

  const applyCombo = async (combo: LightCombo): Promise<void> => {
    const available = new Set(lights.map((l) => l.id));
    const actions = comboActions(combo, available);
    if (actions.length === 0) {
      toast("info", "Nothing to apply", "None of this combo's lights are available right now.");
      return;
    }
    setApplyingId(combo.id);
    const ok = await sendActions(actions);
    setApplyingId(null);
    if (ok) toast("success", `“${combo.name}” applied`);
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold tracking-[0.16em] text-ink-faint uppercase">Saved combos</h2>
        <Button
          size="sm"
          variant="glass"
          onClick={() => setDialogOpen(true)}
          disabled={lights.length === 0 || persist.isPending}
        >
          <BookmarkPlus size={14} /> Save current look
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="hidden h-24 sm:block" />
        </div>
      ) : (combos ?? []).length === 0 ? (
        <div className="rounded-panel border border-dashed border-line px-5 py-8 text-center">
          <p className="text-sm text-ink-dim">No saved combos yet.</p>
          <p className="mt-1 text-xs text-ink-faint">
            Set the mood — pick themes for each light — then hit “Save current look” to bottle it.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {(combos ?? []).map((combo, i) => (
              <ComboCard
                key={combo.id}
                combo={combo}
                themesByVal={themesByVal}
                disabled={disabled}
                applying={applyingId === combo.id}
                index={i}
                onApply={() => void applyCombo(combo)}
                onDelete={() => deleteCombo(combo)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          title="Save current look"
          description="Snapshots every light's power and theme so one tap brings this exact look back."
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveCurrentLook();
            }}
            className="space-y-4"
          >
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Saturday night swim"
                maxLength={40}
                autoFocus
              />
            </Field>

            <div>
              <p className="mb-1.5 text-xs font-medium tracking-wide text-ink-dim uppercase">What gets saved</p>
              <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-xl border border-line bg-abyss/30 p-2.5">
                {lights.map((light) => {
                  const theme = light.lightTheme !== null ? themesByVal.get(light.lightTheme) : undefined;
                  return (
                    <li key={light.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-2 text-ink-dim">
                        <span
                          className={cn("h-2.5 w-2.5 shrink-0 rounded-full", !theme && "border border-line bg-abyss/60")}
                          style={theme ? { background: theme.swatch } : undefined}
                        />
                        <span className="truncate">{light.name}</span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[9px] font-semibold tracking-wide uppercase",
                          light.isOn ? "text-accent" : "text-ink-faint"
                        )}
                      >
                        {light.isOn ? (theme?.name ?? "On") : "Off"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={name.trim().length === 0 || persist.isPending}>
                {persist.isPending ? "Saving…" : "Save look"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
