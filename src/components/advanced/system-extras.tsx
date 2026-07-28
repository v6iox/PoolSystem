"use client";

import { useState } from "react";
import { Archive, Download, FileSearch, Gamepad2, Radio, ShieldAlert, Umbrella } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SettingRow, SettingsSection, StatusPill } from "@/components/settings/section";
import { AdvancedDisclosure, useAdvanced } from "@/components/advanced/core";
import { usePool } from "@/lib/client/pool-state";
import { formatRelative } from "@/lib/utils";

/**
 * The remaining panel-comms surfaces, all on Settings → System and all
 * capability-gated: they render only when the equipment actually reports.
 */

/** RS-485 bus health — early warning for wiring/termination trouble. */
export function BusHealthSection(): React.JSX.Element | null {
  const { advanced, isOwner } = useAdvanced();
  if (!isOwner || !advanced || advanced.rs485.length === 0) return null;
  return (
    <SettingsSection
      icon={<Radio size={14} />}
      title="RS-485 bus health"
      description="Counters from njsPC's serial link to the panel. Rising collisions or failures usually mean wiring or termination trouble."
    >
      {advanced.rs485.map((p) => {
        const trouble = p.failed > 0 || p.collisions > 25;
        return (
          <SettingRow
            key={p.port}
            label={p.port}
            hint={`${p.sent.toLocaleString()} sent · ${p.received.toLocaleString()} received · ${p.collisions} collisions · ${p.failed} failed`}
          >
            <StatusPill tone={trouble ? "warn" : p.status === "open" ? "ok" : "neutral"}>
              {trouble ? "check wiring" : p.status}
            </StatusPill>
          </SettingRow>
        );
      })}
    </SettingsSection>
  );
}

/** njsPC's own configuration backups (panel config, not the Moonpool DB). */
export function PanelBackupsSection(): React.JSX.Element | null {
  const { advanced, isOwner, disabled, send } = useAdvanced();
  const [busy, setBusy] = useState(false);
  if (!isOwner || !advanced) return null;
  return (
    <SettingsSection
      icon={<Archive size={14} />}
      title="Panel configuration backups"
      description="njsPC snapshots its pool-controller configuration into its own storage volume — separate from (and complementary to) Moonpool's database."
    >
      <SettingRow
        label="Back up now"
        hint={
          advanced.backups.length > 0
            ? `${advanced.backups.length} backup${advanced.backups.length === 1 ? "" : "s"} · latest ${advanced.backups[0]?.at ? formatRelative(advanced.backups[0].at) : advanced.backups[0]?.name ?? ""}`
            : "No panel-config backups yet"
        }
      >
        <Button
          variant="glass"
          size="sm"
          disabled={disabled || busy}
          onClick={() => {
            setBusy(true);
            void send("backup-create", {}, "Panel configuration backed up").finally(() => setBusy(false));
          }}
        >
          <Archive size={14} /> Back up
        </Button>
      </SettingRow>
      {advanced.backups.slice(0, 5).map((b) => (
        <SettingRow key={b.name} label={b.name} hint={`${b.at ? formatRelative(b.at) : "date unknown"}${b.sizeKb !== null ? ` · ${b.sizeKb} KB` : ""}`} />
      ))}
    </SettingsSection>
  );
}

/** Packet capture + diagnostics snapshot — the support toolkit. */
export function DiagnosticsSection(): React.JSX.Element | null {
  const { advanced, isOwner, disabled, send } = useAdvanced();
  const [capturing, setCapturing] = useState(false);
  if (!isOwner || !advanced) return null;
  return (
    <SettingsSection
      icon={<FileSearch size={14} />}
      title="Diagnostics"
      description="For debugging bus problems or filing an issue: capture raw RS-485 traffic, or download a full config + state snapshot."
    >
      <SettingRow
        icon={<ShieldAlert size={16} />}
        label="RS-485 packet capture"
        hint={capturing ? "Capturing bus traffic — reproduce the problem, then stop to download" : "Records the raw panel conversation"}
      >
        {capturing ? (
          <a href="/api/advanced/capture-stop" download onClick={() => setCapturing(false)}>
            <Button variant="primary" size="sm">
              <Download size={14} /> Stop & download
            </Button>
          </a>
        ) : (
          <Button
            variant="glass"
            size="sm"
            disabled={disabled}
            onClick={() => {
              void send("capture-start", {}, "Packet capture started").then((ok) => setCapturing(ok));
            }}
          >
            Start capture
          </Button>
        )}
      </SettingRow>
      <SettingRow icon={<Download size={16} />} label="Diagnostics snapshot" hint="Full njsPC config, live state and valuemaps as JSON">
        <a href="/api/advanced/diagnostics" download>
          <Button variant="glass" size="sm">
            <Download size={14} /> Download
          </Button>
        </a>
      </SettingRow>
    </SettingsSection>
  );
}

/** Wall remotes (iS4, QuickTouch, SpaCommand): button → circuit mapping. */
export function RemotesSection(): React.JSX.Element | null {
  const { snapshot } = usePool();
  const { advanced, isOwner, disabled, send } = useAdvanced();
  if (!isOwner || !advanced || advanced.remotes.length === 0) return null;
  const circuits = [...snapshot.circuits, ...snapshot.features];
  return (
    <AdvancedDisclosure
      title="Advanced — wall remotes"
      hint="Button-to-circuit mapping for iS4 / QuickTouch style remotes, written to the panel."
    >
      {advanced.remotes.map((r) => (
        <div key={r.id} className="px-4 py-3.5">
          <p className="mb-2 flex items-center gap-2 text-sm text-ink">
            <Gamepad2 size={15} className="text-accent" /> {r.name}
            <span className="text-xs text-ink-faint">{r.typeName}</span>
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {r.buttons.map((b) => (
              <label key={b.slot} className="flex items-center justify-between gap-2 text-sm text-ink-dim">
                Button {b.slot}
                <Select
                  value={b.circuitId !== null ? String(b.circuitId) : ""}
                  disabled={disabled}
                  aria-label={`${r.name} button ${b.slot}`}
                  className="h-9 w-44"
                  onValueChange={(v) =>
                    void send(
                      "remote",
                      { id: r.id, buttons: [{ slot: b.slot, circuitId: Number(v) }] },
                      `${r.name} button ${b.slot} remapped`
                    )
                  }
                  options={circuits.map((c) => ({ value: String(c.id), label: c.name }))}
                />
              </label>
            ))}
          </div>
        </div>
      ))}
    </AdvancedDisclosure>
  );
}

/** Covers + virtual equipment — read-only visibility, config stays in dashPanel. */
export function CoversAndVirtualSection(): React.JSX.Element | null {
  const { advanced, isOwner } = useAdvanced();
  if (!isOwner || !advanced) return null;
  if (advanced.covers.length === 0 && advanced.virtualEquipment.length === 0) return null;
  return (
    <SettingsSection
      icon={<Umbrella size={14} />}
      title="Covers & virtual equipment"
      description="Detected on the panel. Configuration for these lives in njsPC's dashPanel — shown here so nothing on your system is invisible."
    >
      {advanced.covers.map((c) => (
        <SettingRow key={`cover-${c.id}`} label={c.name} hint={`${c.bodyDesc || "cover"}${c.normallyOn ? " · normally on" : ""}`} />
      ))}
      {advanced.virtualEquipment.map((v) => (
        <SettingRow key={`${v.kind}-${v.address}`} label={v.name} hint={`virtual ${v.kind} · address ${v.address}`} />
      ))}
    </SettingsSection>
  );
}
