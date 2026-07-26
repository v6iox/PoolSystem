"use client";

import { motion } from "motion/react";
import { Droplets } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { PageHeader, EmptyState, Skeleton } from "@/components/ui/panel";
import { ChlorSaltHero, ChlorOutputs } from "@/components/pump/chlor-card";
import { SuperChlorCard } from "@/components/pump/super-chlor-card";

export default function ChlorinatorPage(): React.JSX.Element {
  const { snapshot, hasLoaded, backendConnected } = usePool();
  const chlors = snapshot.chlorinators;
  const hasSpa = snapshot.bodies.some((b) => b.kind === "spa");
  const first = chlors[0];

  const subtitle = !hasLoaded
    ? "Waiting for controller…"
    : !first
      ? "No salt system reported"
      : first.superChlor
        ? `Super-chlorinating · ${first.superChlorHours}h`
        : `${first.saltLevel.toLocaleString()} ppm salt · output ${first.currentOutput}%`;

  return (
    <div>
      <PageHeader title="Chlorinator" subtitle={subtitle} />

      {!hasLoaded ? (
        <div className="space-y-4">
          <Skeleton className="h-64" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        </div>
      ) : chlors.length === 0 ? (
        <EmptyState
          icon={<Droplets size={40} />}
          title="No chlorinator reported"
          detail={
            backendConnected
              ? "The controller hasn't reported a salt chlorinator. Once one is configured on the panel it will show up here."
              : "Controller is offline — the chlorinator will appear as soon as the connection returns."
          }
        />
      ) : (
        <div className="space-y-8">
          {chlors.map((chlor, i) => (
            <motion.section
              key={chlor.id}
              className="space-y-4"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, type: "spring", stiffness: 300, damping: 30 }}
            >
              <ChlorSaltHero chlor={chlor} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChlorOutputs chlor={chlor} hasSpa={hasSpa} />
                <SuperChlorCard chlor={chlor} />
              </div>
            </motion.section>
          ))}
        </div>
      )}
    </div>
  );
}
