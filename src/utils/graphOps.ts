import type { ApiEdge, ApiNode, Graph } from '../types/board'
import type { Ops } from '../types/realtime'

export const emptyOps = (): Ops => ({ nodes: [], delNodes: [], edges: [], delEdges: [] })
export const isEmptyOps = (ops: Ops) => !ops.nodes.length && !ops.delNodes.length && !ops.edges.length && !ops.delEdges.length

const changedItems = <T extends { id: string }>(prev: T[], next: T[]) => {
  const before = new Map(prev.map((item) => [item.id, JSON.stringify(item)]))
  const upserts = next.filter((item) => before.get(item.id) !== JSON.stringify(item))
  const alive = new Set(next.map((item) => item.id))
  return { upserts, removed: prev.filter((item) => !alive.has(item.id)).map((item) => item.id) }
}

// Diferenca por elemento entre o que o servidor conhece e o estado local.
export const diffOps = (prev: Graph, next: Graph): Ops => {
  const nodes = changedItems<ApiNode>(prev.nodes, next.nodes)
  const edges = changedItems<ApiEdge>(prev.edges, next.edges)
  return { nodes: nodes.upserts, delNodes: nodes.removed, edges: edges.upserts, delEdges: edges.removed }
}

const merge = <T extends { id: string }>(items: T[], upserts: T[], removed: string[]) => {
  const map = new Map(items.map((item) => [item.id, item]))
  upserts.forEach((item) => map.set(item.id, item))
  removed.forEach((id) => map.delete(id))
  return [...map.values()]
}

export const applyOps = (graph: Graph, ops: Ops): Graph => ({
  nodes: merge(graph.nodes, ops.nodes, ops.delNodes),
  edges: merge(graph.edges, ops.edges, ops.delEdges),
})

// Ids tocados por um conjunto de operacoes (para desfazer so o que a pessoa mudou).
export const touched = (ops: Ops) => ({ nodes: new Set([...ops.nodes.map((node) => node.id), ...ops.delNodes]), edges: new Set([...ops.edges.map((edge) => edge.id), ...ops.delEdges]) })
