"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, Expand, EyeOff, GripVertical, LayoutGrid, Shrink } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePool } from "@/lib/client/pool-state";
import { deriveCapabilities, type SystemCapabilities } from "@/lib/capabilities";
import { apiGet, apiSend } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { roleAtLeast, type Role } from "@/types/auth";
import {
  ChemistryWidget,
  ChlorinatorWidget,
  HealthWidget,
  PumpWidget,
  QuickTogglesWidget,
  SchedulesWidget,
  WeatherWidget,
} from "./widgets";
import { WaterWidget } from "./water-widget";

export interface WidgetDef {
  id: string;
  title: string;
  minRole: Role;
  component: React.ComponentType;
  /** Grid columns at md+ (1 or 2). */
  defaultWide: boolean;
  /** System-scan gate: hide when the installation lacks this equipment. */
  needs?: (caps: SystemCapabilities) => boolean;
}

const WIDGETS: WidgetDef[] = [
  { id: "toggles", title: "Quick controls", minRole: "guest", component: QuickTogglesWidget, defaultWide: false },
  { id: "pump", title: "Pump", minRole: "family", component: PumpWidget, defaultWide: false, needs: (c) => c.hasPump },
  { id: "chlorinator", title: "Chlorinator & salt", minRole: "family", component: ChlorinatorWidget, defaultWide: false, needs: (c) => c.hasChlorinator },
  { id: "weather", title: "Weather", minRole: "guest", component: WeatherWidget, defaultWide: false },
  { id: "water", title: "Water level", minRole: "family", component: WaterWidget, defaultWide: false },
  { id: "schedules", title: "Coming up", minRole: "family", component: SchedulesWidget, defaultWide: false },
  { id: "chemistry", title: "Chemistry", minRole: "family", component: ChemistryWidget, defaultWide: false },
  { id: "health", title: "System health", minRole: "guest", component: HealthWidget, defaultWide: false },
];

interface DashboardLayout {
  order: string[];
  hidden: string[];
  wide: string[];
}

function defaultLayout(role: Role): DashboardLayout {
  const visible = WIDGETS.filter((w) => roleAtLeast(role, w.minRole));
  return { order: visible.map((w) => w.id), hidden: [], wide: visible.filter((w) => w.defaultWide).map((w) => w.id) };
}

function SortableWidget({
  id,
  editing,
  wide,
  hidden,
  onToggleWide,
  onToggleHidden,
  children,
}: {
  id: string;
  editing: boolean;
  wide: boolean;
  hidden: boolean;
  onToggleWide: () => void;
  onToggleHidden: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editing });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative",
        wide && "sm:col-span-2",
        isDragging && "z-20 opacity-90",
        editing && "rounded-panel outline-2 outline-dashed outline-accent/30",
        hidden && !editing && "hidden",
        hidden && editing && "opacity-40"
      )}
    >
      {editing && (
        <div className="absolute -top-2.5 right-2 z-10 flex items-center gap-1">
          <button
            onClick={onToggleHidden}
            className={cn("rounded-lg border border-line bg-deep p-1.5", hidden ? "text-danger" : "text-ink-dim")}
            aria-label={hidden ? "Show widget" : "Hide widget"}
          >
            <EyeOff size={13} />
          </button>
          <button
            onClick={onToggleWide}
            className="rounded-lg border border-line bg-deep p-1.5 text-ink-dim hidden sm:block"
            aria-label={wide ? "Make narrow" : "Make wide"}
          >
            {wide ? <Shrink size={13} /> : <Expand size={13} />}
          </button>
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab touch-none rounded-lg border border-line bg-deep p-1.5 text-accent active:cursor-grabbing"
            aria-label="Drag to reorder"
          >
            <GripVertical size={13} />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

export function WidgetGrid(): React.JSX.Element {
  const { user, snapshot, hasLoaded } = usePool();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<DashboardLayout>(() => defaultLayout(user.role));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  const { data: prefsData } = useQuery({
    queryKey: ["prefs"],
    queryFn: () => apiGet<{ prefs: { dashboard?: DashboardLayout } }>("/api/settings/prefs"),
    staleTime: Infinity,
  });

  useEffect(() => {
    const stored = prefsData?.prefs.dashboard;
    if (stored && Array.isArray(stored.order)) {
      const known = new Set(WIDGETS.map((w) => w.id));
      const order = stored.order.filter((id) => known.has(id));
      for (const w of WIDGETS) if (!order.includes(w.id)) order.push(w.id);
      setLayout({ order, hidden: (stored.hidden ?? []).filter((id) => known.has(id)), wide: (stored.wide ?? []).filter((id) => known.has(id)) });
    }
  }, [prefsData]);

  const caps = deriveCapabilities(snapshot, hasLoaded);
  const allowed = useMemo(
    () =>
      new Set(
        WIDGETS.filter(
          (w) => roleAtLeast(user.role, w.minRole) && (!caps.known || !w.needs || w.needs(caps))
        ).map((w) => w.id)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user.role, caps.known, caps.hasPump, caps.hasChlorinator]
  );
  const ordered = layout.order.filter((id) => allowed.has(id));

  const persist = (next: DashboardLayout): void => {
    setLayout(next);
    void apiSend("PUT", "/api/settings/prefs", { dashboard: next }).then(() =>
      queryClient.setQueryData(["prefs"], (old: { prefs: Record<string, unknown> } | undefined) =>
        old ? { prefs: { ...old.prefs, dashboard: next } } : old
      )
    );
  };

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ordered.indexOf(String(active.id));
    const newIndex = ordered.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    persist({ ...layout, order: arrayMove(ordered, oldIndex, newIndex) });
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold tracking-[0.16em] text-ink-faint uppercase">At a glance</h2>
        <Button
          variant={editing ? "primary" : "ghost"}
          size="sm"
          onClick={() => setEditing((e) => !e)}
        >
          {editing ? (
            <>
              <Check size={14} /> Done
            </>
          ) : (
            <>
              <LayoutGrid size={14} /> Customize
            </>
          )}
        </Button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ordered} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ordered.map((id) => {
              const def = WIDGETS.find((w) => w.id === id);
              if (!def) return null;
              const Comp = def.component;
              return (
                <SortableWidget
                  key={id}
                  id={id}
                  editing={editing}
                  wide={layout.wide.includes(id)}
                  hidden={layout.hidden.includes(id)}
                  onToggleWide={() =>
                    persist({
                      ...layout,
                      wide: layout.wide.includes(id) ? layout.wide.filter((x) => x !== id) : [...layout.wide, id],
                    })
                  }
                  onToggleHidden={() =>
                    persist({
                      ...layout,
                      hidden: layout.hidden.includes(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id],
                    })
                  }
                >
                  <Comp />
                </SortableWidget>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
