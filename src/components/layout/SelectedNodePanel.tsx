import { useRef, type ReactNode } from 'react'
import { useReactFlow } from '@xyflow/react'
import { containerKind, type FlowNode } from '../../utils/graphMapping'
import type { AlignMode } from '../../hooks/useSelectionActions'
import { useRealtimeContext } from '../realtime/RealtimeContext'
import { Island } from '../ui/Island'
import { AlignBottomIcon, AlignCenterIcon, AlignLeftIcon, AlignMiddleIcon, AlignRightIcon, AlignTopIcon, BringFrontIcon, CloseIcon, CopyIcon, DistributeHIcon, DistributeVIcon, ImageIcon, LockIcon, SendBackIcon, TrashIcon, UnlockIcon } from '../ui/icons'

export const MAX_PRINTS = 3

const TITLES: Record<string, string> = {
  stage: 'Etapa', gateway: 'Condicional', start: 'Início', end: 'Fim', pool: 'Pool', lane: 'Lane', phase: 'Phase', text: 'Texto', note: 'Nota', shape: 'Forma',
}

type Layers = { onReorder: (direction: 'front' | 'back') => void }

type SelectedNodePanelProps = Layers & {
  node: FlowNode
  onAddPrint: (file: File) => void
  onRemovePrint: (name: string) => void
  onDuplicate: () => void
  onToggleLock: () => void
  onAddChild: (kind: 'lane' | 'phase') => void
  onFitPool: () => void
}

export function SelectedNodePanel({ node, onAddPrint, onRemovePrint, onDuplicate, onToggleLock, onReorder, onAddChild, onFitPool }: SelectedNodePanelProps) {
  const { updateNodeData, deleteElements } = useReactFlow()
  const live = useRealtimeContext()
  const fileInput = useRef<HTMLInputElement>(null)
  const type = node.type ?? 'shape'
  const kind = containerKind(type, node.data.shapeKey) ?? type
  const locked = node.draggable === false
  const hasDescription = type === 'stage' || type === 'gateway' || type === 'note'
  const hasPrints = type === 'stage' || type === 'gateway'
  const change = (field: 'title' | 'description' | 'inputs' | 'outputs') => (value: string) => updateNodeData(node.id, { [field]: value })
  // Campo bloqueado enquanto outra pessoa o edita; ao focar avisamos os colegas.
  const field = (name: 'title' | 'description' | 'inputs' | 'outputs') => {
    const other = live.editorOf(node.id, name)
    return { disabled: !!other, title: other ? `${other.name} está editando` : undefined, onFocus: () => live.setEditing(node.id, name), onBlur: () => live.setEditing(null) }
  }

  return (
    <div className="selected-shape-actions-container">
      <Island className="selected-shape-actions" padding={0}>
        <span className="selected-shape-actions__title">{TITLES[kind] ?? 'Elemento'}</span>
        <label>Título<input type="text" value={node.data.title} maxLength={300} {...field('title')} onChange={(event) => change('title')(event.target.value)} /></label>
        {hasDescription && (
          <label>Descrição<textarea rows={3} value={node.data.description} {...field('description')} onChange={(event) => change('description')(event.target.value)} /></label>
        )}
        {type === 'stage' && (
          <>
            <label>Entradas<textarea rows={2} value={node.data.inputs} {...field('inputs')} onChange={(event) => change('inputs')(event.target.value)} /></label>
            <label>Saídas<textarea rows={2} value={node.data.outputs} {...field('outputs')} onChange={(event) => change('outputs')(event.target.value)} /></label>
          </>
        )}
        {hasPrints && (
          <div className="prints-field">
            <span>Prints ({node.data.attachments.length}/{MAX_PRINTS})</span>
            <div className="prints-field__list">
              {node.data.attachments.map((print) => (
                <div key={print.name} className="prints-field__item">
                  <img src={print.url} alt={print.name} />
                  <button type="button" className="prints-field__remove" aria-label="Remover print" onClick={() => onRemovePrint(print.name)}><CloseIcon /></button>
                </div>
              ))}
            </div>
            <button type="button" className="excalidraw-button" disabled={node.data.attachments.length >= MAX_PRINTS} onClick={() => fileInput.current?.click()}>
              <ImageIcon size={16} /> Anexar imagem
            </button>
            <small>Ou cole com Ctrl+V (PNG, JPG ou WebP, até 1 MB).</small>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onAddPrint(file)
              event.target.value = ''
            }} />
          </div>
        )}
        {(kind === 'pool' || kind === 'lane') && (
          <div className="selected-shape-actions__row">
            <button type="button" className="excalidraw-button" onClick={() => onAddChild(kind === 'pool' ? 'lane' : 'phase')}>{kind === 'pool' ? '+ Lane' : '+ Phase'}</button>
            {kind === 'pool' && <button type="button" className="excalidraw-button" title="Reencaixar lanes na largura da pool" onClick={onFitPool}>Reencaixar</button>}
          </div>
        )}
        <div className="selected-shape-actions__row">
          <button type="button" className="excalidraw-button" title="Duplicar (Ctrl+D)" onClick={onDuplicate}><CopyIcon size={16} /></button>
          <button type="button" className="excalidraw-button" title="Comentar neste elemento" onClick={() => live.openComments(node.id)}>💬</button>
          <button type="button" className="excalidraw-button" title={locked ? 'Destravar' : 'Travar posição'} aria-pressed={locked} onClick={onToggleLock}>{locked ? <LockIcon size={16} /> : <UnlockIcon size={16} />}</button>
          <button type="button" className="excalidraw-button excalidraw-button--danger" title="Excluir" onClick={() => { void deleteElements({ nodes: [{ id: node.id }] }) }}><TrashIcon size={16} /></button>
        </div>
        {!containerKind(type, node.data.shapeKey) && (
          <div className="selected-shape-actions__row">
            <button type="button" className="excalidraw-button" title="Trazer para frente" onClick={() => onReorder('front')}><BringFrontIcon size={16} /></button>
            <button type="button" className="excalidraw-button" title="Enviar para trás" onClick={() => onReorder('back')}><SendBackIcon size={16} /></button>
          </div>
        )}
      </Island>
    </div>
  )
}

type MultiSelectionPanelProps = Layers & {
  count: number
  onAlign: (mode: AlignMode) => void
  onDuplicate: () => void
}

export function MultiSelectionPanel({ count, onAlign, onDuplicate, onReorder }: MultiSelectionPanelProps) {
  const { getNodes, deleteElements } = useReactFlow()
  const alignButtons: [AlignMode, string, ReactNode][] = [
    ['left', 'Alinhar à esquerda', <AlignLeftIcon size={16} key="l" />],
    ['center', 'Centralizar na horizontal', <AlignCenterIcon size={16} key="c" />],
    ['right', 'Alinhar à direita', <AlignRightIcon size={16} key="r" />],
    ['top', 'Alinhar ao topo', <AlignTopIcon size={16} key="t" />],
    ['middle', 'Centralizar na vertical', <AlignMiddleIcon size={16} key="m" />],
    ['bottom', 'Alinhar à base', <AlignBottomIcon size={16} key="b" />],
    ['distribute-h', 'Distribuir na horizontal (3+)', <DistributeHIcon size={16} key="dh" />],
    ['distribute-v', 'Distribuir na vertical (3+)', <DistributeVIcon size={16} key="dv" />],
  ]
  return (
    <div className="selected-shape-actions-container">
      <Island className="selected-shape-actions" padding={0}>
        <span className="selected-shape-actions__title">{count} elementos selecionados</span>
        <div className="selected-shape-actions__row">
          {alignButtons.slice(0, 3).map(([mode, title, icon]) => <button key={mode} type="button" className="excalidraw-button" title={title} onClick={() => onAlign(mode)}>{icon}</button>)}
        </div>
        <div className="selected-shape-actions__row">
          {alignButtons.slice(3, 6).map(([mode, title, icon]) => <button key={mode} type="button" className="excalidraw-button" title={title} onClick={() => onAlign(mode)}>{icon}</button>)}
        </div>
        <div className="selected-shape-actions__row">
          {alignButtons.slice(6).map(([mode, title, icon]) => <button key={mode} type="button" className="excalidraw-button" title={title} disabled={count < 3} onClick={() => onAlign(mode)}>{icon}</button>)}
        </div>
        <div className="selected-shape-actions__row">
          <button type="button" className="excalidraw-button" title="Trazer para frente" onClick={() => onReorder('front')}><BringFrontIcon size={16} /></button>
          <button type="button" className="excalidraw-button" title="Enviar para trás" onClick={() => onReorder('back')}><SendBackIcon size={16} /></button>
          <button type="button" className="excalidraw-button" title="Duplicar (Ctrl+D)" onClick={onDuplicate}><CopyIcon size={16} /></button>
          <button type="button" className="excalidraw-button excalidraw-button--danger" title="Excluir" onClick={() => { void deleteElements({ nodes: getNodes().filter((node) => node.selected).map((node) => ({ id: node.id })) }) }}><TrashIcon size={16} /></button>
        </div>
      </Island>
    </div>
  )
}
