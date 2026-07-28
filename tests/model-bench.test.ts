import { describe, it } from "vitest";
import { CASES, matchPlan, type EvalCase } from "./copilot-cases";
import { runLlm } from "./pipeline";
import { ctx } from "./fixtures";

/**
 * Score several local models against the same corpus, so picking the model
 * that ships is a measurement rather than a guess.
 *
 *   COPILOT_BENCH=true COPILOT_BENCH_MODELS=qwen3:0.6b,qwen3:1.7b \
 *     npx vitest run model-bench
 *
 * Prints overall accuracy, a per-tag breakdown and latency percentiles, plus
 * every failure with the reason. Cases run through the production pipeline
 * (ground + validate), so the score reflects what a user would actually get.
 */

const enabled = process.env.COPILOT_BENCH === "true";
const MODELS = (process.env.COPILOT_BENCH_MODELS ?? "qwen3:1.7b").split(",").map((m) => m.trim()).filter(Boolean);

interface CaseResult {
  evalCase: EvalCase;
  ok: boolean;
  reason: string | null;
  ms: number;
  corrections: number;
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function table(rows: Array<Record<string, string>>, headers: string[]): string {
  const widths = headers.map((h) => Math.max(h.length, ...rows.map((r) => (r[h] ?? "").length)));
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ");
  return [line(headers), line(widths.map((w) => "─".repeat(w))), ...rows.map((r) => line(headers.map((h) => r[h] ?? "")))].join("\n");
}

describe.skipIf(!enabled)("local model benchmark", () => {
  const summary: Array<Record<string, string>> = [];

  for (const model of MODELS) {
    it(
      `scores ${model}`,
      async () => {
        const results: CaseResult[] = [];
        for (const evalCase of CASES) {
          const withHistory = evalCase.history ? { ...ctx, history: evalCase.history } : ctx;
          const started = Date.now();
          try {
            const result = await runLlm(evalCase.text, withHistory, { model, timeoutMs: 120_000 });
            const ms = Date.now() - started;
            // When the right answer is "do nothing", a validation refusal is a
            // correct outcome, not a miss: the user gets told why and the pool
            // doesn't move. Only score it as a failure when an action was due.
            const reason =
              result.problems.length > 0
                ? evalCase.expect.length === 0
                  ? null
                  : `refused: ${result.problems.join("; ")}`
                : matchPlan(result.calls, evalCase.expect, Date.now());
            results.push({ evalCase, ok: reason === null, reason, ms, corrections: result.corrections.length });
          } catch (err) {
            results.push({
              evalCase,
              ok: false,
              reason: `ERROR: ${(err as Error).message}`,
              ms: Date.now() - started,
              corrections: 0,
            });
          }
        }

        const passed = results.filter((r) => r.ok);
        const latencies = results.map((r) => r.ms);
        const corrected = results.filter((r) => r.corrections > 0).length;

        const byTag = new Map<string, { pass: number; total: number }>();
        for (const r of results) {
          const entry = byTag.get(r.evalCase.tag) ?? { pass: 0, total: 0 };
          entry.total += 1;
          if (r.ok) entry.pass += 1;
          byTag.set(r.evalCase.tag, entry);
        }

        const lines: string[] = [
          ``,
          `═══ ${model} ═══`,
          `overall   ${passed.length}/${results.length}  (${Math.round((passed.length / results.length) * 100)}%)`,
          `latency   p50 ${pct(latencies, 50)}ms · p90 ${pct(latencies, 90)}ms · max ${Math.max(...latencies)}ms`,
          `grounding corrected ${corrected}/${results.length} plans`,
          ``,
          table(
            [...byTag.entries()]
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([tag, s]) => ({
                tag,
                score: `${s.pass}/${s.total}`,
                pct: `${Math.round((s.pass / s.total) * 100)}%`,
              })),
            ["tag", "score", "pct"]
          ),
        ];

        const failures = results.filter((r) => !r.ok);
        if (failures.length > 0) {
          lines.push(``, `failures:`);
          for (const f of failures) lines.push(`  ✗ “${f.evalCase.text}” — ${f.reason}`);
        }
        console.log(lines.join("\n"));

        summary.push({
          model,
          accuracy: `${passed.length}/${results.length} (${Math.round((passed.length / results.length) * 100)}%)`,
          p50: `${pct(latencies, 50)}ms`,
          p90: `${pct(latencies, 90)}ms`,
        });
      },
      // Every case, sequentially, on a small local model.
      CASES.length * 130_000
    );
  }

  it("prints the comparison", () => {
    if (summary.length > 0) {
      console.log(`\n═══ comparison ═══\n${table(summary, ["model", "accuracy", "p50", "p90"])}\n`);
    }
  });
});
