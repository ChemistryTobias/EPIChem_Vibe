/**
 * One row of the hierarchy tree, plus its children — recursive.
 *
 * Indentation is a computed inline padding rather than nested containers, so
 * every row shares one hover style and one hit target regardless of depth.
 */

import type { TreeNode } from "./hierarchyTree";
import { indentFor } from "./indent";

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (uuid: string) => void;
  onSelect: (node: TreeNode) => void;
}

export function TreeRow({ node, depth, expanded, onToggle, onSelect }: TreeRowProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.uuid);

  return (
    <li>
      <div className="tree__row" style={{ paddingLeft: `${indentFor(depth)}px` }}>
        <button
          className="tree__twisty"
          onClick={() => hasChildren && onToggle(node.uuid)}
          aria-label={hasChildren ? (isExpanded ? "Collapse" : "Expand") : undefined}
          aria-expanded={hasChildren ? isExpanded : undefined}
          disabled={!hasChildren}
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : "·"}
        </button>

        <span className="tree__kind label">{node.kind}</span>
        <button className="tree__name" onClick={() => onSelect(node)}>
          {node.name}
        </button>
        {hasChildren && <span className="tree__count muted">{node.children.length}</span>}
      </div>

      {hasChildren && isExpanded && (
        <ul className="tree__children">
          {node.children.map((child) => (
            <TreeRow
              key={child.uuid}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
