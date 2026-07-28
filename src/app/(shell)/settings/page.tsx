"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Activity, Info, Loader2, LogOut, Mic, SlidersHorizontal, Users } from "lucide-react";
import { usePool } from "@/lib/client/pool-state";
import { roleAtLeast } from "@/types/auth";
import { PageHeader, Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { AppearanceSection } from "@/components/settings/appearance-section";
import { UnitsSection } from "@/components/settings/units-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import { CalibrationSection } from "@/components/settings/calibration-section";
import { SettingsLinkCard } from "@/components/settings/section";

export default function SettingsPage(): React.JSX.Element {
  const { user } = usePool();
  const [signingOut, setSigningOut] = useState(false);
  const isOwner = user.role === "owner";

  const signOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  };

  const links: Array<{ href: string; icon: React.ReactNode; title: string; detail: string }> = [
    ...(isOwner
      ? [
          {
            href: "/settings/equipment",
            icon: <SlidersHorizontal size={19} />,
            title: "Equipment",
            detail: "Rename circuits, pick icons, guest visibility",
          },
          {
            href: "/settings/users",
            icon: <Users size={19} />,
            title: "Users",
            detail: "Family & guest accounts, roles, passwords",
          },
          {
            href: "/settings/audit",
            icon: <Activity size={19} />,
            title: "Audit log",
            detail: "Every change, who made it, and when",
          },
          {
            href: "/settings/integrations",
            icon: <Mic size={19} />,
            title: "Voice & AI",
            detail: "Siri, Alexa, and the copilot brain (Ollama / OpenAI)",
          },
        ]
      : []),
    {
      href: "/settings/system",
      icon: <Info size={19} />,
      title: "System",
      detail: "Connection, equipment model, versions",
    },
  ];

  return (
    <div>
      <PageHeader title="Settings" subtitle="Make Moonpool feel like your pool" />

      <div className="mx-auto max-w-2xl space-y-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <AppearanceSection />
        </motion.div>

        {roleAtLeast(user.role, "family") && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <UnitsSection />
          </motion.div>
        )}

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <NotificationsSection />
        </motion.div>

        {isOwner && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <CalibrationSection />
          </motion.div>
        )}

        <section>
          <h2 className="mb-2 px-1 text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
            More
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {links.map((link, i) => (
              <SettingsLinkCard key={link.href} index={i} {...link} />
            ))}
          </div>
        </section>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm text-ink">{user.name}</p>
              <p className="truncate text-xs text-ink-faint">
                {user.email} · <span className="capitalize">{user.role}</span>
              </p>
            </div>
            <Button variant="danger" size="sm" disabled={signingOut} onClick={() => void signOut()}>
              {signingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
              Sign out
            </Button>
          </Panel>
          <p className="mt-3 text-center text-[11px] text-ink-faint">Moonpool {process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}</p>
        </motion.div>
      </div>
    </div>
  );
}
