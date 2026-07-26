/** Client-side shapes for the copilot API (mirrors src/server/copilot/engine.ts DTOs). */

export type PlanState = "pending" | "confirmed" | "cancelled" | "executed" | "error";

export interface CopilotPlan {
  summary: string[];
  note?: string;
  /** Weather-aware cautions ("rain tomorrow 3–4 PM") shown before confirming. */
  advisories?: string[];
  results?: string[];
}

export interface CopilotMessage {
  id: number;
  threadId: number;
  role: "user" | "assistant";
  content: string;
  plan: CopilotPlan | null;
  planState: PlanState | null;
  createdAt: number;
}

export interface CopilotThread {
  id: number;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export const SUGGESTIONS = [
  "Warm the spa to 102",
  "What's the salt level?",
  "Lights blue at sunset every Friday",
  "Everything off",
] as const;
