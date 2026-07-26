"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, SendHorizonal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Input bar pinned under the message stream (above the mobile bottom nav). */
export function Composer({
  onSend,
  busy,
  autoFocusKey,
}: {
  onSend: (text: string) => void;
  busy: boolean;
  /** Changes refocus the input (e.g. after switching threads). */
  autoFocusKey: number | null;
}): React.JSX.Element {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [autoFocusKey]);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const text = value.trim();
    if (!text || busy) return;
    setValue("");
    onSend(text);
  };

  return (
    <form onSubmit={submit} className="flex shrink-0 items-center gap-2 pt-2">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Message the pool copilot…"
        aria-label="Message the pool copilot"
        maxLength={2000}
        autoComplete="off"
      />
      <Button type="submit" variant="primary" size="icon" disabled={busy || value.trim().length === 0} aria-label="Send">
        {busy ? <Loader2 size={18} className="animate-spin" /> : <SendHorizonal size={18} />}
      </Button>
    </form>
  );
}
