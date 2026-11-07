import { createContext, useContext, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Handle, NodeResizer, Position, ViewportPortal, useReactFlow, useStore, type NodeProps } from '@xyflow/react'
import type { ApiAttachment } from '../../types/board'
import { containerKind, type FlowNode } from '../../utils/graphMapping'
import { awsFileOf, awsGroupStyle, awsIconUrl, isAwsGroupFile } from '../../utils/awsCatalog'
import { moveDivider, normalizePool, phasesOf } from '../../utils/containerLayout'
import { useRealtimeContext } from '../realtime/RealtimeContext'
import { NodeSuggestions } from './NodeSuggestions'

type Variant = 'stage' | 'gateway' | 'start' | 'end' | 'pool' | 'lane' | 'phase' | 'text' | 'note' | 'shape'

const HANDLES = [['t', Position.Top], ['r', Position.Right], ['b', Position.Bottom], ['l', Position.Left]] as const

const DIAMOND = '50,0 100,50 50,100 0,50'
const RIGHT_TRIANGLE = '0,0 0,100 100,100'

// Visualizacao sem edicao (comparacao de versoes).
export const ReadOnlyContext = createContext(false)

function EditableTitle({ id, value }: { id: string; value: string }) {
  const { updateNodeData } = useReactFlow()
  const readOnly = useContext(ReadOnlyContext)
  const live = useRealtimeContext()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const other = live.editorOf(id, 'title')

  const finish = () => { setEditing(false); live.setEditing(null) }
  const commit = () => { updateNodeData(id, { title: draft.trim() }); finish() }

  if (editing && !readOnly) {
    return (
      <input
        className="fc-node__input nodrag"
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') finish()
          event.stopPropagation()
        }}
      />
    )
  }
  return (
    <p className="fc-node__title" title={other ? `${other.name} está editando` : undefined} onDoubleClick={() => { if (!readOnly && !other) { setDraft(value); setEditing(true); live.setEditing(id, 'title') } }}>{value || '\u00a0'}</p>
  )
}

function PrintThumbs({ prints, below = false }: { prints: ApiAttachment[]; below?: boolean }) {
  const [open, setOpen] = useState<ApiAttachment | null>(null)
  return (
    <div className={`fc-node__prints nodrag ${below ? 'fc-node__prints--below' : ''}`}>
      {prints.map((print) => (
        <button key={print.name} type="button" className="fc-node__thumb" title="Ampliar print" onClick={(event) => { event.stopPropagation(); setOpen(print) }}>
          <img src={print.url} alt={print.name} />
        </button>
      ))}
      {open && createPortal(
        <div className="print-lightbox" role="dialog" aria-modal="true" onClick={() => setOpen(null)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(null) }}>
          <img src={open.url} alt={open.name} />
        </div>,
        document.body,
      )}
    </div>
  )
}

const variantOf = (type: string | undefined, shapeKey: string | null): Variant => {
  const container = containerKind(type, shapeKey)
  return container ?? (type as Variant)
}

// Divisoria entre phases vizinhas: arrastar move a fronteira para esquerda ou direita.
function PhaseDivider({ id }: { id: string }) {
  const { getNodes, setNodes, getZoom, getInternalNode } = useReactFlow<FlowNode>()
  const [active, setActive] = useState(false)
  const [guide, setGuide] = useState<{ x: number; y1: number; y2: number } | null>(null)
  const hasNext = useStore((state) => {
    const me = state.nodeLookup.get(id)
    if (!me?.parentId) return false
    for (const other of state.nodeLookup.values()) {
      if (other.parentId === me.parentId && other.id !== id && containerKind(other.type, (other.data as FlowNode['data']).shapeKey) === 'phase' && other.position.x > me.position.x) return true
    }
    return false
  })
  if (!hasNext) return null

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.preventDefault()
    const nodes = getNodes()
    const me = nodes.find((node) => node.id === id)
    if (!me?.parentId) return
    const phases = phasesOf(nodes, me.parentId)
    const next = phases[phases.findIndex((phase) => phase.id === id) + 1]
    if (!next) return
    const span = (node: FlowNode) => ({ id: node.id, x: node.position.x, width: node.width ?? node.measured?.width ?? 0 })
    const start = { left: span(me), right: span(next), pointerX: event.clientX, zoom: getZoom() }
    setActive(true)
    const laneInternal = getInternalNode(me.parentId)
    const laneX = laneInternal?.internals.positionAbsolute.x ?? 0
    // Bordas de phases de outras lanes: alvos de encaixe da divisoria.
    const targets: { x: number; y1: number; y2: number }[] = []
    for (const node of getNodes()) {
      if (node.parentId === me.parentId || containerKind(node.type, node.data.shapeKey) !== 'phase') continue
      const internal = getInternalNode(node.id)
      if (!internal) continue
      const { x, y } = internal.internals.positionAbsolute
      const w = internal.measured.width ?? 0
      const h = internal.measured.height ?? 0
      targets.push({ x, y1: y, y2: y + h }, { x: x + w, y1: y, y2: y + h })
    }
    const laneY = laneInternal?.internals.positionAbsolute.y ?? 0
    const laneH = laneInternal?.measured.height ?? 0
    const onMove = (move: PointerEvent) => {
      let delta = (move.clientX - start.pointerX) / start.zoom
      const boundary = laneX + start.left.x + start.left.width + delta
      const near = move.altKey ? undefined : targets.reduce<typeof targets[number] | undefined>((best, target) => (Math.abs(target.x - boundary) <= 6 / start.zoom && (!best || Math.abs(target.x - boundary) < Math.abs(best.x - boundary)) ? target : best), undefined)
      if (near) delta += near.x - boundary
      setGuide(near ? { x: near.x, y1: Math.min(near.y1, laneY), y2: Math.max(near.y2, laneY + laneH) } : null)
      const [left, right] = moveDivider(start.left, start.right, delta)
      setNodes((current) => current.map((node) => {
        const target = node.id === left.id ? left : node.id === right.id ? right : null
        return target ? { ...node, position: { ...node.position, x: target.x }, width: target.width } : node
      }))
    }
    const onUp = () => {
      setActive(false)
      setGuide(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <>
      <div className={`fc-node__divider nodrag nopan ${active ? 'fc-node__divider--active' : ''}`} title="Arraste para ajustar a divisão (Alt solta o encaixe)" onPointerDown={onPointerDown} />
      {guide && <ViewportPortal><svg className="snap-guides" width={1} height={1}><line x1={guide.x} x2={guide.x} y1={guide.y1} y2={guide.y2} /></svg></ViewportPortal>}
    </>
  )
}

function NodeView({ id, type, data, selected }: NodeProps<FlowNode>) {
  const readOnly = useContext(ReadOnlyContext)
  const { setNodes } = useReactFlow<FlowNode>()
  const live = useRealtimeContext()
  const comments = live.commentCount(id)
  const tone = live.commentTone(id)
  const variant = variantOf(type, data.shapeKey)
  const shape = data.shapeKey
  const isContainer = variant === 'pool' || variant === 'lane' || variant === 'phase'
  const polygon = variant === 'gateway' ? DIAMOND : variant === 'shape' && shape === 'right_triangle' ? RIGHT_TRIANGLE : null
  const round = variant === 'start' || variant === 'end' || (variant === 'shape' && (shape === 'circle' || shape === 'ellipse'))
  const box = variant === 'stage' || (variant === 'shape' && !polygon && !round)
  const className = [
    'fc-node',
    box && 'fc-node--box',
    round && 'fc-node--ellipse',
    variant === 'end' && 'fc-node--end',
    variant === 'stage' && 'fc-node--stage',
    isContainer && `fc-node--${variant}`,
    variant === 'text' && 'fc-node--text',
    variant === 'note' && 'fc-node--note',
  ].filter(Boolean).join(' ')

  return (
    <div className={className} title={variant === 'gateway' && data.description ? data.description : undefined}>
      {!readOnly && <NodeResizer isVisible={selected} minWidth={isContainer ? 80 : 40} minHeight={isContainer ? 60 : 30} onResizeEnd={(_, params) => {
        if (variant === 'pool') setNodes((current) => normalizePool(current, id, params.width))
        else if (variant === 'lane') setNodes((current) => { const parent = current.find((node) => node.id === id)?.parentId; return parent ? normalizePool(current, parent) : current })
      }} />}
      {!readOnly && variant === 'phase' && <PhaseDivider id={id} />}
      {comments > 0 && <button type="button" className={`fc-node__badge nodrag ${tone ? `fc-node__badge--${tone}` : ''}`} title="Ver comentários" onClick={(event) => { event.stopPropagation(); live.openComments(id) }}>💬 {comments}</button>}
      {!readOnly && !isContainer && variant !== 'text' && variant !== 'note' && <NodeSuggestions nodeId={id} fromKey={shape ?? variant} />}
      {polygon && <svg className="fc-node__svg" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points={polygon} /></svg>}
      <div className="fc-node__body">
        <EditableTitle id={id} value={data.title} />
        {(variant === 'stage' || variant === 'note') && data.description && <p className="fc-node__text">{data.description}</p>}
        {variant === 'stage' && data.attachments.length > 0 && <PrintThumbs prints={data.attachments} />}
      </div>
      {variant === 'gateway' && data.attachments.length > 0 && <PrintThumbs prints={data.attachments} below />}
      {!isContainer && HANDLES.map(([handleId, position]) => <Handle key={handleId} id={handleId} type="source" position={position} />)}
    </div>
  )
}

// Icone de servico (rotulo abaixo) ou grupo AWS (VPC, subnet...) com borda e icone no canto.
function AwsNode({ id, data, selected, file }: NodeProps<FlowNode> & { file: string }) {
  const readOnly = useContext(ReadOnlyContext)
  const live = useRealtimeContext()
  const comments = live.commentCount(id)
  const group = isAwsGroupFile(file)
  const style = group ? awsGroupStyle(file) : null
  return (
    <div className={`fc-node fc-aws ${group ? 'fc-aws--group' : 'fc-aws--service'} ${style?.dashed ? 'fc-aws--dashed' : ''}`} style={style ? ({ '--aws-accent': style.color } as CSSProperties) : undefined}>
      {!readOnly && <NodeResizer isVisible={selected} minWidth={group ? 120 : 48} minHeight={group ? 80 : 56} />}
      {comments > 0 && <button type="button" className="fc-node__badge nodrag" title="Ver comentários" onClick={(event) => { event.stopPropagation(); live.openComments(id) }}>💬 {comments}</button>}
      {group ? (
        <div className="fc-aws__head">
          {!style?.noIcon && <img src={awsIconUrl(file)} alt="" draggable={false} />}
          <EditableTitle id={id} value={data.title} />
        </div>
      ) : (
        <>
          <img className="fc-aws__icon" src={awsIconUrl(file)} alt={data.title} draggable={false} />
          <EditableTitle id={id} value={data.title} />
        </>
      )}
      {!group && HANDLES.map(([handleId, position]) => <Handle key={handleId} id={handleId} type="source" position={position} />)}
    </div>
  )
}

function ShapeNode(props: NodeProps<FlowNode>) {
  const file = awsFileOf(props.data.extra)
  return file ? <AwsNode {...props} file={file} /> : <NodeView {...props} />
}

export const nodeTypes = {
  stage: NodeView,
  gateway: NodeView,
  start: NodeView,
  end: NodeView,
  area: NodeView,
  text: NodeView,
  note: NodeView,
  shape: ShapeNode,
}
