"use client";

import { useState } from "react";
import { Power } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { toast } from "@/stores/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { patchAllOff } from "./optimistic";

/** Family+ panic button: confirms, then sends the single `allOff` action. */
export function AllOffButton(): React.JSX.Element {
  const { sendAction, backendConnected } = usePool();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    const ok = await sendAction({ type: "allOff" }, patchAllOff);
    setBusy(false);
    setOpen(false);
    if (ok) toast("success", "Everything off", "All circuits and features were switched off.");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="danger" size="sm" disabled={!backendConnected}>
          <Power size={14} /> All off
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Turn everything off?"
        description="Every circuit and water feature will be switched off, including the pool and spa."
      >
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => void confirm()}>
            <Power size={14} /> {busy ? "Turning off…" : "Turn everything off"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
