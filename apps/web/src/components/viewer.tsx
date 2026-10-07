import { createContext, useContext } from "react";
import type { NavigationViewer } from "../features/event-slice/contracts";

/**
 * Who is looking at the page: the signed-in viewer, or null for a visitor.
 * The root route learns it on the server, so the first HTML already has it.
 */
export type ViewerState = NavigationViewer | null;

export const ViewerContext = createContext<ViewerState>(null);

export function useViewer(): ViewerState {
  return useContext(ViewerContext);
}
