"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { Waves } from "lucide-react";
import { Logo, Wordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { apiGet, apiSend } from "@/lib/client/api";

function LoginForm(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiGet<{ needsSetup: boolean }>("/api/auth/status")
      .then((s) => {
        if (s.needsSetup) router.replace("/setup");
      })
      .catch(() => undefined);
  }, [router]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/api/auth/login", { email, password });
      // A 200 only means the server made a session — it doesn't mean the
      // browser kept the cookie. Confirm before navigating: otherwise a
      // dropped cookie sends us back to this very page, which React does not
      // remount, leaving the button spinning on "Diving in…" with nothing to
      // explain why.
      const me = await apiGet<{ user?: { id: number } }>("/api/auth/me").catch(() => null);
      if (!me?.user) {
        throw new Error(
          "Signed in, but your browser didn't keep the session cookie. If you're on plain http://, restart Moonpool so it stops marking the cookie Secure — or reach it over https."
        );
      }
      router.replace(params.get("next") ?? "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 120, damping: 18 }}
      className="glass-bright w-full max-w-sm rounded-panel p-8"
    >
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 200, damping: 16 }}
        >
          <Logo size={56} />
        </motion.div>
        <Wordmark className="text-3xl" />
        <p className="text-sm text-ink-dim">The pool is lit. Come on in.</p>
      </div>

      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="Email">
          <Input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@home.local"
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        {error ? (
          <motion.p
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {error}
          </motion.p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
          {busy ? (
            <span className="flex items-center gap-2">
              <Waves size={18} className="animate-pulse" /> Diving in…
            </span>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
      <p className="mt-6 text-center text-xs text-ink-faint">
        Accounts are created by the pool owner on this device — no cloud involved.
      </p>
    </motion.div>
  );
}

export default function LoginPage(): React.JSX.Element {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
