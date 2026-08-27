/**
 * Moving the inspector from one record to another.
 *
 * A screen that shows the inspector provides this; the inspector's reference
 * fields call it, so clicking a lab's site swaps the panel over to the site.
 * The screen decides what "selected" means for it — a row in a table, a box on
 * the canvas — which is why this is a callback and not shared state.
 */

import { createContext, useContext } from "react";

import type { EntityKind, EntityRow } from "../../api/types";

export interface InspectorTarget {
  kind: EntityKind;
  row: EntityRow;
}

export const InspectorNavContext = createContext<((target: InspectorTarget) => void) | null>(null);

export const useInspectorNav = () => useContext(InspectorNavContext);
