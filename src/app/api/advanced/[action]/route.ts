import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getRuntime } from "@/server/runtime";
import { audit } from "@/server/audit";
import type { CircuitConfigInput } from "@/server/adapters/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ action: string }> };

function bad(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

function numField(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Advanced panel-configuration writes, one action per call:
 *   circuit      {id, name?, type?, eggTimer?, freeze?, showInFeatures?}
 *   pump-speed   {pumpId, circuitId, speed}
 *   light-group  {id, name?, circuitIds?}
 *   valve        {id, name}
 *   clock-sync   {}
 *   cancel-delay {}   (family — it's operational, not config)
 * Everything is audited; the adapter revalidates against the panel.
 */
export async function PUT(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { action } = await params;
  const auth = await requireUser(action === "cancel-delay" ? "family" : "owner");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const adapter = getRuntime().adapter;
  const log = (act: string, target: string, newValue?: string): void =>
    audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: act, target, ...(newValue ? { newValue } : {}) });

  try {
    switch (action) {
      case "circuit": {
        const id = numField(body.id);
        if (id === undefined) return bad("id required");
        const input: CircuitConfigInput = { id };
        if (typeof body.name === "string" && body.name.trim()) input.name = body.name.trim().slice(0, 24);
        if (numField(body.type) !== undefined) input.type = numField(body.type);
        if (numField(body.eggTimer) !== undefined) {
          const minutes = Math.round(numField(body.eggTimer) as number);
          if (minutes < 0 || minutes > 1620) return bad("eggTimer must be 0–1620 minutes");
          input.eggTimer = minutes;
        }
        if (typeof body.freeze === "boolean") input.freeze = body.freeze;
        if (typeof body.showInFeatures === "boolean") input.showInFeatures = body.showInFeatures;
        await adapter.setCircuitConfig(input);
        log("panelCircuitConfig", `circuit ${id}`, JSON.stringify({ ...input, id: undefined }));
        break;
      }
      case "pump-speed": {
        const pumpId = numField(body.pumpId);
        const circuitId = numField(body.circuitId);
        const speed = numField(body.speed);
        if (pumpId === undefined || circuitId === undefined || speed === undefined) {
          return bad("pumpId, circuitId and speed required");
        }
        await adapter.setPumpCircuitSpeed(pumpId, circuitId, Math.round(speed));
        log("panelPumpProgram", `pump ${pumpId} / circuit ${circuitId}`, `${Math.round(speed)} rpm`);
        break;
      }
      case "light-group": {
        const id = numField(body.id);
        if (id === undefined) return bad("id required");
        const patch: { name?: string; circuitIds?: number[] } = {};
        if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 24);
        if (Array.isArray(body.circuitIds)) {
          patch.circuitIds = body.circuitIds.map((v) => numField(v)).filter((v): v is number => v !== undefined);
          if (patch.circuitIds.length === 0) return bad("A light group needs at least one light");
        }
        if (patch.name === undefined && patch.circuitIds === undefined) return bad("Nothing to change");
        await adapter.setLightGroup(id, patch);
        log("panelLightGroup", `light group ${id}`, JSON.stringify(patch));
        break;
      }
      case "valve": {
        const id = numField(body.id);
        if (id === undefined || typeof body.name !== "string" || !body.name.trim()) return bad("id and name required");
        await adapter.setValveName(id, body.name.trim().slice(0, 24));
        log("panelValveName", `valve ${id}`, body.name.trim().slice(0, 24));
        break;
      }
      case "clock-sync": {
        await adapter.syncPanelClock();
        log("panelClockSync", "panel clock", new Date().toISOString());
        break;
      }
      case "cancel-delay": {
        await adapter.cancelDelay();
        log("cancelDelay", "panel delay");
        break;
      }
      case "backup-create": {
        await adapter.createNjspcBackup();
        log("njspcBackup", "panel configuration");
        break;
      }
      case "remote": {
        const id = numField(body.id);
        if (id === undefined || !Array.isArray(body.buttons)) return bad("id and buttons required");
        const buttons = body.buttons
          .map((b) => {
            const rec = b as Record<string, unknown>;
            const slot = numField(rec.slot);
            const circuitId = numField(rec.circuitId);
            return slot !== undefined && circuitId !== undefined ? { slot, circuitId } : null;
          })
          .filter((b): b is { slot: number; circuitId: number } => b !== null);
        if (buttons.length === 0) return bad("No valid button mappings");
        await adapter.setRemoteButtons(id, buttons);
        log("panelRemoteButtons", `remote ${id}`, JSON.stringify(buttons));
        break;
      }
      case "chem-feed": {
        const id = numField(body.id);
        const seconds = numField(body.seconds);
        const kind = body.kind === "ph" || body.kind === "orp" ? body.kind : undefined;
        if (id === undefined || kind === undefined || seconds === undefined) return bad("id, kind and seconds required");
        if (seconds < 1 || seconds > 300) return bad("Manual dose must be 1–300 seconds");
        await adapter.chemFeed(id, kind, Math.round(seconds));
        log("chemManualFeed", `chem controller ${id}`, `${kind} for ${Math.round(seconds)}s`);
        break;
      }
      case "capture-start": {
        await adapter.startPacketCapture();
        log("packetCaptureStart", "RS-485 bus");
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, advanced: await adapter.getAdvancedOptions() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The controller rejected that change" },
      { status: 502 }
    );
  }
}

/** File downloads: diagnostics snapshot and the stopped packet capture. */
export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { action } = await params;
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const adapter = getRuntime().adapter;
  try {
    if (action === "diagnostics") {
      const snapshot = await adapter.getDiagnostics();
      audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "downloadDiagnostics", target: "njsPC" });
      return new NextResponse(JSON.stringify(snapshot, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="moonpool-diagnostics-${new Date().toISOString().slice(0, 10)}.json"`,
        },
      });
    }
    if (action === "capture-stop") {
      const file = await adapter.stopPacketCapture();
      audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "packetCaptureStop", target: "RS-485 bus" });
      return new NextResponse(file.content, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${file.filename}"`,
        },
      });
    }
    return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 404 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The controller rejected that request" },
      { status: 502 }
    );
  }
}
