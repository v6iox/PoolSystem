"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Check, ExternalLink, Globe, KeyRound, Loader2, LogOut, Sparkles, Waves } from "lucide-react";
import { apiGet, apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { SettingsSection } from "@/components/settings/section";
import { cn } from "@/lib/utils";

/**
 * Copilot brain picker: local Ollama, OpenAI API key, or Sign in with ChatGPT
 * (Codex-style OAuth that uses the ChatGPT subscription — unofficial route,
 * clearly labeled, with the API key as the supported fallback).
 */

interface ProviderInfo {
  provider: "env" | "openai-key" | "openrouter" | "chatgpt-oauth";
  model: string;
  defaultModel: string;
  hasApiKey: boolean;
  hasOpenrouterKey: boolean;
  oauth: { connected: boolean; email: string; plan: string };
  envBackend: string;
}

const OPTIONS: Array<{ id: ProviderInfo["provider"]; title: string; detail: string; icon: React.ReactNode }> = [
  { id: "env", title: "Local (Ollama)", detail: "Runs on the Pi — private, no account", icon: <Waves size={16} /> },
  { id: "openai-key", title: "OpenAI API key", detail: "Official API, pay-per-use", icon: <KeyRound size={16} /> },
  { id: "openrouter", title: "OpenRouter", detail: "One key, any model — Claude, Gemini, Llama…", icon: <Globe size={16} /> },
  { id: "chatgpt-oauth", title: "Sign in with ChatGPT", detail: "Uses your Plus/Pro subscription", icon: <Sparkles size={16} /> },
];

export function CopilotBrainSection(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [orKey, setOrKey] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ["copilot-provider"],
    queryFn: () => apiGet<ProviderInfo>("/api/copilot/provider"),
  });
  const info = query.data;

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["copilot-provider"] });
  };

  const save = async (patch: Record<string, string>): Promise<void> => {
    setBusy(true);
    try {
      await apiSend("PUT", "/api/copilot/provider", patch);
      refresh();
      toast("success", "Copilot updated");
    } catch (err) {
      toast("error", "Couldn't save", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const startOauth = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await apiSend<{ authUrl: string }>("POST", "/api/copilot/oauth", { action: "start" });
      setAuthUrl(res.authUrl);
      window.open(res.authUrl, "_blank", "noopener");
    } catch (err) {
      toast("error", "Couldn't start sign-in", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const completeOauth = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await apiSend<{ oauth: ProviderInfo["oauth"] }>("POST", "/api/copilot/oauth", {
        action: "complete",
        pasted,
      });
      setAuthUrl(null);
      setPasted("");
      refresh();
      toast("success", "ChatGPT connected", res.oauth.email ? `Signed in as ${res.oauth.email}` : undefined);
    } catch (err) {
      toast("error", "Sign-in failed", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    try {
      await apiSend("DELETE", "/api/copilot/oauth");
      refresh();
      toast("success", "ChatGPT disconnected", "Copilot is back on the local model.");
    } catch (err) {
      toast("error", "Couldn't disconnect", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const effectiveModel = model ?? info?.model ?? "";

  return (
    <SettingsSection title="Copilot brain" icon={<Brain size={17} />}>
      <div className="p-4">
        <p className="mb-3 text-sm text-ink-dim">
          Which model turns your words into pool commands. Whatever you pick, every action is still validated,
          role-checked, confirmed, and audited — the model only ever parses intent.
        </p>

        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {OPTIONS.map((opt) => {
            const active = info?.provider === opt.id;
            const disabled =
              (opt.id === "openai-key" && !info?.hasApiKey && !apiKey) ||
              (opt.id === "openrouter" && !info?.hasOpenrouterKey && !orKey) ||
              (opt.id === "chatgpt-oauth" && !info?.oauth.connected);
            return (
              <button
                key={opt.id}
                onClick={() => void save({ provider: opt.id })}
                disabled={busy || (disabled && !active)}
                className={cn(
                  "rounded-xl border p-3 text-left transition-all",
                  active ? "border-accent/50 bg-accent-soft shadow-[0_0_16px_-6px] shadow-accent/40" : "border-line hover:border-line-bright",
                  disabled && !active && "opacity-50"
                )}
              >
                <span className={cn("mb-1.5 flex items-center gap-1.5 text-sm font-medium", active ? "text-accent" : "text-ink")}>
                  {opt.icon}
                  {opt.title}
                  {active && <Check size={13} className="ml-auto" />}
                </span>
                <span className="block text-[11px] leading-snug text-ink-faint">{opt.detail}</span>
              </button>
            );
          })}
        </div>

        {info?.provider === "env" && (
          <p className="mb-4 text-xs text-ink-faint">
            Backend: <code className="text-ink-dim">{info.envBackend}</code>
          </p>
        )}

        {/* OpenAI API key */}
        <div className="mb-4">
          <Field label="OpenAI API key" hint={info?.hasApiKey ? "A key is saved (stored only in the Pi's local database). Paste a new one to replace it." : "sk-… from platform.openai.com — stored only on the Pi."}>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={info?.hasApiKey ? "••••••••••••" : "sk-…"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <Button
                variant="primary"
                disabled={busy || !apiKey.trim()}
                onClick={() => {
                  void save({ apiKey: apiKey.trim(), provider: "openai-key" }).then(() => setApiKey(""));
                }}
              >
                Save & use
              </Button>
            </div>
          </Field>
        </div>

        {/* OpenRouter API key */}
        <div className="mb-4">
          <Field
            label="OpenRouter API key"
            hint={
              info?.hasOpenrouterKey
                ? "A key is saved (stored only in the Pi's local database). Paste a new one to replace it."
                : "sk-or-… from openrouter.ai/keys — one key unlocks Claude, Gemini, Llama, DeepSeek and hundreds more. Set the model below like anthropic/claude-sonnet-4."
            }
          >
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={info?.hasOpenrouterKey ? "••••••••••••" : "sk-or-…"}
                value={orKey}
                onChange={(e) => setOrKey(e.target.value)}
                autoComplete="new-password"
              />
              <Button
                variant="primary"
                disabled={busy || !orKey.trim()}
                onClick={() => {
                  void save({ openrouterApiKey: orKey.trim(), provider: "openrouter" }).then(() => setOrKey(""));
                }}
              >
                Save & use
              </Button>
            </div>
          </Field>
        </div>

        {/* Sign in with ChatGPT */}
        <div className="mb-4 rounded-xl border border-line bg-abyss/40 p-3">
          {info?.oauth.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="flex items-center gap-1.5 text-sm text-ink">
                  <Sparkles size={14} className="text-accent" /> ChatGPT connected
                </p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {info.oauth.email || "signed in"}
                  {info.oauth.plan ? ` · ${info.oauth.plan}` : ""}
                </p>
              </div>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void disconnect()}>
                <LogOut size={13} /> Disconnect
              </Button>
            </div>
          ) : authUrl ? (
            <div className="space-y-2.5">
              <p className="text-sm text-ink-dim">
                1. Finish signing in on the OpenAI tab that just opened{" "}
                <a href={authUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent">
                  (reopen <ExternalLink size={11} />)
                </a>
                . 2. You'll land on a <code className="text-ink-dim">localhost:1455</code> page that can't load —
                that's expected. 3. Copy that page's full URL from the address bar and paste it here:
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="http://localhost:1455/auth/callback?code=…"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                />
                <Button variant="primary" disabled={busy || !pasted.trim()} onClick={() => void completeOauth()}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : "Connect"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm text-ink">Use your ChatGPT subscription</p>
                <p className="mt-0.5 max-w-md text-xs text-ink-faint">
                  Same sign-in flow as Codex CLI / OpenClaw. Unofficial — if OpenAI changes it, switch to an API key.
                  Tokens never leave the Pi.
                </p>
              </div>
              <Button variant="glass" size="sm" disabled={busy} onClick={() => void startOauth()}>
                <Sparkles size={13} /> Sign in with ChatGPT
              </Button>
            </div>
          )}
        </div>

        {/* Model override */}
        <Field label="Model" hint={`Blank = default for the selected brain (${info?.defaultModel ?? "…"})`}>
          <div className="flex gap-2">
            <Input
              placeholder={info?.defaultModel ?? ""}
              value={effectiveModel}
              onChange={(e) => setModel(e.target.value)}
            />
            <Button variant="glass" disabled={busy || model === null} onClick={() => void save({ model: effectiveModel })}>
              Save
            </Button>
          </div>
        </Field>
      </div>
    </SettingsSection>
  );
}
