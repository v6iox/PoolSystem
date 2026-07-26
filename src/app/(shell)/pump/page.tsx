"use client";

import { motion } from "motion/react";
import { Fan } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { PageHeader, EmptyState, Skeleton } from "@/components/ui/panel";
import { PumpCard } from "@/components/pump/pump-card";
import { cn } from "@/lib/utils";

export default function PumpPage(): React.JSX.Element {
  const { snapshot, hasLoaded, backendConnected } = usePool();
  const pumps = snapshot.pumps;
  const running = pumps.filter((p) => p.isRunning);
  const totalWatts = running.reduce((sum, p) => sum + p.watts, 0);

  const subtitle = !hasLoaded
    ? "Waiting for controller…"
    : pumps.length === 0
      ? "No pumps reported"
      : running.length === 0
        ? "All pumps idle"
        : `${running.length} of ${pumps.length} running · ${totalWatts.toLocaleString()} W`;

  return (
    <div>
      <PageHeader title="Pump" subtitle={subtitle} />

      {!hasLoaded ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-[28rem]" />
          <Skeleton className="hidden h-[28rem] lg:block" />
        </div>
      ) : pumps.length === 0 ? (
        <EmptyState
          icon={<Fan size={40} />}
          title="No pumps reported"
          detail={
            backendConnected
              ? "The controller hasn't reported any pumps. Once a pump is configured on the panel it will show up here."
              : "Controller is offline — pumps will appear as soon as the connection returns."
          }
        />
      ) : (
        <div className={cn("grid grid-cols-1 gap-4", pumps.length > 1 && "lg:grid-cols-2")}>
          {pumps.map((pump, i) => (
            <motion.div
              key={pump.id}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, type: "spring", stiffness: 300, damping: 30 }}
            >
              <PumpCard pump={pump} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
