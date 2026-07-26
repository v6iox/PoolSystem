"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal, ToggleRight, Waves } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { apiGet, apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { EmptyState, PageHeader, Panel, Skeleton } from "@/components/ui/panel";
import { OwnerOnlyState, SettingsSection } from "@/components/settings/section";
import {
  BodyRenameRow,
  CircuitMetaRow,
  type CircuitMetaEntry,
  type EquipmentCircuit,
} from "@/components/settings/equipment-rows";

/**
 * Owner equipment customization: rename bodies & circuits, assign icons,
 * control guest visibility, hide clutter. Hidden circuits drop out of the live
 * snapshot, so they're resurrected here from their stored meta rows to stay
 * un-hideable.
 */

interface CircuitMetaResponse {
  meta: CircuitMetaEntry[];
}

export default function EquipmentSettingsPage(): React.JSX.Element {
  const { snapshot, hasLoaded, backendConnected, user } = usePool();
  const queryClient = useQueryClient();
  const isOwner = user.role === "owner";

  const metaQuery = useQuery({
    queryKey: ["circuit-meta"],
    queryFn: () => apiGet<CircuitMetaResponse>("/api/settings/circuit-meta"),
    enabled: isOwner,
  });

  const metaById = useMemo(() => {
    const map = new Map<number, CircuitMetaEntry>();
    for (const entry of metaQuery.data?.meta ?? []) map.set(entry.circuitId, entry);
    return map;
  }, [metaQuery.data]);

  const circuits = useMemo<EquipmentCircuit[]>(() => {
    const bodyCircuitIds = new Set(snapshot.bodies.map((b) => b.circuitId));
    const live: EquipmentCircuit[] = [...snapshot.circuits, ...snapshot.features].map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      isLight: c.isLight,
      isFeature: c.isFeature,
      fromMetaOnly: false,
    }));
    // Hidden circuits are filtered out of the snapshot — bring them back from
    // meta so the owner can rename or un-hide them.
    const liveIds = new Set(live.map((c) => c.id));
    const resurrected: EquipmentCircuit[] = (metaQuery.data?.meta ?? [])
      .filter((m) => m.hidden && !liveIds.has(m.circuitId))
      .map((m) => ({
        id: m.circuitId,
        name: m.displayName ?? `Circuit ${m.circuitId}`,
        type: "generic",
        isLight: false,
        isFeature: false,
        fromMetaOnly: true,
      }));
    // Pool/spa body circuits first, then panel order.
    return [...live, ...resurrected].sort((a, b) => {
      const aBody = bodyCircuitIds.has(a.id) ? 0 : 1;
      const bBody = bodyCircuitIds.has(b.id) ? 0 : 1;
      return aBody - bBody || a.id - b.id;
    });
  }, [snapshot.bodies, snapshot.circuits, snapshot.features, metaQuery.data]);

  if (!isOwner) {
    return (
      <div>
        <PageHeader title="Equipment" subtitle="Names, icons and visibility" />
        <OwnerOnlyState />
      </div>
    );
  }

  const saveCircuit = (patch: {
    circuitId: number;
    displayName?: string | null;
    icon?: string | null;
    guestVisible?: boolean;
    hidden?: boolean;
  }): void => {
    void apiSend<{ ok: boolean }>("PUT", "/api/settings/circuit-meta", patch)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["circuit-meta"] });
        const what =
          patch.displayName !== undefined
            ? "Circuit renamed"
            : patch.icon !== undefined
              ? "Icon updated"
              : patch.guestVisible !== undefined
                ? patch.guestVisible
                  ? "Now visible to guests"
                  : "Hidden from guests"
                : patch.hidden
                  ? "Circuit hidden"
                  : "Circuit unhidden";
        toast("success", what);
      })
      .catch((err: unknown) => {
        toast("error", "Couldn't save", err instanceof Error ? err.message : undefined);
      });
  };

  const renameBody = (bodyId: number, bodyName: string | null): void => {
    void apiSend<{ ok: boolean }>("PUT", "/api/settings/circuit-meta", { bodyId, bodyName })
      .then(() => toast("success", bodyName ? "Body renamed" : "Body name reset"))
      .catch((err: unknown) => {
        toast("error", "Couldn't rename body", err instanceof Error ? err.message : undefined);
      });
  };

  const loading = !hasLoaded || metaQuery.isLoading;

  return (
    <div>
      <PageHeader
        title="Equipment"
        subtitle="Rename circuits, pick icons, choose what guests can see"
      />

      <div className="mx-auto max-w-2xl space-y-6">
        {loading ? (
          <>
            <Skeleton className="h-28" />
            <Skeleton className="h-96" />
          </>
        ) : (
          <>
            {snapshot.bodies.length > 0 && (
              <SettingsSection
                icon={<Waves size={13} />}
                title="Bodies of water"
                description="Names save when you leave the field. Clear a name to restore the controller default."
              >
                {snapshot.bodies.map((body, i) => (
                  <BodyRenameRow
                    key={body.id}
                    bodyId={body.id}
                    name={body.name}
                    kind={body.kind}
                    index={i}
                    onRename={renameBody}
                  />
                ))}
              </SettingsSection>
            )}

            {circuits.length === 0 ? (
              <EmptyState
                icon={<ToggleRight size={32} />}
                title="No circuits reported"
                detail={
                  backendConnected
                    ? "The controller has not reported any circuits or features to customize yet."
                    : "The pool controller is unreachable — circuits will appear here when it reconnects."
                }
              />
            ) : (
              <SettingsSection
                icon={<SlidersHorizontal size={13} />}
                title="Circuits & features"
                description="Guest switches share a circuit with guest accounts; hidden circuits disappear for everyone."
              >
                {circuits.map((circuit, i) => (
                  <CircuitMetaRow
                    key={`${circuit.fromMetaOnly ? "m" : "c"}-${circuit.id}`}
                    circuit={circuit}
                    meta={metaById.get(circuit.id)}
                    index={i}
                    onSave={saveCircuit}
                  />
                ))}
              </SettingsSection>
            )}

            <Panel className="p-4 text-xs text-ink-faint">
              Renames and icons apply everywhere in Moonpool — dashboards, schedules, scenes and the
              copilot — but never change the controller&apos;s own configuration.
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
