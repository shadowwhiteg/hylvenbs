"use client";

import { useMemo, useRef } from "react";
import { Badge } from "@/components/ui";
import type { GraphDataDto, GraphNodeState } from "@/lib/client";

const STATE_TONE: Record<GraphNodeState, "neutral" | "warning" | "success" | "danger"> = {
  idle: "neutral",
  running: "warning",
  ok: "success",
  error: "danger",
  cancelled: "neutral",
};

type TreeItem = { id: string; label: string; depth: number; type: string };

function flatten(graph: GraphDataDto): TreeItem[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!childrenOf.has(edge.from)) childrenOf.set(edge.from, []);
    childrenOf.get(edge.from)!.push(edge.to);
  }

  const items: TreeItem[] = [];
  const visited = new Set<string>();
  function visit(id: string, depth: number) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id);
    if (!node) return;
    items.push({ id, label: node.label, depth, type: node.type });
    for (const childId of childrenOf.get(id) ?? []) visit(childId, depth + 1);
  }
  if (byId.has(graph.rootId)) visit(graph.rootId, 0);
  for (const node of graph.nodes) visit(node.id, 0);

  return items;
}

/**
 * Árvore acessível equivalente ao grafo (RQ-VIS-10): mesma informação de estado e
 * erro que o SVG, navegável por setas e Enter, para quem usa teclado ou leitor de
 * tela.
 */
export function GraphTree({
  graph,
  selectedNodeId,
  onSelectNode,
}: {
  graph: GraphDataDto;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
}) {
  const items = useMemo(() => flatten(graph), [graph]);
  const refs = useRef<Map<string, HTMLLIElement>>(new Map());

  function focusIndex(index: number) {
    const clamped = Math.min(items.length - 1, Math.max(0, index));
    const item = items[clamped];
    if (item) refs.current.get(item.id)?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLLIElement>, index: number) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusIndex(index + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusIndex(index - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectNode(items[index]!.id);
    }
  }

  return (
    <ul role="tree" aria-label="Árvore de agentes e servidores MCP" className="space-y-0.5 text-sm">
      {items.map((item, index) => {
        const runtime = graph.runtime?.nodes[item.id];
        const state = runtime?.state ?? "idle";
        return (
          <li
            key={item.id}
            ref={(el) => {
              if (el) refs.current.set(item.id, el);
            }}
            role="treeitem"
            aria-level={item.depth + 1}
            aria-selected={selectedNodeId === item.id}
            tabIndex={index === 0 ? 0 : -1}
            style={{ paddingLeft: item.depth * 16 }}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent aria-selected:bg-accent-soft"
            onClick={() => onSelectNode(item.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            <span className="truncate">{item.label}</span>
            <Badge tone={STATE_TONE[state]}>{state}</Badge>
            {runtime?.errorType ? <span className="truncate text-[11px] text-danger">{runtime.errorType}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
