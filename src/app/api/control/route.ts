import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { executeAction, executeActions, createScheduledJob } from "@/server/control";
import type { PoolAction } from "@/types/actions";

export const dynamic = "force-dynamic";

interface ControlBody {
  action?: PoolAction;
  actions?: PoolAction[];
  /** Optional: also schedule these actions to run later (epoch ms). */
  followUp?: { actions: PoolAction[]; at: number; label?: string };
}

/**
 * The single control endpoint. Guests are allowed in — per-action role rules
 * are enforced inside the control layer (guest-visible circuits/scenes only).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("guest");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as ControlBody | null;
  if (!body || (!body.action && !Array.isArray(body.actions))) {
    return NextResponse.json({ error: "Provide an action or actions[]" }, { status: 400 });
  }
  const ctx = {
    userId: auth.user.id,
    userName: auth.user.name,
    role: auth.user.role,
    source: "ui" as const,
  };
  const results = body.action
    ? [await executeAction(body.action, ctx)]
    : await executeActions(body.actions ?? [], ctx);

  let jobId: number | null = null;
  if (body.followUp && results.every((r) => r.ok)) {
    if (!Number.isFinite(body.followUp.at) || body.followUp.at <= Date.now()) {
      return NextResponse.json({ error: "followUp.at must be in the future" }, { status: 400 });
    }
    jobId = createScheduledJob({
      label: body.followUp.label ?? "follow-up",
      actions: body.followUp.actions,
      fireAt: body.followUp.at,
      ctx,
    });
  }

  const failed = results.filter((r) => !r.ok);
  return NextResponse.json(
    { ok: failed.length === 0, results, jobId },
    { status: failed.length === 0 ? 200 : 422 }
  );
}
