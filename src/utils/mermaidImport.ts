import { Graph as DagreGraph, layout } from '@dagrejs/dagre'
import type { ApiEdge, ApiNode, Graph, NodeType, Shape } from '../types/board'
import { LANE_BAND, LANE_HEIGHT, MIN_POOL_WIDTH, POOL_HEADER } from './containerLayout.ts'
import { parseMermaid, type MermaidAst, type MermaidDirection, type MermaidResult } from './mermaidParse.ts'

export type MermaidImport = MermaidResult & { graph: Graph | null }

const PAD = 24
const GENERAL_LANE = 'Geral'
const FALLBACK_SIZE: Record<string, { width: number; height: number }> = {
  stage: { width: 220, height: 90 },
  gateway: { width: 90, height: 90 },
  start: { width: 70, height: 70 },
  end: { width: 70, height: 70 },
}

const HANDLES: Record<MermaidDirection, { source: string; target: string }> = {
  LR: { source: 'r', target: 'l' },
  RL: { source: 'l', target: 'r' },
  TB: { source: 'b', target: 't' },
  BT: { source: 't', target: 'b' },
}

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const YES = new Set(['sim', 'yes', 's', 'y', 'true'])
const NO = new Set(['nao', 'no', 'n', 'false'])

const branchOf = (label: string | null): 'true' | 'false' | null => {
  if (!label) return null
  const key = normalize(label)
  return YES.has(key) ? 'true' : NO.has(key) ? 'false' : null
}

const area = (shapes: Map<string, Shape>, key: 'pool' | 'lane', id: string, parentId: string | null, frame: { x: number; y: number; width: number; height: number }, title: string): ApiNode => ({
  id, type: 'area', shapeKey: key, parentId, ...frame, rotation: 0, zIndex: 0, title, description: null, inputs: null, outputs: null,
  style: shapes.get(key)?.style ?? null, data: null, locked: false, attachments: [],
})

// Subgraphs viram lanes de uma unica pool; os nos ficam relativos a lane, mantendo o layout global da esquerda para a direita.
function arrangeInPool(ast: MermaidAst, nodes: ApiNode[], edges: ApiEdge[], ids: Map<string, string>, shapes: Map<string, Shape>, stamp: string): Graph {
  const lanes = ast.groups.map((group) => ({ id: group.id, title: group.title }))
  if (ast.nodes.some((node) => !node.group)) lanes.push({ id: '', title: GENERAL_LANE })
  const laneOf = new Map(ast.nodes.map((node) => [ids.get(node.id) as string, node.group ?? '']))
  const order = new Map(lanes.map((lane, index) => [lane.id, index]))
  const minX = Math.min(...nodes.map((node) => node.x))
  const offsetX = LANE_BAND + PAD
  const laneWidth = Math.max(MIN_POOL_WIDTH, offsetX + Math.max(...nodes.map((node) => node.x - minX + (node.width ?? 0))) + PAD)
  const poolId = `pool-${stamp}`
  const laneNodes: ApiNode[] = []
  let cursor = POOL_HEADER

  lanes.forEach((lane, index) => {
    const members = nodes.filter((node) => laneOf.get(node.id) === lane.id)
    const top = Math.min(...members.map((node) => node.y))
    const span = Math.max(...members.map((node) => node.y + (node.height ?? 0))) - top
    const height = Math.max(LANE_HEIGHT, span + 2 * PAD)
    const shift = Math.round((height - span) / 2)
    const laneId = `lane-${stamp}g${index.toString(36)}`
    for (const node of members) Object.assign(node, { parentId: laneId, x: node.x - minX + offsetX, y: node.y - top + shift })
    laneNodes.push(area(shapes, 'lane', laneId, poolId, { x: 0, y: cursor, width: laneWidth, height }, lane.title))
    cursor += height
  })

  for (const edge of edges) {
    const from = order.get(laneOf.get(edge.source) ?? '') ?? 0
    const to = order.get(laneOf.get(edge.target) ?? '') ?? 0
    const handles = from === to ? HANDLES.LR : to > from ? HANDLES.TB : HANDLES.BT
    edge.sourceHandle = handles.source
    edge.targetHandle = handles.target
  }

  const pool = area(shapes, 'pool', poolId, null, { x: 0, y: 0, width: laneWidth, height: cursor }, 'Processo')
  return { nodes: [pool, ...laneNodes, ...nodes], edges }
}

export function astToGraph(ast: MermaidAst, shapes: Shape[]): Graph {
  const incoming = new Set(ast.edges.map((edge) => edge.target))
  const outgoing = new Set(ast.edges.map((edge) => edge.source))
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const ids = new Map<string, string>()

  const typeOf = (id: string, shape: string | null): 'start' | 'end' | 'stage' | 'gateway' => {
    if (shape === 'diamond' || shape === 'hexagon') return 'gateway'
    if (shape === 'stadium') return !incoming.has(id) ? 'start' : !outgoing.has(id) ? 'end' : 'stage'
    return 'stage'
  }

  const catalog = new Map(shapes.map((shape) => [shape.key, shape]))
  const sized = ast.nodes.map((node, index) => {
    const key = typeOf(node.id, node.shape)
    const shape = catalog.get(key)
    const fallback = FALLBACK_SIZE[key]
    const apiId = `${key}-${stamp}${index.toString(36)}`
    ids.set(node.id, apiId)
    return { node, key, apiId, shape, width: shape?.width ?? fallback.width, height: shape?.height ?? fallback.height }
  })

  const dagre = new DagreGraph({ multigraph: true })
  dagre.setGraph({ rankdir: ast.groups.length ? 'LR' : ast.direction, nodesep: 50, ranksep: 80, marginx: 0, marginy: 0 })
  dagre.setDefaultEdgeLabel(() => ({}))
  sized.forEach((item) => dagre.setNode(item.apiId, { width: item.width, height: item.height }))
  ast.edges.forEach((edge, index) => {
    const label = edge.label
    dagre.setEdge(ids.get(edge.source) as string, ids.get(edge.target) as string, label ? { width: Math.min(label.length, 30) * 7, height: 16 } : {}, String(index))
  })
  layout(dagre)

  const nodes: ApiNode[] = sized.map(({ node, key, apiId, shape, width, height }) => {
    const placed = dagre.node(apiId)
    return {
      id: apiId,
      type: key as NodeType,
      shapeKey: key,
      parentId: null,
      x: Math.round(placed.x - width / 2),
      y: Math.round(placed.y - height / 2),
      width,
      height,
      rotation: 0,
      zIndex: 0,
      title: node.text ?? node.id,
      description: null,
      inputs: null,
      outputs: null,
      style: shape?.style ?? null,
      data: { mermaidId: node.id },
      locked: false,
      attachments: [],
    }
  })

  const handles = HANDLES[ast.groups.length ? 'LR' : ast.direction]
  const gateways = new Set(nodes.filter((node) => node.type === 'gateway').map((node) => node.id))
  const edges: ApiEdge[] = ast.edges.map((edge, index) => {
    const source = ids.get(edge.source) as string
    return {
      id: `edge-${stamp}${index.toString(36)}`,
      source,
      target: ids.get(edge.target) as string,
      sourceHandle: handles.source,
      targetHandle: handles.target,
      type: 'smoothstep',
      label: edge.label,
      branch: gateways.has(source) ? branchOf(edge.label) : null,
      style: null,
      data: null,
    }
  })

  return ast.groups.length ? arrangeInPool(ast, nodes, edges, ids, catalog, stamp) : { nodes, edges }
}

export function importMermaid(source: string, shapes: Shape[]): MermaidImport {
  const result = parseMermaid(source)
  return { ...result, graph: result.ast ? astToGraph(result.ast, shapes) : null }
}

// Desloca o grafo para a direita da area ocupada e alinha ao topo (modo "adicionar").
export function placeBeside(graph: Graph, existing: { x: number; y: number; width?: number | null }[]): Graph {
  if (!existing.length || !graph.nodes.length) return graph
  const roots = graph.nodes.filter((node) => !node.parentId)
  const right = Math.max(...existing.map((node) => node.x + (node.width ?? 220)))
  const top = Math.min(...existing.map((node) => node.y))
  const dx = right + 120 - Math.min(...roots.map((node) => node.x))
  const dy = top - Math.min(...roots.map((node) => node.y))
  return { ...graph, nodes: graph.nodes.map((node) => (node.parentId ? node : { ...node, x: node.x + dx, y: node.y + dy })) }
}
