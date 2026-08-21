/** Static demo procedure — no procedure IR/backend exists yet. */

import type { Edge, Node } from "@xyflow/react";

export const MOCK_NODES: Node[] = [
  { id: "dissolve", position: { x: 0, y: 80 }, data: { label: "Dissolve" } },
  { id: "mix", position: { x: 220, y: 80 }, data: { label: "Mix" } },
  { id: "coat", position: { x: 440, y: 80 }, data: { label: "Coat" } },
  { id: "anneal", position: { x: 660, y: 80 }, data: { label: "Anneal" } },
];

export const MOCK_EDGES: Edge[] = [
  { id: "e1", source: "dissolve", target: "mix" },
  { id: "e2", source: "mix", target: "coat" },
  { id: "e3", source: "coat", target: "anneal" },
];
