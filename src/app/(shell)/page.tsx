"use client";

import { motion } from "motion/react";
import { Flame, Snowflake, Sun, Thermometer, Wind } from "lucide-react";
import { usePool, patchSetpoint } from "@/lib/client/pool-state";
import { TempDial } from "@/components/pool/temp-dial";
import { useAdvisoryGate } from "@/components/pool/advisory-gate";
import { WidgetGrid } from "@/components/widgets/widget-grid";
import { Panel, Skeleton } from "@/components/ui/panel";
import { roleAtLeast } from "@/types/auth";
import { cn } from "@/lib/utils";

function Hero(): React.JSX.Element {
  const { snapshot, hasLoaded, backendConnected, user, sendAction } = usePool();
  const canControl = roleAtLeast(user.role, "family");
  const { gate, dialog } = useAdvisoryGate();

  if (!hasLoaded) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72 hidden sm:block" />
      </div>
    );
  }

  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Night swim?" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Golden hour";

  return (
    <section>
      <div className="mb-5 flex items-end justify-between">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display text-3xl font-semibold tracking-tight text-ink"
          >
            {greeting}, {user.name.split(" ")[0]}
          </motion.h1>
          <p className="mt-1 flex items-center gap-3 text-sm text-ink-dim">
            {snapshot.airTemp !== null && (
              <span className="flex items-center gap-1">
                <Thermometer size={14} className="text-accent" /> Air {Math.round(snapshot.airTemp)}°{snapshot.units}
              </span>
            )}
            {snapshot.freezeProtect && (
              <span className="flex items-center gap-1 text-warn">
                <Snowflake size={14} /> Freeze protect
              </span>
            )}
            {snapshot.solarTemp !== null && snapshot.bodies.some((b) => b.heatMode.includes("solar")) && (
              <span className="flex items-center gap-1">
                <Sun size={14} className="text-warn" /> Solar {Math.round(snapshot.solarTemp)}°
              </span>
            )}
          </p>
        </div>
      </div>

      <div className={cn("grid grid-cols-1 gap-4", snapshot.bodies.length > 1 && "sm:grid-cols-2")}>
        {snapshot.bodies.map((body, i) => {
          const heating = body.heatStatus !== "off";
          return (
            <motion.div
              key={body.id}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, type: "spring", stiffness: 120, damping: 18 }}
            >
              <Panel
                className={cn(
                  "relative flex flex-col items-center overflow-hidden px-4 pb-5 pt-6",
                  heating && "pulse-heat"
                )}
              >
                <div className="absolute right-4 top-4 flex items-center gap-1.5">
                  {body.isOn && (
                    <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold tracking-wide text-accent uppercase">
                      <Wind size={11} /> circulating
                    </span>
                  )}
                  {heating && (
                    <span className="flex items-center gap-1 rounded-full bg-heat-soft px-2 py-0.5 text-[10px] font-semibold tracking-wide text-heat uppercase">
                      <Flame size={11} /> {body.heatStatus}
                    </span>
                  )}
                </div>
                <TempDial
                  label={body.name}
                  temp={body.temp}
                  setPoint={body.setPoint}
                  min={body.minSetPoint}
                  max={body.maxSetPoint}
                  heating={heating}
                  heatSource={body.heatStatus === "solar" ? "solar" : "heater"}
                  units={snapshot.units}
                  size={252}
                  disabled={!backendConnected || !canControl}
                  onSetPoint={
                    canControl
                      ? (value) => {
                          const run = (): void =>
                            void sendAction(
                              { type: "setHeat", bodyId: body.id, setPoint: value },
                              patchSetpoint(body.id, value)
                            );
                          // Weather-aware confirmation on meaningful raises
                          // while heat is actually on; small nudges just go.
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
                <p className="mt-2 text-xs capitalize text-ink-faint">
                  heat: {body.heatMode === "solarpref" ? "solar preferred" : body.heatMode}
                </p>
              </Panel>
            </motion.div>
          );
        })}
        {snapshot.bodies.length === 0 && (
          <Panel className="p-8 text-center text-ink-dim">
            No bodies of water reported yet{backendConnected ? "" : " — controller offline"}.
          </Panel>
        )}
      </div>
      {dialog}
    </section>
  );
}

export default function DashboardPage(): React.JSX.Element {
  return (
    <div className="space-y-8">
      <Hero />
      <WidgetGrid />
    </div>
  );
}
