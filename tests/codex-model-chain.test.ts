import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ctx } from "./fixtures";

/**
 * ChatGPT (Codex) model self-healing. The Codex backend only accepts
 * Codex-tuned models and the accepted set drifts — it started rejecting
 * "gpt-5" with 400 "The 'gpt-5' model is not supported when using Codex with
 * a ChatGPT account", which broke the copilot outright. Auto mode must walk
 * the candidate chain on that rejection, remember the survivor, and leave an
 * explicit Settings override untouched (verbatim, with a helpful error).
 */

vi.mock("@/server/copilot/openai-oauth", () => ({
  getOauthCredentials: async () => ({ accessToken: "test-token", accountId: "acct-1" }),
  getOauthStatus: () => ({ connected: true, email: "t@t.co", plan: "plus" }),
}));

let parseWithCodex: typeof import("@/server/copilot/codex").parseWithCodex;
let getSetting: typeof import("@/server/settings").getSetting;
let setSetting: typeof import("@/server/settings").setSetting;
let dir: string;

const PLAN = '{"tool_calls":[],"reply":"Salt is 3100 ppm."}';
const SSE_OK = `data: {"type":"response.output_text.delta","delta":${JSON.stringify(PLAN)}}\n\ndata: [DONE]\n`;

/** Models the fake backend accepts; everything else gets the real rejection shape. */
let accepted: Set<string>;
let requestedModels: string[];

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { model?: string };
      const model = body.model ?? "";
      requestedModels.push(model);
      if (!accepted.has(model)) {
        return new Response(
          JSON.stringify({ detail: `The '${model}' model is not supported when using Codex with a ChatGPT account.` }),
          { status: 400 }
        );
      }
      return new Response(SSE_OK, { status: 200 });
    })
  );
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonpool-codex-"));
  process.env.DATABASE_PATH = path.join(dir, "test.db");
  ({ getSetting, setSetting } = await import("@/server/settings"));
  ({ parseWithCodex } = await import("@/server/copilot/codex"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  setSetting("codexWorkingModel", "");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("codex model auto-chain", () => {
  it("walks past rejected models, succeeds, and remembers the survivor", async () => {
    accepted = new Set(["gpt-5.6-sol"]);
    requestedModels = [];
    stubFetch();
    const plan = await parseWithCodex("what's the salt level?", ctx, null);
    expect(plan.reply).toBe("Salt is 3100 ppm.");
    // First candidate rejected, second accepted — and persisted for next time.
    expect(requestedModels).toEqual(["gpt-5.6-terra", "gpt-5.6-sol"]);
    expect(getSetting("codexWorkingModel", "")).toBe("gpt-5.6-sol");
  });

  it("uses the remembered model first on later calls", async () => {
    accepted = new Set(["gpt-5.6-sol"]);
    setSetting("codexWorkingModel", "gpt-5.6-sol");
    requestedModels = [];
    stubFetch();
    await parseWithCodex("hey", ctx, null);
    expect(requestedModels).toEqual(["gpt-5.6-sol"]);
  });

  it("re-heals when the remembered model is retired", async () => {
    accepted = new Set(["gpt-5.6-luna"]);
    setSetting("codexWorkingModel", "gpt-5.6-terra"); // no longer accepted
    requestedModels = [];
    stubFetch();
    await parseWithCodex("hey", ctx, null);
    expect(requestedModels).toEqual(["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"]);
    expect(getSetting("codexWorkingModel", "")).toBe("gpt-5.6-luna");
  });

  it("an explicit override is used verbatim and never chained", async () => {
    accepted = new Set(["gpt-5-codex"]);
    requestedModels = [];
    stubFetch();
    await expect(parseWithCodex("hey", ctx, "gpt-5")).rejects.toThrow(/Clear the model override/);
    expect(requestedModels).toEqual(["gpt-5"]);
  });

  it("a 400 that merely mentions 'model' does not trigger the chain", async () => {
    requestedModels = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: string }) => {
        const body = JSON.parse(init?.body ?? "{}") as { model?: string };
        requestedModels.push(body.model ?? "");
        return new Response(JSON.stringify({ detail: "input exceeds the model context window" }), { status: 400 });
      })
    );
    await expect(parseWithCodex("hey", ctx, null)).rejects.toThrow(/context window/);
    expect(requestedModels.length).toBe(1); // no prompt re-send to every candidate
  });

  it("non-model errors (auth) do not advance the chain", async () => {
    requestedModels = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: string }) => {
        const body = JSON.parse(init?.body ?? "{}") as { model?: string };
        requestedModels.push(body.model ?? "");
        return new Response("forbidden", { status: 403 });
      })
    );
    await expect(parseWithCodex("hey", ctx, null)).rejects.toThrow(/403/);
    expect(requestedModels.length).toBe(1); // no pointless retries on auth failures
  });
});
