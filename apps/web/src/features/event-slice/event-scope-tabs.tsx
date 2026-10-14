import { TabLink, Tabs } from "../../components/tabs";
import type { EventsSearch, EventsViewerHomeSchool } from "./contracts";
import {
  currentEventScope,
  eventScopeSearch,
  type EventScope,
} from "./event-scope";

const scopeLabels: Record<EventScope, string> = {
  all: "All events",
  "my-school": "My school",
  online: "Online",
  tournaments: "Tournaments",
};

/**
 * All events, My school, Online, and Tournaments as `Tabs` links over the
 * events directory. My school appears only for a signed-in viewer whose home
 * school is known. Each tab keeps the other filters and starts from page one.
 */
export function EventScopeTabs({
  homeSchool,
  search,
}: {
  homeSchool?: EventsViewerHomeSchool;
  search: EventsSearch;
}) {
  const current = currentEventScope(search, homeSchool?.slug);
  const scopes: EventScope[] = homeSchool
    ? ["all", "my-school", "online", "tournaments"]
    : ["all", "online", "tournaments"];

  return (
    <div className="event-scope-tabs">
      <Tabs label="Event scope">
        {scopes.map((scope) => (
          <TabLink
            current={current === scope}
            key={scope}
            search={eventScopeSearch(search, scope, homeSchool?.slug)}
            to="/events"
          >
            {scopeLabels[scope]}
          </TabLink>
        ))}
      </Tabs>
    </div>
  );
}
