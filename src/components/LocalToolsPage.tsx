import { lazy, Suspense } from "react";
import type { Locale } from "@/i18n";

const UsagePage = lazy(() => import("./UsagePage").then((m) => ({ default: m.UsagePage })));
const PluginMarketplacePage = lazy(() => import("./PluginMarketplacePage").then((m) => ({ default: m.PluginMarketplacePage })));

export function LocalToolsPage(props: {
  pane: "usage" | "plugin-marketplace";
  locale: Locale;
  projectPath: string | null;
  cliFound: boolean;
}) {
  return (
    <Suspense fallback={null}>
      {props.pane === "usage" ? <UsagePage locale={props.locale} /> : <PluginMarketplacePage {...props} />}
    </Suspense>
  );
}
