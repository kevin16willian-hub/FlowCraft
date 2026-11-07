import { useDeferredValue, useMemo, useState } from 'react'
import type { Graph, Shape } from '../../types/board'
import { importMermaid, type MermaidImport } from '../../utils/mermaidImport'
import type { MermaidIssue } from '../../utils/mermaidParse'
import { Modal } from '../ui/Modal'

export type MermaidMode = 'replace' | 'append'

type Props = {
  shapes: Shape[]
  hasContent: boolean
  onImport: (graph: Graph, mode: MermaidMode) => void
  onClose: () => void
}

const SAMPLE = `flowchart LR
    A([Início]) --> B[Etapa]
    B --> C{Aprovado?}
    C -- sim --> D([Fim])
    C -- não --> B`

function IssueItem({ issue, kind }: { issue: MermaidIssue; kind: 'error' | 'warning' }) {
  const caret = `${' '.repeat(Math.max(0, issue.column - 1))}^`
  return (
    <li className={`mermaid-issue mermaid-issue--${kind}`}>
      <strong>Linha {issue.line}, col. {issue.column}:</strong> {issue.message}
      {issue.source.trim() && <pre className="mermaid-issue__code">{issue.source}{'\n'}{caret}</pre>}
      {issue.hint && <small>{issue.hint}</small>}
    </li>
  )
}

export function MermaidImportDialog({ shapes, hasContent, onImport, onClose }: Props) {
  const [source, setSource] = useState('')
  const [mode, setMode] = useState<MermaidMode>(hasContent ? 'append' : 'replace')
  const deferred = useDeferredValue(source)
  const result: MermaidImport | null = useMemo(() => (deferred.trim() ? importMermaid(deferred, shapes) : null), [deferred, shapes])
  const ready = result?.graph != null && deferred === source

  return (
    <Modal title="Importar Mermaid" wide onClose={onClose}>
      <p className="Modal__hint">Cole um diagrama <code>flowchart</code> ou <code>graph</code> do Mermaid. A validação é feita enquanto você digita.</p>
      <textarea
        className="mermaid-input"
        aria-label="Código Mermaid"
        spellCheck={false}
        placeholder={SAMPLE}
        value={source}
        onChange={(event) => setSource(event.target.value)}
      />
      <div className="mermaid-status" role="status">
        {!result && 'Aguardando código...'}
        {result?.graph && `${result.graph.nodes.filter((node) => node.type !== 'area').length} nós · ${result.graph.edges.length} arestas${result.ast?.groups.length ? ` · ${result.ast.groups.length} lane(s)` : ''}${result.warnings.length ? ` · ${result.warnings.length} aviso(s)` : ''}`}
        {result && !result.graph && `${result.errors.length} erro(s) — corrija para importar`}
      </div>
      {result && result.errors.length > 0 && <ul className="mermaid-issues" aria-label="Erros">{result.errors.map((issue, index) => <IssueItem key={`e${index}`} issue={issue} kind="error" />)}</ul>}
      {result && result.warnings.length > 0 && <ul className="mermaid-issues" aria-label="Avisos">{result.warnings.map((issue, index) => <IssueItem key={`w${index}`} issue={issue} kind="warning" />)}</ul>}
      {hasContent && (
        <fieldset className="mermaid-mode">
          <label><input type="radio" name="mermaid-mode" checked={mode === 'append'} onChange={() => setMode('append')} /> Adicionar ao quadro</label>
          <label><input type="radio" name="mermaid-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Substituir o quadro</label>
        </fieldset>
      )}
      <div className="Modal__form mermaid-actions">
        <button type="button" className="excalidraw-button" onClick={() => setSource(SAMPLE)}>Inserir exemplo</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="excalidraw-button" onClick={onClose}>Cancelar</button>
        <button type="button" className="excalidraw-button excalidraw-button--primary" disabled={!ready} onClick={() => { if (result?.graph) onImport(result.graph, mode) }}>Importar</button>
      </div>
    </Modal>
  )
}
