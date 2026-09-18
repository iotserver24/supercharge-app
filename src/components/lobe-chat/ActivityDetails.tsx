import { useMemo } from "react";
import { createT, type Locale } from "@/i18n";
import type { ActivityGroup } from "@/lib/activityOverview";
import { toolFailed } from "@/lib/grokActivitySteps";
import { TimelineToolRow } from "./TimelineToolRow";

export function ActivityDetails({ groups, locale, live }: { groups: ActivityGroup[]; locale: Locale; live: boolean }) {
  const tr = useMemo(() => createT(locale), [locale]);
  return (
    <div className="activity-details">
      {groups.map((group) => (
        <details className="activity-details__group" key={group.kind} open={group.tools.some(toolFailed)}>
          <summary>
            <span>{tr(`chat.activity.${group.kind}`)}</span>
            <span className="activity-details__count">{group.tools.length}</span>
          </summary>
          <div className="activity-details__tools">
            {group.tools.map((tool, index) => (
              <TimelineToolRow key={tool.toolCallId || index} tool={live || toolFailed(tool) ? tool : { ...tool, streaming: false, status: /^(running|pending|in_progress)$/.test(tool.status || "") ? "" : tool.status }} locale={locale} defaultExpanded={toolFailed(tool)} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
