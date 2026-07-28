import { describe, expect, it } from "vitest";
import { parseDelayState } from "@/server/adapters/njspc";

/**
 * EasyTouch reports its delay byte as 32 | flags: 32 alone is the NORMAL
 * no-delay state (njsPC maps both 0 and 32 to "nodelay"), 34 = heater
 * cooldown, 36 = valve turn, 38 = freeze. Regression guard for the bug where
 * any nonzero val read as "in a delay" — a permanent banner that Skip could
 * never clear, which also muzzled the heater watchdog's stop detection.
 */

const nodelay32 = { val: 32, name: "nodelay", desc: "No Delay" };

describe("parseDelayState", () => {
  it("treats EasyTouch's transformed nodelay (val 32) as no delay", () => {
    const res = parseDelayState({ delay: nodelay32 });
    expect(res.delay).toBe(false);
    expect(res.delays).toEqual([]);
  });

  it("treats val 0 / missing / boolean false as no delay", () => {
    expect(parseDelayState({ delay: { val: 0, name: "nodelay", desc: "No Delay" } }).delay).toBe(false);
    expect(parseDelayState({}).delay).toBe(false);
    expect(parseDelayState({ delay: false }).delay).toBe(false);
  });

  it("names a real heater cooldown delay from desc", () => {
    const res = parseDelayState({ delay: { val: 34, name: "heaterdelay", desc: "Heater Cooldown Delay" } });
    expect(res.delay).toBe(true);
    expect(res.delays).toEqual(["Heater Cooldown Delay"]);
  });

  it("handles an untransformed numeric delay byte", () => {
    expect(parseDelayState({ delay: 32 }).delay).toBe(false);
    expect(parseDelayState({ delay: 0 }).delay).toBe(false);
    const heater = parseDelayState({ delay: 34 });
    expect(heater.delay).toBe(true);
    expect(heater.delays).toEqual(["Heater cooldown delay"]);
    expect(parseDelayState({ delay: 36 }).delays).toEqual(["Valve delay"]);
    expect(parseDelayState({ delay: 38 }).delays).toEqual(["Freeze delay"]);
    // Unknown nonzero (non-32) values still count as a delay, just unnamed.
    expect(parseDelayState({ delay: 2 })).toEqual({ delay: true, delays: ["Panel delay"] });
  });

  it("surfaces body-level delay flags even when the panel byte says nodelay", () => {
    const res = parseDelayState({
      delay: nodelay32,
      temps: { bodies: [{ id: 2, name: "Spa", heaterCooldownDelay: true }] },
    });
    expect(res.delay).toBe(true);
    expect(res.delays).toEqual(["Spa heater cool-down"]);
  });

  it("surfaces circuit and feature start/stop delay flags", () => {
    const res = parseDelayState({
      delay: nodelay32,
      circuits: [{ id: 6, name: "Pool", stopDelay: true }],
      features: [{ id: 9, name: "Cleaner", startDelay: true }],
    });
    expect(res.delay).toBe(true);
    expect(res.delays).toEqual(["Pool stop delay", "Cleaner start delay"]);
  });

  it("combines the panel delay name with per-body flags", () => {
    const res = parseDelayState({
      delay: { val: 34, name: "heaterdelay", desc: "Heater Cooldown Delay" },
      temps: { bodies: [{ id: 2, name: "Spa", stopDelay: true }] },
    });
    expect(res.delay).toBe(true);
    expect(res.delays).toEqual(["Heater Cooldown Delay", "Spa stop delay"]);
  });
});
