import type { NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getRuntime } from "@/server/runtime";

export const dynamic = "force-dynamic";

/**
 * Authenticated SSE stream of pool state. The server holds the single
 * connection to njsPC; browsers only ever see this relay, filtered by role.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const role = auth.user.role;
  const runtime = getRuntime();
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lastSent = 0;
  let trailing: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (): void => {
        try {
          const snap = runtime.getSnapshotForRole(role);
          controller.enqueue(encoder.encode(`event: state\ndata: ${JSON.stringify(snap)}\n\n`));
          lastSent = Date.now();
        } catch {
          cleanup();
        }
      };
      // Throttle to at most one push per second, with a trailing send so the
      // final state after a burst always lands.
      const onSnap = (): void => {
        const elapsed = Date.now() - lastSent;
        if (elapsed >= 1000) {
          send();
        } else if (!trailing) {
          trailing = setTimeout(() => {
            trailing = null;
            send();
          }, 1000 - elapsed);
        }
      };
      send();
      unsubscribe = runtime.onSnapshot(onSnap);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 25_000);

      const cleanup = (): void => {
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        if (trailing) clearTimeout(trailing);
        trailing = null;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
      if (trailing) clearTimeout(trailing);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
