import { useState } from "react";
import type { MessageKey } from "@/i18n";
import type { AppDialog } from "@/lib/app/appDialogTypes";
import { isDesktopHost } from "@/lib/api";
import { useUpdaterContext } from "@/hooks/UpdaterProvider";
import { UpdatesPanel } from "./UpdatesPanel";

export function CliUpdateOfferBar({ active, t }: {
  active: boolean;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  setAppDialog: (dialog: AppDialog | null) => void;
  showToast: (msg: string, ms?: number) => void;
}) {
  const { snapshot } = useUpdaterContext();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const key = `${snapshot.app.latest}|${snapshot.cli.latest}|${snapshot.restartRequired}`;
  const visible = snapshot.restartRequired || snapshot.updating || [snapshot.app, snapshot.cli].some((item) => ["available", "manual", "downloaded", "installed"].includes(item.phase));
  if (!active || !isDesktopHost() || !visible || dismissed === key) return null;
  return <UpdatesPanel compact t={t} onDismiss={() => setDismissed(key)} />;
}
