"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  Beaker,
  CalendarClock,
  Droplets,
  Fan,
  FlaskConical,
  History,
  Home,
  Lightbulb,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Settings,
  Sparkles,
  Thermometer,
  ToggleRight,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { useState } from "react";
import { usePool } from "@/lib/client/pool-state";
import { Logo, Wordmark } from "@/components/logo";
import { cn } from "@/lib/utils";
import type { Role } from "@/types/auth";
import { roleAtLeast } from "@/types/auth";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  minRole: Role;
}

const NAV_MAIN: NavItem[] = [
  { href: "/", label: "Home", icon: Home, minRole: "guest" },
  { href: "/circuits", label: "Controls", icon: ToggleRight, minRole: "guest" },
  { href: "/heat", label: "Heat", icon: Thermometer, minRole: "family" },
  { href: "/lights", label: "Lights", icon: Lightbulb, minRole: "guest" },
  { href: "/copilot", label: "Copilot", icon: MessageCircle, minRole: "guest" },
];

const NAV_MORE: NavItem[] = [
  { href: "/scenes", label: "Scenes", icon: Sparkles, minRole: "guest" },
  { href: "/pump", label: "Pump", icon: Fan, minRole: "family" },
  { href: "/chlorinator", label: "Chlorinator", icon: Droplets, minRole: "family" },
  { href: "/schedules", label: "Schedules", icon: CalendarClock, minRole: "family" },
  { href: "/chemistry", label: "Chemistry", icon: FlaskConical, minRole: "family" },
  { href: "/automations", label: "Automations", icon: Workflow, minRole: "family" },
  { href: "/history", label: "History", icon: History, minRole: "family" },
  { href: "/settings", label: "Settings", icon: Settings, minRole: "guest" },
  { href: "/settings/users", label: "Users", icon: Users, minRole: "owner" },
  { href: "/settings/audit", label: "Audit log", icon: Activity, minRole: "owner" },
];

function ConnectionBanner(): React.JSX.Element | null {
  const { backendConnected, connection, hasLoaded, snapshot } = usePool();
  const offline = hasLoaded && !backendConnected;
  const reconnecting = connection === "reconnecting";
  if (!offline && !reconnecting) return null;
  return (
    <motion.div
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="sticky top-0 z-40 border-b border-danger/25 bg-danger/12 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-sm text-danger">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger" />
        {reconnecting
          ? "Connection to Moonpool lost — reconnecting…"
          : `Pool controller unreachable — controls paused${snapshot.lastUpdate ? "" : ""}. Reconnecting automatically.`}
      </div>
    </motion.div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user, snapshot } = usePool();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const mainItems = NAV_MAIN.filter((i) => roleAtLeast(user.role, i.minRole));
  const moreItems = NAV_MORE.filter((i) => roleAtLeast(user.role, i.minRole));
  const allItems = [...mainItems, ...moreItems];

  const isActive = (href: string): boolean =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  const logout = async (): Promise<void> => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <div className="flex min-h-dvh">
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-1 border-r border-line bg-glass p-4 backdrop-blur-xl md:flex">
        <Link href="/" className="mb-4 flex items-center gap-2.5 px-2 py-1">
          <Logo size={30} />
          <Wordmark className="text-xl" />
        </Link>
        {allItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
              isActive(item.href)
                ? "bg-accent-soft text-ink font-medium shadow-[inset_0_0_0_1px] shadow-accent/20"
                : "text-ink-dim hover:bg-accent-soft/50 hover:text-ink"
            )}
          >
            <item.icon size={18} className={isActive(item.href) ? "text-accent" : undefined} />
            {item.label}
          </Link>
        ))}
        <div className="mt-auto space-y-2">
          {snapshot.mock && (
            <div className="rounded-lg border border-warn/25 bg-warn/10 px-3 py-1.5 text-[11px] font-medium text-warn">
              MOCK MODE — simulated pool
            </div>
          )}
          <div className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm text-ink">{user.name}</p>
              <p className="text-[11px] capitalize text-ink-faint">{user.role}</p>
            </div>
            <button
              onClick={() => void logout()}
              className="rounded-lg p-2 text-ink-faint transition hover:bg-danger/15 hover:text-danger"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        <ConnectionBanner />
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-glass px-4 py-3 backdrop-blur-xl md:hidden">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={24} />
            <Wordmark className="text-lg" />
          </Link>
          <div className="flex items-center gap-2">
            {snapshot.mock && (
              <span className="rounded-md border border-warn/25 bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold text-warn">
                MOCK
              </span>
            )}
            <button
              onClick={() => void logout()}
              className="rounded-lg p-2 text-ink-faint"
              aria-label="Sign out"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-glass backdrop-blur-2xl md:hidden">
        <div className="flex items-stretch justify-around">
          {mainItems.slice(0, 4).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
                isActive(item.href) ? "text-accent" : "text-ink-faint"
              )}
            >
              {isActive(item.href) && (
                <motion.span
                  layoutId="bottom-nav-glow"
                  className="absolute -top-px h-0.5 w-10 rounded-full bg-accent shadow-[0_0_8px] shadow-accent"
                />
              )}
              <item.icon size={21} />
              {item.label}
            </Link>
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium",
              moreOpen ? "text-accent" : "text-ink-faint"
            )}
          >
            <MoreHorizontal size={21} />
            More
          </button>
        </div>
      </nav>

      {/* Mobile "More" sheet */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-abyss/70 backdrop-blur-sm md:hidden"
              onClick={() => setMoreOpen(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 38 }}
              className="glass-bright pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-3xl p-5 md:hidden"
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="font-display font-semibold text-ink">Everything else</p>
                <button onClick={() => setMoreOpen(false)} className="rounded-lg p-1.5 text-ink-faint" aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {[...mainItems.slice(4), ...moreItems].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-2xl border border-line px-2 py-3.5 text-xs transition-colors",
                      isActive(item.href) ? "border-accent/30 bg-accent-soft text-ink" : "text-ink-dim"
                    )}
                  >
                    <item.icon size={20} className={isActive(item.href) ? "text-accent" : undefined} />
                    {item.label}
                  </Link>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
