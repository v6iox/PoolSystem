"use client";

import { Eye, Thermometer } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { roleAtLeast } from "@/types/auth";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/panel";
import { HeatBodyPanel } from "@/components/circuits/heat-body-panel";
import { HeatAdvanced } from "@/components/advanced/panels";
import { cn } from "@/lib/utils";

export default function HeatPage(): React.JSX.Element {
  const { snapshot, hasLoaded, backendConnected, user } = usePool();
  const canControl = roleAtLeast(user.role, "family");
  const heatingCount = snapshot.bodies.filter((b) => b.heatStatus !== "off").length;

  return (
    <div>
      <PageHeader
        title="Heat"
        subtitle={
          hasLoaded
            ? heatingCount > 0
              ? `${heatingCount} ${heatingCount === 1 ? "body" : "bodies"} heating`
              : "Nothing heating right now"
            : undefined
        }
      />

      {hasLoaded && !canControl && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-abyss/40 px-3 py-2 text-sm text-ink-dim">
          <Eye size={15} className="shrink-0 text-accent" />
          Signed in as a guest — heat settings are read-only.
        </p>
      )}

      {!hasLoaded ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-[27rem]" />
          <Skeleton className="hidden h-[27rem] lg:block" />
        </div>
      ) : snapshot.bodies.length === 0 ? (
        <EmptyState
          icon={<Thermometer size={32} />}
          title="No bodies of water reported"
          detail={
            backendConnected
              ? "The controller has not reported a pool or spa to heat yet."
              : "The pool controller is unreachable — heating will be available when it reconnects."
          }
        />
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 gap-4",
            snapshot.bodies.length > 1 ? "lg:grid-cols-2" : "mx-auto w-full max-w-xl"
          )}
        >
          {snapshot.bodies.map((body, i) => (
            <HeatBodyPanel key={body.id} body={body} index={i} />
          ))}
        </div>
      )}

      <HeatAdvanced />
    </div>
  );
}
