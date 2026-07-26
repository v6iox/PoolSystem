"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "@/lib/client/theme";
import { Caustics } from "@/components/background/Caustics";
import { Toaster } from "@/components/ui/toaster";

function Ambient(): React.JSX.Element {
  const { theme } = useTheme();
  return <Caustics paused={!theme.ambientMotion} />;
}

function ServiceWorkerRegistrar(): null {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true },
        },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <Ambient />
        {children}
        <Toaster />
        <ServiceWorkerRegistrar />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
