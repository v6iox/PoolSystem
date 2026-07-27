"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Check, Minus, ScanSearch } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { equipmentInventory } from "@/lib/capabilities";
import { SettingsSection } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * System scan panel. Detection is continuous (equipment comes straight from
 * the live panel snapshot), but the scan animation gives a clear moment of
 * "here's what Moonpool found" — and the not-found rows explain why parts of
 * the app are hidden on this installation.
 */
export function DetectedEquipment(): React.JSX.Element {
  const { snapshot, backendConnected } = usePool();
  const [scanTick, setScanTick] = useState(0);
  const [scanning, setScanning] = useState(false);
  const items = equipmentInventory(snapshot);

  const rescan = (): void => {
    setScanning(true);
    setScanTick((t) => t + 1);
    window.setTimeout(() => setScanning(false), items.length * 90 + 400);
  };

  return (
    <SettingsSection
      title="Detected equipment"
      icon={<ScanSearch size={17} />}
      description="Discovered live from the panel — pages and widgets for missing gear are hidden automatically."
    >
      <div className="p-4">
        <ul className="space-y-1">
          {items.map((item, i) => (
            <motion.li
              key={`${scanTick}-${item.label}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.09, type: "spring", stiffness: 300, damping: 26 }}
              className="flex items-start justify-between gap-3 rounded-lg px-2 py-2"
            >
              <div className="min-w-0">
                <p className={cn("text-sm", item.found ? "text-ink" : "text-ink-faint")}>{item.label}</p>
                <p className="text-xs text-ink-faint">{item.detail}</p>
              </div>
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  item.found ? "bg-ok/15 text-ok" : "bg-abyss/50 text-ink-faint"
                )}
              >
                {item.found ? <Check size={12} /> : <Minus size={12} />}
              </span>
            </motion.li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs text-ink-faint">
            {backendConnected
              ? "Add equipment at the panel (or in njsPC) and it appears here on its own."
              : "Controller offline — showing the last known inventory."}
          </p>
          <Button variant="ghost" size="sm" onClick={rescan} disabled={scanning}>
            <ScanSearch size={14} className={scanning ? "animate-pulse" : undefined} />
            {scanning ? "Scanning…" : "Rescan"}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
