import type { ApiEdge, ApiNode, Graph } from '../types/board'

export type GraphDiff = {
  nodes: { added: ApiNode[]; removed: ApiNode[]; changed: ApiNode[] }
  edges: { added: ApiEdge[]; removed: ApiEdge[]; changed: ApiEdge[] }
}

const nodeSignature = (node: ApiNode) => JSON.stringify([
  node.type, node.shapeKey, node.parentId, node.x, node.y, node.width, node.height, node.title ?? '', node.description ?? '',
  node.inputs ?? '', node.outputs ?? '', node.locked, node.attachments.map((print) => print.name),
])

const edgeSignature = (edge: ApiEdge) => JSON.stringify([edge.source, edge.target, edge.sourceHandle, edge.targetHandle, edge.label ?? '', edge.branch])

const compare = <T extends { id: string }>(before: T[], after: T[], signature: (item: T) => string) => {
  const previous = new Map(before.map((item) => [item.id, item]))
  const next = new Map(after.map((item) => [item.id, item]))
  return {
    added: after.filter((item) => !previous.has(item.id)),
    removed: before.filter((item) => !next.has(item.id)),
    changed: after.filter((item) => previous.has(item.id) && signature(previous.get(item.id) as T) !== signature(item)),
  }
}

// Diferenca entre dois grafos por id: adicionado, removido ou alterado (posicao, tamanho, textos, ligacoes).
export const diffGraphs = (before: Graph, after: Graph): GraphDiff => ({
  nodes: compare(before.nodes, after.nodes, nodeSignature),
  edges: compare(before.edges, after.edges, edgeSignature),
})

export type FieldChange = { field: string; before: string; after: string }

const FIELDS: [string, (node: ApiNode) => unknown][] = [
  ['Título', (node) => node.title ?? ''],
  ['Descrição', (node) => node.description ?? ''],
  ['Entradas', (node) => node.inputs ?? ''],
  ['Saídas', (node) => node.outputs ?? ''],
  ['Posição', (node) => `${Math.round(node.x)}, ${Math.round(node.y)}`],
  ['Tamanho', (node) => `${Math.round(node.width ?? 0)} × ${Math.round(node.height ?? 0)}`],
  ['Contêiner', (node) => node.parentId ?? 'nenhum'],
  ['Tipo', (node) => `${node.type}/${node.shapeKey ?? ''}`],
  ['Bloqueado', (node) => (node.locked ? 'sim' : 'não')],
  ['Prints', (node) => node.attachments.map((print) => print.name).join(', ') || 'nenhum'],
]

// Campos que diferem entre as duas versoes do mesmo elemento.
export const nodeChanges = (before: ApiNode, after: ApiNode): FieldChange[] =>
  FIELDS.flatMap(([field, read]) => {
    const [a, b] = [String(read(before)), String(read(after))]
    return a === b ? [] : [{ field, before: a, after: b }]
  })

// Posicao absoluta (somando os contêineres ancestrais).
export const absoluteBox = (node: ApiNode, all: Map<string, ApiNode>) => {
  let x = node.x
  let y = node.y
  for (let parent = node.parentId ? all.get(node.parentId) : undefined, guard = 0; parent && guard < 10; parent = parent.parentId ? all.get(parent.parentId) : undefined, guard++) { x += parent.x; y += parent.y }
  return { x, y, width: node.width ?? 160, height: node.height ?? 80 }
}
