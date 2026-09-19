import { useState } from "react";
import { IconCircleArrowUp } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { GlassModal } from "@/components/GlassModal";
import { UpdatesPanel } from "@/components/UpdatesPanel";
import { useUpdaterContext } from "@/hooks/UpdaterProvider";
import { isUpdateSimActive } from "@/lib/updateSim";
import { isDesktopHost } from "@/lib/api";
import type { MessageKey } from "@/i18n";

export function SidebarUpdateButton({ t }: {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  const { snapshot } = useUpdaterContext();
  const [open, setOpen] = useState(false);
  const visible = snapshot.restartRequired || snapshot.updating || [snapshot.app, snapshot.cli].some((item) => ["available", "manual", "downloaded", "installed"].includes(item.phase));
  if ((!visible && !open) || (!isDesktopHost() && !isUpdateSimActive())) return null;
  const label = t(snapshot.restartRequired ? "updates.restartReady" : "updates.title");
  return <>
    <Tip label={label} placement="bottom">
      <button className={`sidebar-update-btn${snapshot.updating ? " sidebar-update-btn--busy" : ""}`} aria-label={label} title={label} onClick={() => setOpen(true)}>
        <IconCircleArrowUp size={16} />
        <span className={`sidebar-update-btn__dot${snapshot.updating ? " sidebar-update-btn__dot--pulse" : ""}`} aria-hidden />
      </button>
    </Tip>
    <GlassModal open={open} onClose={() => setOpen(false)} title={t("updates.title")} size="md" closeLabel={t("common.close")}>
      <UpdatesPanel t={t} />
    </GlassModal>
  </>;
}
