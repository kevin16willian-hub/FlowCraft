import { NAME_PATTERN } from '../controllers/prints.controller.js'
import { httpError } from './http.js'

export const NODE_TYPES = ['start', 'end', 'stage', 'gateway', 'area', 'text', 'shape', 'note']
const ID_PATTERN = /^[\w.:-]{1,64}$/
const MAX_NODES = 2000
const MAX_EDGES = 4000
const MAX_ATTACHMENTS = 3

const text = (value, max, field) => {
  if (value == null) return null
  if (typeof value !== 'string') throw httpError(400, `${field} deve ser texto`)
  if (value.length > max) throw httpError(400, `${field} excede ${max} caracteres`)
  return value
}

const number = (value, fallback, field) => {
  if (value == null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw httpError(400, `${field} deve ser numerico`)
  return value
}

const jsonObject = (value, field) => {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw httpError(400, `${field} deve ser objeto`)
  if (JSON.stringify(value).length > 50_000) throw httpError(400, `${field} muito grande`)
  return value
}

const id = (value, field) => {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw httpError(400, `${field} invalido`)
  return value
}

// Valida e normaliza { nodes, edges } vindos do cliente. Ordena nos por profundidade (pai antes do filho).
export const sanitizeGraph = (body) => {
  const rawNodes = body?.nodes ?? []
  const rawEdges = body?.edges ?? []
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) throw httpError(400, 'nodes e edges devem ser listas')
  if (rawNodes.length > MAX_NODES || rawEdges.length > MAX_EDGES) throw httpError(400, 'quadro excede o limite de elementos')

  const nodes = new Map()
  for (const raw of rawNodes) {
    const nodeId = id(raw?.id, 'node.id')
    if (nodes.has(nodeId)) throw httpError(400, `node duplicado: ${nodeId}`)
    if (!NODE_TYPES.includes(raw.type)) throw httpError(400, `tipo de no invalido: ${raw.type}`)
    const attachments = raw.attachments ?? []
    if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) throw httpError(400, 'anexos invalidos')
    nodes.set(nodeId, {
      id: nodeId,
      type: raw.type,
      shapeKey: raw.type === 'area' && !['pool', 'lane', 'phase'].includes(raw.shapeKey) ? 'phase' : text(raw.shapeKey, 40, 'shapeKey'),
      parentId: raw.parentId == null ? null : id(raw.parentId, 'parentId'),
      x: number(raw.x, 0, 'x'),
      y: number(raw.y, 0, 'y'),
      width: number(raw.width, null, 'width'),
      height: number(raw.height, null, 'height'),
      rotation: number(raw.rotation, 0, 'rotation'),
      zIndex: Math.trunc(number(raw.zIndex, 0, 'zIndex')),
      title: text(raw.title, 300, 'title'),
      description: text(raw.description, 20_000, 'description'),
      inputs: text(raw.inputs, 20_000, 'inputs'),
      outputs: text(raw.outputs, 20_000, 'outputs'),
      style: jsonObject(raw.style, 'style'),
      data: jsonObject(raw.data, 'data'),
      locked: raw.locked === true,
      attachments: attachments.map((attachment) => {
        if (!NAME_PATTERN.test(attachment?.name ?? '')) throw httpError(400, 'nome de anexo invalido')
        return { name: attachment.name }
      }),
    })
  }

  const depthOf = (node, seen = new Set()) => {
    if (node.parentId == null) return 0
    const parent = nodes.get(node.parentId)
    if (!parent || seen.has(node.id)) throw httpError(400, `parentId invalido em ${node.id}`)
    return 1 + depthOf(parent, seen.add(node.id))
  }
  const ordered = [...nodes.values()].map((node) => ({ ...node, depth: depthOf(node) })).sort((a, b) => a.depth - b.depth)

  const edges = new Map()
  for (const raw of rawEdges) {
    const edgeId = id(raw?.id, 'edge.id')
    if (edges.has(edgeId)) throw httpError(400, `edge duplicada: ${edgeId}`)
    const source = id(raw.source, 'source')
    const target = id(raw.target, 'target')
    if (!nodes.has(source) || !nodes.has(target)) throw httpError(400, `edge ${edgeId} referencia no inexistente`)
    if (raw.branch != null && raw.branch !== 'true' && raw.branch !== 'false') throw httpError(400, 'branch invalido')
    edges.set(edgeId, {
      id: edgeId,
      source,
      target,
      sourceHandle: text(raw.sourceHandle, 30, 'sourceHandle'),
      targetHandle: text(raw.targetHandle, 30, 'targetHandle'),
      type: text(raw.type, 30, 'type'),
      label: text(raw.label, 200, 'label'),
      branch: raw.branch ?? null,
      style: jsonObject(raw.style, 'style'),
      data: jsonObject(raw.data, 'data'),
    })
  }

  return { nodes: ordered, edges: [...edges.values()] }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const guid = (value, field = 'id') => {
  if (typeof value !== 'string' || !GUID.test(value)) throw httpError(400, `${field} invalido`)
  return value.toLowerCase()
}
