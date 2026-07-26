"use client";

import { useMemo } from "react";
import { ToggleRight } from "lucide-react";
import { usePool, patchCircuit } from "@/lib/client/pool-state";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/panel";
import { CircuitCard } from "@/components/circuits/circuit-card";
import { AllOffButton } from "@/components/circuits/all-off-button";
import { patchCircuitWithBody } from "@/components/circuits/optimistic";
import { roleAtLeast } from "@/types/auth";
import type { CircuitState, LightThemeDef } from "@/types/pool";

const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4";

export default function CircuitsPage(): React.JSX.Element {
  const { snapshot, hasLoaded, backendConnected, user, sendAction } = usePool();
  const canControl = roleAtLeast(user.role, "family");

  const bodyCircuitIds = useMemo(
    () => new Set(snapshot.bodies.map((b) => b.circuitId)),
    [snapshot.bodies]
  );

  // Every circuit + feature, with the pool/spa body circuits pinned first.
  const items = useMemo(() => {
    const isBody = (c: CircuitState): boolean =>
      c.type === "pool" || c.type === "spa" || bodyCircuitIds.has(c.id);
    return [...snapshot.circuits, ...snapshot.features].sort(
      (a, b) => Number(isBody(b)) - Number(isBody(a))
    );
  }, [snapshot.circuits, snapshot.features, bodyCircuitIds]);

  const themeFor = (c: CircuitState): LightThemeDef | null =>
    c.isLight && c.lightTheme !== null
      ? (snapshot.lightThemes.find((t) => t.val === c.lightTheme) ?? null)
      : null;

  const toggle = (c: CircuitState, on: boolean): void => {
    const patch = bodyCircuitIds.has(c.id) ? patchCircuitWithBody(c.id, on) : patchCircuit(c.id, on);
    void sendAction({ type: "setCircuit", circuitId: c.id, state: on }, patch);
  };

  const onCount = items.filter((c) => c.isOn).length;

  return (
    <div>
      <PageHeader
        title="Controls"
        subtitle={
          hasLoaded
            ? onCount > 0
              ? `${onCount} of ${items.length} running`
              : "All quiet"
            : undefined
        }
        action={hasLoaded && canControl && items.length > 0 ? <AllOffButton /> : undefined}
      />

      {!hasLoaded ? (
        <div className={GRID}>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ToggleRight size={32} />}
          title={user.role === "guest" ? "Nothing shared with you yet" : "No circuits reported"}
          detail={
            user.role === "guest"
              ? "Ask an owner to make circuits guest-visible and they will show up here."
              : backendConnected
                ? "The controller has not reported any circuits or features."
                : "The pool controller is unreachable — circuits will appear when it reconnects."
          }
        />
      ) : (
        <div className={GRID}>
          {items.map((c, i) => (
            <CircuitCard
              key={`${c.isFeature ? "f" : "c"}-${c.id}`}
              circuit={c}
              theme={themeFor(c)}
              disabled={!backendConnected}
              index={i}
              onToggle={(on) => toggle(c, on)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
