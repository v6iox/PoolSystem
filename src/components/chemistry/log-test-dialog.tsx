"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PLAUSIBLE_BOUNDS, type ReadingField } from "@/components/chemistry/chem-shared";

/** Manual test-kit entry → POST /api/chemistry. Any subset of fields is fine. */

interface FieldDef {
  key: ReadingField;
  label: string;
  unit: string;
  step: string;
  placeholder: string;
}

const FIELD_DEFS: FieldDef[] = [
  { key: "ph", label: "pH", unit: "", step: "0.1", placeholder: "7.5" },
  { key: "fc", label: "Free chlorine", unit: "ppm", step: "0.5", placeholder: "3" },
  { key: "ta", label: "Alkalinity", unit: "ppm", step: "10", placeholder: "100" },
  { key: "cya", label: "CYA", unit: "ppm", step: "5", placeholder: "40" },
  { key: "ch", label: "Calcium", unit: "ppm", step: "25", placeholder: "300" },
  { key: "salt", label: "Salt", unit: "ppm", step: "100", placeholder: "3200" },
  { key: "orp", label: "ORP · optional", unit: "mV", step: "10", placeholder: "700" },
];

const EMPTY_VALUES: Record<ReadingField, string> = { ph: "", orp: "", fc: "", ta: "", cya: "", ch: "", salt: "" };

const fieldName = (field: string): string => (field === "ph" ? "pH" : field.toUpperCase());

function LogTestForm({ close }: { close: () => void }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<ReadingField, string>>(EMPTY_VALUES);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const parsed = FIELD_DEFS.map((def) => {
    const raw = values[def.key].trim();
    const num = raw === "" ? null : Number(raw);
    const [lo, hi] = PLAUSIBLE_BOUNDS[def.key];
    const invalid = num !== null && (!Number.isFinite(num) || num < lo || num > hi);
    return { def, num, invalid, filled: raw !== "" };
  });

  const filledCount = parsed.filter((p) => p.filled && !p.invalid).length;
  const canSave = filledCount > 0 && !parsed.some((p) => p.invalid) && !saving;

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    const body: Partial<Record<ReadingField, number>> & { notes?: string } = {};
    for (const p of parsed) {
      if (p.filled && !p.invalid && p.num !== null) body[p.def.key] = p.num;
    }
    if (notes.trim() !== "") body.notes = notes.trim();
    try {
      const res = await apiSend<{ ok: boolean; id: number; outOfRange: string[] }>("POST", "/api/chemistry", body);
      toast("success", "Test logged", `${filledCount} ${filledCount === 1 ? "value" : "values"} recorded.`);
      if (res.outOfRange.length > 0) {
        toast(
          "info",
          "Out of ideal range",
          `${res.outOfRange.map(fieldName).join(" · ")} — see dosing suggestions.`
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chemistry"] }),
        queryClient.invalidateQueries({ queryKey: ["chem-latest"] }),
      ]);
      close();
    } catch (err) {
      toast("error", "Couldn't log the test", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {FIELD_DEFS.map(({ key, label, unit, step, placeholder }) => {
          const entry = parsed.find((p) => p.def.key === key);
          const [lo, hi] = PLAUSIBLE_BOUNDS[key];
          return (
            <Field key={key} label={unit ? `${label} · ${unit}` : label} hint={entry?.invalid ? `Must be ${lo}–${hi}` : undefined}>
              <Input
                type="number"
                inputMode="decimal"
                min={lo}
                max={hi}
                step={step}
                placeholder={placeholder}
                value={values[key]}
                onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                aria-label={label}
                className={cn(entry?.invalid && "border-warn/60")}
              />
            </Field>
          );
        })}
      </div>

      <div>
        <Label htmlFor="chem-notes">Notes</Label>
        <textarea
          id="chem-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Cloudy after the storm, backwashed filter…"
          maxLength={2000}
          className="min-h-[72px] w-full resize-y rounded-xl border border-line bg-abyss/50 px-3.5 py-2.5 text-sm text-ink transition-colors placeholder:text-ink-faint focus:border-accent/50 focus:ring-2 focus:ring-accent/20 focus:outline-none"
        />
      </div>

      <p className="text-xs text-ink-faint">Leave anything you didn&apos;t test blank — log at least one value.</p>

      <div className="flex items-center justify-end gap-2 pt-1">
        <DialogClose asChild>
          <Button variant="ghost" size="md">
            Cancel
          </Button>
        </DialogClose>
        <Button variant="primary" size="md" disabled={!canSave} onClick={() => void save()}>
          <FlaskConical size={15} /> {saving ? "Logging…" : "Log test"}
        </Button>
      </div>
    </div>
  );
}

export function LogTestDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent title="Log a water test" description="Straight from the test kit — every field is optional." wide>
          <LogTestForm close={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}
