"use client";

import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { Logo, Wordmark } from "@/components/logo";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/utils";
import type { PoolStateSnapshot } from "@/types/pool";

/**
 * PWA offline shell. Served by the service worker when the app can't be
 * reached; shows the last-known pool state cached in localStorage.
 */
export default function OfflinePage(): React.JSX.Element {
  const [cached, setCached] = useState<{ snap: PoolStateSnapshot; at: number } | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("moonpool-last-state");
      if (raw) setCached(JSON.parse(raw) as { snap: PoolStateSnapshot; at: number });
    } catch {
      setCached(null);
    }
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
      <div className="flex items-center gap-2.5">
        <Logo size={34} />
        <Wordmark className="text-2xl" />
      </div>
      <Panel className="w-full max-w-sm p-6 text-center">
        <CloudOff size={28} className="mx-auto mb-3 text-ink-faint" />
        <p className="font-display font-medium text-ink">You&apos;re offline</p>
        <p className="mt-1 text-sm text-ink-dim">
          Can&apos;t reach Moonpool right now. {cached ? `Here's the pool as of ${formatRelative(cached.at)}.` : ""}
        </p>
        {cached && (
          <div className="mt-5 grid grid-cols-2 gap-3">
            {cached.snap.bodies.map((b) => (
              <div key={b.id} className="rounded-xl border border-line bg-abyss/40 p-3">
                <p className="text-[11px] tracking-widest text-ink-faint uppercase">{b.name}</p>
                <p className="temp-display mt-1 text-3xl text-ink">
                  {b.temp !== null ? Math.round(b.temp) : "—"}
                  <span className="text-sm text-ink-dim">°{cached.snap.units}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-ink-faint">set {b.setPoint}°</p>
              </div>
            ))}
            {cached.snap.airTemp !== null && (
              <div className="col-span-2 rounded-xl border border-line bg-abyss/40 p-3">
                <p className="text-[11px] tracking-widest text-ink-faint uppercase">Air</p>
                <p className="temp-display mt-1 text-2xl text-ink">
                  {Math.round(cached.snap.airTemp)}
                  <span className="text-sm text-ink-dim">°{cached.snap.units}</span>
                </p>
              </div>
            )}
          </div>
        )}
        <Button variant="primary" className="mt-6 w-full" onClick={() => window.location.replace("/")}>
          <RefreshCw size={15} /> Try again
        </Button>
      </Panel>
      <p className="text-xs text-ink-faint">Controls need a live connection — nothing is queued while offline.</p>
    </div>
  );
}
