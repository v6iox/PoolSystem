"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { FlaskConical, Lock, RefreshCw } from "lucide-react";
import type { AppSettings } from "@/server/settings";
import { usePool } from "@/lib/client/pool-state";
import { apiGet } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { roleAtLeast } from "@/types/auth";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, Skeleton } from "@/components/ui/panel";
import { IntelliChemCard } from "@/components/chemistry/intellichem-card";
import { RangeBoard } from "@/components/chemistry/range-board";
import { DosingCard } from "@/components/chemistry/dosing-card";
import { TrendSparklines } from "@/components/chemistry/trend-sparklines";
import { HistoryTable } from "@/components/chemistry/history-table";
import { LogTestDialog } from "@/components/chemistry/log-test-dialog";
import { FALLBACK_RANGES, latestPerField, type ChemReading } from "@/components/chemistry/chem-shared";
import { ChemAdvanced } from "@/components/chemistry/chem-advanced";
import { formatRelative } from "@/lib/utils";

function Section({ index, children }: { index: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, type: "spring", stiffness: 300, damping: 30 }}
    >
      {children}
    </motion.div>
  );
}

export default function ChemistryPage(): React.JSX.Element {
  const { snapshot, hasLoaded, user } = usePool();
  const isFamily = roleAtLeast(user.role, "family");
  const [logOpen, setLogOpen] = useState(false);

  const readingsQuery = useQuery({
    queryKey: ["chemistry"],
    queryFn: () => apiGet<{ readings: ChemReading[] }>("/api/chemistry?limit=200"),
    enabled: isFamily,
    refetchInterval: 5 * 60_000,
  });
  const settingsQuery = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => apiGet<{ settings: AppSettings }>("/api/settings/app"),
    enabled: isFamily,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (readingsQuery.isError) {
      toast(
        "error",
        "Couldn't load water tests",
        readingsQuery.error instanceof Error ? readingsQuery.error.message : "Unknown error"
      );
    }
  }, [readingsQuery.isError, readingsQuery.error]);

  const readings = readingsQuery.data?.readings ?? [];
  const latest = latestPerField(readings);
  const ranges = settingsQuery.data?.settings.idealRanges ?? FALLBACK_RANGES;
  const gallons = settingsQuery.data?.settings.poolVolumeGallons ?? 15_000;
  const hasIntelliChem = snapshot.chem.length > 0;
  const loading = !hasLoaded || readingsQuery.isPending || settingsQuery.isPending;
  const lastTest = readings.length > 0 ? Math.max(...readings.map((r) => r.at)) : null;

  if (!isFamily) {
    return (
      <div>
        <PageHeader title="Chemistry" subtitle="Water balance & testing" />
        <EmptyState
          icon={<Lock size={32} />}
          title="Family members only"
          detail="Water testing and dosing are limited to family accounts — ask the pool owner for access."
        />
      </div>
    );
  }

  let sectionIndex = 0;

  return (
    <div>
      <PageHeader
        title="Chemistry"
        subtitle={
          loading
            ? undefined
            : lastTest !== null
              ? `Last tested ${formatRelative(lastTest)}`
              : hasIntelliChem
                ? "Live probe connected"
                : "Water balance & testing"
        }
        action={
          !loading ? (
            <Button variant="primary" size="sm" onClick={() => setLogOpen(true)}>
              <FlaskConical size={15} /> Log test
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-56" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="hidden h-28 lg:block" />
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="space-y-4">
          {hasIntelliChem && (
            <Section index={sectionIndex++}>
              <IntelliChemCard controllers={snapshot.chem} />
            </Section>
          )}

          {readingsQuery.isError ? (
            <Panel className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <p className="text-sm text-ink-dim">Couldn&apos;t load the test history.</p>
              <Button variant="glass" size="sm" onClick={() => void readingsQuery.refetch()}>
                <RefreshCw size={14} /> Try again
              </Button>
            </Panel>
          ) : readings.length === 0 ? (
            <EmptyState
              icon={<FlaskConical size={32} />}
              title="No tests yet — log your first"
              detail={
                hasIntelliChem
                  ? "The probe covers pH and ORP live; log a kit test to track chlorine, alkalinity, CYA, calcium and salt."
                  : "Grab your test kit, dip a sample, and log the numbers — ranges, trends and dosing advice appear here."
              }
              action={
                <Button variant="primary" onClick={() => setLogOpen(true)}>
                  <FlaskConical size={16} /> Log a test
                </Button>
              }
            />
          ) : (
            <>
              <Section index={sectionIndex++}>
                <RangeBoard latest={latest} ranges={ranges} />
              </Section>
              <Section index={sectionIndex++}>
                <DosingCard latest={latest} ranges={ranges} gallons={gallons} />
              </Section>
              <Section index={sectionIndex++}>
                <TrendSparklines readings={readings} />
              </Section>
              <Section index={sectionIndex++}>
                <HistoryTable readings={readings} />
              </Section>
            </>
          )}
        </div>
      )}

      <ChemAdvanced />

      <LogTestDialog open={logOpen} onOpenChange={setLogOpen} />
    </div>
  );
}
