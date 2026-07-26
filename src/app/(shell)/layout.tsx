import { redirect } from "next/navigation";
import { getSessionUser, getUserCount } from "@/server/auth/session";
import { PoolStateProvider } from "@/lib/client/pool-state";
import { AppShell } from "@/components/shell/app-shell";

export const dynamic = "force-dynamic";

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  if (getUserCount() === 0) redirect("/setup");
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <PoolStateProvider user={user}>
      <AppShell>{children}</AppShell>
    </PoolStateProvider>
  );
}
