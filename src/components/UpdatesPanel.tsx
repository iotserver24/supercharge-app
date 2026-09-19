import { useState } from "react";
import { GlassModal } from "@/components/GlassModal";
import { IconCircleArrowUp, IconRefresh } from "@/components/icons";
import { useUpdaterContext } from "@/hooks/UpdaterProvider";
import type { ComponentUpdate, UpdatePhase } from "@/lib/updateController";
import type { MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import "./updates-panel.css";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;
const phaseKeys: Record<UpdatePhase, MessageKey> = {
  idle: "updates.notChecked", current: "updates.current", unavailable: "updates.notPublished",
  available: "updates.available", downloading: "updates.downloading", downloaded: "updates.downloaded",
  installing: "updates.installing", installed: "updates.installed", manual: "updates.manual", error: "updates.failed",
};

function ComponentRow({ name, item, t }: { name: string; item: ComponentUpdate; t: Translate }) {
  return <div className="updates-panel__component" data-update-phase={item.phase}>
    <div className="updates-panel__component-name">{name}</div>
    <div className="updates-panel__versions">
      <span>{item.current || "—"}</span>
      {item.latest && item.latest !== item.current && !["current", "unavailable"].includes(item.phase) ? <span> → {item.latest}</span> : null}
    </div>
    <span className="updates-panel__state">{t(phaseKeys[item.phase])}{item.percent != null && ["downloading", "installing"].includes(item.phase) ? ` ${Math.round(item.percent)}%` : ""}</span>
    {item.errorKey ? <div className="updates-panel__error" role="alert">{t(item.errorKey as MessageKey)}</div> : item.error ? <div className="updates-panel__error" role="alert">{item.error}</div> : null}
    {item.percent != null && ["downloading", "installing"].includes(item.phase) ? <progress max={100} value={item.percent} aria-label={name} /> : null}
  </div>;
}

export function UpdatesPanel({ t, compact = false, onDismiss }: { t: Translate; compact?: boolean; onDismiss?: () => void }) {
  const { snapshot, checkForUpdate, updateAll, restartToUpdate } = useUpdaterContext();
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const busy = snapshot.checking || snapshot.updating || snapshot.restarting;
  const canUpdate = [snapshot.app, snapshot.cli].some((item) => item.phase === "available" || (item.phase === "error" && item.latest && !["manual", "none"].includes(item.source ?? "")));
  const openManual = async () => {
    try {
      setOpenError(null);
      const url = snapshot.app.downloadUrl || snapshot.app.releaseUrl;
      if (url) await api.openExternalUrl(url);
    } catch (error) { setOpenError(String(error)); }
  };

  return <section className={`updates-panel${compact ? " updates-panel--compact" : ""}`} aria-label={t("updates.title")} data-testid="combined-updates">
    <div className="updates-panel__heading">
      <IconCircleArrowUp size={17} />
      <strong>{t(snapshot.restartRequired ? "updates.restartReady" : "updates.title")}</strong>
      {snapshot.checking ? <span role="status">{t("updates.checking")}</span> : null}
    </div>
    <div className="updates-panel__components">
      <ComponentRow name={t("updates.app")} item={snapshot.app} t={t} />
      <ComponentRow name={t("updates.cli")} item={snapshot.cli} t={t} />
    </div>
    {!compact || snapshot.restartRequired ? <p className="updates-panel__hint">{t(snapshot.restartRequired ? "updates.restartHint" : "updates.description")}</p> : null}
    <div className="updates-panel__actions">
      {!compact ? <button className="btn btn--ghost" disabled={busy} onClick={() => void checkForUpdate()}><IconRefresh size={14} /> {t("updates.check")}</button> : null}
      {canUpdate ? <button className="btn btn--solid" disabled={busy} onClick={() => void updateAll()}>{t(snapshot.updating ? "updates.downloading" : "updates.updateBoth")}</button> : null}
      {snapshot.restartRequired ? <button className="btn btn--solid updates-panel__restart" disabled={busy} onClick={() => setConfirmRestart(true)}><IconRefresh size={14} /> {t(snapshot.restarting ? "updates.restarting" : "updates.restart")}</button> : null}
      {snapshot.app.phase === "manual" ? <button className="btn btn--ghost" disabled={busy} onClick={() => void openManual()}>{t("updates.openDownload")}</button> : null}
      {onDismiss ? <button className="btn btn--ghost" disabled={busy} onClick={onDismiss}>{t("cliUpdate.later")}</button> : null}
    </div>
    {snapshot.error || openError ? <p role="alert" className="updates-panel__error">{snapshot.error || openError}</p> : null}
    <GlassModal open={confirmRestart} onClose={() => setConfirmRestart(false)} title={t("updates.confirmTitle")} size="sm" closeLabel={t("common.close")}
      footer={<><button className="btn btn--ghost" onClick={() => setConfirmRestart(false)}>{t("common.cancel")}</button><button className="btn btn--solid" onClick={() => { setConfirmRestart(false); void restartToUpdate(); }}>{t("updates.restart")}</button></>}>
      <p className="settings-row__desc">{t("updates.confirmBody")}</p>
    </GlassModal>
  </section>;
}
