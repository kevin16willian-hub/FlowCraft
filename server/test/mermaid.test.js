import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { importMermaid, placeBeside } from '../../src/utils/mermaidImport.ts'
import { parseMermaid } from '../../src/utils/mermaidParse.ts'

const FLOW = `flowchart LR
    A([Início]) --> B[Seleciona filiais ou pedidos]
    B --> C[processar_pedidos]
    C --> G{Modo}
    G -- filial --> H[ZSD_SO_RELEASE: pedidos Z3]
    G -- pedido --> I[VA02: dados do pedido]
    H --> K
    I --> K[Para cada pedido]
    K --> L{MensagemSAP?}
    L -- sim --> L1[Error, só histórico]
    L -- não --> M[Checa estoque]
    M --> Q{Status anterior}
    Q -- "novo / Link para envio / falha de envio" --> R[Envia e-mail ao cliente, Link enviado]
    Q -->|Finalizado| T[Fim do fluxo]
    classDef x fill:#fff
`

const errorsOf = (source) => parseMermaid(source).errors.map((item) => `${item.line}:${item.message}`)

describe('mermaid parse', () => {
  it('importa o fluxo completo sem erros', () => {
    const result = importMermaid(FLOW, [])
    assert.deepEqual(result.errors, [])
    assert.equal(result.graph?.nodes.length, 13)
    assert.equal(result.graph?.edges.length, 13)
    const byMermaid = new Map(result.graph?.nodes.map((node) => [node.data?.mermaidId, node]))
    assert.equal(byMermaid.get('A')?.type, 'start')
    assert.equal(byMermaid.get('G')?.type, 'gateway')
    assert.equal(byMermaid.get('K')?.title, 'Para cada pedido')
    assert.equal(byMermaid.get('R')?.type, 'stage')
    assert.ok(result.warnings.some((item) => item.message.includes('classDef')))
  })

  it('mapeia sim/nao para branch e preserva rotulos', () => {
    const { graph } = importMermaid(FLOW, [])
    const labels = graph?.edges.map((edge) => [edge.label, edge.branch])
    assert.ok(labels?.some(([label, branch]) => label === 'sim' && branch === 'true'))
    assert.ok(labels?.some(([label, branch]) => label === 'não' && branch === 'false'))
    assert.ok(labels?.some(([label, branch]) => label === 'filial' && branch === null))
    assert.ok(labels?.some(([label]) => label === 'novo / Link para envio / falha de envio'))
  })

  it('posiciona nos distintos e respeita a direcao LR', () => {
    const { graph } = importMermaid('flowchart LR\nA([a]) --> B[b] --> C([c])', [])
    const [a, b, c] = graph?.nodes ?? []
    assert.ok(a.x < b.x && b.x < c.x)
    assert.equal(a.type, 'start')
    assert.equal(c.type, 'end')
    assert.equal(graph?.edges[0].sourceHandle, 'r')
  })

  it('aceita fences, ponto e virgula, & e <br/>', () => {
    const { graph, errors } = importMermaid('```mermaid\ngraph TD\nA[um<br/>dois]; A --> B & C\n```', [])
    assert.deepEqual(errors, [])
    assert.equal(graph?.nodes.find((node) => node.data?.mermaidId === 'A')?.title, 'um\ndois')
    assert.equal(graph?.edges.length, 2)
  })

  it('placeBeside move o grafo para a direita do existente', () => {
    const { graph } = importMermaid('flowchart TD\nA --> B', [])
    const moved = placeBeside(graph, [{ x: 0, y: 50, width: 100 }])
    assert.equal(Math.min(...moved.nodes.map((node) => node.x)), 220)
  })
})

describe('mermaid validacao', () => {
  it('cabecalho ausente ou invalido', () => {
    assert.match(errorsOf('A --> B')[0], /^1:Cabeçalho ausente/)
    assert.match(errorsOf('flowchart XX\nA-->B')[0], /Direção inválida/)
    assert.match(errorsOf('sequenceDiagram\nA->>B: oi')[0], /flowchart/)
    assert.match(errorsOf('   \n')[0], /Texto vazio/)
  })

  it('colchete, aspas e rotulo sem fechamento com linha e coluna', () => {
    const bracket = parseMermaid('flowchart TD\nA --> B[Checa estoque')
    assert.equal(bracket.errors[0].line, 2)
    assert.equal(bracket.errors[0].column, 8)
    assert.match(bracket.errors[0].message, /"\[" sem "\]"/)
    assert.match(errorsOf('flowchart TD\nA["oi] --> B')[0], /Aspas sem fechamento/)
    assert.match(errorsOf('flowchart TD\nA -->|sim B')[0], /Rótulo/)
    assert.match(errorsOf('flowchart TD\nA(texto --> B')[0], /sem "\)"/)
  })

  it('aresta sem destino, seta invalida e texto inesperado', () => {
    assert.match(errorsOf('flowchart TD\nA -->')[0], /sem nó de destino/)
    assert.match(errorsOf('flowchart TD\nA -> B')[0], /Operador de seta inválido "->"/)
    assert.match(errorsOf('flowchart TD\nA => B')[0], /Operador de seta inválido/)
    assert.match(errorsOf('flowchart TD\nA B')[0], /Texto inesperado/)
    assert.match(errorsOf('flowchart TD\n--> B')[0], /Esperado o ID/)
  })

  it('texto vazio no no e diagrama sem nos', () => {
    assert.match(errorsOf('flowchart TD\nA[] --> B')[0], /Texto vazio no nó "A"/)
    assert.match(errorsOf('flowchart TD\n%% so comentario')[0], /Nenhum nó/)
  })

  it('limite de nos', () => {
    const big = `flowchart TD\n${Array.from({ length: 301 }, (_, index) => `N${index}`).join('\n')}`
    assert.match(errorsOf(big)[0], /grande demais/)
  })

  it('avisos nao bloqueiam', () => {
    const result = parseMermaid('flowchart TD\nA --> B\nC\nD{x}\nsubgraph s\nend')
    assert.deepEqual(result.errors, [])
    const messages = result.warnings.map((item) => item.message).join('|')
    assert.match(messages, /isolado/)
    assert.match(messages, /menos de duas saídas/)
    assert.match(messages, /vazio/)
    assert.match(messages, /usado sem texto/)
  })
})

const GROUPED = `flowchart LR
    A([Início]) --> B
    subgraph validacao [Validação de pedido]
        direction TB
        B[Checa estoque] --> C{Em estoque?}
        C -- sim --> D[Cartão no pedido]
        subgraph interno [Interno]
            X[Extra]
        end
    end
    subgraph pagamento [Pagamento]
        E[Captura URL] --> F[Preenche]
    end
    C -- não --> G[Bloqueio 99]
    D --> E
    F --> H([Fim])
    validacao --> pagamento
`

describe('mermaid subgraph', () => {
  it('agrupa nos e achata subgraph aninhado', () => {
    const { ast, errors, warnings } = parseMermaid(GROUPED)
    assert.deepEqual(errors, [])
    assert.deepEqual(ast?.groups.map((group) => group.title), ['Validação de pedido', 'Pagamento'])
    const group = (id) => ast?.nodes.find((node) => node.id === id)?.group
    assert.equal(group('B'), 'validacao')
    assert.equal(group('X'), 'validacao')
    assert.equal(group('E'), 'pagamento')
    assert.equal(group('A'), null)
    assert.ok(warnings.some((item) => item.message.includes('aninhado')))
  })

  it('aresta para o id do subgraph liga ao no do grupo', () => {
    const { ast } = parseMermaid(GROUPED)
    assert.ok(!ast?.nodes.some((node) => node.id === 'validacao'))
    assert.ok(ast?.edges.some((edge) => edge.source === 'X' && edge.target === 'E'))
  })

  it('gera pool com lanes, filhos relativos e sem sobreposicao', () => {
    const { graph, errors } = importMermaid(GROUPED, [])
    assert.deepEqual(errors, [])
    const nodes = graph?.nodes ?? []
    const pool = nodes.find((node) => node.shapeKey === 'pool')
    const lanes = nodes.filter((node) => node.shapeKey === 'lane')
    assert.deepEqual(lanes.map((lane) => lane.title), ['Validação de pedido', 'Pagamento', 'Geral'])
    assert.ok(lanes.every((lane) => lane.parentId === pool?.id && lane.x === 0 && lane.width === pool?.width))
    assert.equal(pool?.height, 36 + lanes.reduce((sum, lane) => sum + (lane.height ?? 0), 0))
    const laneIds = new Set(lanes.map((lane) => lane.id))
    const children = nodes.filter((node) => node.type !== 'area')
    assert.ok(children.every((node) => laneIds.has(node.parentId)))
    for (const lane of lanes) {
      const inside = children.filter((node) => node.parentId === lane.id)
      assert.ok(inside.every((node) => node.x >= 28 && node.y >= 0 && node.x + node.width <= lane.width && node.y + node.height <= lane.height))
    }
  })

  it('arestas entre lanes usam saida vertical', () => {
    const { graph } = importMermaid(GROUPED, [])
    const byMermaid = new Map(graph?.nodes.map((node) => [node.data?.mermaidId, node.id]))
    const edge = graph?.edges.find((item) => item.source === byMermaid.get('D') && item.target === byMermaid.get('E'))
    assert.equal(edge?.sourceHandle, 'b')
    assert.equal(edge?.targetHandle, 't')
  })

  it('subgraph sem nome e erro', () => {
    assert.match(errorsOf('flowchart TD\nsubgraph\nA\nend')[0], /subgraph sem nome/)
  })

  it('placeBeside nao desloca filhos duas vezes', () => {
    const { graph } = importMermaid(GROUPED, [])
    const moved = placeBeside(graph, [{ x: 0, y: 0, width: 100 }])
    const before = graph.nodes.find((node) => node.parentId && node.type !== 'area')
    const after = moved.nodes.find((node) => node.id === before.id)
    assert.equal(after.x, before.x)
  })
})
