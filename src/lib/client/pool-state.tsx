"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PoolStateSnapshot } from "@/types/pool";
import { EMPTY_SNAPSHOT } from "@/types/pool";
import type { ActionResult, PoolAction } from "@/types/actions";
import type { SessionUser } from "@/types/auth";
import { apiSend, ApiError } from "@/lib/client/api";
import { toast } from "@/stores/toast";

/**
 * Live pool state over SSE + optimistic control.
 *
 * Optimistic model: each in-flight action registers a patch applied on top of
 * the latest server snapshot. On failure the patch is dropped immediately
 * (instant rollback) and a toast explains why. On success it lingers briefly
 * so the next real snapshot can catch up without a visual bounce.
 */

type Patch = { id: number; until: number; apply: (snap: PoolStateSnapshot) => PoolStateSnapshot };

export type ConnectionState = "connecting" | "live" | "reconnecting";

interface PoolContextValue {
  snapshot: PoolStateSnapshot;
  /** Browser ↔ app server SSE health. */
  connection: ConnectionState;
  /** App server ↔ njsPC health (false = watchdog banner + disabled controls). */
  backendConnected: boolean;
  hasLoaded: boolean;
  user: SessionUser;
  sendAction: (action: PoolAction, optimistic?: (snap: PoolStateSnapshot) => PoolStateSnapshot) => Promise<boolean>;
  sendActions: (actions: PoolAction[]) => Promise<boolean>;
}

const PoolContext = createContext<PoolContextValue | null>(null);

let patchSeq = 1;

export function PoolStateProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}): React.JSX.Element {
  const [serverSnapshot, setServerSnapshot] = useState<PoolStateSnapshot>(EMPTY_SNAPSHOT);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [patches, setPatches] = useState<Patch[]>([]);
  const sourceRef = useRef<EventSource | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = (): void => {
      if (cancelled) return;
      const source = new EventSource("/api/state/stream");
      sourceRef.current = source;
      source.addEventListener("state", (event) => {
        retryRef.current = 0;
        setConnection("live");
        setHasLoaded(true);
        try {
          const snap = JSON.parse((event as MessageEvent<string>).data) as PoolStateSnapshot;
          setServerSnapshot(snap);
          // Cache last-known state for the PWA offline shell.
          try {
            window.localStorage.setItem("moonpool-last-state", JSON.stringify({ snap, at: Date.now() }));
          } catch {
            // storage full/blocked — offline shell just won't have data
          }
        } catch {
          // malformed frame — ignore, next one will land
        }
      });
      source.onerror = () => {
        source.close();
        if (cancelled) return;
        setConnection("reconnecting");
        const delay = Math.min(15_000, 1000 * 2 ** retryRef.current);
        retryRef.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      sourceRef.current?.close();
    };
  }, []);

  // Drop expired optimistic patches.
  useEffect(() => {
    if (patches.length === 0) return;
    const timer = setInterval(() => {
      const nowMs = Date.now();
      setPatches((prev) => (prev.some((p) => p.until < nowMs) ? prev.filter((p) => p.until >= nowMs) : prev));
    }, 500);
    return () => clearInterval(timer);
  }, [patches.length]);

  const snapshot = useMemo(() => {
    let snap = serverSnapshot;
    for (const patch of patches) snap = patch.apply(snap);
    return snap;
  }, [serverSnapshot, patches]);

  const sendAction = useCallback(
    async (action: PoolAction, optimistic?: (snap: PoolStateSnapshot) => PoolStateSnapshot): Promise<boolean> => {
      const patchId = patchSeq++;
      if (optimistic) {
        setPatches((prev) => [...prev, { id: patchId, until: Date.now() + 15_000, apply: optimistic }]);
      }
      try {
        const res = await apiSend<{ ok: boolean; results: ActionResult[] }>("POST", "/api/control", { action });
        const result = res.results[0];
        if (!result?.ok) {
          throw new ApiError(result?.error ?? "Action failed", 422);
        }
        // Let the patch ride briefly so SSE catches up, then release.
        setPatches((prev) => prev.map((p) => (p.id === patchId ? { ...p, until: Date.now() + 2500 } : p)));
        return true;
      } catch (err) {
        setPatches((prev) => prev.filter((p) => p.id !== patchId));
        toast("error", "Couldn't do that", err instanceof Error ? err.message : "Unknown error");
        return false;
      }
    },
    []
  );

  const sendActions = useCallback(async (actions: PoolAction[]): Promise<boolean> => {
    try {
      const res = await apiSend<{ ok: boolean; results: ActionResult[] }>("POST", "/api/control", { actions });
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast("error", "Some actions failed", failed.map((f) => f.error).join("; "));
        return false;
      }
      return true;
    } catch (err) {
      toast("error", "Couldn't do that", err instanceof Error ? err.message : "Unknown error");
      return false;
    }
  }, []);

  const value = useMemo(
    () => ({
      snapshot,
      connection,
      backendConnected: serverSnapshot.connected,
      hasLoaded,
      user,
      sendAction,
      sendActions,
    }),
    [snapshot, connection, serverSnapshot.connected, hasLoaded, user, sendAction, sendActions]
  );

  return <PoolContext.Provider value={value}>{children}</PoolContext.Provider>;
}

export function usePool(): PoolContextValue {
  const ctx = useContext(PoolContext);
  if (!ctx) throw new Error("usePool outside PoolStateProvider");
  return ctx;
}

/** Convenience: optimistic patch helpers used across control pages. */
export const patchCircuit =
  (circuitId: number, isOn: boolean) =>
  (snap: PoolStateSnapshot): PoolStateSnapshot => ({
    ...snap,
    circuits: snap.circuits.map((c) => (c.id === circuitId ? { ...c, isOn } : c)),
    features: snap.features.map((c) => (c.id === circuitId ? { ...c, isOn } : c)),
  });

export const patchSetpoint =
  (bodyId: number, setPoint: number) =>
  (snap: PoolStateSnapshot): PoolStateSnapshot => ({
    ...snap,
    bodies: snap.bodies.map((b) => (b.id === bodyId ? { ...b, setPoint } : b)),
  });

export const patchHeatMode =
  (bodyId: number, heatMode: PoolStateSnapshot["bodies"][number]["heatMode"]) =>
  (snap: PoolStateSnapshot): PoolStateSnapshot => ({
    ...snap,
    bodies: snap.bodies.map((b) => (b.id === bodyId ? { ...b, heatMode } : b)),
  });
