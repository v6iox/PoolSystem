import type { PoolAction } from "@/types/actions";
import type { PoolStateSnapshot } from "@/types/pool";
import { allCircuits } from "@/components/scenes/steps";

export interface SceneSeed {
  name: string;
  icon: string;
  description: string;
  actions: PoolAction[];
  guestVisible: boolean;
}

/**
 * Starter "Spa Night" scene, adapted to whatever equipment the system
 * actually reports: spa (or first body) on + heat to ~102°, lights to a
 * purple/magenta-ish theme, waterfall off if one exists by name.
 * Returns null when there's nothing sensible to build.
 */
export function buildSpaNightSeed(snapshot: PoolStateSnapshot): SceneSeed | null {
  const actions: PoolAction[] = [];
  const bits: string[] = [];
  const circuits = allCircuits(snapshot);

  // 1. Spa (or the first body) on + heat.
  const body = snapshot.bodies.find((b) => b.kind === "spa") ?? snapshot.bodies[0];
  if (body) {
    actions.push({ type: "setCircuit", circuitId: body.circuitId, state: true });
    const min = Math.max(60, body.minSetPoint);
    const max = Math.min(104, body.maxSetPoint);
    if (min <= max) {
      const setPoint = Math.min(max, Math.max(min, 102));
      const heat: Extract<PoolAction, { type: "setHeat" }> = { type: "setHeat", bodyId: body.id, setPoint };
      if (body.supportedHeatModes.includes("heater")) heat.mode = "heater";
      actions.push(heat);
      bits.push(`${body.name.toLowerCase()} to ${setPoint}°`);
    } else {
      bits.push(`${body.name.toLowerCase()} on`);
    }
  }

  // 2. Lights to something evening-purple; fall back to any color theme.
  const theme =
    snapshot.lightThemes.find((t) => /purple/i.test(t.name)) ??
    snapshot.lightThemes.find((t) => /magenta/i.test(t.name)) ??
    snapshot.lightThemes.find((t) => t.type === "color") ??
    snapshot.lightThemes[0];
  if (theme) {
    const group = snapshot.lightGroups[0];
    if (group) {
      for (const circuitId of group.circuitIds.slice(0, 4)) {
        actions.push({ type: "setCircuit", circuitId, state: true });
      }
      actions.push({ type: "setLightGroupTheme", groupId: group.id, theme: theme.val });
      bits.push(`lights ${theme.name.toLowerCase()}`);
    } else {
      const lights = circuits.filter((c) => c.isLight).slice(0, 3);
      for (const light of lights) {
        actions.push({ type: "setCircuit", circuitId: light.id, state: true });
        actions.push({ type: "setLightTheme", circuitId: light.id, theme: theme.val });
      }
      if (lights.length > 0) bits.push(`lights ${theme.name.toLowerCase()}`);
    }
  }

  // 3. Waterfall / fountain off for a quiet soak.
  const waterfall = circuits.find((c) => /fall|fountain/i.test(c.name));
  if (waterfall) {
    actions.push({ type: "setCircuit", circuitId: waterfall.id, state: false });
    bits.push(`${waterfall.name.toLowerCase()} off`);
  }

  if (actions.length === 0) return null;
  return {
    name: "Spa Night",
    icon: "bath",
    description: bits.length > 0 ? `One tap: ${bits.join(", ")}.` : "One-tap evening soak setup.",
    actions: actions.slice(0, 25),
    guestVisible: false,
  };
}
