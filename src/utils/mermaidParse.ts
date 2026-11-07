export type MermaidShape = 'rect' | 'round' | 'stadium' | 'subroutine' | 'cylinder' | 'circle' | 'diamond' | 'hexagon'
export type MermaidDirection = 'LR' | 'RL' | 'TB' | 'BT'

export type MermaidIssue = { line: number; column: number; message: string; hint?: string; source: string }
export type MermaidNode = { id: string; text: string | null; shape: MermaidShape | null; line: number; group: string | null }
export type MermaidEdge = { source: string; target: string; label: string | null; line: number }
export type MermaidGroup = { id: string; title: string; line: number }
export type MermaidAst = { direction: MermaidDirection; nodes: MermaidNode[]; edges: MermaidEdge[]; groups: MermaidGroup[] }
export type MermaidResult = { ast: MermaidAst | null; errors: MermaidIssue[]; warnings: MermaidIssue[] }

export const MAX_NODES = 300
export const MAX_EDGES = 600

const WORD = '[\\w\\u00C0-\\uFFFF]'
const ID = new RegExp(`^${WORD}+`)
const HEADER = /^(flowchart|graph)(?:\s+(\S+))?\s*$/
const DIRECTIONS: Record<string, MermaidDirection> = { LR: 'LR', RL: 'RL', TB: 'TB', TD: 'TB', BT: 'BT' }
const OTHER_DIAGRAMS = /^(sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline)\b/
const IGNORED = /^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/
const ARROW_END = '(-{2,}>|-{3,}|={2,}>|={3,}|\\.+-?>|\\.+-)'
const LABELED = new RegExp(`^(--|==|-\\.)\\s+(.+?)\\s+${ARROW_END}(?=\\s|$|${WORD})`)
const PLAIN = /^(-{2,}>|-{3,}|={2,}>|={3,}|-\.+->|-\.+-)/
const BAD_OPERATOR = /^[-=.<>~]+[xo]?/

// Abertura, fechamento e forma; as aberturas mais longas vem primeiro.
const OPENERS: [string, string, MermaidShape][] = [
  ['([', '])', 'stadium'],
  ['[[', ']]', 'subroutine'],
  ['[(', ')]', 'cylinder'],
  ['((', '))', 'circle'],
  ['{{', '}}', 'hexagon'],
  ['[', ']', 'rect'],
  ['(', ')', 'round'],
  ['{', '}', 'diamond'],
]

const clean = (raw: string) => {
  let text = raw.trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1)
  return text.replace(/<br\s*\/?>/gi, '\n').trim()
}

// Divide a linha em instrucoes por ";" e remove comentarios "%%", respeitando aspas.
const statements = (line: string): { text: string; offset: number }[] => {
  const out: { text: string; offset: number }[] = []
  let quoted = false
  let start = 0
  for (let i = 0; i <= line.length; i += 1) {
    const char = line[i]
    if (char === '"') quoted = !quoted
    const comment = !quoted && char === '%' && line[i + 1] === '%'
    if (i === line.length || comment || (!quoted && char === ';')) {
      out.push({ text: line.slice(start, i), offset: start })
      if (comment || i === line.length) break
      start = i + 1
    }
  }
  return out
}

// "subgraph id [Titulo]", "subgraph Titulo" ou "subgraph \"Titulo\"".
const parseSubgraph = (rest: string): { id: string; title: string } | null => {
  const text = rest.trim()
  if (!text) return null
  const withId = new RegExp(`^(${WORD}+)\\s*\\[(.*)\\]$`).exec(text)
  if (withId) return { id: withId[1], title: clean(withId[2]) || withId[1] }
  const title = clean(text)
  return title ? { id: title, title } : null
}

const stripFences = (lines: string[]) => {
  const first = lines.findIndex((line) => line.trim() !== '')
  if (first < 0 || !/^```\s*mermaid\s*$/i.test(lines[first].trim())) return lines
  const copy = [...lines]
  copy[first] = ''
  const last = copy.map((line) => line.trim()).lastIndexOf('```')
  if (last > first) copy[last] = ''
  return copy
}

export function parseMermaid(source: string): MermaidResult {
  const errors: MermaidIssue[] = []
  const warnings: MermaidIssue[] = []
  const lines = stripFences(source.replace(/\r\n?/g, '\n').split('\n'))
  const nodes = new Map<string, MermaidNode>()
  let edges: MermaidEdge[] = []
  let groups: MermaidGroup[] = []
  const stack: string[] = []
  const ignoredSeen = new Set<string>()
  let direction: MermaidDirection = 'TB'
  let headerSeen = false

  const issue = (list: MermaidIssue[], line: number, column: number, message: string, hint?: string) => {
    list.push({ line: line + 1, column: column + 1, message, hint, source: lines[line] })
  }

  const declare = (id: string, line: number, text: string | null, shape: MermaidShape | null) => {
    let current = nodes.get(id)
    if (!current) {
      current = { id, text, shape, line, group: null }
      nodes.set(id, current)
    } else if (text !== null) {
      if (current.text !== null && (current.text !== text || current.shape !== shape)) issue(warnings, line, 0, `Nó "${id}" redefinido; vale a última definição`)
      current.text = text
      current.shape = shape
    }
    if (stack.length && !current.group) current.group = stack[0]
  }

  const parseStatement = (lineNo: number, raw: string, offset: number) => {
    const text = raw
    const lead = text.length - text.trimStart().length
    const body = text.trim()
    if (!body) return
    let pos = lead
    const at = () => pos + offset
    const rest = () => text.slice(pos)
    const skip = () => { while (pos < text.length && /\s/.test(text[pos])) pos += 1 }

    const readQuoted = (): string | null => {
      const end = text.indexOf('"', pos + 1)
      if (end < 0) { issue(errors, lineNo, at(), 'Aspas sem fechamento', 'Feche o texto com " ou remova a aspa'); return null }
      const value = text.slice(pos + 1, end)
      pos = end + 1
      return value
    }

    const parseNode = (): string | null => {
      const match = ID.exec(rest())
      if (!match) { issue(errors, lineNo, at(), `Esperado o ID de um nó, encontrado "${rest().charAt(0)}"`, 'IDs usam letras, números e _'); return null }
      const id = match[0]
      pos += id.length
      const opener = OPENERS.find(([open]) => rest().startsWith(open))
      let label: string | null = null
      let shape: MermaidShape | null = null
      if (opener) {
        const [open, close, kind] = opener
        const openAt = at()
        pos += open.length
        skip()
        if (text[pos] === '"') {
          const quoted = readQuoted()
          if (quoted === null) return null
          skip()
          if (!rest().startsWith(close)) { issue(errors, lineNo, openAt, `"${open}" sem "${close}" correspondente`); return null }
          pos += close.length
          label = clean(quoted)
        } else {
          const end = text.indexOf(close, pos)
          if (end < 0) { issue(errors, lineNo, openAt, `"${open}" sem "${close}" correspondente`, `Feche o nó com ${close}`); return null }
          label = clean(text.slice(pos, end))
          pos = end + close.length
        }
        if (!label) { issue(errors, lineNo, openAt, `Texto vazio no nó "${id}"`); return null }
        shape = kind
      }
      const klass = /^:::[\w-]+/.exec(rest())
      if (klass) pos += klass[0].length
      declare(id, lineNo, label, shape)
      return id
    }

    const parseGroup = (): string[] | null => {
      const ids: string[] = []
      for (;;) {
        skip()
        const id = parseNode()
        if (id === null) return null
        ids.push(id)
        skip()
        if (text[pos] !== '&') return ids
        pos += 1
      }
    }

    // Retorna o rotulo (ou null) quando ha seta valida; undefined quando ha erro.
    const parseEdge = (): { label: string | null } | undefined => {
      const here = rest()
      let label: string | null = null
      const labeled = LABELED.exec(here)
      if (labeled) {
        label = clean(labeled[2])
        pos += labeled[0].length
      } else {
        const plain = PLAIN.exec(here)
        if (!plain) {
          const bad = BAD_OPERATOR.exec(here)
          if (bad) issue(errors, lineNo, at(), `Operador de seta inválido "${bad[0]}"`, 'Use -->, ---, -.-> ou ==>; rótulo com -->|texto| ou -- texto -->')
          else issue(errors, lineNo, at(), `Texto inesperado "${here.trim().split(/\s+/)[0]}"`, 'Faltou uma seta entre os nós?')
          return undefined
        }
        pos += plain[0].length
        skip()
        if (text[pos] === '|') {
          const barAt = at()
          const end = text.indexOf('|', pos + 1)
          if (end < 0) { issue(errors, lineNo, barAt, 'Rótulo "|" sem fechamento', 'Use -->|texto|'); return undefined }
          label = clean(text.slice(pos + 1, end))
          pos = end + 1
        }
      }
      return { label: label || null }
    }

    let previous = parseGroup()
    while (previous) {
      skip()
      if (pos >= text.length) return
      const edge = parseEdge()
      if (!edge) return
      skip()
      if (pos >= text.length) { issue(errors, lineNo, at() - 1, 'Aresta sem nó de destino', 'Complete com o ID do próximo nó'); return }
      const next = parseGroup()
      if (!next) return
      for (const source of previous) for (const target of next) edges.push({ source, target, label: edge.label, line: lineNo + 1 })
      previous = next
    }
  }

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    for (const { text, offset } of statements(lines[lineNo])) {
      const body = text.trim()
      if (!body) continue
      const column = offset + (text.length - text.trimStart().length)

      if (!headerSeen) {
        headerSeen = true
        const match = HEADER.exec(body)
        if (!match) {
          const message = OTHER_DIAGRAMS.test(body)
            ? 'Só diagramas flowchart/graph são suportados'
            : 'Cabeçalho ausente: a primeira linha deve ser "flowchart LR" ou "graph TD"'
          issue(errors, lineNo, column, message)
          return { ast: null, errors, warnings }
        }
        if (match[2] && !DIRECTIONS[match[2]]) {
          issue(errors, lineNo, column + body.indexOf(match[2]), `Direção inválida "${match[2]}"`, 'Use LR, RL, TB, TD ou BT')
          return { ast: null, errors, warnings }
        }
        direction = match[2] ? DIRECTIONS[match[2]] : 'TB'
        continue
      }

      const opened = /^subgraph\b\s*(.*)$/.exec(body)
      if (opened) {
        const spec = parseSubgraph(opened[1])
        if (!spec) issue(errors, lineNo, column, 'subgraph sem nome', 'Use: subgraph id [Título]')
        else if (stack.length) issue(warnings, lineNo, column, `Subgraph aninhado "${spec.title}" foi achatado na lane "${groups.find((group) => group.id === stack[0])?.title ?? stack[0]}"`)
        else if (!groups.some((group) => group.id === spec.id)) groups.push({ id: spec.id, title: spec.title, line: lineNo })
        stack.push(spec?.id ?? '')
        continue
      }
      if (body === 'end' && stack.length) { stack.pop(); continue }
      const ignored = IGNORED.exec(body)
      if (ignored) {
        if (ignored[1] !== 'direction' && !ignoredSeen.has(ignored[1])) { ignoredSeen.add(ignored[1]); issue(warnings, lineNo, column, `"${ignored[1]}" é ignorado na importação`) }
        continue
      }

      parseStatement(lineNo, text, offset)
    }
  }

  if (!headerSeen) {
    errors.push({ line: 1, column: 1, message: 'Texto vazio: cole um diagrama "flowchart"', source: '' })
    return { ast: null, errors, warnings }
  }
  if (stack.length) issue(warnings, lines.length - 1, 0, 'subgraph sem "end" correspondente')

  // IDs de subgraph usados em arestas viram o primeiro (destino) ou o ultimo (origem) no do grupo.
  const members = (id: string) => [...nodes.values()].filter((node) => node.group === id)
  const groupIds = new Set(groups.map((group) => group.id))
  for (const id of groupIds) if (nodes.get(id)?.text === null) nodes.delete(id)
  const noted = new Set<string>()
  edges = edges.flatMap((edge) => {
    const resolved = { ...edge }
    for (const side of ['source', 'target'] as const) {
      const id = edge[side]
      if (!groupIds.has(id) || nodes.has(id)) continue
      const list = members(id)
      if (!list.length) return []
      const pick = side === 'source' ? list[list.length - 1] : list[0]
      resolved[side] = pick.id
      if (!noted.has(`${id}:${side}`)) { noted.add(`${id}:${side}`); issue(warnings, edge.line - 1, 0, `Aresta ligada ao subgraph "${id}": usando o nó "${pick.id}"`) }
    }
    return [resolved]
  })
  groups = groups.filter((group) => {
    if (members(group.id).length) return true
    issue(warnings, group.line, 0, `Subgraph "${group.title}" está vazio e foi ignorado`)
    return false
  })
  if (!nodes.size && !errors.length) errors.push({ line: 1, column: 1, message: 'Nenhum nó encontrado no diagrama', source: lines[0] ?? '' })
  if (nodes.size > MAX_NODES) errors.push({ line: 1, column: 1, message: `Diagrama grande demais: ${nodes.size} nós (máximo ${MAX_NODES})`, source: '' })
  if (edges.length > MAX_EDGES) errors.push({ line: 1, column: 1, message: `Diagrama grande demais: ${edges.length} arestas (máximo ${MAX_EDGES})`, source: '' })

  const linked = new Set(edges.flatMap((edge) => [edge.source, edge.target]))
  const outgoing = new Map<string, number>()
  edges.forEach((edge) => outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1))
  for (const node of nodes.values()) {
    if (node.text === null) issue(warnings, node.line, 0, `Nó "${node.id}" usado sem texto; o ID será o título`)
    if (nodes.size > 1 && !linked.has(node.id)) issue(warnings, node.line, 0, `Nó "${node.id}" está isolado (sem arestas)`)
    if (node.shape === 'diamond' && (outgoing.get(node.id) ?? 0) < 2) issue(warnings, node.line, 0, `Condicional "${node.id}" tem menos de duas saídas`)
  }

  if (errors.length) return { ast: null, errors, warnings }
  return { ast: { direction, nodes: [...nodes.values()], edges, groups }, errors, warnings }
}
