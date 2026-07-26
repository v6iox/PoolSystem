"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Ban, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { apiGet } from "@/lib/client/api";
import { EmptyState, PageHeader, Panel, Skeleton } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { OwnerOnlyState, StatusPill, type PillTone } from "@/components/settings/section";
import {
  CreateUserDialog,
  DeleteUserDialog,
  EditUserDialog,
  type UserRow,
} from "@/components/settings/user-dialogs";
import { cn } from "@/lib/utils";
import type { Role } from "@/types/auth";

const ROLE_TONE: Record<Role, PillTone> = { owner: "accent", family: "ok", guest: "neutral" };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default function UsersSettingsPage(): React.JSX.Element {
  const { user } = usePool();
  const isOwner = user.role === "owner";
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => apiGet<{ users: UserRow[] }>("/api/users"),
    enabled: isOwner,
  });

  if (!isOwner) {
    return (
      <div>
        <PageHeader title="Users" subtitle="Household accounts" />
        <OwnerOnlyState />
      </div>
    );
  }

  const users = usersQuery.data?.users ?? [];

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Local accounts on this Moonpool — owners, family and guests"
        action={
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <UserPlus size={15} /> New account
          </Button>
        }
      />

      <div className="mx-auto max-w-2xl">
        {usersQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : usersQuery.isError ? (
          <EmptyState
            icon={<Users size={32} />}
            title="Couldn't load accounts"
            detail="Something went wrong fetching the user list. Refresh to try again."
          />
        ) : users.length === 0 ? (
          <EmptyState
            icon={<Users size={32} />}
            title="No accounts yet"
            detail="Create family and guest accounts so everyone gets the right level of control."
            action={
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                <UserPlus size={15} /> New account
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {users.map((row, i) => {
              const isSelf = row.id === user.id;
              return (
                <motion.div
                  key={row.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, type: "spring", stiffness: 300, damping: 30 }}
                >
                  <Panel className={cn("flex items-center gap-3.5 p-4", row.disabled && "opacity-70")}>
                    <span
                      className={cn(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold",
                        row.disabled ? "bg-abyss/50 text-ink-faint" : "bg-accent-soft text-accent"
                      )}
                    >
                      {initials(row.name) || "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">{row.name}</span>
                        {isSelf && (
                          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent uppercase">
                            You
                          </span>
                        )}
                        <StatusPill tone={ROLE_TONE[row.role]}>{row.role}</StatusPill>
                        {row.disabled && (
                          <StatusPill tone="bad">
                            <Ban size={11} /> disabled
                          </StatusPill>
                        )}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-dim">{row.email}</p>
                      <p className="mt-0.5 text-[11px] text-ink-faint">
                        Added{" "}
                        {new Date(row.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label={`Edit ${row.name}`}
                        onClick={() => setEditing(row)}
                      >
                        <Pencil size={15} />
                      </Button>
                      {!isSelf && (
                        <Button
                          variant="ghost"
                          size="iconSm"
                          aria-label={`Delete ${row.name}`}
                          className="hover:bg-danger/15 hover:text-danger"
                          onClick={() => setDeleting(row)}
                        >
                          <Trash2 size={15} />
                        </Button>
                      )}
                    </div>
                  </Panel>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EditUserDialog
        user={editing}
        isSelf={editing?.id === user.id}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <DeleteUserDialog
        user={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
    </div>
  );
}
