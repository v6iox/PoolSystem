import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Cancel a pending one-shot scheduled job. */
export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  const db = getDb();
  const job = db.prepare("SELECT id, label, status FROM scheduled_jobs WHERE id = ?").get(id) as
    | { id: number; label: string; status: string }
    | undefined;
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.status !== "pending") return NextResponse.json({ error: "Job already finished" }, { status: 409 });
  db.prepare("UPDATE scheduled_jobs SET status = 'cancelled' WHERE id = ?").run(id);
  audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "cancelJob", target: job.label || `job ${id}` });
  return NextResponse.json({ ok: true });
}
