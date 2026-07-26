"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Logo, Wordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { apiGet, apiSend } from "@/lib/client/api";

export default function SetupPage(): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiGet<{ needsSetup: boolean }>("/api/auth/status")
      .then((s) => {
        if (!s.needsSetup) router.replace("/login");
      })
      .catch(() => undefined);
  }, [router]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/api/auth/setup", { name, email, password });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 120, damping: 18 }}
        className="glass-bright w-full max-w-sm rounded-panel p-8"
      >
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo size={48} />
          <Wordmark className="text-2xl" />
          <div>
            <p className="font-display font-medium text-ink">First swim</p>
            <p className="mt-1 text-sm text-ink-dim">
              Create the owner account. It manages users, settings and everything else — stored right here, on your Pi.
            </p>
          </div>
        </div>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <Field label="Your name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@home.local"
            />
          </Field>
          <Field label="Password" hint="At least 8 characters">
            <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirm password">
            <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error ? (
            <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
          ) : null}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
            {busy ? "Creating…" : "Create owner account"}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
