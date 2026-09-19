import { UpdatesPanel } from "@/components/UpdatesPanel";
import type { MessageKey } from "@/i18n";

export function AboutUpdateRow({ t }: {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  return <div className="settings-row settings-row--stack" id="settings-anchor-updates"><span id="settings-anchor-aboutCli" /><UpdatesPanel t={t} /></div>;
}
