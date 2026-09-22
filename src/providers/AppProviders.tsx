import type { ReactNode } from "react";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { SkinShareProvider } from "@/providers/SkinShareProvider";
import { SshWatchProvider } from "@/providers/SshWatchProvider";
import { PluginContributionsProvider } from "@/providers/PluginContributionsProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <SkinShareProvider>
        <SshWatchProvider>
          <PluginContributionsProvider>{children}</PluginContributionsProvider>
        </SshWatchProvider>
      </SkinShareProvider>
    </ThemeProvider>
  );
}
