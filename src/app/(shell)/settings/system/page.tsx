"use client";

import { motion } from "motion/react";
import {
  BookOpen,
  Cpu,
  ExternalLink,
  FlaskConical,
  GitBranch,
  Info,
  RadioTower,
  ShieldCheck,
  Snowflake,
  Timer,
  Wifi,
  WifiOff,
} from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { PageHeader, Panel, Skeleton } from "@/components/ui/panel";
import {
  SettingRow,
  SettingsSection,
  StatusPill,
  type PillTone,
} from "@/components/settings/section";
import { DetectedEquipment } from "@/components/settings/detected-equipment";
import { formatRelative } from "@/lib/utils";

/** Read-only system status: connection, panel state, equipment identity, versions. */

const APP_VERSION = "1.0.0";

function ValueText({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="text-sm text-ink-dim">{children}</span>;
}

export default function SystemSettingsPage(): React.JSX.Element {
  const { snapshot, hasLoaded, backendConnected, connection } = usePool();

  const panelTone: PillTone = snapshot.panelMode === "auto" ? "ok" : snapshot.panelMode === "unknown" ? "neutral" : "warn";
  const equipment = snapshot.equipment;

  return (
    <div>
      <PageHeader title="System" subtitle="How Moonpool is talking to your pool right now" />

      <div className="mx-auto max-w-2xl space-y-6">
        {!hasLoaded ? (
          <>
            <Skeleton className="h-52" />
            <Skeleton className="h-40" />
            <Skeleton className="h-32" />
          </>
        ) : (
          <>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <SettingsSection icon={<RadioTower size={13} />} title="Connection">
                <SettingRow
                  icon={backendConnected ? <Wifi size={17} className="text-ok" /> : <WifiOff size={17} className="text-danger" />}
                  label="Pool controller"
                  hint={
                    backendConnected
                      ? "Live state is streaming in."
                      : "Unreachable — controls are paused until it comes back."
                  }
                >
                  <StatusPill tone={backendConnected ? "ok" : "bad"}>
                    {backendConnected ? "Connected" : "Offline"}
                  </StatusPill>
                </SettingRow>
                <SettingRow
                  icon={<FlaskConical size={17} />}
                  label="Source"
                  hint={
                    snapshot.mock
                      ? "Built-in simulator — no hardware is being touched."
                      : "nodejs-poolController at the address set by NJSPC_URL."
                  }
                >
                  <StatusPill tone={snapshot.mock ? "warn" : "accent"}>
                    {snapshot.mock ? "MOCK simulator" : "njsPC (live)"}
                  </StatusPill>
                </SettingRow>
                <SettingRow
                  icon={<Timer size={17} />}
                  label="Last update"
                  hint={connection === "live" ? "Streaming over SSE" : "Reconnecting to the stream…"}
                >
                  <ValueText>{snapshot.lastUpdate > 0 ? formatRelative(snapshot.lastUpdate) : "—"}</ValueText>
                </SettingRow>
              </SettingsSection>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }}>
              <DetectedEquipment />
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <SettingsSection icon={<Cpu size={13} />} title="Equipment">
                <SettingRow icon={<Cpu size={17} />} label="Panel model">
                  <ValueText>{equipment.model || "—"}</ValueText>
                </SettingRow>
                <SettingRow icon={<GitBranch size={17} />} label="Controller type">
                  <ValueText>{equipment.controllerType || "—"}</ValueText>
                </SettingRow>
                <SettingRow icon={<Info size={17} />} label="Panel firmware">
                  <ValueText>{equipment.softwareVersion || "—"}</ValueText>
                </SettingRow>
                <SettingRow icon={<ShieldCheck size={17} />} label="Panel mode">
                  <StatusPill tone={panelTone}>{snapshot.panelMode}</StatusPill>
                </SettingRow>
                <SettingRow icon={<Snowflake size={17} />} label="Freeze protection">
                  <StatusPill tone={snapshot.freezeProtect ? "warn" : "ok"}>
                    {snapshot.freezeProtect ? "Active" : "Idle"}
                  </StatusPill>
                </SettingRow>
                <SettingRow icon={<Timer size={17} />} label="Heater / valve delay">
                  <StatusPill tone={snapshot.delay ? "warn" : "ok"}>
                    {snapshot.delay ? "In delay" : "None"}
                  </StatusPill>
                </SettingRow>
              </SettingsSection>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <SettingsSection icon={<BookOpen size={13} />} title="About">
                <SettingRow icon={<Info size={17} />} label="Moonpool" hint="Self-hosted pool control">
                  <ValueText>v{APP_VERSION}</ValueText>
                </SettingRow>
                <a
                  href="https://github.com/tagyoureit/nodejs-poolController"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-accent-soft/40"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <BookOpen size={17} className="shrink-0 text-ink-faint" />
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">nodejs-poolController docs</span>
                      <span className="block text-xs text-ink-faint">The bridge Moonpool talks to</span>
                    </span>
                  </span>
                  <ExternalLink size={15} className="shrink-0 text-ink-faint" />
                </a>
                <a
                  href="https://github.com/tagyoureit/nodejs-poolController/wiki"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-accent-soft/40"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <BookOpen size={17} className="shrink-0 text-ink-faint" />
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">Setup & wiring guides</span>
                      <span className="block text-xs text-ink-faint">njsPC wiki — panels, RS-485, config</span>
                    </span>
                  </span>
                  <ExternalLink size={15} className="shrink-0 text-ink-faint" />
                </a>
              </SettingsSection>
            </motion.div>

            <Panel className="p-4 text-xs text-ink-faint">
              Everything on this page is read-only. Connection problems usually mean njsPC restarted or
              the RS-485 link dropped — Moonpool reconnects automatically and re-enables controls the
              moment state starts flowing again.
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
