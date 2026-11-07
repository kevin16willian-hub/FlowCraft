import { useEffect, useMemo, useRef, useState } from 'react'
import type { FlowNode } from '../../utils/graphMapping'
import { Island } from '../ui/Island'
import { SearchIcon } from '../ui/icons'

type SearchPanelProps = {
  nodes: FlowNode[]
  onPick: (nodeId: string) => void
  onClose: () => void
}

const MAX_RESULTS = 20

// Busca por titulo, descricao, entradas e saidas dos elementos do quadro (Ctrl+F).
export function SearchPanel({ nodes, onPick, onClose }: SearchPanelProps) {
  const [term, setTerm] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])

  const results = useMemo(() => {
    const needle = term.trim().toLowerCase()
    if (!needle) return []
    return nodes.filter((node) => [node.data.title, node.data.description, node.data.inputs, node.data.outputs].some((field) => field.toLowerCase().includes(needle))).slice(0, MAX_RESULTS)
  }, [nodes, term])

  return (
    <div className="search-panel">
      <Island padding={2}>
        <div className="search-panel__field">
          <SearchIcon size={16} />
          <input
            ref={input}
            type="text"
            value={term}
            placeholder="Procurar na tela"
            aria-label="Procurar na tela"
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              if (event.key === 'Enter' && results[0]) onPick(results[0].id)
            }}
          />
        </div>
        {term.trim() && results.length === 0 && <p className="search-panel__empty">Nenhum resultado.</p>}
        {results.map((node) => (
          <button key={node.id} type="button" className="dropdown-menu-item" onClick={() => onPick(node.id)}>
            <div className="dropdown-menu-item__text">{node.data.title || `(${node.type})`}</div>
            <div className="dropdown-menu-item__shortcut">{node.type}</div>
          </button>
        ))}
      </Island>
    </div>
  )
}
