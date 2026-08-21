/**
 * Right-hand detail panel for the selected Hierarchy node.
 *
 * Each kind shows the fields that kind actually has (`api/schemas.py`), so the
 * switch below is the one place that knows Zone has an atmosphere and a Station
 * carries the execution binding (ADR 0007).
 */

import { useState } from "react";

import { Inspector } from "../../components/Inspector";
import { Button } from "../../components/Button";
import { deleteNode } from "../../api/topology";
import { NodeDetails } from "./registryDetails";
import type { TreeNode } from "./topologyTree";

interface TopologyInspectorProps {
  node: TreeNode | null;
  onClose: () => void;
  /** Switch the panel to edit mode (not offered for Device — see EditInspector). */
  onEdit: (node: TreeNode) => void;
  /** The node was deleted: clear the selection and reload. */
  onDeleted: () => void;
}

export function TopologyInspector({ node, onClose, onEdit, onDeleted }: TopologyInspectorProps) {
  if (!node) {
    return (
      <Inspector
        kind="Hierarchy inspector"
        placeholder="Select a node in the tree to see its registry record."
      />
    );
  }

  return (
    <Inspector kind={`${node.kind} inspector`} title={node.name} subtitle={node.code} onClose={onClose}>
      <NodeActions node={node} onEdit={onEdit} onDeleted={onDeleted} />

      <NodeDetails
        kind={node.kind}
        row={node.row}
        childrenCodes={node.children.map((c) => c.code)}
      />
    </Inspector>
  );
}

/**
 * Edit / delete row for the selected node. Delete is a two-step inline confirm
 * (no browser dialog), and owns its own busy/error state — a 409 comes back when
 * the node still has children, which is a message worth showing, not swallowing.
 * Device is deletable but not editable here (its edit belongs with Device Status).
 */
function NodeActions({
  node,
  onEdit,
  onDeleted,
}: {
  node: TreeNode;
  onEdit: (node: TreeNode) => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteNode(node.kind, node.code);
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="node-actions">
      {confirming ? (
        <>
          <span className="node-actions__prompt">Delete {node.code}?</span>
          <Button variant="danger" onClick={remove} disabled={busy}>
            {busy ? "Deleting…" : "Confirm"}
          </Button>
          <Button onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          {node.kind !== "Device" && (
            <Button variant="primary" onClick={() => onEdit(node)}>
              Edit
            </Button>
          )}
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        </>
      )}
      {error && (
        <p className="create-form__error node-actions__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
