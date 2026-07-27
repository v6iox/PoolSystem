import type { PoolStateSnapshot } from "@/types/pool";

/**
 * System scan: what equipment this installation actually has, derived live
 * from what the panel reports. Nav items, dashboard widgets and the
 * detected-equipment panel all key off this, so a system without (say) a
 * chlorinator simply never shows chlorinator UI.
 */

export interface SystemCapabilities {
  /** First snapshot hasn't landed yet — show everything rather than flash. */
  known: boolean;
  hasBodies: boolean;
  hasSpa: boolean;
  /** At least one body reports a controllable heat source. */
  hasHeat: boolean;
  hasSolar: boolean;
  hasPump: boolean;
  hasVariableSpeedPump: boolean;
  hasChlorinator: boolean;
  hasIntelliChem: boolean;
  hasLights: boolean;
  hasLightGroups: boolean;
}

export function deriveCapabilities(snapshot: PoolStateSnapshot, hasLoaded: boolean): SystemCapabilities {
  // Until real data arrives (or while disconnected with an empty snapshot),
  // treat capabilities as unknown and gate nothing.
  const known = hasLoaded && (snapshot.connected || snapshot.bodies.length > 0 || snapshot.circuits.length > 0);
  const lights = [...snapshot.circuits, ...snapshot.features].filter((c) => c.isLight);
  return {
    known,
    hasBodies: snapshot.bodies.length > 0,
    hasSpa: snapshot.bodies.some((b) => b.kind === "spa"),
    hasHeat: snapshot.bodies.some((b) => b.supportedHeatModes.some((m) => m !== "off")),
    hasSolar: snapshot.bodies.some((b) => b.supportedHeatModes.includes("solar") || b.supportedHeatModes.includes("solarpref")),
    hasPump: snapshot.pumps.length > 0,
    hasVariableSpeedPump: snapshot.pumps.some((p) => ["vs", "vsf", "vf"].includes(p.type)),
    hasChlorinator: snapshot.chlorinators.length > 0,
    hasIntelliChem: snapshot.chem.length > 0,
    hasLights: lights.length > 0 || snapshot.lightGroups.length > 0,
    hasLightGroups: snapshot.lightGroups.length > 0,
  };
}

/** Inventory rows for the "Detected equipment" scan panel. */
export interface DetectedItem {
  label: string;
  detail: string;
  found: boolean;
}

export function equipmentInventory(snapshot: PoolStateSnapshot): DetectedItem[] {
  const caps = deriveCapabilities(snapshot, true);
  const lights = [...snapshot.circuits, ...snapshot.features].filter((c) => c.isLight);
  const plainCircuits = [...snapshot.circuits, ...snapshot.features].filter((c) => !c.isLight);
  return [
    {
      label: "Bodies of water",
      detail: snapshot.bodies.map((b) => `${b.name} (${b.kind})`).join(", ") || "none reported",
      found: caps.hasBodies,
    },
    {
      label: "Heaters",
      detail: caps.hasHeat
        ? snapshot.bodies
            .map((b) => `${b.name}: ${b.supportedHeatModes.filter((m) => m !== "off").join("/") || "none"}`)
            .join(" · ")
        : "no controllable heat reported",
      found: caps.hasHeat,
    },
    {
      label: "Circuits & features",
      detail: `${plainCircuits.length} switchable`,
      found: plainCircuits.length > 0,
    },
    {
      label: "Pumps",
      detail: snapshot.pumps.map((p) => `${p.name} (${p.type.toUpperCase()})`).join(", ") || "none reported",
      found: caps.hasPump,
    },
    {
      label: "Chlorinator",
      detail: snapshot.chlorinators.map((c) => c.name).join(", ") || "none reported",
      found: caps.hasChlorinator,
    },
    {
      label: "Color lights",
      detail: caps.hasLights
        ? `${lights.length} light${lights.length === 1 ? "" : "s"}${snapshot.lightGroups.length > 0 ? ` + ${snapshot.lightGroups.length} group${snapshot.lightGroups.length === 1 ? "" : "s"}` : ""}, ${snapshot.lightThemes.length} themes`
        : "none reported",
      found: caps.hasLights,
    },
    {
      label: "IntelliChem",
      detail: caps.hasIntelliChem ? snapshot.chem.map((c) => c.name).join(", ") : "not present — manual test logging is used",
      found: caps.hasIntelliChem,
    },
    {
      label: "Schedules",
      detail: `${snapshot.schedules.length} in the panel`,
      found: snapshot.schedules.length > 0,
    },
  ];
}
