/**
 * App shell — providers only. Feature state lives in domain modules.
 * Growth freeze: App.tsx + AppWorkbench.tsx combined lines may only decrease
 * (see AGENTS.md §7). New product state must not land here.
 */
import { AppProviders } from "@/providers/AppProviders";
import { AppWorkbench } from "@/app/AppWorkbench";

export default function App() {
  return (
    <AppProviders>
      <AppWorkbench />
    </AppProviders>
  );
}
