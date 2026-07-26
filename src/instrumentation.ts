/**
 * Boots the Moonpool runtime (njsPC bridge or simulator, automations worker,
 * history sampler, alert engine) once per server process.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getRuntime } = await import("@/server/runtime");
    getRuntime();
  }
}
