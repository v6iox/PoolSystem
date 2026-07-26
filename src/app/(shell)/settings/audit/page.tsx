"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Activity, ArrowRight, ChevronDown, Loader2, TriangleAlert } from "lucide-react";
import type { AuditRow } from "@/server/audit";
import { usePool } from "@/lib/client/pool-state";
import { apiGet } from "@/lib/client/api";
import { EmptyState, PageHeader, Panel, Skeleton } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { OwnerOnlyState, StatusPill, type PillTone } from "@/components/settings/section";
import { cn, formatClock } from "@/lib/utils";

/** Reverse-chronological audit trail with source filtering + cursor paging. */

const PAGE_SIZE = 50;

const SOURCES = ["all", "ui", "copilot", "automation", "scene", "schedule", "system"] as const;
type SourceFilter = (typeof SOURCES)[number];

const SOURCE_TONE: Record<string, PillTone> = {
  ui: "accent",
  copilot: "warn",
  automation: "ok",
  scene: "accent",
  schedule: "neutral",
  system: "neutral",
};

function dayLabel(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function AuditEntryRow({ entry, index }: { entry: AuditRow; index: number }): React.JSX.Element {
  const failed = entry.ok === 0;
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.03, type: "spring", stiffness: 350, damping: 32 }}
      className={cn("flex gap-3 px-4 py-3", failed && "bg-danger/8")}
    >
      <div className="w-16 shrink-0 pt-0.5 text-right">
        <p className="text-xs font-medium text-ink-dim">{formatClock(entry.at)}</p>
        <p className="text-[10px] text-ink-faint">{dayLabel(entry.at)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium text-ink">{entry.user_name}</span>
          <span className="text-ink-dim">{entry.action}</span>
          {entry.target && <span className="truncate text-ink-dim">· {entry.target}</span>}
          <StatusPill tone={SOURCE_TONE[entry.source] ?? "neutral"} className="normal-case">
            {entry.source}
          </StatusPill>
          {failed && (
            <StatusPill tone="bad" className="normal-case">
              <TriangleAlert size={11} /> failed
            </StatusPill>
          )}
        </p>
        {(entry.old_value || entry.new_value) && (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-ink-faint">
            {entry.old_value && <span className="max-w-56 truncate">{entry.old_value}</span>}
            {entry.old_value && entry.new_value && <ArrowRight size={11} className="shrink-0" />}
            {entry.new_value && <span className="max-w-56 truncate text-ink-dim">{entry.new_value}</span>}
          </p>
        )}
        {failed && entry.detail && <p className="mt-1 text-xs text-danger">{entry.detail}</p>}
      </div>
    </motion.li>
  );
}

export default function AuditSettingsPage(): React.JSX.Element {
  const { user } = usePool();
  const isOwner = user.role === "owner";
  const [source, setSource] = useState<SourceFilter>("all");

  const auditQuery = useInfiniteQuery({
    queryKey: ["audit", source],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (source !== "all") params.set("source", source);
      if (pageParam > 0) params.set("before", String(pageParam));
      return apiGet<{ entries: AuditRow[] }>(`/api/audit?${params.toString()}`);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.entries.length >= PAGE_SIZE ? lastPage.entries[lastPage.entries.length - 1]?.at : undefined,
    enabled: isOwner,
  });

  if (!isOwner) {
    return (
      <div>
        <PageHeader title="Audit log" subtitle="Every change, tracked" />
        <OwnerOnlyState />
      </div>
    );
  }

  const entries = auditQuery.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Who changed what — across the app, copilot, automations and schedules"
      />

      <div className="mx-auto max-w-3xl space-y-4">
        <div className="-mx-4 overflow-x-auto px-4">
          <div role="radiogroup" aria-label="Filter by source" className="flex w-max gap-1.5">
            {SOURCES.map((s) => {
              const selected = source === s;
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setSource(s)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-xs font-medium capitalize transition-colors",
                    selected
                      ? "border-accent/40 bg-accent-soft text-accent"
                      : "border-line text-ink-dim hover:border-line-bright hover:text-ink"
                  )}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        {auditQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : auditQuery.isError ? (
          <EmptyState
            icon={<Activity size={32} />}
            title="Couldn't load the audit log"
            detail="Something went wrong fetching entries. Refresh to try again."
          />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<Activity size={32} />}
            title="Nothing here yet"
            detail={
              source === "all"
                ? "Actions land here as soon as anyone changes something — toggles, setpoints, schedules, settings."
                : `No entries from the ${source} source yet. Try another filter.`
            }
          />
        ) : (
          <>
            <Panel className="overflow-hidden">
              <ul className="divide-y divide-line">
                {entries.map((entry, i) => (
                  <AuditEntryRow key={entry.id} entry={entry} index={i} />
                ))}
              </ul>
            </Panel>

            {auditQuery.hasNextPage ? (
              <Button
                variant="glass"
                className="w-full"
                disabled={auditQuery.isFetchingNextPage}
                onClick={() => void auditQuery.fetchNextPage()}
              >
                {auditQuery.isFetchingNextPage ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <ChevronDown size={15} />
                )}
                Load older entries
              </Button>
            ) : (
              <p className="pb-2 text-center text-[11px] text-ink-faint">End of the log.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
