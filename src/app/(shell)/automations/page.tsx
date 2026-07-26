"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Lock, Plus, RefreshCw, Wand2, WifiOff } from "lucide-react";
import type { AutomationDef, SceneDef } from "@/types/actions";
import { usePool } from "@/lib/client/pool-state";
import { roleAtLeast } from "@/types/auth";
import { apiGet } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/panel";
import { AutomationCard } from "@/components/automations/automation-card";
import { AutomationDialog } from "@/components/automations/automation-dialog";
import { PendingJobs } from "@/components/automations/pending-jobs";
import type { AutomationsResponse } from "@/components/automations/describe";

export default function AutomationsPage(): React.JSX.Element {
  const { hasLoaded, backendConnected, user } = usePool();
  const isFamily = roleAtLeast(user.role, "family");

  const query = useQuery({
    queryKey: ["automations"],
    queryFn: () => apiGet<AutomationsResponse>("/api/automations"),
    enabled: isFamily,
    refetchInterval: 60_000,
  });
  const { data: scenesData } = useQuery({
    queryKey: ["scenes"],
    queryFn: () => apiGet<{ scenes: SceneDef[] }>("/api/scenes"),
    enabled: isFamily,
  });
  const scenes = useMemo(() => scenesData?.scenes ?? [], [scenesData]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AutomationDef | null>(null);

  const automations = query.data?.automations ?? [];
  const pendingJobs = query.data?.pendingJobs ?? [];
  const enabledCount = automations.filter((a) => a.enabled).length;
  const loading = !hasLoaded || (isFamily && query.isPending);

  const openCreate = (): void => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (automation: AutomationDef): void => {
    setEditing(automation);
    setDialogOpen(true);
  };

  if (!isFamily) {
    return (
      <div>
        <PageHeader title="Automations" subtitle="If this, then pool" />
        <EmptyState
          icon={<Lock size={32} />}
          title="Family members only"
          detail="Automations can change equipment state, so guests can't view or edit them. Ask the pool owner for a family account."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automations"
        subtitle={
          loading
            ? undefined
            : automations.length === 0
              ? "If this, then pool"
              : `${automations.length} ${automations.length === 1 ? "automation" : "automations"} · ${enabledCount} active${
                  pendingJobs.length > 0 ? ` · ${pendingJobs.length} queued` : ""
                }`
        }
        action={
          !loading && !query.isError ? (
            <Button variant="primary" size="sm" disabled={!backendConnected} onClick={openCreate}>
              <Plus size={15} /> New automation
            </Button>
          ) : undefined
        }
      />

      {!backendConnected && hasLoaded && (
        <p className="flex items-center gap-2 rounded-xl border border-warn/25 bg-warn/10 px-3 py-2 text-sm text-warn">
          <WifiOff size={15} className="shrink-0" />
          Controller offline — automations are paused and read-only until it reconnects.
        </p>
      )}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
          <Skeleton className="h-44 hidden lg:block" />
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={<Wand2 size={32} />}
          title="Couldn't load automations"
          detail={query.error instanceof Error ? query.error.message : "Something went wrong fetching the automation list."}
          action={
            <Button variant="glass" onClick={() => void query.refetch()}>
              <RefreshCw size={15} /> Try again
            </Button>
          }
        />
      ) : automations.length === 0 && pendingJobs.length === 0 ? (
        <EmptyState
          icon={<Wand2 size={32} />}
          title="No automations yet"
          detail="Automations react to time, sun, temperature and events — the copilot can create them too. Try lights at sunset, or an all-off when freeze protection kicks in."
          action={
            <Button variant="primary" disabled={!backendConnected} onClick={openCreate}>
              <Plus size={16} /> Create your first automation
            </Button>
          }
        />
      ) : (
        <>
          {automations.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {automations.map((automation, i) => (
                <motion.div
                  key={automation.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 8) * 0.05, type: "spring", stiffness: 300, damping: 30 }}
                >
                  <AutomationCard
                    automation={automation}
                    scenes={scenes}
                    disabled={!backendConnected}
                    onEdit={openEdit}
                  />
                </motion.div>
              ))}
            </div>
          )}

          {pendingJobs.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 30 }}
            >
              <PendingJobs jobs={pendingJobs} scenes={scenes} disabled={!backendConnected} />
            </motion.div>
          )}
        </>
      )}

      <AutomationDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        automation={editing}
      />
    </div>
  );
}
