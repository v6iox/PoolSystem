"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bath, Eye, Plus, RefreshCw, Sparkles, WifiOff } from "lucide-react";
import type { SceneDef } from "@/types/actions";
import { usePool } from "@/lib/client/pool-state";
import { roleAtLeast } from "@/types/auth";
import { apiGet, apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { SceneCard } from "@/components/scenes/scene-card";
import { SceneDialog } from "@/components/scenes/scene-dialog";
import { RunLaterDialog } from "@/components/scenes/run-later-dialog";
import { PendingSceneRuns } from "@/components/scenes/pending-runs";
import { buildSpaNightSeed } from "@/components/scenes/seed";

export default function ScenesPage(): React.JSX.Element {
  const { snapshot, hasLoaded, backendConnected, user } = usePool();
  const isFamily = roleAtLeast(user.role, "family");
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SceneDef | null>(null);
  const [runLaterScene, setRunLaterScene] = useState<SceneDef | null>(null);
  const [seeding, setSeeding] = useState(false);

  const scenesQuery = useQuery({
    queryKey: ["scenes"],
    queryFn: () => apiGet<{ scenes: SceneDef[] }>("/api/scenes"),
    refetchInterval: 60_000,
  });
  const scenes = scenesQuery.data?.scenes ?? [];
  const loading = !hasLoaded || scenesQuery.isPending;

  const openCreate = (): void => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (scene: SceneDef): void => {
    setEditing(scene);
    setDialogOpen(true);
  };

  const seed = hasLoaded ? buildSpaNightSeed(snapshot) : null;
  const createSeed = async (): Promise<void> => {
    if (!seed || seeding) return;
    setSeeding(true);
    try {
      await apiSend<{ ok: boolean; id: number }>("POST", "/api/scenes", seed);
      await queryClient.invalidateQueries({ queryKey: ["scenes"] });
      toast("success", "Spa Night added", seed.description);
    } catch (err) {
      toast("error", "Couldn't add the starter scene", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Scenes"
        subtitle={
          loading
            ? undefined
            : scenes.length === 0
              ? "One-tap macros for the whole pool"
              : `${scenes.length} ${scenes.length === 1 ? "scene" : "scenes"} · tap a card to run`
        }
        action={
          !loading && isFamily ? (
            <Button variant="primary" size="sm" onClick={openCreate}>
              <Plus size={15} /> New scene
            </Button>
          ) : undefined
        }
      />

      {!loading && !isFamily && scenes.length > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-abyss/40 px-3 py-2 text-sm text-ink-dim">
          <Eye size={15} className="shrink-0 text-accent" />
          These scenes were shared with guests — tap one to run it.
        </p>
      )}

      {!loading && !backendConnected && scenes.length > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-warn/25 bg-warn/10 px-3 py-2 text-sm text-warn">
          <WifiOff size={15} className="shrink-0" />
          Controller offline — scenes can be edited but not run right now.
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : scenesQuery.isError ? (
        <EmptyState
          icon={<Sparkles size={32} />}
          title="Couldn't load scenes"
          detail={scenesQuery.error instanceof Error ? scenesQuery.error.message : "Something went wrong."}
          action={
            <Button variant="glass" onClick={() => void scenesQuery.refetch()}>
              <RefreshCw size={15} /> Try again
            </Button>
          }
        />
      ) : scenes.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={32} />}
          title={isFamily ? "No scenes yet" : "No scenes shared with you yet"}
          detail={
            isFamily
              ? "A scene bundles a few controls — spa on, heat up, lights set — into one big tappable card."
              : "Ask the owner to mark a scene as guest-visible and it'll show up here."
          }
          action={
            isFamily ? (
              <span className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="primary" onClick={openCreate}>
                  <Plus size={16} /> Build a scene
                </Button>
                {seed && (
                  <Button variant="glass" disabled={seeding} onClick={() => void createSeed()}>
                    <Bath size={16} className="text-accent" /> Start with “Spa Night”
                  </Button>
                )}
              </span>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {scenes.map((scene, index) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                index={index}
                disabled={!backendConnected}
                canManage={isFamily}
                onEdit={openEdit}
                onRunLater={setRunLaterScene}
              />
            ))}
          </div>

          {isFamily && <PendingSceneRuns scenes={scenes} />}
        </div>
      )}

      {isFamily && (
        <>
          <SceneDialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) setEditing(null);
            }}
            scene={editing}
            scenes={scenes}
          />
          <RunLaterDialog
            key={runLaterScene?.id ?? "closed"}
            scene={runLaterScene}
            onClose={() => setRunLaterScene(null)}
          />
        </>
      )}
    </div>
  );
}
