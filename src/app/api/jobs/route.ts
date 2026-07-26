import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { createScheduledJob } from "@/server/control";
import { validateActionsShape } from "@/server/validate";
import type { PoolAction } from "@/types/actions";

export const dynamic = "force-dynamic";

interface JobInput {
  label?: string;
  actions?: PoolAction[];
  /** Epoch ms; must be in the future. */
  at?: number;
}

/**
 * Create a one-shot scheduled job ("run this scene later tonight") without
 * running anything now. Cancel with DELETE /api/jobs/[id]; pending jobs are
 * listed by GET /api/automations.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as JobInput | null;
  if (!body || typeof body.at !== "number" || !Number.isFinite(body.at)) {
    return NextResponse.json({ error: "at (epoch ms) required" }, { status: 400 });
  }
  if (body.at <= Date.now()) {
    return NextResponse.json({ error: "at must be in the future" }, { status: 400 });
  }
  if (body.at > Date.now() + 7 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "at must be within the next 7 days" }, { status: 400 });
  }
  const actionsErr = validateActionsShape(body.actions);
  if (actionsErr) return NextResponse.json({ error: actionsErr }, { status: 400 });

  const id = createScheduledJob({
    label: typeof body.label === "string" && body.label.trim().length > 0 ? body.label.trim() : "one-shot job",
    actions: body.actions ?? [],
    fireAt: body.at,
    ctx: { userId: auth.user.id, userName: auth.user.name, role: auth.user.role, source: "ui" },
  });
  return NextResponse.json({ ok: true, id });
}
