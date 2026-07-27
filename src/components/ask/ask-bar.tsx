"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ChevronRight, CloudRain, MessageCircle, Sparkles, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { apiSend } from "@/lib/client/api";
import { usePool } from "@/lib/client/pool-state";
import { Button } from "@/components/ui/button";
import { ThinkingRipple, RevealText } from "@/components/copilot/message-list";
import type { CopilotMessage } from "@/components/copilot/types";
import { cn } from "@/lib/utils";

/**
 * The AI ask bar — a search-bar-shaped front door to the copilot, UniFi-style:
 * a glowing AI mark in a glass pill, type a question or command, answers and
 * confirm-first plans drop down inline. Press "/" anywhere to focus it.
 */

function AiMark({ active }: { active: boolean }): React.JSX.Element {
  return (
    <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-lg motion-reduce:hidden"
        style={{
          background:
            "conic-gradient(from var(--ask-angle, 0deg), var(--accent), transparent 40%, var(--accent) 70%, transparent 90%)",
          opacity: 0.65,
        }}
        animate={{ rotate: active ? 360 : 0 }}
        transition={active ? { repeat: Infinity, duration: 2.4, ease: "linear" } : { duration: 0.4 }}
      />
      <span className="relative flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-abyss">
        <Sparkles size={13} className="text-accent" />
      </span>
    </span>
  );
}

export function AskBar({ className }: { className?: string }): React.JSX.Element {
  const { backendConnected } = usePool();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  const [reply, setReply] = useState<CopilotMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "/" or Cmd/Ctrl+K focuses the bar from anywhere on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.key === "/" && !typing) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setReply(null);
        setAsked(null);
        setError(null);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = useCallback(async (): Promise<void> => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setAsked(q);
    setReply(null);
    setError(null);
    setText("");
    try {
      const res = await apiSend<{ assistant: CopilotMessage | null }>("POST", "/api/copilot/quick", { text: q });
      setReply(res.assistant);
      if (!res.assistant) setError("No answer came back — try the Copilot tab.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, [text, busy]);

  const act = useCallback(
    async (kind: "confirm" | "cancel"): Promise<void> => {
      if (!reply || planBusy) return;
      setPlanBusy(true);
      try {
        const res = await apiSend<{ message: CopilotMessage; result: CopilotMessage | null }>(
          "POST",
          `/api/copilot/messages/${reply.id}/${kind}`
        );
        // The plan message carries executed/cancelled state + result rows.
        setReply(res.message);
        if (kind === "confirm") {
          // Plans can create one-shots/automations/scenes — refresh the lists
          // so the Schedules page shows them right away.
          void queryClient.invalidateQueries({ queryKey: ["automations"] });
          void queryClient.invalidateQueries({ queryKey: ["scenes"] });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't do that");
      } finally {
        setPlanBusy(false);
      }
    },
    [reply, planBusy, queryClient]
  );

  const open = asked !== null;
  const plan = reply?.plan ?? null;
  const planState = reply?.planState ?? null;
  const showText = reply ? reply.content : "";

  return (
    <div ref={rootRef} className={cn("relative z-30", className)}>
      <motion.div
        animate={{
          boxShadow: focused
            ? "0 0 0 1px color-mix(in oklab, var(--accent) 45%, transparent), 0 8px 40px -8px color-mix(in oklab, var(--accent) 35%, transparent)"
            : "0 0 0 1px var(--line)",
        }}
        transition={{ duration: 0.25 }}
        className="glass-bright flex items-center gap-2.5 rounded-2xl px-3 py-2"
      >
        <AiMark active={busy || focused} />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder='Ask your pool anything — "warm the spa", "salt level?", "lights blue at 8"'
          className="h-9 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          aria-label="Ask the pool copilot"
        />
        {!focused && !text && (
          <kbd className="hidden rounded-md border border-line bg-abyss/50 px-1.5 py-0.5 text-[10px] text-ink-faint sm:block">/</kbd>
        )}
        <Button
          variant={text.trim() ? "primary" : "ghost"}
          size="iconSm"
          className="rounded-xl"
          disabled={!text.trim() || busy}
          onClick={() => void submit()}
          aria-label="Ask"
        >
          <ArrowRight size={15} />
        </Button>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="glass-bright absolute inset-x-0 top-full mt-2 rounded-2xl p-4"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <p className="min-w-0 truncate text-xs text-ink-faint">
                you asked: <span className="text-ink-dim">“{asked}”</span>
              </p>
              <button
                onClick={() => {
                  setAsked(null);
                  setReply(null);
                  setError(null);
                }}
                className="shrink-0 rounded-md p-1 text-ink-faint hover:text-ink"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>

            {busy && <ThinkingRipple />}

            {error && (
              <p className="flex items-start gap-2 text-sm text-danger">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" /> {error}
              </p>
            )}

            {reply && (
              <div>
                <p className="text-sm whitespace-pre-wrap text-ink">
                  <RevealText text={showText} animate />
                </p>

                {plan && (
                  <div
                    className={cn(
                      "mt-3 rounded-xl border p-3",
                      planState === "pending" && "border-accent/30 bg-accent-soft/30",
                      planState === "executed" && "border-ok/25 bg-ok/5",
                      planState === "error" && "border-danger/25 bg-danger/5",
                      planState === "cancelled" && "border-line opacity-55"
                    )}
                  >
                    <ul className="space-y-1.5">
                      {(planState === "executed" || planState === "error" ? (plan.results ?? plan.summary) : plan.summary).map(
                        (row, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-ink">
                            {planState === "pending" ? (
                              <ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" />
                            ) : row.startsWith("Failed") ? (
                              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-danger" />
                            ) : (
                              <Check size={14} className="mt-0.5 shrink-0 text-ok" />
                            )}
                            <span className="min-w-0">{row}</span>
                          </li>
                        )
                      )}
                    </ul>
                    {plan.advisories && plan.advisories.length > 0 && planState === "pending" && (
                      <ul className="mt-2.5 space-y-1.5">
                        {plan.advisories.map((advisory, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/10 px-2.5 py-2 text-xs text-warn"
                          >
                            <CloudRain size={13} className="mt-0.5 shrink-0" /> {advisory}
                          </li>
                        ))}
                      </ul>
                    )}
                    {planState === "pending" && (
                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={!backendConnected || planBusy}
                          onClick={() => void act("confirm")}
                        >
                          <Check size={14} /> Confirm
                        </Button>
                        <Button variant="ghost" size="sm" disabled={planBusy} onClick={() => void act("cancel")}>
                          <X size={14} /> Cancel
                        </Button>
                        {!backendConnected && <span className="text-xs text-ink-faint">controller offline</span>}
                      </div>
                    )}
                    {planState === "executed" && (
                      <p className="mt-2 text-[11px] font-semibold tracking-wider text-ok uppercase">Done</p>
                    )}
                    {planState === "cancelled" && (
                      <p className="mt-2 text-[11px] font-semibold tracking-wider text-ink-faint uppercase">Cancelled</p>
                    )}
                  </div>
                )}

                <Link
                  href="/copilot"
                  className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-faint transition-colors hover:text-accent"
                >
                  <MessageCircle size={12} /> continue in Copilot
                </Link>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
