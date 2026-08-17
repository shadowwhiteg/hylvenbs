/**
 * Layout em camadas puro e determinístico (design 006, T6.1, RQ-VIS-01/02).
 * Sem estado, sem I/O: mesma topologia sempre produz as mesmas coordenadas.
 * BFS a partir da raiz define a camada de cada agente; servidores MCP entram na
 * camada seguinte ao maior agente que os usa. Duas passadas de baricentro (uma
 * para frente, uma para trás) reduzem cruzamentos; empate preserva a ordem
 * corrente da camada, que é função apenas da topologia de entrada — o resultado
 * continua sem depender do histórico de renderização.
 */

export type GraphEdgeInput = { id: string; from: string; to: string; kind: string };

export type NodePosition = { x: number; y: number; layer: number };

export type LayoutResult = {
  positions: Map<string, NodePosition>;
  layers: string[][];
  width: number;
  height: number;
};

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 72;
export const H_GAP = 96;
export const V_GAP = 24;

export function layoutGraph(nodeIds: string[], edges: GraphEdgeInput[], rootId: string): LayoutResult {
  const delegateEdges = edges.filter((e) => e.kind === "delegate");
  const otherEdges = edges.filter((e) => e.kind !== "delegate");

  const layer = new Map<string, number>();
  const outByDelegate = new Map<string, string[]>();
  for (const e of delegateEdges) {
    if (!outByDelegate.has(e.from)) outByDelegate.set(e.from, []);
    outByDelegate.get(e.from)!.push(e.to);
  }

  if (nodeIds.includes(rootId)) {
    layer.set(rootId, 0);
    const queue = [rootId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const l = layer.get(id)!;
      for (const to of outByDelegate.get(id) ?? []) {
        if (!layer.has(to)) {
          layer.set(to, l + 1);
          queue.push(to);
        }
      }
    }
  }

  // Nós fora da árvore de delegação (ex.: servidor MCP) entram na camada seguinte
  // ao maior agente que os referencia. Repetimos até estabilizar (grafo raso, poucas
  // iterações na prática).
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of otherEdges) {
      const fromLayer = layer.get(e.from);
      if (fromLayer === undefined) continue;
      const candidate = fromLayer + 1;
      const current = layer.get(e.to);
      if (current === undefined || candidate > current) {
        layer.set(e.to, candidate);
        changed = true;
      }
    }
  }

  for (const id of nodeIds) {
    if (!layer.has(id)) layer.set(id, 0);
  }

  // Ordem de descoberta inicial dentro de cada camada.
  const maxLayer = Math.max(0, ...[...layer.values()]);
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  const placed = new Set<string>();
  for (const id of nodeIds) {
    if (placed.has(id)) continue;
    layers[layer.get(id)!]!.push(id);
    placed.add(id);
  }

  reduceCrossings(layers, edges, true);
  reduceCrossings(layers, edges, false);

  const layerHeights = layers.map((l) => (l.length ? l.length * NODE_HEIGHT + (l.length - 1) * V_GAP : 0));
  const maxHeight = Math.max(NODE_HEIGHT, ...layerHeights);

  const positions = new Map<string, NodePosition>();
  layers.forEach((layerNodes, li) => {
    const x = li * (NODE_WIDTH + H_GAP);
    const yOffset = (maxHeight - layerHeights[li]!) / 2;
    layerNodes.forEach((id, idx) => {
      const y = yOffset + idx * (NODE_HEIGHT + V_GAP);
      positions.set(id, { x, y, layer: li });
    });
  });

  return {
    positions,
    layers,
    width: layers.length * NODE_WIDTH + Math.max(0, layers.length - 1) * H_GAP,
    height: maxHeight,
  };
}

function reduceCrossings(layers: string[][], edges: GraphEdgeInput[], forward: boolean): void {
  const range = forward
    ? layers.map((_, i) => i).slice(1)
    : layers
        .map((_, i) => i)
        .slice(0, -1)
        .reverse();

  for (const li of range) {
    const neighborLi = forward ? li - 1 : li + 1;
    const neighborPos = new Map<string, number>();
    layers[neighborLi]!.forEach((id, idx) => neighborPos.set(id, idx));

    const barycenter = new Map<string, number>();
    layers[li]!.forEach((id, idx) => {
      const neighborIndices = edges
        .filter((e) => (forward ? e.to === id : e.from === id))
        .map((e) => neighborPos.get(forward ? e.from : e.to))
        .filter((v): v is number => v !== undefined);
      barycenter.set(id, neighborIndices.length ? average(neighborIndices) : idx);
    });

    // Empate é resolvido pela ordem que a camada já tinha — ordenar por id aqui
    // desfaria o agrupamento por pai que a passada anterior acabou de produzir
    // (todos os subagentes de um MCP compartilhado empatam em baricentro).
    const currentPos = new Map<string, number>();
    layers[li]!.forEach((id, idx) => currentPos.set(id, idx));

    layers[li] = [...layers[li]!].sort((a, b) => {
      const diff = barycenter.get(a)! - barycenter.get(b)!;
      if (diff !== 0) return diff;
      return currentPos.get(a)! - currentPos.get(b)!;
    });
  }
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
