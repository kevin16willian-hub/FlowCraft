import type { ReactNode } from 'react'
import type { BoardKind, Shape } from '../../types/board'
import type { AwsItem } from '../../utils/awsCatalog'
import { AwsTools } from './AwsPalette'
import { DropdownMenu, DropdownMenuItem } from '../ui/DropdownMenu'
import { Island, Stack } from '../ui/Island'
import { ToolButton } from '../ui/ToolButton'
import { SHAPE_ICONS } from '../ui/shapeIcons'
import { DiamondIcon, EllipseIcon, EndEventIcon, HandIcon, LaneIcon, LockIcon, MoreIcon, NoteIcon, PhaseIcon, PoolIcon, PlusIcon, RectangleIcon, SelectionIcon, TextIcon, UnlockIcon } from '../ui/icons'
import { genericItemOf } from '../../utils/genericCatalog'

export type ToolDefinition = { id: string; title: string; key: string; icon: ReactNode; group: number }

export const MAIN_TOOLS: ToolDefinition[] = [
  { id: 'select', title: 'Seleção', key: 'v', icon: <SelectionIcon />, group: 0 },
  { id: 'hand', title: 'Mão (ferramenta de rolagem)', key: 'h', icon: <HandIcon />, group: 0 },
  { id: 'stage', title: 'Etapa', key: 'r', icon: <RectangleIcon />, group: 1 },
  { id: 'gateway', title: 'Condicional', key: 'd', icon: <DiamondIcon />, group: 1 },
  { id: 'start', title: 'Início', key: 'o', icon: <EllipseIcon />, group: 1 },
  { id: 'end', title: 'Fim', key: 'f', icon: <EndEventIcon />, group: 1 },
  { id: 'pool', title: 'Pool (swimlane)', key: 'p', icon: <PoolIcon />, group: 2 },
  { id: 'lane', title: 'Lane (raia)', key: 'l', icon: <LaneIcon />, group: 2 },
  { id: 'phase', title: 'Phase (fase)', key: 'g', icon: <PhaseIcon />, group: 2 },
  { id: 'text', title: 'Texto', key: 't', icon: <TextIcon />, group: 3 },
  { id: 'note', title: 'Nota', key: 'n', icon: <NoteIcon />, group: 3 },
]

export const hintFor = (tool: string, shapes: Shape[], awsItems: AwsItem[] = []) => {
  if (tool === 'select') return <span>Para mover a tela, segure <kbd>Roda do mouse</kbd> ou <kbd>Barra de espaço</kbd> enquanto arrasta ou use a ferramenta de mão</span>
  if (tool === 'hand') return <span>Arraste para mover a tela</span>
  const label = MAIN_TOOLS.find((item) => item.id === tool)?.title ?? shapes.find((shape) => shape.key === tool)?.label ?? awsItems.find((item) => item.key === tool)?.label ?? genericItemOf(tool)?.label ?? 'elemento'
  return <span>Clique no quadro para inserir: {label}</span>
}

const AWS_TOOL_IDS = new Set(['select', 'hand', 'text', 'note'])
export const toolsFor = (kind: BoardKind) => (kind === 'aws' ? MAIN_TOOLS.filter((item) => AWS_TOOL_IDS.has(item.id)) : MAIN_TOOLS)

type ToolbarProps = {
  tool: string
  locked: boolean
  kind: BoardKind
  shapes: Shape[]
  awsItems: AwsItem[]
  hint: ReactNode
  onToolChange: (tool: string) => void
  onLockChange: (locked: boolean) => void
  mindmapActions?: {
    canAddRoot: boolean
    canAddChild: boolean
    canAddSibling: boolean
    onAddRoot: () => void
    onAddChild: () => void
    onAddSibling: () => void
  }
}

export function Toolbar({ tool, locked, kind, shapes, awsItems, hint, onToolChange, onLockChange, mindmapActions }: ToolbarProps) {
  const tools = toolsFor(kind)
  const mainIds = new Set(MAIN_TOOLS.map((item) => item.id))
  const extraShapes = kind === 'aws' ? [] : shapes.filter((shape) => !mainIds.has(shape.key) && SHAPE_ICONS[shape.key])
  const extraActive = extraShapes.some((shape) => shape.key === tool)
  const mindmap = kind === 'business-plan'

  return (
    <Stack direction="vertical" gap={4} style={{ justifyItems: 'start' }}>
      <Stack direction="horizontal" gap={1} className="App-toolbar-container">
        <Island className="App-toolbar" padding={1} data-viewport-ui="top">
          <div className="HintViewer">{hint}</div>
          <Stack direction="horizontal" gap={1}>
            <ToolButton
              icon={locked ? <LockIcon /> : <UnlockIcon />}
              title="Manter ativa a ferramenta selecionada após desenhar"
              keybinding="q"
              checked={locked}
              onClick={() => onLockChange(!locked)}
            />
            <div className="App-toolbar__divider" />
            {mindmap ? (
              <>
                {MAIN_TOOLS.filter((item) => item.id === 'select' || item.id === 'hand').map((item) => (
                  <ToolButton key={item.id} icon={item.icon} title={item.title} keybinding={item.key} checked={tool === item.id} onClick={() => onToolChange(item.id)} />
                ))}
                <div className="App-toolbar__divider" />
                <button type="button" className="ToolIcon ToolIcon_type_toggle ToolIcon_size_medium" title="Criar tópico central" aria-label="Criar tópico central" disabled={!mindmapActions?.canAddRoot} onClick={mindmapActions?.onAddRoot}>
                  <div className="ToolIcon__icon"><PlusIcon /></div>
                </button>
                <button type="button" className="ToolIcon ToolIcon_type_toggle ToolIcon_size_medium" title="Adicionar subtópico ao tópico selecionado" aria-label="Adicionar subtópico" disabled={!mindmapActions?.canAddChild} onClick={mindmapActions?.onAddChild}>
                  <div className="ToolIcon__icon"><RectangleIcon /></div>
                </button>
                <button type="button" className="ToolIcon ToolIcon_type_toggle ToolIcon_size_medium" title="Adicionar tópico no mesmo nível" aria-label="Adicionar tópico irmão" disabled={!mindmapActions?.canAddSibling} onClick={mindmapActions?.onAddSibling}>
                  <div className="ToolIcon__icon"><NoteIcon /></div>
                </button>
              </>
            ) : tools.map((item, index) => (
              <span key={item.id} style={{ display: 'contents' }}>
                {index > 0 && tools[index - 1].group !== item.group && <div className="App-toolbar__divider" />}
                <ToolButton icon={item.icon} title={item.title} keybinding={item.key} checked={tool === item.id} onClick={() => onToolChange(item.id)} />
              </span>
            ))}
            {!mindmap && kind === 'aws' && <AwsTools items={awsItems} tool={tool} onToolChange={onToolChange} />}
            {!mindmap && extraShapes.length > 0 && (
              <>
                <div className="App-toolbar__divider" />
                <DropdownMenu triggerIcon={<MoreIcon />} triggerTitle="Mais formas" triggerClassName={`App-toolbar__extra-tools-trigger ${extraActive ? 'ToolIcon--checked' : ''}`}>
                  {extraShapes.map((shape) => (
                    <DropdownMenuItem key={shape.key} icon={SHAPE_ICONS[shape.key]} selected={tool === shape.key} onSelect={() => onToolChange(shape.key)}>{shape.label}</DropdownMenuItem>
                  ))}
                </DropdownMenu>
              </>
            )}
          </Stack>
        </Island>
      </Stack>
    </Stack>
  )
}
