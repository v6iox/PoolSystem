import type { AutomationDef, AutomationTrigger, PoolAction } from "@/types/actions";

export interface AutomationRow {
  id: number;
  name: string;
  trigger: string;
  actions: string;
  enabled: number;
  created_by: number | null;
  created_via: "ui" | "copilot";
  last_run_at: number | null;
  last_result: string | null;
  creator_name: string | null;
}

export function rowToDef(row: AutomationRow): AutomationDef {
  return {
    id: row.id,
    name: row.name,
    trigger: JSON.parse(row.trigger) as AutomationTrigger,
    actions: JSON.parse(row.actions) as PoolAction[],
    enabled: row.enabled === 1,
    createdBy: row.created_by,
    createdByName: row.creator_name ?? "system",
    createdVia: row.created_via,
    lastRunAt: row.last_run_at,
    lastResult: row.last_result,
  };
}
