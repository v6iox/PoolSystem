"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { Logo } from "@/components/logo";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import { PlanCard } from "./plan-card";
import { SUGGESTIONS, type CopilotMessage } from "./types";

function AssistantAvatar(): React.JSX.Element {
  return (
    <span className="glass mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
      <Logo size={18} />
    </span>
  );
}

function TypingIndicator(): React.JSX.Element {
  return (
    <div className="flex items-start gap-2.5">
      <AssistantAvatar />
      <Panel className="flex items-center gap-1.5 px-4 py-3.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-accent"
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{ repeat: Infinity, duration: 1.1, delay: i * 0.18, ease: "easeInOut" }}
          />
        ))}
      </Panel>
    </div>
  );
}

function EmptyChat({ onSuggestion, disabled }: { onSuggestion: (text: string) => void; disabled: boolean }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-3">
        <span className="glass flex h-14 w-14 items-center justify-center rounded-full">
          <Logo size={32} />
        </span>
        <div>
          <p className="font-display text-lg font-semibold text-ink">Tell the pool what to do</p>
          <p className="mt-1 max-w-sm text-sm text-ink-dim">
            Plain English in, structured pool commands out. I'll always show you the plan before touching anything.
          </p>
        </div>
      </motion.div>
      <div className="flex max-w-md flex-wrap items-center justify-center gap-2">
        {SUGGESTIONS.map((s, i) => (
          <motion.button
            key={s}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05, type: "spring", stiffness: 300, damping: 26 }}
            onClick={() => onSuggestion(s)}
            disabled={disabled}
            className="glass flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm text-ink transition-colors hover:border-line-bright hover:text-accent disabled:opacity-40"
          >
            <Sparkles size={13} className="text-accent" />
            {s}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  pendingText,
  typing,
  controlsDisabled,
  busyMessageId,
  onConfirm,
  onCancel,
  onSuggestion,
}: {
  messages: CopilotMessage[];
  /** Optimistic user bubble while the reply is in flight. */
  pendingText: string | null;
  typing: boolean;
  controlsDisabled: boolean;
  busyMessageId: number | null;
  onConfirm: (messageId: number) => void;
  onCancel: (messageId: number) => void;
  onSuggestion: (text: string) => void;
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, typing, pendingText, busyMessageId]);

  const empty = messages.length === 0 && pendingText === null && !typing;

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-3">
      {empty ? (
        <EmptyChat onSuggestion={onSuggestion} disabled={typing} />
      ) : (
        <div className="space-y-4">
          {messages.map((message) =>
            message.role === "user" ? (
              <motion.div key={message.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md border border-accent/20 bg-accent-soft px-3.5 py-2.5 text-sm whitespace-pre-wrap text-ink">
                  {message.content}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-2.5"
              >
                <AssistantAvatar />
                <div className="min-w-0 max-w-[85%]">
                  <Panel className={cn("px-3.5 py-2.5", message.plan && "min-w-[min(20rem,100%)]")}>
                    <p className="text-sm whitespace-pre-wrap text-ink">{message.content}</p>
                    <PlanCard
                      message={message}
                      disabled={controlsDisabled}
                      busy={busyMessageId === message.id}
                      onConfirm={onConfirm}
                      onCancel={onCancel}
                    />
                  </Panel>
                </div>
              </motion.div>
            )
          )}
          {pendingText !== null && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md border border-accent/20 bg-accent-soft px-3.5 py-2.5 text-sm whitespace-pre-wrap text-ink opacity-80">
                {pendingText}
              </div>
            </motion.div>
          )}
          {typing && <TypingIndicator />}
        </div>
      )}
    </div>
  );
}
