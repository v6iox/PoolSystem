"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePool } from "@/lib/client/pool-state";
import { apiGet, apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { PageHeader, Panel, Skeleton } from "@/components/ui/panel";
import { MessageList } from "@/components/copilot/message-list";
import { ThreadRail, ThreadPicker } from "@/components/copilot/thread-rail";
import { Composer } from "@/components/copilot/composer";
import type { CopilotMessage, CopilotThread } from "@/components/copilot/types";

/**
 * Pool Copilot — natural-language chat that drives the pool through
 * structured, server-validated tool calls. State-changing plans render as
 * confirmation cards; replies are template-generated from real results.
 */
export default function CopilotPage(): React.JSX.Element {
  const { hasLoaded, backendConnected, user } = usePool();
  const queryClient = useQueryClient();

  const [threadId, setThreadId] = useState<number | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [busyMessageId, setBusyMessageId] = useState<number | null>(null);

  const threadsQuery = useQuery({
    queryKey: ["copilot-threads"],
    queryFn: () => apiGet<{ threads: CopilotThread[] }>("/api/copilot/threads"),
  });
  const threads = threadsQuery.data?.threads ?? [];

  const messagesQuery = useQuery({
    queryKey: ["copilot-messages", threadId],
    queryFn: () => apiGet<{ messages: CopilotMessage[] }>(`/api/copilot/threads/${threadId}/messages`),
    enabled: threadId !== null,
  });
  const messages = threadId === null ? [] : (messagesQuery.data?.messages ?? []);

  const appendMessages = useCallback(
    (tid: number, incoming: CopilotMessage[]): void => {
      queryClient.setQueryData<{ messages: CopilotMessage[] }>(["copilot-messages", tid], (old) => ({
        messages: [...(old?.messages ?? []), ...incoming],
      }));
    },
    [queryClient]
  );

  const replaceMessage = useCallback(
    (tid: number, updated: CopilotMessage): void => {
      queryClient.setQueryData<{ messages: CopilotMessage[] }>(["copilot-messages", tid], (old) => ({
        messages: (old?.messages ?? []).map((m) => (m.id === updated.id ? updated : m)),
      }));
    },
    [queryClient]
  );

  const send = useCallback(
    async (text: string): Promise<void> => {
      if (sending) return;
      setSending(true);
      setPendingText(text);
      try {
        let tid = threadId;
        if (tid === null) {
          const created = await apiSend<{ thread: CopilotThread }>("POST", "/api/copilot/threads", {});
          tid = created.thread.id;
          queryClient.setQueryData<{ messages: CopilotMessage[] }>(["copilot-messages", tid], { messages: [] });
          setThreadId(tid);
        }
        const res = await apiSend<{ messages: CopilotMessage[] }>("POST", `/api/copilot/threads/${tid}/messages`, { text });
        appendMessages(tid, res.messages);
        void queryClient.invalidateQueries({ queryKey: ["copilot-threads"] });
      } catch (err) {
        toast("error", "Copilot couldn't reply", err instanceof Error ? err.message : "Unknown error");
      } finally {
        setPendingText(null);
        setSending(false);
      }
    },
    [appendMessages, queryClient, sending, threadId]
  );

  const confirm = useCallback(
    async (messageId: number): Promise<void> => {
      if (threadId === null || busyMessageId !== null) return;
      setBusyMessageId(messageId);
      try {
        const res = await apiSend<{ message: CopilotMessage; result: CopilotMessage | null }>(
          "POST",
          `/api/copilot/messages/${messageId}/confirm`
        );
        replaceMessage(threadId, res.message);
        if (res.result) appendMessages(threadId, [res.result]);
        // Plans can create one-shots/automations/scenes — refresh the lists
        // so the Schedules page shows them right away.
        void queryClient.invalidateQueries({ queryKey: ["automations"] });
        void queryClient.invalidateQueries({ queryKey: ["scenes"] });
      } catch (err) {
        toast("error", "Couldn't run that plan", err instanceof Error ? err.message : "Unknown error");
      } finally {
        setBusyMessageId(null);
      }
    },
    [appendMessages, busyMessageId, queryClient, replaceMessage, threadId]
  );

  const cancel = useCallback(
    async (messageId: number): Promise<void> => {
      if (threadId === null || busyMessageId !== null) return;
      setBusyMessageId(messageId);
      try {
        const res = await apiSend<{ message: CopilotMessage }>("POST", `/api/copilot/messages/${messageId}/cancel`);
        replaceMessage(threadId, res.message);
      } catch (err) {
        toast("error", "Couldn't cancel that", err instanceof Error ? err.message : "Unknown error");
      } finally {
        setBusyMessageId(null);
      }
    },
    [busyMessageId, replaceMessage, threadId]
  );

  const selectThread = useCallback((id: number | null): void => {
    setThreadId(id);
  }, []);

  const loading = !hasLoaded || threadsQuery.isPending;
  const messagesLoading = threadId !== null && messagesQuery.isPending;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Copilot"
        subtitle={
          user.role === "guest"
            ? "Ask about the pool, or control what's shared with you"
            : "Tell the pool what to do — it always shows the plan first"
        }
      />

      {loading ? (
        <div className="flex gap-5">
          <Skeleton className="hidden h-[50vh] w-56 lg:block" />
          <Skeleton className="h-[50vh] flex-1" />
        </div>
      ) : (
        <div className="flex h-[calc(100dvh-230px)] min-h-[360px] gap-5 md:h-[calc(100dvh-170px)]">
          <ThreadRail threads={threads} activeId={threadId} loading={false} onSelect={selectThread} />
          <Panel className="flex min-h-0 min-w-0 flex-1 flex-col p-3 sm:p-4">
            <ThreadPicker threads={threads} activeId={threadId} onSelect={selectThread} />
            {messagesLoading ? (
              <div className="flex-1 space-y-3 py-3">
                <Skeleton className="h-14 w-3/5" />
                <Skeleton className="ml-auto h-10 w-2/5" />
                <Skeleton className="h-20 w-4/5" />
              </div>
            ) : messagesQuery.isError ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm text-ink-dim">
                  {messagesQuery.error instanceof Error ? messagesQuery.error.message : "Couldn't load this conversation."}
                </p>
                <button
                  onClick={() => void messagesQuery.refetch()}
                  className="glass rounded-xl px-4 py-2 text-sm text-ink transition-colors hover:border-line-bright"
                >
                  Try again
                </button>
              </div>
            ) : (
              <MessageList
                messages={messages}
                pendingText={pendingText}
                typing={sending}
                controlsDisabled={!backendConnected}
                busyMessageId={busyMessageId}
                onConfirm={(id) => void confirm(id)}
                onCancel={(id) => void cancel(id)}
                onSuggestion={(text) => void send(text)}
              />
            )}
            <Composer onSend={(text) => void send(text)} busy={sending} autoFocusKey={threadId} />
          </Panel>
        </div>
      )}
    </div>
  );
}
