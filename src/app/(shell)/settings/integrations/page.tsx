"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Copy, KeyRound, Mic, Plus, Speaker, Trash2 } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { roleAtLeast } from "@/types/auth";
import { apiGet, apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";
import { PageHeader, Panel, EmptyState } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { OwnerOnlyState, SettingsSection } from "@/components/settings/section";
import { formatRelative } from "@/lib/utils";

interface TokenRow {
  id: number;
  label: string;
  userId: number;
  createdAt: number;
  lastUsedAt: number | null;
}

function CopyButton({ value }: { value: string }): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="iconSm"
      aria-label="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => toast("success", "Copied"));
      }}
    >
      <Copy size={14} />
    </Button>
  );
}

function Snippet({ children }: { children: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-abyss/50 px-3 py-2">
      <code className="min-w-0 overflow-x-auto text-xs whitespace-nowrap text-ink-dim no-scrollbar">{children}</code>
      <CopyButton value={children} />
    </div>
  );
}

const ALEXA_INTERACTION_MODEL = JSON.stringify(
  {
    interactionModel: {
      languageModel: {
        invocationName: "moonpool",
        intents: [
          { name: "AMAZON.StopIntent", samples: [] },
          { name: "AMAZON.CancelIntent", samples: [] },
          { name: "AMAZON.HelpIntent", samples: [] },
          {
            name: "AskPoolIntent",
            slots: [{ name: "query", type: "AMAZON.SearchQuery" }],
            samples: ["{query}", "to {query}", "ask {query}"],
          },
        ],
      },
    },
  },
  null,
  2
);

export default function IntegrationsPage(): React.JSX.Element {
  const { user } = usePool();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [skillId, setSkillId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isOwner = roleAtLeast(user.role, "owner");
  const tokensQuery = useQuery({
    queryKey: ["integration-tokens"],
    queryFn: () => apiGet<{ tokens: TokenRow[] }>("/api/integrations/tokens"),
    enabled: isOwner,
  });
  const alexaQuery = useQuery({
    queryKey: ["alexa-config"],
    queryFn: () => apiGet<{ skillId: string }>("/api/integrations/alexa-config"),
    enabled: isOwner,
  });

  if (!isOwner) {
    return (
      <div>
        <PageHeader title="Voice" subtitle="Siri & Alexa" />
        <OwnerOnlyState />
      </div>
    );
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-moonpool-url";
  const exampleToken = freshToken ?? "mp_YOUR_TOKEN";
  const effectiveSkillId = skillId ?? alexaQuery.data?.skillId ?? "";

  const mint = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await apiSend<{ token: string }>("POST", "/api/integrations/tokens", { label: label || "Voice" });
      setFreshToken(res.token);
      setLabel("");
      await queryClient.invalidateQueries({ queryKey: ["integration-tokens"] });
      toast("success", "Token created", "Copy it now — it won't be shown again.");
    } catch (err) {
      toast("error", "Couldn't create token", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: number): Promise<void> => {
    try {
      await apiSend("DELETE", `/api/integrations/tokens?id=${id}`);
      await queryClient.invalidateQueries({ queryKey: ["integration-tokens"] });
      toast("success", "Token revoked");
    } catch (err) {
      toast("error", "Couldn't revoke", err instanceof Error ? err.message : undefined);
    }
  };

  const saveSkill = async (): Promise<void> => {
    setBusy(true);
    try {
      await apiSend("PUT", "/api/integrations/alexa-config", { skillId: effectiveSkillId });
      toast("success", effectiveSkillId ? "Alexa skill saved" : "Alexa skill cleared");
    } catch (err) {
      toast("error", "Couldn't save", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Voice"
        subtitle="Hey Siri / Alexa — same copilot, same rules, everything audited"
      />
      <div className="mx-auto max-w-2xl space-y-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <SettingsSection title="Voice tokens" icon={<KeyRound size={17} />}>
            <div className="p-4">
            <p className="mb-3 text-sm text-ink-dim">
              Long-lived keys for Shortcuts and other integrations. Commands run as your account and land in the audit
              log. Only a hash is stored — copy new tokens immediately.
            </p>
            <div className="mb-3 flex gap-2">
              <Input placeholder="Label (e.g. Spencer's iPhone)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <Button variant="primary" disabled={busy} onClick={() => void mint()}>
                <Plus size={15} /> Create
              </Button>
            </div>
            {freshToken && (
              <div className="mb-3 rounded-xl border border-ok/25 bg-ok/5 p-3">
                <p className="mb-2 text-xs font-medium text-ok">New token — shown once:</p>
                <Snippet>{freshToken}</Snippet>
              </div>
            )}
            <div className="space-y-2">
              {(tokensQuery.data?.tokens ?? []).map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{t.label}</p>
                    <p className="text-[11px] text-ink-faint">
                      created {formatRelative(t.createdAt)}
                      {t.lastUsedAt ? ` · last used ${formatRelative(t.lastUsedAt)}` : " · never used"}
                    </p>
                  </div>
                  <Button variant="ghost" size="iconSm" aria-label="Revoke" onClick={() => void revoke(t.id)}>
                    <Trash2 size={14} className="text-danger" />
                  </Button>
                </div>
              ))}
              {tokensQuery.data && tokensQuery.data.tokens.length === 0 && !freshToken && (
                <EmptyState title="No tokens yet" detail="Create one to hook up Siri or anything else that can hit a URL." />
              )}
            </div>
            </div>
          </SettingsSection>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <SettingsSection title="Siri Shortcuts" icon={<Mic size={17} />}>
            <div className="p-4">
            <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-sm text-ink-dim">
              <li>Create a token above.</li>
              <li>iPhone → Shortcuts → new shortcut → add <span className="text-ink">Dictate text</span>.</li>
              <li>
                Add <span className="text-ink">Get contents of URL</span> with the URL below, replacing the token and
                inserting the dictated text as the <code className="text-accent">q</code> parameter.
              </li>
              <li>Add <span className="text-ink">Speak text</span> (or Show result) for the reply.</li>
              <li>Name it "Pool" → "Hey Siri, Pool" → say anything: "warm the spa", "what's the salt at?".</li>
            </ol>
            <Snippet>{`${origin}/api/integrations/siri?token=${exampleToken}&q=[Dictated Text]`}</Snippet>
            <p className="mt-2 text-xs text-ink-faint">
              Tip: make single-purpose shortcuts too — "Spa Time" can hard-code q=spa+on+and+102 for a one-phrase start.
            </p>
            </div>
          </SettingsSection>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <SettingsSection title="Alexa skill" icon={<Speaker size={17} />}>
            <div className="p-4">
            <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-sm text-ink-dim">
              <li>
                developer.amazon.com → Alexa Skills Kit → Create Skill (Custom, provision your own) — free, personal to
                your Amazon account.
              </li>
              <li>Paste the interaction model below in the JSON editor (invocation: "moonpool").</li>
              <li>
                Endpoint → HTTPS, use your public Moonpool URL (Cloudflare Tunnel / Tailscale Funnel) with the path
                below; choose "trusted certificate".
              </li>
              <li>Copy the Skill ID (amzn1.ask.skill…) into the field below and save.</li>
              <li>"Alexa, open moonpool" · "Alexa, ask moonpool to warm the spa to one oh two".</li>
            </ol>
            <div className="space-y-2.5">
              <Snippet>{`${origin}/api/integrations/alexa`}</Snippet>
              <details className="rounded-xl border border-line bg-abyss/40 p-3">
                <summary className="cursor-pointer text-xs font-medium text-ink-dim">Interaction model JSON</summary>
                <div className="mt-2 max-h-56 overflow-auto rounded-lg bg-abyss/60 p-2">
                  <pre className="text-[11px] leading-relaxed text-ink-dim">{ALEXA_INTERACTION_MODEL}</pre>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void navigator.clipboard.writeText(ALEXA_INTERACTION_MODEL).then(() => toast("success", "Copied"))}
                  >
                    <Copy size={13} /> Copy JSON
                  </Button>
                </div>
              </details>
              <Field label="Skill ID">
                <div className="flex gap-2">
                  <Input
                    placeholder="amzn1.ask.skill.xxxxxxxx-…"
                    value={effectiveSkillId}
                    onChange={(e) => setSkillId(e.target.value)}
                  />
                  <Button variant="primary" disabled={busy} onClick={() => void saveSkill()}>
                    Save
                  </Button>
                </div>
              </Field>
              <p className="text-xs text-ink-faint">
                Requests are verified against Amazon's signing certificate and your skill ID; commands run as your
                account with confirmation auto-applied (advisories are spoken back instead).
              </p>
            </div>
            </div>
          </SettingsSection>
        </motion.div>
      </div>
    </div>
  );
}
