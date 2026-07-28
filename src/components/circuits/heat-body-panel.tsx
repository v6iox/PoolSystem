"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Flame, Snowflake, Sun } from "lucide-react";
import type { BodyState } from "@/types/pool";
import { usePool, patchHeatMode, patchSetpoint } from "@/lib/client/pool-state";
import { roleAtLeast } from "@/types/auth";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { TempDial } from "@/components/pool/temp-dial";
import { useAdvisoryGate } from "@/components/pool/advisory-gate";
import { HeatModePicker } from "./heat-mode-picker";
import { patchCircuitWithBody } from "./optimistic";
import { cn, formatRelative } from "@/lib/utils";

const STATUS_VERB: Record<BodyState["heatStatus"], string> = {
  off: "",
  heater: "heating",
  solar: "solar heating",
  cooling: "cooling",
  dual: "heating",
};

/** One body of water: liquid dial, on/off, heat mode + animated heating status. */
export function HeatBodyPanel({ body, index }: { body: BodyState; index: number }): React.JSX.Element {
  const { snapshot, backendConnected, user, sendAction } = usePool();
  const reduced = useReducedMotion();
  const canControl = roleAtLeast(user.role, "family");
  const disabled = !backendConnected || !canControl;
  const { gate, dialog } = useAdvisoryGate();

  const heating = body.heatStatus !== "off";
  const stale = body.tempStale === true;
  const solarActive = body.heatStatus === "solar";
  const cooling = body.heatStatus === "cooling";
  const solarTemp = snapshot.solarTemp;
  const showSolarTemp =
    solarTemp !== null && (body.heatMode === "solar" || body.heatMode === "solarpref" || solarActive);

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { delay: index * 0.08, type: "spring", stiffness: 140, damping: 20 },
      }}
    >
      <Panel
        className={cn(
          "relative flex flex-col items-center gap-4 overflow-hidden px-4 pb-5 pt-5",
          heating && !cooling && "pulse-heat"
        )}
      >
        <div className="flex w-full items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold tracking-tight text-ink">{body.name}</p>
            <p className="text-xs capitalize text-ink-faint">
              {body.kind} · {body.isOn ? "circulating" : "off"}
            </p>
          </div>
          <Switch
            checked={body.isOn}
            disabled={disabled}
            aria-label={`${body.name} on`}
            onCheckedChange={(on) =>
              void sendAction(
                { type: "setCircuit", circuitId: body.circuitId, state: on },
                patchCircuitWithBody(body.circuitId, on)
              )
            }
          />
        </div>

        <TempDial
          label={body.name}
          temp={stale ? null : body.temp}
          setPoint={body.setPoint}
          min={body.minSetPoint}
          max={body.maxSetPoint}
          heating={heating}
          heatSource={solarActive ? "solar" : "heater"}
          units={snapshot.units}
          size={256}
          disabled={disabled}
          onSetPoint={
            canControl
              ? (value) => {
                  const run = (): void =>
                    void sendAction(
                      { type: "setHeat", bodyId: body.id, setPoint: value },
                      patchSetpoint(body.id, value)
                    );
                  // Weather-aware confirmation on meaningful raises while heat is on.
                  if (body.heatMode !== "off" && value >= body.setPoint + 3) {
                    void gate(
                      {
                        bodyId: body.id,
                        bodyName: body.name,
                        setPoint: value,
                        intent: `Raise the ${body.name.toLowerCase()} setpoint to ${value}°${snapshot.units}`,
                        confirmLabel: `Heat to ${value}°`,
                      },
                      run
                    );
                  } else {
                    run();
                  }
                }
              : undefined
          }
        />

        {stale ? (
          <p className="mb-1 text-[11px] text-ink-faint/70">
            no live reading — pump off{body.temp !== null ? ` (last ${Math.round(body.temp)}°${snapshot.units})` : ""}
          </p>
        ) : (
          body.temp !== null &&
          typeof body.tempChangedAt === "number" && (
            <p className="mb-1 text-[11px] text-ink-faint/70">reading updated {formatRelative(body.tempChangedAt)}</p>
          )
        )}

        {/* Status chips — fixed min height so appearing/disappearing doesn't jump the layout. */}
        <div className="flex min-h-7 flex-wrap items-center justify-center gap-2">
          <AnimatePresence mode="popLayout">
            {heating && (
              <motion.span
                key={body.heatStatus}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                  cooling ? "bg-accent-soft text-accent" : solarActive ? "bg-warn/10 text-warn" : "bg-heat-soft text-heat"
                )}
              >
                <motion.span
                  className="flex"
                  animate={reduced ? undefined : { scale: [1, 1.25, 1], opacity: [0.75, 1, 0.75] }}
                  transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
                >
                  {cooling ? <Snowflake size={13} /> : solarActive ? <Sun size={13} /> : <Flame size={13} />}
                </motion.span>
                {STATUS_VERB[body.heatStatus]} to {body.setPoint}°{snapshot.units}
              </motion.span>
            )}
          </AnimatePresence>
          {showSolarTemp && (
            <span className="flex items-center gap-1 rounded-full border border-line bg-abyss/40 px-2.5 py-1 text-xs text-ink-dim">
              <Sun size={12} className="text-warn" /> Solar {Math.round(solarTemp)}°{snapshot.units}
            </span>
          )}
        </div>

        <HeatModePicker
          bodyId={body.id}
          modes={body.supportedHeatModes}
          value={body.heatMode}
          disabled={disabled}
          onChange={(mode) => {
            const run = (): void =>
              void sendAction({ type: "setHeat", bodyId: body.id, mode }, patchHeatMode(body.id, mode));
            // Turning heat ON gets a weather-aware confirmation ("rain is
            // forecast tomorrow 3–4 PM…"); turning it off never prompts.
            if (body.heatMode === "off" && mode !== "off") {
              void gate(
                {
                  bodyId: body.id,
                  bodyName: body.name,
                  setPoint: body.setPoint,
                  intent: `Turn on ${mode === "heater" ? "the heater" : mode === "solar" ? "solar heat" : "solar-preferred heat"} for the ${body.name.toLowerCase()} (set ${body.setPoint}°${snapshot.units})`,
                  confirmLabel: "Heat anyway",
                },
                run
              );
            } else {
              run();
            }
          }}
        />
        {dialog}
      </Panel>
    </motion.div>
  );
}
