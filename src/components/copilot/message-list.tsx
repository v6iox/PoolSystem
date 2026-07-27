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

/**
 * Thinking state: the logo sits in rippling water — expanding rings + a
 * gentle bob — while droplet dots surface one by one. Reduced motion gets
 * the plain three-dot fade.
 */
export function ThinkingRipple({ label = "reading the water…" }: { label?: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2.5">
      <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center">
        {[0, 1].map((i) => (
          <motion.span
            key={i}
            className="absolute inset-0 rounded-full border border-accent/50 motion-reduce:hidden"
            animate={{ scale: [1, 1.9], opacity: [0.55, 0] }}
            transition={{ repeat: Infinity, duration: 1.8, delay: i * 0.9, ease: "easeOut" }}
          />
        ))}
        <motion.span
          className="glass relative flex h-8 w-8 items-center justify-center rounded-full"
          animate={{ y: [0, -2.5, 0] }}
          transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}
        >
          <Logo size={18} />
        </motion.span>
      </span>
      <Panel className="flex items-center gap-2.5 px-4 py-3.5">
        <span className="flex items-end gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-accent"
              animate={{ y: [0, -5, 0], opacity: [0.3, 1, 0.3] }}
              transition={{ repeat: Infinity, duration: 1.15, delay: i * 0.16, ease: "easeInOut" }}
            />
          ))}
        </span>
        <motion.span
          className="text-xs text-ink-dim"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        >
          {label}
        </motion.span>
      </Panel>
    </div>
  );
}

const TypingIndicator = ThinkingRipple;

/** Word-staggered reveal for freshly arrived assistant replies — feels streamed. */
export function RevealText({ text, animate }: { text: string; animate: boolean }): React.JSX.Element {
  if (!animate) return <>{text}</>;
  const words = text.split(/(\s+)/);
  if (words.length > 160) return <>{text}</>;
  let wordIndex = 0;
  return (
    <>
      {words.map((word, i) => {
        if (/^\s+$/.test(word)) return <span key={i}>{word}</span>;
        const delay = 0.045 * wordIndex++;
        return (
          <motion.span
            key={i}
            className="inline-block"
            initial={{ opacity: 0, y: 4, filter: "blur(3px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay, duration: 0.28, ease: "easeOut" }}
          >
            {word}
          </motion.span>
        );
      })}
    </>
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
                    <p className="text-sm whitespace-pre-wrap text-ink">
                      <RevealText text={message.content} animate={Date.now() - message.createdAt < 8000} />
                    </p>
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
