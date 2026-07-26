"use client";

import { Check, Moon, MoonStar, Paintbrush, Palette, Sun, SunMoon, Waves, X } from "lucide-react";
import { THEME_PRESETS, useTheme, type ThemeMode } from "@/lib/client/theme";
import { SettingRow, SettingsSection, Segmented } from "@/components/settings/section";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Appearance: mode, OLED black, accent presets + custom accent, ambient motion. */

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = ln - sn * Math.min(ln, 1 - ln) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

const MODE_OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Moon }> = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "auto", label: "Auto", icon: SunMoon },
  { value: "light", label: "Light", icon: Sun },
];

export function AppearanceSection(): React.JSX.Element {
  const { theme, setTheme, resolvedMode } = useTheme();
  const activePreset = THEME_PRESETS.find((p) => p.id === theme.presetId) ?? THEME_PRESETS[0];
  const accent = theme.customAccent ?? activePreset ?? { h: 187, s: 78, l: 62 };
  const accentHex = hslToHex(accent.h, accent.s, accent.l);

  return (
    <SettingsSection icon={<Palette size={13} />} title="Appearance">
      <SettingRow label="Mode" hint="Auto follows your device">
        <Segmented
          aria-label="Color mode"
          value={theme.mode}
          onChange={(mode) => setTheme({ mode })}
          options={MODE_OPTIONS}
        />
      </SettingRow>

      {resolvedMode === "dark" && (
        <SettingRow
          icon={<MoonStar size={17} />}
          label="OLED black"
          hint="Pure-black backdrop for OLED screens"
        >
          <Switch
            checked={theme.oled}
            onCheckedChange={(oled) => setTheme({ oled })}
            aria-label="OLED black"
          />
        </SettingRow>
      )}

      <SettingRow label="Accent" hint="Tints dials, glows and controls" stacked>
        <div className="flex flex-wrap items-center gap-2.5">
          {THEME_PRESETS.map((preset) => {
            const selected = theme.customAccent === null && theme.presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                title={preset.name}
                aria-label={`${preset.name} accent`}
                aria-pressed={selected}
                onClick={() => setTheme({ presetId: preset.id, customAccent: null })}
                className={cn(
                  "relative flex h-11 w-11 items-center justify-center rounded-full border transition-transform hover:scale-105 active:scale-95",
                  selected ? "border-line-bright shadow-[0_0_14px]" : "border-line"
                )}
                style={{
                  backgroundColor: `hsl(${preset.h} ${preset.s}% ${preset.l}% / 0.22)`,
                  ...(selected ? { boxShadow: `0 0 14px hsl(${preset.h} ${preset.s}% ${preset.l}% / 0.45)` } : {}),
                }}
              >
                <span
                  className="h-6 w-6 rounded-full"
                  style={{ backgroundColor: `hsl(${preset.h} ${preset.s}% ${preset.l}%)` }}
                />
                {selected && <Check size={13} className="absolute text-abyss" strokeWidth={3} />}
              </button>
            );
          })}

          {/* Custom accent via native color input, converted to HSL. */}
          <label
            className={cn(
              "relative flex h-11 cursor-pointer items-center gap-2 rounded-full border px-3 transition-colors",
              theme.customAccent ? "border-line-bright bg-accent-soft" : "border-line hover:border-line-bright"
            )}
          >
            <Paintbrush size={14} className={theme.customAccent ? "text-accent" : "text-ink-faint"} />
            <span className={cn("text-xs font-medium", theme.customAccent ? "text-accent" : "text-ink-dim")}>
              Custom
            </span>
            {theme.customAccent && (
              <span className="h-4 w-4 rounded-full" style={{ backgroundColor: accentHex }} />
            )}
            <input
              type="color"
              aria-label="Custom accent color"
              value={accentHex}
              onChange={(e) => setTheme({ customAccent: hexToHsl(e.target.value) })}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
          {theme.customAccent && (
            <button
              type="button"
              onClick={() => setTheme({ customAccent: null })}
              className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-ink-faint transition-colors hover:text-ink"
              aria-label="Clear custom accent"
            >
              <X size={13} /> Reset
            </button>
          )}
        </div>
      </SettingRow>

      <SettingRow
        icon={<Waves size={17} />}
        label="Ambient motion"
        hint="Underwater caustics behind the interface"
      >
        <Switch
          checked={theme.ambientMotion}
          onCheckedChange={(ambientMotion) => setTheme({ ambientMotion })}
          aria-label="Ambient motion"
        />
      </SettingRow>
    </SettingsSection>
  );
}
