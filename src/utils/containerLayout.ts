import { containerKind } from './containerKind.ts'
import type { FlowNode } from './graphMapping.ts'

export const POOL_HEADER = 36
export const LANE_BAND = 28
export const LANE_HEIGHT = 140
export const PHASE_WIDTH = 220
export const MIN_PHASE_WIDTH = 80
export const MIN_POOL_WIDTH = 300

export type Frame = { x: number; y: number; width: number; height: number }
export type Span = { id: string; x: number; width: number }

const width = (node: FlowNode) => node.width ?? node.measured?.width ?? 0
const height = (node: FlowNode) => node.height ?? node.measured?.height ?? 0
const kindOf = (node: FlowNode) => containerKind(node.type, node.data.shapeKey)
const childrenOf = (nodes: FlowNode[], id: string) => nodes.filter((node) => node.parentId === id)
const byX = (a: FlowNode, b: FlowNode) => a.position.x - b.position.x

// Posicao da proxima lane: sempre largura total da pool, empilhada abaixo da ultima.
export const nextLaneFrame = (nodes: FlowNode[], pool: FlowNode): Frame => {
  const lanes = childrenOf(nodes, pool.id).filter((node) => kindOf(node) === 'lane')
  const y = lanes.length ? Math.max(...lanes.map((lane) => lane.position.y + height(lane))) : POOL_HEADER
  return { x: 0, y, width: Math.max(width(pool), MIN_POOL_WIDTH), height: LANE_HEIGHT }
}

// Lanes ocupam toda a largura da pool, ficam empilhadas sem folga e a pool cresce para contê-las.
export const normalizePool = (nodes: FlowNode[], poolId: string, minWidth = 0): FlowNode[] => {
  const pool = nodes.find((node) => node.id === poolId)
  if (!pool) return nodes
  const lanes = childrenOf(nodes, poolId).filter((node) => kindOf(node) === 'lane').sort((a, b) => a.position.y - b.position.y)
  const poolWidth = Math.max(width(pool), minWidth, MIN_POOL_WIDTH)
  let cursor = POOL_HEADER
  const placed = new Map<string, { y: number; height: number }>()
  for (const lane of lanes) {
    placed.set(lane.id, { y: cursor, height: height(lane) })
    cursor += height(lane)
  }
  const poolHeight = Math.max(height(pool), lanes.length ? cursor : 0)
  // A ultima phase de cada lane vai ate a borda direita da lane.
  const lastPhase = new Map<string, FlowNode>()
  for (const lane of lanes) {
    const last = phasesOf(nodes, lane.id).at(-1)
    if (last) lastPhase.set(last.id, last)
  }
  return nodes.map((node) => {
    if (node.id === poolId) return { ...node, width: poolWidth, height: poolHeight }
    const slot = placed.get(node.id)
    if (slot) return { ...node, position: { x: 0, y: slot.y }, width: poolWidth, height: slot.height }
    if (lastPhase.has(node.id)) return { ...node, width: Math.max(poolWidth - node.position.x, MIN_PHASE_WIDTH) }
    return node
  })
}

export type PhaseSlot = { frame: Frame; resizes: Span[]; laneWidth: number }

// Nova phase: divide a lane em colunas iguais; se houver formas soltas na lane, vai a direita da ultima peca.
export const nextPhaseSlot = (nodes: FlowNode[], lane: FlowNode): PhaseSlot => {
  const laneWidth = width(lane)
  const laneHeight = height(lane)
  const children = childrenOf(nodes, lane.id)
  const phases = children.filter((node) => kindOf(node) === 'phase').sort(byX)
  const loose = children.filter((node) => kindOf(node) === null)

  if (loose.length) {
    const x = Math.max(LANE_BAND, ...children.map((node) => node.position.x + width(node)))
    return { frame: { x, y: 0, width: PHASE_WIDTH, height: laneHeight }, resizes: [], laneWidth: Math.max(laneWidth, x + PHASE_WIDTH) }
  }

  const count = phases.length + 1
  const inner = Math.max(laneWidth - LANE_BAND, count * MIN_PHASE_WIDTH)
  const column = Math.round(inner / count)
  return {
    frame: { x: LANE_BAND + phases.length * column, y: 0, width: column, height: laneHeight },
    resizes: phases.map((phase, index) => ({ id: phase.id, x: LANE_BAND + index * column, width: column })),
    laneWidth: inner + LANE_BAND,
  }
}

// Move a divisoria entre duas phases vizinhas; nenhuma fica menor que o minimo.
export const moveDivider = (left: Span, right: Span, delta: number): [Span, Span] => {
  const boundary = left.x + left.width
  const limit = right.x + right.width - MIN_PHASE_WIDTH
  const next = Math.min(Math.max(boundary + delta, left.x + MIN_PHASE_WIDTH), limit)
  return [
    { id: left.id, x: left.x, width: Math.round(next - left.x) },
    { id: right.id, x: Math.round(next), width: Math.round(right.x + right.width - next) },
  ]
}

export const phasesOf = (nodes: FlowNode[], laneId: string) => childrenOf(nodes, laneId).filter((node) => kindOf(node) === 'phase').sort(byX)
