"use client";

import { useMemo, useRef, useState } from "react";
import type { GraphDataDto, GraphEdgeDto, GraphNodeDto, GraphNodeState } from "@/lib/client";
import { exportPng, exportSvg } from "@/lib/graph/export";
import { H_GAP, NODE_HEIGHT, NODE_WIDTH, layoutGraph, V_GAP } from "@/lib/graph/layout";

const MARGIN = 32;
const MIN_SCALE = 0.2;
const MAX_SCALE = 3;

/** Aparência por estado — nunca só cor (RQ-VIS-11): ícone + rótulo sempre acompanham. */
const STATE_STYLE: Record<GraphNodeState, { stroke: string; icon: string; label: string; pulse?: boolean }> = {
  idle: { stroke: "var(--border-strong)", icon: "", label: "ocioso" },
  running: { stroke: "var(--accent)", icon: "▶", label: "executando", pulse: true },
  ok: { stroke: "var(--success)", icon: "✓", label: "concluído" },
  error: { stroke: "var(--danger)", icon: "⚠", label: "falhou" },
  cancelled: { stroke: "var(--fg-muted)", icon: "⊘", label: "cancelado" },
};

const TYPE_LABEL: Record<GraphNodeDto["type"], string> = {
  orchestrator: "orquestrador",
  agent: "agente",
  subagent: "subagente",
  mcpServer: "servidor MCP",
};

type ViewBox = { x: number; y: number; w: number; h: number };

export type GraphViewProps = {
  graph: GraphDataDto;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  className?: string;
};

export function GraphView({ graph, selectedNodeId, onSelectNode, className }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeIds = useMemo(() => graph.nodes.map((n) => n.id), [graph.nodes]);
  const layout = useMemo(() => layoutGraph(nodeIds, graph.edges, graph.rootId), [nodeIds, graph.edges, graph.rootId]);

  const fitted = useMemo<ViewBox>(
    () => ({ x: -MARGIN, y: -MARGIN, w: layout.width + MARGIN * 2, h: layout.height + MARGIN * 2 }),
    [layout.width, layout.height],
  );
  const [viewBox, setViewBox] = useState<ViewBox>(fitted);
  const [lastFitted, setLastFitted] = useState(fitted);
  if (fitted.w !== lastFitted.w || fitted.h !== lastFitted.h) {
    setLastFitted(fitted);
    setViewBox(fitted);
  }

  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const errorCount = graph.runtime ? Object.values(graph.runtime.nodes).filter((n) => n.state === "error").length : 0;
  const ariaLabel = `Fluxo com ${graph.nodes.length} nós${errorCount ? `, ${errorCount} em falha` : ""}`;

  function clientToSvgPoint(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    return { x: viewBox.x + px * viewBox.w, y: viewBox.y + py * viewBox.h };
  }

  function handleWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const point = clientToSvgPoint(e.clientX, e.clientY);
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    const currentScale = fitted.w / viewBox.w;
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, currentScale / factor));
    const newW = fitted.w / nextScale;
    const newH = fitted.h / nextScale;
    const ratioX = (point.x - viewBox.x) / viewBox.w;
    const ratioY = (point.y - viewBox.y) / viewBox.h;
    setViewBox({ x: point.x - ratioX * newW, y: point.y - ratioY * newH, w: newW, h: newH });
  }

  const dragState = useRef<{ x: number; y: number } | null>(null);
  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    dragState.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragState.current) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - dragState.current.x) / rect.width) * viewBox.w;
    const dy = ((e.clientY - dragState.current.y) / rect.height) * viewBox.h;
    dragState.current = { x: e.clientX, y: e.clientY };
    setViewBox((vb) => ({ ...vb, x: vb.x - dx, y: vb.y - dy }));
  }
  function handlePointerUp() {
    dragState.current = null;
  }

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => svgRef.current && exportSvg(svgRef.current)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs hover:bg-surface-hover"
        >
          Exportar SVG
        </button>
        <button
          type="button"
          onClick={() => svgRef.current && exportPng(svgRef.current)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs hover:bg-surface-hover"
        >
          Exportar PNG
        </button>
        <button
          type="button"
          onClick={() => setViewBox(fitted)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs hover:bg-surface-hover"
        >
          Ajustar
        </button>
      </div>
      <svg
        ref={svgRef}
        role="img"
        aria-label={ariaLabel}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="w-full cursor-grab touch-none rounded-lg border border-border bg-bg-subtle active:cursor-grabbing"
        style={{ height: Math.min(560, Math.max(240, layout.height + MARGIN * 2)) }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--fg-muted)" />
          </marker>
        </defs>

        {graph.edges.map((edge) => (
          <EdgeView
            key={edge.id}
            edge={edge}
            layout={layout}
            calls={graph.runtime?.edges[edge.id]?.calls}
            highlighted={selectedNodeId === edge.from || selectedNodeId === edge.to}
          />
        ))}

        {graph.nodes.map((node) => (
          <NodeView
            key={node.id}
            node={node}
            position={layout.positions.get(node.id)}
            runtime={graph.runtime?.nodes[node.id]}
            selected={selectedNodeId === node.id}
            onSelect={() => onSelectNode(node.id === selectedNodeId ? null : node.id)}
          />
        ))}
      </svg>

      <ul className="mt-2 flex flex-wrap gap-3 text-[11px] text-fg-muted">
        {(Object.entries(STATE_STYLE) as [GraphNodeState, (typeof STATE_STYLE)[GraphNodeState]][])
          .filter(([state]) => state !== "idle")
          .map(([state, style]) => (
            <li key={state} className="flex items-center gap-1">
              <span style={{ color: style.stroke }}>{style.icon || "○"}</span> {style.label}
            </li>
          ))}
      </ul>
    </div>
  );
}

function EdgeView({
  edge,
  layout,
  calls,
  highlighted,
}: {
  edge: GraphEdgeDto;
  layout: ReturnType<typeof layoutGraph>;
  calls: number | undefined;
  highlighted: boolean;
}) {
  const from = layout.positions.get(edge.from);
  const to = layout.positions.get(edge.to);
  if (!from || !to) return null;

  const isBackEdge = to.layer <= from.layer;
  const x1 = from.x + NODE_WIDTH;
  const y1 = from.y + NODE_HEIGHT / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_HEIGHT / 2;

  const path = isBackEdge
    ? `M${x1},${y1} A${Math.abs(x1 - x2) / 2 + 40},${60} 0 0 1 ${x2},${y2}`
    : `M${x1},${y1} C${x1 + H_GAP / 2},${y1} ${x2 - H_GAP / 2},${y2} ${x2},${y2}`;

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2 - (isBackEdge ? 60 : 0);

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={highlighted ? "var(--accent)" : "var(--border-strong)"}
        strokeWidth={highlighted ? 2 : 1.5}
        strokeDasharray={edge.kind === "tool" || isBackEdge ? "4 3" : undefined}
        markerEnd="url(#arrow)"
      />
      {calls && calls > 1 ? (
        <text x={midX} y={midY - 4} textAnchor="middle" fontSize="11" fill="var(--fg-muted)" className="font-mono">
          ×{calls}
        </text>
      ) : null}
    </g>
  );
}

function NodeView({
  node,
  position,
  runtime,
  selected,
  onSelect,
}: {
  node: GraphNodeDto;
  position: { x: number; y: number } | undefined;
  runtime: (GraphDataDto["runtime"] extends infer R ? (R extends { nodes: Record<string, infer N> } ? N : never) : never) | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  if (!position) return null;
  const state = runtime?.state ?? "idle";
  const style = STATE_STYLE[state];
  const isMcp = node.type === "mcpServer";

  return (
    <g
      transform={`translate(${position.x}, ${position.y})`}
      onClick={onSelect}
      role="button"
      tabIndex={-1}
      aria-label={`${node.label}, ${TYPE_LABEL[node.type]}, ${style.label}${runtime?.errorType ? `, erro ${runtime.errorType}` : ""}`}
      className="cursor-pointer"
    >
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={isMcp ? NODE_HEIGHT / 2 : 10}
        fill="var(--surface)"
        stroke={style.stroke}
        strokeWidth={selected ? 3 : 2}
        className={style.pulse ? "animate-pulse" : undefined}
      />
      <RoleMarker type={node.type} />
      <text x={14} y={22} fontSize="12" fontWeight={600} fill="var(--fg)">
        {truncate(node.label, 22)}
      </text>
      <text x={14} y={40} fontSize="10" fill="var(--fg-muted)">
        {TYPE_LABEL[node.type]}
        {node.model ? ` · ${node.model}` : ""}
      </text>
      {style.icon ? (
        <text x={NODE_WIDTH - 22} y={22} fontSize="13" fill={style.stroke}>
          {style.icon}
        </text>
      ) : null}
      {runtime ? (
        <text x={14} y={58} fontSize="10" fill="var(--fg-muted)" className="font-mono">
          {runtime.calls > 0 ? `${runtime.calls}× · ` : ""}
          {runtime.inputTokens || runtime.outputTokens ? `${runtime.inputTokens}/${runtime.outputTokens} tok · ` : ""}
          {runtime.durationMs != null ? `${runtime.durationMs}ms` : ""}
        </text>
      ) : null}
      {runtime?.errorType ? (
        <text x={14} y={NODE_HEIGHT - 6} fontSize="10" fill="var(--danger)">
          {truncate(runtime.errorType, 26)}
        </text>
      ) : null}
    </g>
  );
}

/**
 * Marca o papel por forma, não só cor (RQ-HIER-07, RQ-VIS-11): orquestrador é uma
 * barra sólida contínua (raiz, um bloco só); agente intermediário é a mesma barra
 * partida ao meio (delega e é delegado); subagente não tem barra (folha).
 */
function RoleMarker({ type }: { type: GraphNodeDto["type"] }) {
  if (type === "orchestrator") {
    return <rect x={0} y={0} width={4} height={NODE_HEIGHT} rx={2} fill="var(--accent)" />;
  }
  if (type === "agent") {
    const segment = NODE_HEIGHT / 2 - 3;
    return (
      <>
        <rect x={0} y={0} width={4} height={segment} rx={2} fill="var(--accent)" />
        <rect x={0} y={NODE_HEIGHT - segment} width={4} height={segment} rx={2} fill="var(--accent)" />
      </>
    );
  }
  return null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export { NODE_WIDTH, NODE_HEIGHT, V_GAP };
