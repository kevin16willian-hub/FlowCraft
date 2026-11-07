import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { CSSProperties } from 'react'
import { containerKind, type ContainerKind } from './containerKind.ts'
import type { ApiAttachment, ApiEdge, ApiNode, Graph, NodeType, Shape } from '../types/board'

export type FlowNodeData = {
  title: string
  description: string
  inputs: string
  outputs: string
  shapeKey: string | null
  attachments: ApiAttachment[]
  style: Record<string, unknown> | null
  extra: Record<string, unknown> | null
  [key: string]: unknown
}

export type FlowNode = Node<FlowNodeData, NodeType>

const round = (value: number) => Math.round(value * 10) / 10

// Pais sempre antes dos filhos (exigencia do React Flow).
export const sortParentsFirst = <T extends { id: string; parentId?: string | null }>(nodes: T[]): T[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const seen = new Set<string>()
  const ordered: T[] = []
  const visit = (node: T) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent) visit(parent)
    ordered.push(node)
  }
  nodes.forEach(visit)
  return ordered
}

export { containerKind, type ContainerKind }

const CONTAINER_Z: Record<ContainerKind, number> = { pool: -30, lane: -20, phase: -20 }

export const toFlowNodes = (nodes: ApiNode[]): FlowNode[] => sortParentsFirst(nodes).map((node) => ({
  id: node.id,
  type: node.type,
  position: { x: node.x, y: node.y },
  parentId: node.parentId ?? undefined,
  zIndex: node.type === 'area' ? CONTAINER_Z[containerKind(node.type, node.shapeKey) ?? 'phase'] : node.zIndex,
  width: node.width ?? undefined,
  height: node.height ?? undefined,
  draggable: !node.locked,
  data: {
    title: node.title ?? '',
    description: node.description ?? '',
    inputs: node.inputs ?? '',
    outputs: node.outputs ?? '',
    shapeKey: node.shapeKey,
    attachments: node.attachments,
    style: node.style,
    extra: node.data,
  },
}))

export const toFlowEdges = (edges: ApiEdge[]): Edge[] => edges.map((edge) => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  sourceHandle: edge.sourceHandle,
  targetHandle: edge.targetHandle,
  type: edge.type ?? 'smoothstep',
  label: edge.label ?? undefined,
  markerEnd: { type: MarkerType.ArrowClosed },
  style: edge.style ? (edge.style as CSSProperties) : undefined,
  data: { branch: edge.branch, style: edge.style, extra: edge.data },
}))

export const toApiGraph = (nodes: FlowNode[], edges: Edge[]): Graph => ({
  nodes: nodes.map((node) => ({
    id: node.id,
    type: node.type ?? 'shape',
    shapeKey: node.data.shapeKey,
    parentId: node.parentId ?? null,
    x: round(node.position.x),
    y: round(node.position.y),
    width: node.width ?? node.measured?.width ?? null,
    height: node.height ?? node.measured?.height ?? null,
    rotation: 0,
    zIndex: node.type === 'area' ? 0 : node.zIndex ?? 0,
    title: node.data.title || null,
    description: node.data.description || null,
    inputs: node.data.inputs || null,
    outputs: node.data.outputs || null,
    style: node.data.style,
    data: node.data.extra,
    locked: node.draggable === false,
    attachments: node.data.attachments.map((attachment) => ({ name: attachment.name })),
  })),
  edges: edges.map((edge) => {
    const data = (edge.data ?? {}) as { branch?: 'true' | 'false' | null; style?: Record<string, unknown> | null; extra?: Record<string, unknown> | null }
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      type: edge.type ?? null,
      label: typeof edge.label === 'string' ? edge.label : null,
      branch: data.branch ?? null,
      style: data.style ?? null,
      data: data.extra ?? null,
    }
  }),
})

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const DEFAULT_TITLES: Record<string, string> = { stage: 'Nova etapa', gateway: 'Condição?', start: 'Início', end: 'Fim', pool: 'Pool', lane: 'Lane', phase: 'Phase', text: 'Texto', note: 'Nota' }

type Frame = { x: number; y: number; width: number; height: number }

// Novo no (selecionado) a partir de uma forma do catalogo.
export const buildNode = (shape: Shape, frame: Frame, parentId?: string): FlowNode => {
  const kind = containerKind(shape.type, shape.key)
  return {
    id: newId(shape.type),
    type: shape.type,
    position: { x: Math.round(frame.x), y: Math.round(frame.y) },
    parentId,
    zIndex: kind ? CONTAINER_Z[kind] : undefined,
    width: frame.width,
    height: frame.height,
    selected: true,
    data: { title: DEFAULT_TITLES[shape.key] ?? '', description: '', inputs: '', outputs: '', shapeKey: shape.key, attachments: [], style: shape.style, extra: null },
  }
}

// Saidas de uma condicional recebem "Sim" e depois "Nao".
export const gatewayBranch = (edges: Edge[], sourceId: string): { branch: 'true' | 'false' | null; label?: string } => {
  const used = new Set(edges.filter((edge) => edge.source === sourceId).map((edge) => (edge.data as { branch?: string | null } | undefined)?.branch))
  if (!used.has('true')) return { branch: 'true', label: 'Sim' }
  if (!used.has('false')) return { branch: 'false', label: 'Não' }
  return { branch: null }
}
