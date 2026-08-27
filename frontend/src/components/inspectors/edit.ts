/**
 * The inspector's editor: a draft of pending changes, shared with whichever
 * screen owns the panel.
 *
 * The screen owns the draft rather than the inspector, because on the layout
 * canvas a drag and a typed coordinate are the *same* edit — dragging a box
 * writes geometry into this draft, and the editor's number fields read and
 * write the very same entry. One Save writes it.
 */

import { createContext, useContext } from "react";

export interface EditSession {
  editing: boolean;
  /** Field name -> pending value. Empty means nothing has been altered. */
  draft: Record<string, unknown>;
  set: (field: string, value: unknown) => void;
}

export const EditContext = createContext<EditSession | null>(null);

export const useEditSession = () => useContext(EditContext);

/** A field's current value: the draft's, if it has one, else the record's. */
export function useFieldValue<T>(row: object, field: string): T {
  const session = useEditSession();
  if (session && field in session.draft) return session.draft[field] as T;
  return (row as Record<string, unknown>)[field] as T;
}
