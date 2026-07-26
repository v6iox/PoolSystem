"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { formatChemNumber } from "@/lib/dosing";
import { formatClock, formatRelative } from "@/lib/utils";
import { METRICS, type ChemReading } from "@/components/chemistry/chem-shared";

/** Recent readings with a two-step delete (tap trash → confirm). */

const MAX_ROWS = 50;

function Cell({ value }: { value: number | null }): React.JSX.Element {
  return value !== null ? (
    <td className="px-3 py-2.5 text-right text-ink tabular-nums">{formatChemNumber(value)}</td>
  ) : (
    <td className="px-3 py-2.5 text-right text-ink-faint">—</td>
  );
}

export function HistoryTable({ readings }: { readings: ChemReading[] }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const rows = [...readings].sort((a, b) => b.at - a.at).slice(0, MAX_ROWS);

  const remove = async (id: number): Promise<void> => {
    setDeletingId(id);
    try {
      await apiSend<{ ok: boolean }>("DELETE", `/api/chemistry?id=${id}`);
      toast("success", "Reading deleted");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chemistry"] }),
        queryClient.invalidateQueries({ queryKey: ["chem-latest"] }),
      ]);
    } catch (err) {
      toast("error", "Couldn't delete the reading", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  };

  return (
    <section>
      <p className="mb-2.5 text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">Test history</p>
      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
                <th className="px-4 py-3 font-semibold">When</th>
                {METRICS.map((def) => (
                  <th key={def.key} className="px-3 py-3 text-right font-semibold">
                    {def.short}
                  </th>
                ))}
                <th className="px-3 py-3 text-right font-semibold">ORP</th>
                <th className="px-3 py-3 font-semibold">Notes</th>
                <th className="w-24 px-3 py-3" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((reading) => (
                <tr key={reading.id} className="border-t border-line transition-colors hover:bg-accent-soft/20">
                  <td className="px-4 py-2.5 whitespace-nowrap text-ink">
                    {new Date(reading.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    <span className="ml-1.5 text-xs text-ink-faint">{formatClock(reading.at)}</span>
                    <span className="ml-1.5 hidden text-xs text-ink-faint lg:inline">· {formatRelative(reading.at)}</span>
                  </td>
                  {METRICS.map((def) => (
                    <Cell key={def.key} value={reading[def.key]} />
                  ))}
                  <Cell value={reading.orp} />
                  <td className="max-w-[16rem] truncate px-3 py-2.5 text-ink-dim" title={reading.notes || undefined}>
                    {reading.notes || <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {confirmId === reading.id ? (
                      <span className="flex items-center justify-end gap-1">
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={deletingId === reading.id}
                          onClick={() => void remove(reading.id)}
                        >
                          {deletingId === reading.id ? "…" : "Delete"}
                        </Button>
                        <Button variant="ghost" size="iconSm" aria-label="Keep reading" onClick={() => setConfirmId(null)}>
                          <X size={14} />
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label="Delete reading"
                        className="text-ink-faint hover:text-danger"
                        onClick={() => setConfirmId(reading.id)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {readings.length > MAX_ROWS && (
          <p className="border-t border-line px-4 py-2.5 text-xs text-ink-faint">
            Showing the {MAX_ROWS} most recent of {readings.length} tests.
          </p>
        )}
      </Panel>
    </section>
  );
}
