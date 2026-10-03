import { createContext, useContext } from "react";
import type { NavigationViewer } from "../features/event-slice/contracts";

/**
 * Who is looking at the page: the signed-in viewer, null for a visitor, or
 * "pending" until `/api/navigation-session` answers. The server HTML is
 * viewer-neutral, so anything that depends on this renders as pending first.
 */
export type ViewerState = NavigationViewer | null | "pending";

export const ViewerContext = createContext<ViewerState>("pending");

export function useViewer(): ViewerState {
  return useContext(ViewerContext);
}
