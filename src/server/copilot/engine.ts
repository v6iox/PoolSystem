import { getDb, now } from "@/server/db";
import { getRuntime } from "@/server/runtime";
import { audit } from "@/server/audit";
import { createScheduledJob, executeActions, type ActionContext } from "@/server/control";
import { reloadAutomations } from "@/server/automations/worker";
import { formatClock, formatDays, formatMinutes, formatRelative } from "@/lib/utils";
import type { SessionUser } from "@/types/auth";
import type { Role } from "@/types/auth";
import type { AutomationTrigger, PoolAction } from "@/types/actions";
import { CopilotBackendError } from "./llm";
import { parseWithProvider } from "./provider";
import { isGreeting } from "./mock-parser";
import {
  describeToolCall,
  describeTrigger,
  isReadOnlyTool,
  parseHHMM,
  resolveAt,
  toolCallToActions,
  validateToolCall,
  type AutomationLite,
  type CopilotContext,
  type SceneLite,
  type StatusScope,
  type ToolCall,
} from "./tools";

/**
 * The copilot engine: builds a plan (mock parser in MOCK_MODE, LLM otherwise),
 * answers read-only tools immediately from live data, persists state-changing
 * plans for explicit confirmation, and executes confirmed plans through the
 * same validated control layer as everything else. Every reply the user sees
 * is template-generated from real state/results — the LLM never writes it.
 */

export type PlanState = "pending" | "confirmed" | "cancelled" | "executed" | "error";

export interface PlanDto {
  summary: string[];
  note?: string;
  /** Weather-aware cautions shown on the confirm card ("rain tomorrow 3–4 PM"). */
  advisories?: string[];
  results?: string[];
}

interface StoredPlan extends PlanDto {
  calls: ToolCall[];
}

export interface CopilotMessageDto {
  id: number;
  threadId: number;
  role: "user" | "assistant";
  content: string;
  plan: PlanDto | null;
  planState: PlanState | null;
  createdAt: number;
}

export interface ThreadDto {
  id: number;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/* ── rows ───────────────────────────────────────────────────────────────── */

interface MessageRow {
  id: number;
  thread_id: number;
  role: "user" | "assistant";
  content: string;
  plan: string | null;
  plan_state: PlanState | null;
  created_at: number;
}

interface ThreadRow {
  id: number;
  user_id: number;
  title: string;
  created_at: number;
  updated_at: number;
}

function rowToDto(row: MessageRow): CopilotMessageDto {
  let plan: PlanDto | null = null;
  if (row.plan) {
    try {
      const stored = JSON.parse(row.plan) as StoredPlan;
      plan = {
        summary: stored.summary,
        ...(stored.note ? { note: stored.note } : {}),
        ...(stored.advisories && stored.advisories.length > 0 ? { advisories: stored.advisories } : {}),
        ...(stored.results ? { results: stored.results } : {}),
      };
    } catch {
      plan = null;
    }
  }
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    content: row.content,
    plan,
    planState: row.plan_state,
    createdAt: row.created_at,
  };
}

/* ── threads ────────────────────────────────────────────────────────────── */

export function listThreads(userId: number): ThreadDto[] {
  const rows = getDb()
    .prepare("SELECT * FROM copilot_threads WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100")
    .all(userId) as ThreadRow[];
  return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }));
}

export function createThread(userId: number, title?: string): ThreadDto {
  const at = now();
  const res = getDb()
    .prepare("INSERT INTO copilot_threads (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(userId, title && title.trim() ? title.trim().slice(0, 60) : "New chat", at, at);
  return { id: Number(res.lastInsertRowid), title: title?.trim().slice(0, 60) || "New chat", createdAt: at, updatedAt: at };
}

export function getThreadForUser(threadId: number, userId: number): ThreadDto | null {
  const row = getDb().prepare("SELECT * FROM copilot_threads WHERE id = ?").get(threadId) as ThreadRow | undefined;
  if (!row || row.user_id !== userId) return null;
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function listMessages(threadId: number): CopilotMessageDto[] {
  const rows = getDb()
    .prepare("SELECT * FROM copilot_messages WHERE thread_id = ? ORDER BY id LIMIT 500")
    .all(threadId) as MessageRow[];
  return rows.map(rowToDto);
}

/* ── context ────────────────────────────────────────────────────────────── */

function buildContext(role: Role, threadId: number): CopilotContext {
  const db = getDb();
  const snapshot = getRuntime().getSnapshotForRole(role);
  const sceneRows = db.prepare("SELECT id, name, guest_visible FROM scenes ORDER BY position, id").all() as Array<{
    id: number;
    name: string;
    guest_visible: number;
  }>;
  const scenes: SceneLite[] = sceneRows
    .map((r) => ({ id: r.id, name: r.name, guestVisible: r.guest_visible === 1 }))
    .filter((s) => role !== "guest" || s.guestVisible);
  const autoRows = db.prepare("SELECT id, name, enabled, trigger FROM automations ORDER BY id").all() as Array<{
    id: number;
    name: string;
    enabled: number;
    trigger: string;
  }>;
  const automations: AutomationLite[] = autoRows.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled === 1,
    trigger: JSON.parse(r.trigger) as AutomationTrigger,
  }));
  const guestRows = db.prepare("SELECT circuit_id FROM circuit_meta WHERE guest_visible = 1").all() as Array<{
    circuit_id: number;
  }>;
  const pendingRow = db
    .prepare("SELECT id, plan FROM copilot_messages WHERE thread_id = ? AND plan_state = 'pending' ORDER BY id DESC LIMIT 1")
    .get(threadId) as { id: number; plan: string | null } | undefined;
  let pendingPlan: CopilotContext["pendingPlan"] = null;
  if (pendingRow?.plan) {
    try {
      const stored = JSON.parse(pendingRow.plan) as StoredPlan;
      pendingPlan = { messageId: pendingRow.id, summary: stored.summary };
    } catch {
      pendingPlan = null;
    }
  }
  return { snapshot, scenes, automations, pendingPlan, role, guestVisibleCircuitIds: new Set(guestRows.map((r) => r.circuit_id)) };
}

/* ── template status replies (real data, no LLM) ────────────────────────── */

interface ChemRow {
  at: number;
  ph: number | null;
  orp: number | null;
  fc: number | null;
  ta: number | null;
  cya: number | null;
  ch: number | null;
  salt: number | null;
}

function latestChemReading(): ChemRow | null {
  const row = getDb().prepare("SELECT * FROM chemistry_readings ORDER BY at DESC LIMIT 1").get() as ChemRow | undefined;
  return row ?? null;
}

function chemPairs(row: ChemRow): string {
  const parts: string[] = [];
  if (row.ph !== null) parts.push(`pH ${row.ph}`);
  if (row.fc !== null) parts.push(`FC ${row.fc}`);
  if (row.ta !== null) parts.push(`TA ${row.ta}`);
  if (row.cya !== null) parts.push(`CYA ${row.cya}`);
  if (row.ch !== null) parts.push(`CH ${row.ch}`);
  if (row.orp !== null) parts.push(`ORP ${row.orp}`);
  if (row.salt !== null) parts.push(`salt ${row.salt} ppm`);
  return parts.join(", ");
}

function tempsReply(ctx: CopilotContext): string {
  const snap = ctx.snapshot;
  const deg = `°${snap.units}`;
  if (snap.bodies.length === 0) return "No bodies of water are reported right now.";
  const lines = snap.bodies.map((b) => {
    const temp = b.temp !== null ? `${Math.round(b.temp * 10) / 10}${deg}` : "no reading";
    const heat =
      b.heatStatus !== "off"
        ? `heating (${b.heatStatus}) toward ${b.setPoint}${deg}`
        : b.heatMode !== "off"
          ? `heat ${b.heatMode === "solarpref" ? "solar preferred" : b.heatMode}, idle at target ${b.setPoint}${deg}`
          : `heat off, target ${b.setPoint}${deg}`;
    return `${b.name} is ${temp} — ${heat}.`;
  });
  if (snap.airTemp !== null) lines.push(`Air is ${Math.round(snap.airTemp)}${deg}.`);
  return lines.join("\n");
}

function circuitsReply(ctx: CopilotContext): string {
  const all = [...ctx.snapshot.circuits, ...ctx.snapshot.features];
  if (all.length === 0) {
    return ctx.role === "guest" ? "No circuits are shared with guest accounts yet." : "No circuits reported.";
  }
  const on = all.filter((c) => c.isOn);
  if (on.length === 0) return `Everything is off right now (${all.length} circuit${all.length === 1 ? "" : "s"}).`;
  const off = all.length - on.length;
  return `On right now: ${on.map((c) => c.name).join(", ")}.${off > 0 ? ` The other ${off} circuit${off === 1 ? " is" : "s are"} off.` : ""}`;
}

function chemistryReply(ctx: CopilotContext): string {
  if (ctx.role === "guest") return "Chemistry isn't shared with guest accounts.";
  const chlor = ctx.snapshot.chlorinators[0];
  const last = latestChemReading();
  const lines: string[] = [];
  if (chlor) {
    lines.push(
      `Salt is ${chlor.saltLevel} ppm${chlor.saltRequired ? " — that's low, time to add salt" : " (healthy)"}. ${chlor.name} is ${
        chlor.superChlor
          ? "super-chlorinating"
          : chlor.isActive
            ? `at ${chlor.currentOutput}% output (pool setpoint ${chlor.poolSetpoint}%)`
            : `on standby (pool setpoint ${chlor.poolSetpoint}%)`
      }.`
    );
  }
  if (last) lines.push(`Last water test ${formatRelative(last.at)}: ${chemPairs(last)}.`);
  if (lines.length === 0) return "No chemistry data yet — tell me a reading like “ph 7.6 ta 90” and I'll log it.";
  return lines.join("\n");
}

function equipmentReply(ctx: CopilotContext): string {
  const snap = ctx.snapshot;
  const lines: string[] = [];
  for (const p of snap.pumps) {
    lines.push(`${p.name}: ${p.isRunning ? `running at ${p.rpm} RPM, drawing ${p.watts} W` : "off"}.`);
  }
  const chlor = snap.chlorinators[0];
  if (chlor) lines.push(`${chlor.name}: ${chlor.superChlor ? "super-chlorinating" : chlor.isActive ? `${chlor.currentOutput}% output` : "standby"}.`);
  for (const b of snap.bodies) {
    lines.push(`${b.name} heat: ${b.heatStatus !== "off" ? `firing (${b.heatStatus})` : b.heatMode === "off" ? "off" : `${b.heatMode}, idle`}.`);
  }
  lines.push(
    `Panel: ${snap.panelMode}${snap.freezeProtect ? " — freeze protection ACTIVE" : ""}${snap.delay ? ", in a delay" : ""}.${snap.equipment.model ? ` (${snap.equipment.model})` : ""}`
  );
  if (lines.length === 1 && ctx.role === "guest") return "Equipment details aren't shared with guest accounts.";
  return lines.join("\n");
}

function overallReply(ctx: CopilotContext): string {
  const snap = ctx.snapshot;
  const deg = `°${snap.units}`;
  const lines: string[] = ["Here's the pool right now:"];
  for (const b of snap.bodies) {
    lines.push(
      `• ${b.name}: ${b.temp !== null ? `${Math.round(b.temp * 10) / 10}${deg}` : "—"}${b.heatStatus !== "off" ? ` (heating to ${b.setPoint}${deg})` : ""}`
    );
  }
  const on = [...snap.circuits, ...snap.features].filter((c) => c.isOn);
  lines.push(on.length > 0 ? `• On: ${on.map((c) => c.name).join(", ")}` : "• Everything is off");
  const chlor = snap.chlorinators[0];
  if (chlor) lines.push(`• Salt ${chlor.saltLevel} ppm${chlor.saltRequired ? " (low)" : ""}`);
  if (ctx.role !== "guest" && ctx.automations.length > 0) {
    const active = ctx.automations.filter((a) => a.enabled).length;
    lines.push(`• ${ctx.automations.length} automation${ctx.automations.length === 1 ? "" : "s"} (${active} active)`);
  }
  if (lines.length === 1) return "I can't see any pool state right now — the controller may be offline.";
  return lines.join("\n");
}

function statusReply(scope: StatusScope, ctx: CopilotContext): string {
  switch (scope) {
    case "temps":
      return tempsReply(ctx);
    case "circuits":
      return circuitsReply(ctx);
    case "chemistry":
      return chemistryReply(ctx);
    case "equipment":
      return equipmentReply(ctx);
    case "all":
      return overallReply(ctx);
  }
}

function automationsReply(ctx: CopilotContext): string {
  if (ctx.automations.length === 0) {
    return "No automations yet. Try something like “lights blue at sunset every Friday” and I'll set one up.";
  }
  const lines = ctx.automations.map(
    (a, i) => `${i + 1}. “${a.name}” — ${describeTrigger(a.trigger)}${a.enabled ? "" : " (paused)"}`
  );
  return `You have ${ctx.automations.length} automation${ctx.automations.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}

function schedulesReply(ctx: CopilotContext): string {
  const schedules = ctx.snapshot.schedules;
  if (schedules.length === 0) return "There are no panel schedules yet — tell me something like “run the cleaner 9:00 to 11:00 on weekdays” and I'll set one up.";
  const lines = schedules.map(
    (s) =>
      `#${s.id} ${s.circuitName} — ${formatMinutes(s.startTime)}–${formatMinutes(s.endTime)} · ${formatDays(s.days)}${s.disabled ? " (disabled)" : s.isActive ? " (running now)" : ""}`
  );
  return `Panel schedules (these run in the panel itself):\n${lines.map((l) => `• ${l}`).join("\n")}`;
}

function runReadTool(call: ToolCall, ctx: CopilotContext): string {
  if (call.tool === "get_status") return statusReply(call.args.scope ?? "all", ctx);
  if (call.tool === "list_automations") return automationsReply(ctx);
  if (call.tool === "list_schedules") return schedulesReply(ctx);
  return "";
}

const UNKNOWN_REPLY =
  "I didn't quite get that. I can control circuits, heat, lights, the chlorinator, scenes and automations — try “warm the spa a bit”, “everything off”, “lights blue at sunset every Friday”, or ask “what's the salt at?”.";

/* ── message persistence helpers ────────────────────────────────────────── */

function insertMessage(
  threadId: number,
  role: "user" | "assistant",
  content: string,
  plan?: StoredPlan,
  planState?: PlanState
): CopilotMessageDto {
  const at = now();
  const res = getDb()
    .prepare("INSERT INTO copilot_messages (thread_id, role, content, plan, plan_state, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(threadId, role, content, plan ? JSON.stringify(plan) : null, planState ?? null, at);
  getDb().prepare("UPDATE copilot_threads SET updated_at = ? WHERE id = ?").run(at, threadId);
  return {
    id: Number(res.lastInsertRowid),
    threadId,
    role,
    content,
    plan: plan
      ? {
          summary: plan.summary,
          ...(plan.note ? { note: plan.note } : {}),
          ...(plan.advisories && plan.advisories.length > 0 ? { advisories: plan.advisories } : {}),
        }
      : null,
    planState: planState ?? null,
    createdAt: at,
  };
}

/* ── main entry: one user message in, user+assistant rows out ───────────── */

export async function processMessage(
  user: SessionUser,
  threadId: number,
  text: string
): Promise<{ messages: CopilotMessageDto[] }> {
  const db = getDb();
  const trimmed = text.trim().slice(0, 2000);
  const userMsg = insertMessage(threadId, "user", trimmed);

  // Name new threads after their first message.
  const threadRow = db.prepare("SELECT title FROM copilot_threads WHERE id = ?").get(threadId) as { title: string } | undefined;
  if (threadRow && (threadRow.title === "New chat" || threadRow.title.trim() === "")) {
    db.prepare("UPDATE copilot_threads SET title = ? WHERE id = ?").run(trimmed.slice(0, 48), threadId);
  }

  const ctx = buildContext(user.role, threadId);

  let rawCalls: unknown[] = [];
  let note: string | undefined;
  let chatReply: string | undefined;
  {
    try {
      // Dispatches to the configured brain: local Ollama / OpenAI API key /
      // ChatGPT sign-in — or the deterministic parser in MOCK_MODE.
      const parsed = await parseWithProvider(trimmed, ctx);
      rawCalls = parsed.calls;
      note = parsed.note;
      chatReply = parsed.reply;
      // Deterministic guard: plain greetings/small talk can never carry
      // actions, whatever a small model hallucinates. Keep its reply, drop
      // any phantom tool calls.
      if (rawCalls.length > 0 && isGreeting(trimmed.toLowerCase())) {
        rawCalls = [];
      }
    } catch (err) {
      const detail = err instanceof CopilotBackendError ? err.message : "copilot backend unreachable";
      const assistant = insertMessage(
        threadId,
        "assistant",
        `I couldn't reach the copilot backend (${detail}). Everything else in Moonpool still works — check that your LLM server is running and COPILOT_BASE_URL points at it, then try me again.`
      );
      return { messages: [userMsg, assistant] };
    }
  }

  if (rawCalls.length === 0) {
    // No action to take: a conversational LLM reply (greeting/small talk)
    // beats the canned fallback. Facts/actions never come from chatReply.
    return { messages: [userMsg, insertMessage(threadId, "assistant", chatReply ?? note ?? UNKNOWN_REPLY)] };
  }

  // Special intent: cancel the newest pending plan in this thread.
  const firstRaw = rawCalls[0] as { tool?: unknown } | undefined;
  if (firstRaw?.tool === "cancel_pending") {
    if (!ctx.pendingPlan) {
      return { messages: [userMsg, insertMessage(threadId, "assistant", "There's nothing pending to cancel — you're all clear.")] };
    }
    db.prepare("UPDATE copilot_messages SET plan_state = 'cancelled' WHERE id = ? AND plan_state = 'pending'").run(
      ctx.pendingPlan.messageId
    );
    const what = ctx.pendingPlan.summary.join("; ");
    return {
      messages: [userMsg, insertMessage(threadId, "assistant", `Okay, cancelled — I won't ${what ? `do this: ${what}` : "run that plan"}.`)],
    };
  }

  // Validate everything up front; a friendly refusal beats a half-run plan.
  const validated: ToolCall[] = [];
  const problems: string[] = [];
  for (const raw of rawCalls.slice(0, 10)) {
    const v = validateToolCall(raw, ctx);
    if (v.ok) validated.push(v.call);
    else problems.push(v.error);
  }
  if (problems.length > 0) {
    const content = problems.length === 1 ? (problems[0] as string) : `A few problems with that:\n${problems.map((p) => `• ${p}`).join("\n")}`;
    return { messages: [userMsg, insertMessage(threadId, "assistant", content)] };
  }

  const reads = validated.filter((c) => isReadOnlyTool(c.tool));
  const writes = validated.filter((c) => !isReadOnlyTool(c.tool) && c.tool !== "cancel_pending");
  const readTexts = reads.map((c) => runReadTool(c, ctx));

  // Pure read → answer immediately with live data.
  if (writes.length === 0) {
    // Facts come from templates over live data; the model may add a short
    // conversational lead-in on top.
    const factBody = readTexts.join("\n\n");
    const answer = factBody ? (chatReply ? `${chatReply}\n\n${factBody}` : factBody) : (chatReply ?? UNKNOWN_REPLY);
    return { messages: [userMsg, insertMessage(threadId, "assistant", answer)] };
  }

  // State-changing → persist a pending plan and ask for confirmation.
  const summary = writes.map((c) => describeToolCall(c, ctx));

  // Weather-aware confirmations: heat-raising steps get forecast context
  // ("Rain is forecast tomorrow 3–4 PM") right on the confirm card.
  const advisories: string[] = [];
  for (const call of writes) {
    if (call.tool !== "set_heat") continue;
    const args = call.args;
    const turnsOn = args.mode !== undefined && args.mode !== "off";
    const raises = args.setpoint !== undefined;
    if (!turnsOn && !raises) continue;
    try {
      const { heatAdvisories } = await import("@/server/weather");
      for (const a of await heatAdvisories(args.body, args.setpoint)) {
        if (!advisories.includes(a.message)) advisories.push(a.message);
      }
    } catch {
      // advisory lookup must never block a plan
    }
  }

  const plan: StoredPlan = {
    calls: writes,
    summary,
    ...(note ? { note } : {}),
    ...(advisories.length > 0 ? { advisories } : {}),
  };
  const intro =
    chatReply ??
    (writes.length === 1 ? "Here's what I'll do — confirm and I'm on it:" : `Here's the plan (${writes.length} steps) — confirm and I'm on it:`);
  const content = readTexts.length > 0 ? `${readTexts.join("\n\n")}\n\n${intro}` : intro;
  const assistant = insertMessage(threadId, "assistant", content, plan, "pending");
  return { messages: [userMsg, assistant] };
}

/* ── plan execution (confirm / cancel) ──────────────────────────────────── */

async function executeToolCall(
  call: ToolCall,
  actionCtx: ActionContext,
  ctx: CopilotContext
): Promise<{ ok: boolean; line: string }> {
  const db = getDb();
  switch (call.tool) {
    case "get_status":
    case "list_automations":
    case "list_schedules":
      return { ok: true, line: runReadTool(call, ctx) };

    case "create_schedule": {
      const start = parseHHMM(call.args.start);
      const end = parseHHMM(call.args.end);
      if (start === null || end === null) return { ok: false, line: "Failed: schedule times must be HH:MM." };
      const days = call.args.days.length > 0 ? call.args.days : [0, 1, 2, 3, 4, 5, 6];
      try {
        await getRuntime().adapter.upsertSchedule({
          circuitId: call.args.circuitId,
          startTime: start,
          endTime: end,
          days,
          scheduleType: "repeat",
        });
        audit({
          userId: actionCtx.userId,
          userName: actionCtx.userName,
          source: "copilot",
          action: "createSchedule",
          target: `circuit ${call.args.circuitId}`,
          newValue: `${call.args.start}–${call.args.end} days ${days.join(",")}`,
        });
        return { ok: true, line: describeToolCall(call, ctx) };
      } catch (err) {
        return { ok: false, line: `Failed: ${err instanceof Error ? err.message : "couldn't write the schedule"}` };
      }
    }

    case "delete_schedule": {
      try {
        await getRuntime().adapter.deleteSchedule(call.args.id);
        audit({
          userId: actionCtx.userId,
          userName: actionCtx.userName,
          source: "copilot",
          action: "deleteSchedule",
          target: `schedule ${call.args.id}`,
        });
        return { ok: true, line: describeToolCall(call, ctx) };
      } catch (err) {
        return { ok: false, line: `Failed: ${err instanceof Error ? err.message : "couldn't delete the schedule"}` };
      }
    }

    case "schedule_once": {
      const fireAt = resolveAt(call.args.at);
      if (fireAt === null || fireAt <= Date.now()) {
        return { ok: false, line: `Failed: the time "${call.args.at}" is in the past.` };
      }
      const actions: PoolAction[] = call.args.actions.flatMap((inner) => toolCallToActions(inner, ctx));
      if (actions.length === 0) return { ok: false, line: "Failed: nothing to schedule." };
      const label = call.args.actions.map((inner) => describeToolCall(inner, ctx)).join("; ");
      createScheduledJob({ label: label.slice(0, 120), actions, fireAt, ctx: actionCtx });
      return { ok: true, line: `Scheduled for ${formatClock(fireAt)}: ${label}` };
    }

    case "create_automation": {
      const actions: PoolAction[] = call.args.actions.flatMap((inner) => toolCallToActions(inner, ctx));
      if (actions.length === 0) return { ok: false, line: "Failed: the automation had no runnable actions." };
      db.prepare(
        "INSERT INTO automations (name, trigger, actions, enabled, created_by, created_via, created_at) VALUES (?, ?, ?, 1, ?, 'copilot', ?)"
      ).run(call.args.name, JSON.stringify(call.args.trigger), JSON.stringify(actions), actionCtx.userId, now());
      reloadAutomations();
      audit({
        userId: actionCtx.userId,
        userName: actionCtx.userName,
        source: "copilot",
        action: "createAutomation",
        target: call.args.name,
        newValue: describeTrigger(call.args.trigger),
      });
      return { ok: true, line: `Automation “${call.args.name}” is live — ${describeTrigger(call.args.trigger)}.` };
    }

    case "pause_automation":
    case "resume_automation": {
      const enable = call.tool === "resume_automation" ? 1 : 0;
      const name = ctx.automations.find((a) => a.id === call.args.id)?.name ?? `automation ${call.args.id}`;
      const res = db.prepare("UPDATE automations SET enabled = ? WHERE id = ?").run(enable, call.args.id);
      if (res.changes === 0) return { ok: false, line: `Failed: automation “${name}” no longer exists.` };
      reloadAutomations();
      audit({
        userId: actionCtx.userId,
        userName: actionCtx.userName,
        source: "copilot",
        action: enable ? "resumeAutomation" : "pauseAutomation",
        target: name,
      });
      return { ok: true, line: `${enable ? "Resumed" : "Paused"} “${name}”.` };
    }

    case "delete_automation": {
      const name = ctx.automations.find((a) => a.id === call.args.id)?.name ?? `automation ${call.args.id}`;
      const res = db.prepare("DELETE FROM automations WHERE id = ?").run(call.args.id);
      if (res.changes === 0) return { ok: false, line: `Failed: automation “${name}” no longer exists.` };
      reloadAutomations();
      audit({ userId: actionCtx.userId, userName: actionCtx.userName, source: "copilot", action: "deleteAutomation", target: name });
      return { ok: true, line: `Deleted “${name}”.` };
    }

    case "log_chemistry": {
      const r = call.args.readings;
      db.prepare(
        `INSERT INTO chemistry_readings (at, body_id, ph, orp, fc, ta, cya, ch, salt, notes, user_id)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 'via copilot', ?)`
      ).run(now(), r.ph ?? null, r.orp ?? null, r.fc ?? null, r.ta ?? null, r.cya ?? null, r.ch ?? null, r.salt ?? null, actionCtx.userId);
      const pairs = Object.entries(r)
        .map(([k, v]) => `${k === "ph" ? "pH" : k.toUpperCase()} ${v}`)
        .join(", ");
      audit({
        userId: actionCtx.userId,
        userName: actionCtx.userName,
        source: "copilot",
        action: "logChemistry",
        target: "water test",
        newValue: pairs,
      });
      return { ok: true, line: `Logged your water test: ${pairs}.` };
    }

    case "cancel_pending":
      return { ok: true, line: "Nothing to do." };

    default: {
      // Direct pool actions go through the shared, audited control layer.
      const actions = toolCallToActions(call, ctx);
      if (actions.length === 0) return { ok: false, line: `Failed: couldn't turn “${describeToolCall(call, ctx)}” into an action.` };
      const results = await executeActions(actions, actionCtx);
      const failed = results.filter((x) => !x.ok);
      if (failed.length > 0) {
        return { ok: false, line: `Failed: ${failed.map((f) => f.error ?? f.summary).join("; ")}` };
      }
      return { ok: true, line: results.map((x) => x.summary).join(", ") };
    }
  }
}

function loadPlanMessage(messageId: number, userId: number): { row: MessageRow; thread: ThreadRow } | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM copilot_messages WHERE id = ?").get(messageId) as MessageRow | undefined;
  if (!row) return null;
  const thread = db.prepare("SELECT * FROM copilot_threads WHERE id = ?").get(row.thread_id) as ThreadRow | undefined;
  if (!thread || thread.user_id !== userId) return null;
  return { row, thread };
}

export type PlanActionResult = { ok: true; message: CopilotMessageDto; result: CopilotMessageDto | null } | { ok: false; error: string; status: number };

export async function confirmPlanMessage(user: SessionUser, messageId: number): Promise<PlanActionResult> {
  const db = getDb();
  const loaded = loadPlanMessage(messageId, user.id);
  if (!loaded) return { ok: false, error: "Message not found", status: 404 };
  const { row } = loaded;
  if (row.plan_state !== "pending" || !row.plan) {
    return { ok: false, error: "That plan was already handled", status: 409 };
  }
  let stored: StoredPlan;
  try {
    stored = JSON.parse(row.plan) as StoredPlan;
  } catch {
    return { ok: false, error: "Stored plan is unreadable", status: 500 };
  }
  db.prepare("UPDATE copilot_messages SET plan_state = 'confirmed' WHERE id = ?").run(messageId);

  const ctx = buildContext(user.role, row.thread_id);
  const actionCtx: ActionContext = { userId: user.id, userName: user.name, role: user.role, source: "copilot" };

  const lines: string[] = [];
  let failures = 0;
  for (const call of stored.calls) {
    // Revalidate against fresh state + role before every execution.
    const v = validateToolCall(call, ctx);
    if (!v.ok) {
      lines.push(`Failed: ${v.error}`);
      failures += 1;
      continue;
    }
    try {
      const result = await executeToolCall(v.call, actionCtx, ctx);
      lines.push(result.line);
      if (!result.ok) failures += 1;
    } catch (err) {
      lines.push(`Failed: ${err instanceof Error ? err.message : "unknown error"}`);
      failures += 1;
    }
  }

  const finalState: PlanState = failures === stored.calls.length && stored.calls.length > 0 ? "error" : "executed";
  const updatedPlan: StoredPlan = { ...stored, results: lines };
  db.prepare("UPDATE copilot_messages SET plan_state = ?, plan = ? WHERE id = ?").run(finalState, JSON.stringify(updatedPlan), messageId);

  const content =
    failures === 0
      ? lines.length === 1
        ? `Done — ${lines[0]}`
        : `All set:\n${lines.map((l) => `• ${l}`).join("\n")}`
      : failures === lines.length
        ? `That didn't work:\n${lines.map((l) => `• ${l}`).join("\n")}`
        : `Mostly done, with a hiccup:\n${lines.map((l) => `• ${l}`).join("\n")}`;
  const result = insertMessage(row.thread_id, "assistant", content);

  const updatedRow = db.prepare("SELECT * FROM copilot_messages WHERE id = ?").get(messageId) as MessageRow;
  return { ok: true, message: rowToDto(updatedRow), result };
}

export async function cancelPlanMessage(user: SessionUser, messageId: number): Promise<PlanActionResult> {
  const db = getDb();
  const loaded = loadPlanMessage(messageId, user.id);
  if (!loaded) return { ok: false, error: "Message not found", status: 404 };
  const { row } = loaded;
  if (row.plan_state !== "pending") return { ok: false, error: "That plan was already handled", status: 409 };
  db.prepare("UPDATE copilot_messages SET plan_state = 'cancelled' WHERE id = ?").run(messageId);
  const updatedRow = db.prepare("SELECT * FROM copilot_messages WHERE id = ?").get(messageId) as MessageRow;
  return { ok: true, message: rowToDto(updatedRow), result: null };
}
