"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Lightbulb, MoonStar } from "lucide-react";
import { usePool, patchCircuit } from "@/lib/client/pool-state";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { LightGroupCard } from "@/components/lights/light-group-card";
import { LightCircuitCard } from "@/components/lights/light-circuit-card";
import { ThemeGallery, targetKey, type LightTarget } from "@/components/lights/theme-gallery";
import { SavedCombos } from "@/components/lights/saved-combos";
import { patchLightGroupTheme, patchLightTheme } from "@/components/lights/optimistic";
import { auroraBackground } from "@/components/lights/glow";
import type { LightThemeDef } from "@/types/pool";
import type { PoolAction } from "@/types/actions";
import { LightsAdvanced } from "@/components/advanced/panels";
import { LightCommands } from "@/components/lights/light-commands";

const SECTION_SPRING = { type: "spring", stiffness: 300, damping: 30 } as const;

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="mb-3 text-[11px] font-semibold tracking-[0.16em] text-ink-faint uppercase">{children}</h2>;
}

export default function LightsPage(): React.JSX.Element {
  const { snapshot, hasLoaded, backendConnected, user, sendAction, sendActions } = usePool();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const lights = useMemo(
    () => [...snapshot.circuits, ...snapshot.features].filter((c) => c.isLight),
    [snapshot.circuits, snapshot.features]
  );
  const groups = snapshot.lightGroups;
  const themes = snapshot.lightThemes;

  const themesByVal = useMemo(
    () => new Map<number, LightThemeDef>(themes.map((t) => [t.val, t])),
    [themes]
  );
  const circuitNameById = useMemo(
    () => new Map<number, string>([...snapshot.circuits, ...snapshot.features].map((c) => [c.id, c.name])),
    [snapshot.circuits, snapshot.features]
  );

  // Theme targets: every group, then every individual light. Default = first
  // group if one exists, else the first light.
  const targets = useMemo(
    (): LightTarget[] => [
      ...groups.map((g): LightTarget => ({ kind: "group", id: g.id, name: g.name })),
      ...lights.map((c): LightTarget => ({ kind: "circuit", id: c.id, name: c.name })),
    ],
    [groups, lights]
  );
  const selectedTarget = targets.find((t) => targetKey(t) === selectedKey) ?? targets[0] ?? null;

  const activeTheme = useMemo((): number | null => {
    if (!selectedTarget) return null;
    if (selectedTarget.kind === "group") {
      return groups.find((g) => g.id === selectedTarget.id)?.theme ?? null;
    }
    return lights.find((c) => c.id === selectedTarget.id)?.lightTheme ?? null;
  }, [selectedTarget, groups, lights]);

  const applyTheme = (theme: LightThemeDef): void => {
    if (!selectedTarget) return;
    if (selectedTarget.kind === "group") {
      void sendAction(
        { type: "setLightGroupTheme", groupId: selectedTarget.id, theme: theme.val },
        patchLightGroupTheme(selectedTarget.id, theme.val)
      );
    } else {
      void sendAction(
        { type: "setLightTheme", circuitId: selectedTarget.id, theme: theme.val },
        patchLightTheme(selectedTarget.id, theme.val)
      );
    }
  };

  const litLights = lights.filter((c) => c.isOn);
  const aurora = useMemo(
    () =>
      auroraBackground(
        litLights
          .map((c) => (c.lightTheme !== null ? themesByVal.get(c.lightTheme)?.swatch : undefined))
          .filter((s): s is string => Boolean(s))
      ),
    [litLights, themesByVal]
  );

  const allLightsOff = (): void => {
    const actions = litLights.map((c): PoolAction => ({ type: "setCircuit", circuitId: c.id, state: false }));
    void sendActions(actions);
  };

  const subtitle = !hasLoaded
    ? "Waiting for controller…"
    : lights.length === 0 && groups.length === 0
      ? "No lights reported"
      : litLights.length === 0
        ? "All dark — pick a theme to set the mood"
        : `${litLights.length} of ${lights.length} glowing`;

  if (!hasLoaded) {
    return (
      <div>
        <PageHeader title="Lights" subtitle={subtitle} />
        <div className="space-y-8">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-32" />
            <Skeleton className="hidden h-32 sm:block" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (lights.length === 0 && groups.length === 0) {
    return (
      <div>
        <PageHeader title="Lights" subtitle={subtitle} />
        <EmptyState
          icon={<Lightbulb size={40} />}
          title={user.role === "guest" ? "No lights shared with you yet" : "No lights reported"}
          detail={
            user.role === "guest"
              ? "Ask an owner to make the light circuits guest-visible and they will show up here."
              : backendConnected
                ? "The controller hasn't reported any light circuits or IntelliBrite groups."
                : "The pool controller is unreachable — lights will appear as soon as it reconnects."
          }
        />
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Ambient aurora cast by whatever is currently glowing. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-8 h-72 blur-3xl transition-opacity duration-1000"
        style={{ background: aurora, opacity: litLights.length > 0 ? 0.3 : 0 }}
      />

      <div className="relative space-y-8">
        <PageHeader
          title="Lights"
          subtitle={subtitle}
          action={
            litLights.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={allLightsOff} disabled={!backendConnected}>
                <MoonStar size={14} /> All lights off
              </Button>
            ) : undefined
          }
        />

        {groups.length > 0 && (
          <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={SECTION_SPRING}>
            <SectionTitle>Light groups</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {groups.map((group, i) => (
                <LightGroupCard
                  key={group.id}
                  group={group}
                  theme={group.theme !== null ? (themesByVal.get(group.theme) ?? null) : null}
                  memberNames={group.circuitIds
                    .map((id) => circuitNameById.get(id))
                    .filter((n): n is string => Boolean(n))}
                  disabled={!backendConnected}
                  index={i}
                />
              ))}
            </div>
          </motion.section>
        )}

        {lights.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SECTION_SPRING, delay: 0.05 }}
          >
            <SectionTitle>Lights</SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {lights.map((light, i) => (
                <LightCircuitCard
                  key={`${light.isFeature ? "f" : "c"}-${light.id}`}
                  circuit={light}
                  theme={light.lightTheme !== null ? (themesByVal.get(light.lightTheme) ?? null) : null}
                  disabled={!backendConnected}
                  index={i}
                  onToggle={(on) =>
                    void sendAction({ type: "setCircuit", circuitId: light.id, state: on }, patchCircuit(light.id, on))
                  }
                />
              ))}
            </div>
          </motion.section>
        )}

        {themes.length > 0 && targets.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SECTION_SPRING, delay: 0.1 }}
          >
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-[11px] font-semibold tracking-[0.16em] text-ink-faint uppercase">Theme gallery</h2>
              {selectedTarget && (
                <p className="truncate text-xs text-ink-faint">
                  Tap a swatch to paint <span className="text-ink-dim">{selectedTarget.name}</span>
                </p>
              )}
            </div>
            <ThemeGallery
              themes={themes}
              targets={targets}
              selected={selectedTarget}
              onSelect={(target) => setSelectedKey(targetKey(target))}
              activeTheme={activeTheme}
              disabled={!backendConnected}
              onApply={applyTheme}
            />
          </motion.section>
        )}

        {lights.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SECTION_SPRING, delay: 0.15 }}
          >
            <SavedCombos lights={lights} themesByVal={themesByVal} disabled={!backendConnected} />
          </motion.section>
        )}
      </div>

      <LightCommands />

      <LightsAdvanced />
    </div>
  );
}
