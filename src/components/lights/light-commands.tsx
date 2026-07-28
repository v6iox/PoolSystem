"use client";

import { useState } from "react";
import { Palette } from "lucide-react";
import { LIGHT_COMMAND_LABELS, type LightCommand } from "@/types/actions";
import { usePool } from "@/lib/client/pool-state";
import { roleAtLeast } from "@/types/auth";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

/**
 * IntelliBrite bus commands beyond themes: sync the group's colors, start a
 * swim pattern, hold the current look, or recall the last held one. Applies
 * to the light group when one exists, otherwise to every light.
 */
export function LightCommands(): React.JSX.Element | null {
  const { snapshot, sendAction, backendConnected, user } = usePool();
  const [busy, setBusy] = useState<LightCommand | null>(null);
  const lights = [...snapshot.circuits, ...snapshot.features].filter((c) => c.isLight);
  if (!roleAtLeast(user.role, "family") || lights.length === 0) return null;
  const group = snapshot.lightGroups[0];

  const run = (command: LightCommand): void => {
    setBusy(command);
    const targets = group ? [{ targetId: group.id, isGroup: true }] : lights.map((l) => ({ targetId: l.id, isGroup: false }));
    void Promise.all(
      targets.map((t) => sendAction({ type: "lightCommand", targetId: t.targetId, command, isGroup: t.isGroup }))
    ).finally(() => setBusy(null));
  };

  return (
    <Panel className="mt-4 p-4">
      <p className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
        <Palette size={13} className="text-accent" />
        Color commands{group ? ` — ${group.name}` : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(LIGHT_COMMAND_LABELS) as LightCommand[]).map((command) => (
          <Button
            key={command}
            variant="glass"
            size="sm"
            disabled={!backendConnected || busy !== null}
            onClick={() => run(command)}
          >
            {LIGHT_COMMAND_LABELS[command]}
          </Button>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        Sync lines colors up, swim runs a moving pattern, set applies per-light colors, hold freezes the current look and
        recall brings it back.
      </p>
    </Panel>
  );
}
