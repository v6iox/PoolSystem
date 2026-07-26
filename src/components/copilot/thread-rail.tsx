"use client";

import { MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/panel";
import { cn, formatRelative } from "@/lib/utils";
import type { CopilotThread } from "./types";

/** Desktop sidebar listing the user's chat threads. */
export function ThreadRail({
  threads,
  activeId,
  loading,
  onSelect,
}: {
  threads: CopilotThread[];
  activeId: number | null;
  loading: boolean;
  onSelect: (id: number | null) => void;
}): React.JSX.Element {
  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-1.5 lg:flex">
      <Button variant="glass" size="sm" className="w-full justify-start" onClick={() => onSelect(null)}>
        <Plus size={15} className="text-accent" /> New chat
      </Button>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pt-1">
        {loading ? (
          <>
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </>
        ) : threads.length === 0 ? (
          <p className="px-2 pt-2 text-xs text-ink-faint">No conversations yet.</p>
        ) : (
          threads.map((thread) => (
            <button
              key={thread.id}
              onClick={() => onSelect(thread.id)}
              className={cn(
                "flex w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition-colors",
                activeId === thread.id ? "bg-accent-soft text-ink" : "text-ink-dim hover:bg-accent-soft/50 hover:text-ink"
              )}
            >
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <MessageCircle size={14} className={activeId === thread.id ? "shrink-0 text-accent" : "shrink-0 text-ink-faint"} />
                <span className="truncate">{thread.title}</span>
              </span>
              <span className="pl-6 text-[11px] text-ink-faint">{formatRelative(thread.updatedAt)}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

/** Mobile thread picker — a compact dropdown above the message stream. */
export function ThreadPicker({
  threads,
  activeId,
  onSelect,
}: {
  threads: CopilotThread[];
  activeId: number | null;
  onSelect: (id: number | null) => void;
}): React.JSX.Element | null {
  if (threads.length === 0) return null;
  return (
    <div className="lg:hidden">
      <Select
        aria-label="Conversation"
        value={activeId === null ? "new" : String(activeId)}
        onValueChange={(value) => onSelect(value === "new" ? null : Number(value))}
        options={[
          { value: "new", label: "＋ New chat" },
          ...threads.map((t) => ({ value: String(t.id), label: t.title })),
        ]}
      />
    </div>
  );
}
