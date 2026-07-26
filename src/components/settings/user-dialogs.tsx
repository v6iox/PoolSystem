"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Trash2, UserPlus } from "lucide-react";
import { apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import type { Role } from "@/types/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/** Account row shape returned by GET /api/users. */
export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  createdAt: number;
}

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: "guest", label: "Guest — sees only shared circuits & scenes" },
  { value: "family", label: "Family — full pool control" },
  { value: "owner", label: "Owner — full control + administration" },
];

async function invalidateUsers(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["users"] });
}

export function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("family");
  const [busy, setBusy] = useState(false);

  const reset = (): void => {
    setName("");
    setEmail("");
    setPassword("");
    setRole("family");
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await apiSend<{ ok: boolean }>("POST", "/api/users", { name, email, password, role });
      await invalidateUsers(queryClient);
      toast("success", "Account created", `${name} can now sign in as ${role}.`);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast("error", "Couldn't create account", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New account"
        description="Local account on this Moonpool — no emails are sent."
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam Rivera" required autoFocus />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sam@home.local"
              required
            />
          </Field>
          <Field label="Password" hint="At least 8 characters — share it with them directly.">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </Field>
          <Field label="Role">
            <Select
              aria-label="Role"
              value={role}
              onValueChange={(v) => setRole(v as Role)}
              options={ROLE_OPTIONS}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
              Create account
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditUserDialog({
  user,
  isSelf,
  onOpenChange,
}: {
  /** User being edited; dialog is closed when null. */
  user: UserRow | null;
  isSelf: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Role>("family");
  const [disabled, setDisabled] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  // Sync form state when a different user is opened (render-time state sync).
  if (user && loadedFor !== user.id) {
    setLoadedFor(user.id);
    setRole(user.role);
    setDisabled(user.disabled);
    setPassword("");
  }

  const submit = async (): Promise<void> => {
    if (!user) return;
    const patch: { role?: Role; disabled?: boolean; password?: string } = {};
    if (role !== user.role) patch.role = role;
    if (disabled !== user.disabled) patch.disabled = disabled;
    if (password) patch.password = password;
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    try {
      await apiSend<{ ok: boolean }>("PUT", `/api/users/${user.id}`, patch);
      await invalidateUsers(queryClient);
      toast("success", "Account updated", patch.password ? "Password has been reset." : undefined);
      onOpenChange(false);
    } catch (err) {
      // Server guards (e.g. last-owner protection) land here with a clear message.
      toast("error", "Couldn't update account", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      {user && (
        <DialogContent title={user.name} description={user.email}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field label="Role">
              <Select
                aria-label="Role"
                value={role}
                onValueChange={(v) => setRole(v as Role)}
                options={ROLE_OPTIONS}
              />
            </Field>
            <div className="flex items-center justify-between rounded-xl border border-line bg-abyss/30 px-3.5 py-3">
              <div>
                <p className="text-sm text-ink">Disabled</p>
                <p className="text-xs text-ink-faint">
                  {isSelf ? "You can't disable your own account." : "Blocks sign-in and ends their sessions."}
                </p>
              </div>
              <Switch checked={disabled} onCheckedChange={setDisabled} disabled={isSelf} aria-label="Disabled" />
            </div>
            <Field label="Reset password" hint="Leave blank to keep the current password.">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                placeholder="New password (8+ characters)"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                Save changes
              </Button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

export function DeleteUserDialog({
  user,
  onOpenChange,
}: {
  /** User pending deletion; dialog is closed when null. */
  user: UserRow | null;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const confirm = async (): Promise<void> => {
    if (!user) return;
    setBusy(true);
    try {
      await apiSend<{ ok: boolean }>("DELETE", `/api/users/${user.id}`);
      await invalidateUsers(queryClient);
      toast("success", "Account deleted", `${user.name} can no longer sign in.`);
      onOpenChange(false);
    } catch (err) {
      toast("error", "Couldn't delete account", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      {user && (
        <DialogContent
          title={`Delete ${user.name}?`}
          description="Their account and sign-in are removed. Audit history keeps their past actions."
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              Delete account
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
