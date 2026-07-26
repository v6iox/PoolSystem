import {
  Bath,
  Brush,
  CloudRain,
  Droplets,
  Fan,
  Flame,
  Lightbulb,
  Moon,
  Mountain,
  Palmtree,
  Power,
  Sparkles,
  Sun,
  Waves,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** Icon choices owners can assign to circuits (stored by key in circuit_meta). */
export const CIRCUIT_ICONS: Record<string, LucideIcon> = {
  waves: Waves,
  bath: Bath,
  flame: Flame,
  lightbulb: Lightbulb,
  droplets: Droplets,
  cloudrain: CloudRain,
  fan: Fan,
  brush: Brush,
  sparkles: Sparkles,
  sun: Sun,
  moon: Moon,
  palmtree: Palmtree,
  mountain: Mountain,
  wind: Wind,
  zap: Zap,
  power: Power,
};

/** Default icon by njsPC circuit function type. */
export function defaultCircuitIcon(type: string, isLight: boolean): string {
  if (isLight) return "lightbulb";
  const t = type.toLowerCase();
  if (t.includes("spa")) return "bath";
  if (t.includes("pool")) return "waves";
  if (t.includes("cleaner")) return "brush";
  if (t.includes("fall") || t.includes("fountain")) return "cloudrain";
  if (t.includes("jet") || t.includes("air")) return "wind";
  if (t.includes("heat") || t.includes("solar")) return "flame";
  return "power";
}

export function CircuitIcon({
  icon,
  type,
  isLight,
  size = 20,
  className,
}: {
  icon?: string | null;
  type: string;
  isLight: boolean;
  size?: number;
  className?: string;
}): React.JSX.Element {
  const key = icon && CIRCUIT_ICONS[icon] ? icon : defaultCircuitIcon(type, isLight);
  const Icon = CIRCUIT_ICONS[key] ?? Power;
  return <Icon size={size} className={className} />;
}
