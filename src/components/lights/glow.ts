/**
 * Swatch → glow helpers. A light theme's `swatch` is either a solid CSS color
 * ("#3b82f6") or a full `linear-gradient(...)` string. These helpers pull the
 * component colors out so lit fixtures can cast their actual color into the
 * page as soft box-shadow glows and ambient aurora washes.
 */

const FALLBACK = "#7dd3fc";

const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklab|oklch)\([^)]*\)/g;

/** Component colors of a swatch (1 for solids, ≥1 for gradient strings). */
export function swatchColors(swatch: string): string[] {
  if (swatch.includes("gradient")) {
    const found = swatch.match(COLOR_TOKEN);
    return found && found.length > 0 ? found : [FALLBACK];
  }
  return [swatch];
}

/** Layered box-shadow value that makes a surface glow in the swatch's colors. */
export function glowShadow(swatch: string, intensity = 45, radius = 34): string {
  const colors = swatchColors(swatch);
  const first = colors[0] ?? FALLBACK;
  const last = colors[colors.length - 1] ?? first;
  const layers = [`0 0 ${radius}px -6px color-mix(in oklab, ${first} ${intensity}%, transparent)`];
  if (last !== first) {
    layers.push(
      `0 0 ${Math.round(radius * 1.7)}px -8px color-mix(in oklab, ${last} ${Math.round(intensity * 0.8)}%, transparent)`
    );
  }
  return layers.join(", ");
}

/** Soft ambient wash (stacked radial gradients) from a set of lit swatches. */
export function auroraBackground(swatches: string[]): string {
  const colors = swatches.flatMap((s) => swatchColors(s)).slice(0, 6);
  if (colors.length === 0) return "transparent";
  const step = 100 / (colors.length + 1);
  return colors
    .map(
      (color, i) =>
        `radial-gradient(42% 85% at ${Math.round(step * (i + 1))}% 0%, color-mix(in oklab, ${color} 32%, transparent), transparent 70%)`
    )
    .join(", ");
}
