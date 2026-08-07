/**
 * One row of the topology tree, plus its children. Recursive: a node renders
 * itself and then renders `TopologyNode` again for each child.
 *
 * Indentation is a computed inline padding rather than nested containers, so
 * every row shares one hover/selected style and one hit target regardless of
 * depth.
 */

import type { TreeNode } from "./topologyTree";

interface TopologyNodeProps {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onSelect: (node: TreeNode) => void;
  onToggle: (id: string) => void;
}

export function TopologyNode({
  node,
  depth,
  selectedId,
  expanded,
  onSelect,
  onToggle,
}: TopologyNodeProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = node.id === selectedId;

  return (
    <li className="tree__item">
      <div
        className={isSelected ? "tree__row tree__row--selected" : "tree__row"}
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
      >
        <button
          className="tree__twisty"
          onClick={() => hasChildren && onToggle(node.id)}
          aria-label={hasChildren ? (isExpanded ? "Collapse" : "Expand") : undefined}
          aria-expanded={hasChildren ? isExpanded : undefined}
          disabled={!hasChildren}
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : "·"}
        </button>

        <button className="tree__label" onClick={() => onSelect(node)}>
          <span className="tree__kind label">{node.kind}</span>
          <span className="tree__code mono">{node.code}</span>
          <span className="tree__name">{node.name}</span>
          {hasChildren && <span className="tree__count muted">{node.children.length}</span>}
        </button>
      </div>

      {hasChildren && isExpanded && (
        <ul className="tree__children">
          {node.children.map((child) => (
            <TopologyNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
