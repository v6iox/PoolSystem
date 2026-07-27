"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CalendarClock, Clock, Eye, Plus, Timer } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { roleAtLeast } from "@/types/auth";
import type { CircuitState, ScheduleState } from "@/types/pool";
import type { SceneDef } from "@/types/actions";
import { apiGet } from "@/lib/client/api";
import { EmptyState, PageHeader, Panel, Skeleton } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { WeekView } from "@/components/schedules/week-view";
import { ScheduleList } from "@/components/schedules/schedule-list";
import { ScheduleDialog } from "@/components/schedules/schedule-dialog";
import { ViewToggle, type ScheduleView } from "@/components/schedules/view-toggle";
import { AutomationsStrip } from "@/components/schedules/automations-strip";
import { PendingJobs } from "@/components/automations/pending-jobs";
import type { AutomationsResponse } from "@/components/automations/describe";
import { circuitTint, conflictIds, eggTimerDuration, formatDuration } from "@/components/schedules/helpers";
import { cn } from "@/lib/utils";

/** Egg timers have no fixed start, so the week grid can't place them — show a strip instead. */
function EggTimerStrip({
  eggTimers,
  canEdit,
  onEdit,
}: {
  eggTimers: ScheduleState[];
  canEdit: boolean;
  onEdit: (schedule: ScheduleState) => void;
}): React.JSX.Element {
  return (
    <Panel className="mt-4 p-4">
      <p className="mb-2.5 text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
        Egg timers — run for a duration after turn-on
      </p>
      <div className="flex flex-wrap gap-2">
        {eggTimers.map((s) => {
          const tint = circuitTint(s.circuitId);
          return (
            <button
              key={s.id}
              type="button"
              onClick={canEdit ? () => onEdit(s) : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-transform",
                canEdit ? "cursor-pointer active:scale-95" : "cursor-default",
                s.disabled && "opacity-50"
              )}
              style={{ background: tint.bg, borderColor: tint.border, color: tint.text }}
            >
              <Timer size={13} />
              {s.circuitName}
              <span className="text-ink-dim">{formatDuration(eggTimerDuration(s))}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

export default function SchedulesPage(): React.JSX.Element {
  const { snapshot, hasLoaded, backendConnected, user } = usePool();
  const isFamily = roleAtLeast(user.role, "family");
  const canEdit = isFamily && backendConnected;

  const [view, setView] = useState<ScheduleView>("week");
  const [fullDay, setFullDay] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleState | null>(null);

  // One-shots and automations (copilot- or UI-created) belong here too —
  // this page is "everything that will happen on its own", not just the panel.
  const autoQuery = useQuery({
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
  const pendingJobs = useMemo(() => autoQuery.data?.pendingJobs ?? [], [autoQuery.data]);
  const automations = useMemo(() => autoQuery.data?.automations ?? [], [autoQuery.data]);
  const scenes = useMemo(() => scenesData?.scenes ?? [], [scenesData]);

  const schedules = snapshot.schedules;
  const conflicts = useMemo(() => conflictIds(schedules), [schedules]);
  const activeCount = schedules.filter((s) => s.isActive && !s.disabled).length;
  const eggTimers = schedules.filter((s) => s.isEggTimer);
  const timed = schedules.filter((s) => !s.isEggTimer);

  const circuitById = useMemo(() => {
    const map = new Map<number, CircuitState>();
    for (const c of [...snapshot.circuits, ...snapshot.features]) {
      if (!map.has(c.id)) map.set(c.id, c);
    }
    return map;
  }, [snapshot.circuits, snapshot.features]);

  const openCreate = (): void => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (s: ScheduleState): void => {
    setEditing(s);
    setDialogOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Schedules"
        subtitle={
          hasLoaded
            ? [
                schedules.length === 0
                  ? "Nothing on the panel"
                  : `${schedules.length} panel ${schedules.length === 1 ? "schedule" : "schedules"}${
                      activeCount > 0 ? ` · ${activeCount} running now` : ""
                    }`,
                pendingJobs.length > 0 ? `${pendingJobs.length} queued` : "",
                automations.length > 0
                  ? `${automations.length} ${automations.length === 1 ? "automation" : "automations"}`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        action={
          hasLoaded && isFamily ? (
            <Button variant="primary" size="sm" disabled={!backendConnected} onClick={openCreate}>
              <Plus size={15} /> New schedule
            </Button>
          ) : undefined
        }
      />

      {hasLoaded && !isFamily && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-abyss/40 px-3 py-2 text-sm text-ink-dim">
          <Eye size={15} className="shrink-0 text-accent" />
          Signed in as a guest — schedules are read-only.
        </p>
      )}

      {!hasLoaded ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-11 w-44" />
            <Skeleton className="h-8 w-24" />
          </div>
          <Skeleton className="h-[30rem]" />
        </div>
      ) : schedules.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={32} />}
          title={isFamily ? "No schedules yet" : "No schedules visible"}
          detail={
            !isFamily
              ? "Schedules for guest-visible circuits will show up here."
              : backendConnected
                ? "Put the pump, lights, or cleaner on a timer and the pool runs itself."
                : "The pool controller is unreachable — schedules will appear when it reconnects."
          }
          action={
            canEdit ? (
              <Button variant="primary" onClick={openCreate}>
                <Plus size={16} /> Add your first schedule
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ViewToggle value={view} onChange={setView} />
            <div className="flex items-center gap-2">
              {conflicts.size > 0 && (
                <span className="flex items-center gap-1.5 rounded-full bg-warn/10 px-2.5 py-1 text-[11px] font-medium text-warn">
                  <AlertTriangle size={12} />
                  {conflicts.size} overlapping
                </span>
              )}
              {view === "week" && (
                <Button variant="ghost" size="sm" onClick={() => setFullDay((v) => !v)} aria-pressed={fullDay}>
                  <Clock size={13} />
                  {fullDay ? "Showing 24 h" : "6 AM – 12 AM"}
                </Button>
              )}
            </div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
            >
              {view === "week" ? (
                <>
                  <WeekView
                    schedules={timed}
                    conflicts={conflicts}
                    fullDay={fullDay}
                    canEdit={canEdit}
                    onEdit={openEdit}
                  />
                  {eggTimers.length > 0 && (
                    <EggTimerStrip eggTimers={eggTimers} canEdit={canEdit} onEdit={openEdit} />
                  )}
                </>
              ) : (
                <ScheduleList
                  schedules={schedules}
                  conflicts={conflicts}
                  circuitFor={(id) => circuitById.get(id)}
                  canEdit={canEdit}
                  onEdit={openEdit}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {hasLoaded && isFamily && (pendingJobs.length > 0 || automations.length > 0) && (
        <div className="mt-6 space-y-6">
          {pendingJobs.length > 0 && <PendingJobs jobs={pendingJobs} scenes={scenes} disabled={!backendConnected} />}
          {automations.length > 0 && <AutomationsStrip automations={automations} disabled={!backendConnected} />}
        </div>
      )}

      {isFamily && (
        <ScheduleDialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setEditing(null);
          }}
          schedule={editing}
        />
      )}
    </div>
  );
}
