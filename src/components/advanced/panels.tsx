"use client";

import { useState } from "react";
import { Clock3, Fan, Flame, Lightbulb, RefreshCw, SkipForward, Waves } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { SettingRow } from "@/components/settings/section";
import { AdvancedDisclosure, NumberField, SaveOnBlurInput, useAdvanced } from "@/components/advanced/core";
import { formatClock } from "@/lib/utils";

/**
 * The per-page "Advanced" menus: every remaining njsPC panel-configuration
 * surface, each mounted at the bottom of the page it belongs to. Owner-only;
 * everything writes to the panel through the audited /api/advanced routes.
 */

/** Circuits page: panel names, functions, egg timers, freeze protection. */
export function CircuitsAdvanced(): React.JSX.Element | null {
  const { advanced, isOwner, disabled, send } = useAdvanced();
  if (!isOwner || !advanced || advanced.circuits.length === 0) return null;
  const functions = advanced.circuitFunctions;
  return (
    <AdvancedDisclosure title="Advanced — panel circuit setup">
      {advanced.circuits.map((c) => (
        <div key={c.id} className="grid grid-cols-1 gap-3 px-4 py-3.5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex flex-wrap items-center gap-3">
            <SaveOnBlurInput
              value={c.name}
              disabled={disabled}
              ariaLabel={`Panel name for circuit ${c.id}`}
              className="w-40"
              onSave={(name) => void send("circuit", { id: c.id, name }, `Circuit ${c.id} renamed`)}
            />
            {functions.length > 0 && c.typeVal !== null && (
              <Select
                value={String(c.typeVal)}
                disabled={disabled}
                aria-label={`Function for ${c.name}`}
                className="h-9 w-44"
                onValueChange={(v) => void send("circuit", { id: c.id, type: Number(v) }, `${c.name} function changed`)}
                options={functions.map((f) => ({ value: String(f.val), label: f.name }))}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-2 text-xs text-ink-dim">
              egg timer
              <NumberField
                value={c.eggTimer ?? 0}
                min={0}
                max={1620}
                suffix="min"
                disabled={disabled}
                ariaLabel={`Egg timer for ${c.name}`}
                onSave={(minutes) => void send("circuit", { id: c.id, eggTimer: minutes }, `${c.name} egg timer set`)}
              />
            </span>
            <span className="flex items-center gap-2 text-xs text-ink-dim">
              freeze
              <Switch
                checked={c.freeze}
                disabled={disabled}
                aria-label={`Freeze protection for ${c.name}`}
                onCheckedChange={(on) => void send("circuit", { id: c.id, freeze: on }, `${c.name} freeze protection ${on ? "on" : "off"}`)}
              />
            </span>
            <span className="flex items-center gap-2 text-xs text-ink-dim">
              features
              <Switch
                checked={c.showInFeatures}
                disabled={disabled}
                aria-label={`Show ${c.name} in features`}
                onCheckedChange={(on) => void send("circuit", { id: c.id, showInFeatures: on }, `${c.name} ${on ? "shown" : "hidden"} in features`)}
              />
            </span>
          </div>
        </div>
      ))}
    </AdvancedDisclosure>
  );
}

/** Pump page: the per-circuit speed program table. */
export function PumpAdvanced(): React.JSX.Element | null {
  const { advanced, isOwner, disabled, send } = useAdvanced();
  if (!isOwner || !advanced || advanced.pumps.length === 0) return null;
  return (
    <AdvancedDisclosure title="Advanced — pump speed programs">
      {advanced.pumps.map((p) => (
        <div key={p.id} className="px-4 py-3.5">
          <p className="mb-2 flex items-center gap-2 text-sm text-ink">
            <Fan size={15} className="text-accent" /> {p.name}
            <span className="text-xs text-ink-faint">
              {p.minSpeed}–{p.maxSpeed} rpm
            </span>
          </p>
          <div className="space-y-2">
            {p.circuits.map((pc) => (
              <div key={pc.circuitId} className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink-dim">{pc.circuitName}</span>
                <NumberField
                  value={pc.speed}
                  min={p.minSpeed}
                  max={p.maxSpeed}
                  suffix={pc.units}
                  disabled={disabled}
                  ariaLabel={`${pc.circuitName} pump speed`}
                  onSave={(speed) =>
                    void send("pump-speed", { pumpId: p.id, circuitId: pc.circuitId, speed }, `${pc.circuitName} program updated`)
                  }
                />
              </div>
            ))}
            {p.circuits.length === 0 && <p className="text-xs text-ink-faint">No circuits programmed on this pump.</p>}
          </div>
        </div>
      ))}
    </AdvancedDisclosure>
  );
}

/** Lights page: group name + membership editing. */
export function LightsAdvanced(): React.JSX.Element | null {
  const { snapshot } = usePool();
  const { advanced, isOwner, disabled, send } = useAdvanced();
  if (!isOwner || !advanced || advanced.lightGroups.length === 0) return null;
  const lightName = (id: number): string =>
    [...snapshot.circuits, ...snapshot.features].find((c) => c.id === id)?.name ?? `Light ${id}`;
  return (
    <AdvancedDisclosure title="Advanced — light groups">
      {advanced.lightGroups.map((g) => (
        <div key={g.id} className="px-4 py-3.5">
          <div className="mb-2 flex items-center gap-2">
            <Lightbulb size={15} className="text-accent" />
            <SaveOnBlurInput
              value={g.name}
              disabled={disabled}
              ariaLabel={`Name for light group ${g.id}`}
              className="w-48"
              onSave={(name) => void send("light-group", { id: g.id, name }, "Light group renamed")}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            {advanced.lightCircuitIds.map((cid) => {
              const inGroup = g.circuitIds.includes(cid);
              return (
                <label key={cid} className="flex items-center gap-2 text-sm text-ink-dim">
                  <Switch
                    checked={inGroup}
                    disabled={disabled || (inGroup && g.circuitIds.length === 1)}
                    aria-label={`${lightName(cid)} in ${g.name}`}
                    onCheckedChange={(on) =>
                      void send(
                        "light-group",
                        { id: g.id, circuitIds: on ? [...g.circuitIds, cid] : g.circuitIds.filter((x) => x !== cid) },
                        `${g.name} membership updated`
                      )
                    }
                  />
                  {lightName(cid)}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </AdvancedDisclosure>
  );
}

/** Heat page: heaters as the panel sees them (read-only view). */
export function HeatAdvanced(): React.JSX.Element | null {
  const { advanced, isOwner } = useAdvanced();
  if (!isOwner || !advanced || advanced.heaters.length === 0) return null;
  return (
    <AdvancedDisclosure
      title="Advanced — heaters"
      hint="How the panel has your heaters configured. Rewiring heater types is deliberately left to the panel/dashPanel."
    >
      {advanced.heaters.map((h) => (
        <SettingRow
          key={h.id}
          icon={<Flame size={16} />}
          label={h.name}
          hint={`${h.typeName}${h.bodyDesc ? ` · ${h.bodyDesc}` : ""}${h.coolingEnabled !== null ? ` · cooling ${h.coolingEnabled ? "enabled" : "off"}` : ""}`}
        />
      ))}
    </AdvancedDisclosure>
  );
}

/** System page: panel clock sync + valve names. */
export function SystemAdvanced(): React.JSX.Element | null {
  const { advanced, isOwner, disabled, send } = useAdvanced();
  const [syncing, setSyncing] = useState(false);
  if (!isOwner || !advanced) return null;
  return (
    <AdvancedDisclosure title="Advanced — panel clock & valves">
      <SettingRow
        icon={<Clock3 size={16} />}
        label="Panel clock"
        hint={(() => {
          const serverMs = Date.parse(advanced.clock.serverTime);
          const panelMs = advanced.clock.panelTime ? Date.parse(advanced.clock.panelTime) : NaN;
          const parts: string[] = [];
          if (Number.isFinite(panelMs)) {
            const driftMin = Math.round((panelMs - serverMs) / 60_000);
            parts.push(`panel thinks it's ${formatClock(panelMs)}`);
            parts.push(
              driftMin === 0
                ? "in sync with the server"
                : `${Math.abs(driftMin)} min ${driftMin > 0 ? "ahead" : "behind"} — schedules fire at panel time`
            );
          } else {
            parts.push(`server time ${formatClock(serverMs)}`);
          }
          parts.push(`source: ${advanced.clock.source}`);
          return parts.join(" · ");
        })()}
      >
        <Button
          variant="glass"
          size="sm"
          disabled={disabled || syncing}
          onClick={() => {
            setSyncing(true);
            void send("clock-sync", {}, "Panel clock synced to the server").finally(() => setSyncing(false));
          }}
        >
          <RefreshCw size={14} className={syncing ? "animate-spin" : undefined} /> Sync now
        </Button>
      </SettingRow>
      {advanced.valves.map((v) => (
        <SettingRow
          key={v.id}
          icon={<Waves size={16} />}
          label={`Valve ${v.id}`}
          hint={`${v.typeName}${v.circuitName ? ` · follows ${v.circuitName}` : ""}`}
        >
          <SaveOnBlurInput
            value={v.name}
            disabled={disabled}
            ariaLabel={`Name for valve ${v.id}`}
            className="w-40"
            onSave={(name) => void send("valve", { id: v.id, name }, `Valve ${v.id} renamed`)}
          />
        </SettingRow>
      ))}
    </AdvancedDisclosure>
  );
}

/** Dashboard banner: a heater/valve delay is active — offer to skip it. */
export function DelayBanner(): React.JSX.Element | null {
  const { snapshot, user, backendConnected } = usePool();
  const { send } = useAdvanced();
  const [busy, setBusy] = useState(false);
  if (!snapshot.delay || user.role === "guest") return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-warn/25 bg-warn/10 px-3 py-2 text-sm text-warn">
      <span className="flex items-center gap-2">
        <Clock3 size={15} className="shrink-0" />
        The panel is in a delay (heater cool-down or valve turn) — some circuits are briefly locked.
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={!backendConnected || busy}
        onClick={() => {
          setBusy(true);
          void send("cancel-delay", {}, "Delay cancelled").finally(() => setBusy(false));
        }}
      >
        <SkipForward size={14} /> Skip delay
      </Button>
    </div>
  );
}
