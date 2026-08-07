/**
 * The write history of one hierarchy node (ADR 0004): every create/update/delete
 * records a full snapshot, and this surfaces that trail in the inspector — the
 * "version control" view. Read-only for now; restoring a past revision is a
 * separate capability (forward-revert semantics) that will get its own ADR.
 *
 * Newest first, which is the reverse of the API's write order.
 */

import { useCallback } from "react";

import { fetchRevisions } from "../../api/topology";
import type { HierarchyKind } from "../../api/topology";
import { FieldGroup } from "../../components/Inspector";
import { useAsync } from "../../hooks/useAsync";

import "./RevisionHistory.css";

const ACTION_TONE: Record<string, string> = {
  create: "rev--create",
  update: "rev--update",
  delete: "rev--delete",
};

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function RevisionHistory({ kind, code }: { kind: HierarchyKind; code: string }) {
  // Re-fetch whenever the selected node changes (kind+code are the key).
  const state = useAsync(useCallback(() => fetchRevisions(kind, code), [kind, code]));

  return (
    <FieldGroup title="History">
      {state.loading && <p className="muted rev__note">Loading…</p>}
      {state.error && (
        <p className="rev__note" role="alert">
          Couldn&apos;t load history: {state.error.message}
        </p>
      )}
      {state.data &&
        (state.data.length === 0 ? (
          <p className="muted rev__note">No revisions recorded.</p>
        ) : (
          <ol className="rev">
            {[...state.data].reverse().map((r) => (
              <li key={r.id} className="rev__item">
                <span className={`rev__action ${ACTION_TONE[r.action] ?? ""}`}>{r.action}</span>
                <span className="rev__num mono">#{r.revision_number}</span>
                <span className="rev__meta">
                  {when(r.created_at)}
                  {r.created_by ? ` · ${r.created_by}` : ""}
                </span>
              </li>
            ))}
          </ol>
        ))}
    </FieldGroup>
  );
}
