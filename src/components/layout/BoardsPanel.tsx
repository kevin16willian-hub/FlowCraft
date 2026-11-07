import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { boardsApi } from '../../api/client'
import type { BoardKind, BoardSummary, CurrentUser, Role } from '../../types/board'
import { Modal } from '../ui/Modal'
import { ArchiveIcon, CopyIcon, PencilIcon, RestoreIcon, TrashIcon } from '../ui/icons'

type BoardsPanelProps = {
  user: CurrentUser | null
  boards: BoardSummary[]
  currentId: string | null
  onOpen: (id: string) => void
  onCreate: (name: string, kind: BoardKind) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
  onDuplicate: (id: string) => Promise<void>
  onArchive: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onRestore: (id: string) => Promise<void>
  onClose: () => void
}

const BOARD_KINDS: { kind: BoardKind; title: string; text: string }[] = [
  { kind: 'flowchart', title: 'Fluxograma', text: 'Processos, decisões e swimlanes' },
  { kind: 'aws', title: 'Arquitetura AWS', text: 'Ícones oficiais, VPCs e sub-redes' },
]

const iconButton = (title: string, icon: ReactNode, onClick: () => void) => (
  <button type="button" className="ToolIcon" title={title} aria-label={title} onClick={onClick}><div className="ToolIcon__icon">{icon}</div></button>
)

export function BoardsPanel({ user, boards, currentId, onOpen, onCreate, onRename, onDuplicate, onArchive, onDelete, onRestore, onClose }: BoardsPanelProps) {
  const [tab, setTab] = useState<'active' | 'shared' | 'archived'>('active')
  const [archived, setArchived] = useState<BoardSummary[]>([])
  const [name, setName] = useState('')
  const [kind, setKind] = useState<BoardKind>('flowchart')
  const [message, setMessage] = useState<string | null>(null)

  const loadArchived = useCallback(() => boardsApi.list(true).then(setArchived).catch(() => {}), [])
  useEffect(() => { if (tab === 'archived') void loadArchived() }, [tab, loadArchived])

  const run = async (task: () => Promise<void>) => {
    setMessage(null)
    try { await task() } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'erro inesperado') }
  }

  const mine = (board: BoardSummary) => board.ownerUnumber === user?.unumber
  const confirmDelete = (board: BoardSummary) => {
    if (!window.confirm(`Excluir DEFINITIVAMENTE o quadro "${board.name}"?\n\nO conteúdo, o histórico de versões, os comentários e os compartilhamentos serão apagados e não poderão ser recuperados.`)) return
    void run(async () => { await onDelete(board.id); if (tab === 'archived') await loadArchived() })
  }
  const list = tab === 'active' ? boards.filter(mine) : tab === 'shared' ? boards.filter((board) => !mine(board)) : archived
  const roleLabel = (role: Role | null) => (role === 'editor' ? 'edição' : role === 'viewer' ? 'leitura' : '')

  return (
    <Modal title="Quadros" onClose={onClose}>
      <div className="Modal__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'active'} onClick={() => setTab('active')}>Meus</button>
        <button type="button" role="tab" aria-selected={tab === 'shared'} onClick={() => setTab('shared')}>Compartilhados comigo</button>
        <button type="button" role="tab" aria-selected={tab === 'archived'} onClick={() => setTab('archived')}>Arquivados</button>
      </div>
      {tab === 'active' && (
        <>
        <div className="board-kinds" role="radiogroup" aria-label="Tipo de quadro">
          {BOARD_KINDS.map((option) => (
            <button key={option.kind} type="button" role="radio" aria-checked={kind === option.kind} className={`board-kind ${kind === option.kind ? 'board-kind--active' : ''}`} onClick={() => setKind(option.kind)}>
              <strong>{option.title}</strong>
              <small>{option.text}</small>
            </button>
          ))}
        </div>
        <form className="Modal__form" onSubmit={(event) => { event.preventDefault(); const value = name.trim(); if (value) void run(async () => { await onCreate(value, kind); setName(''); onClose() }) }}>
          <input type="text" value={name} maxLength={200} placeholder="Nome do novo quadro" aria-label="Nome do novo quadro" autoFocus onChange={(event) => setName(event.target.value)} />
          <button type="submit" className="excalidraw-button excalidraw-button--primary" disabled={!name.trim()}>Criar</button>
        </form>
        </>
      )}
      {message && <p role="alert" style={{ color: 'var(--color-danger)', fontSize: '0.875rem' }}>{message}</p>}
      {list.length === 0 && <p style={{ color: 'var(--text-secondary-color)', fontSize: '0.875rem' }}>{tab === 'shared' ? 'Nenhum quadro foi compartilhado com você.' : tab === 'active' ? 'Nenhum quadro seu.' : 'Nenhum quadro arquivado.'}</p>}
      {list.map((board) => (
        <div key={board.id} className={`Modal__row ${board.id === currentId ? 'current' : ''}`}>
          {tab !== 'archived' ? (
            <button type="button" className="Modal__row-main" style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' }} onClick={() => { onOpen(board.id); onClose() }}>
              <strong>{board.name}</strong>
              <small>{board.nodeCount} elementos · atualizado em {new Date(board.updatedAt).toLocaleString('pt-BR')}{!mine(board) && ` · de ${board.ownerName ?? board.ownerUnumber} · ${roleLabel(board.role)}`}</small>
            </button>
          ) : (
            <div className="Modal__row-main">
              <strong>{board.name}</strong>
              <small>{board.nodeCount} elementos · arquivado{!mine(board) && ` · de ${board.ownerName ?? board.ownerUnumber}`}</small>
            </div>
          )}
          {tab !== 'archived' ? (
            <>
              {mine(board) && iconButton('Renomear', <PencilIcon />, () => {
                const next = window.prompt('Novo nome do quadro', board.name)?.trim()
                if (next && next !== board.name) void run(() => onRename(board.id, next))
              })}
              {iconButton('Duplicar', <CopyIcon />, () => { void run(() => onDuplicate(board.id)) })}
              {mine(board) && iconButton('Arquivar', <ArchiveIcon />, () => {
                if (window.confirm(`Arquivar o quadro "${board.name}"? O histórico é preservado.`)) void run(() => onArchive(board.id))
              })}
              {mine(board) && iconButton('Excluir definitivamente', <TrashIcon />, () => confirmDelete(board))}
            </>
          ) : mine(board) && (
            <>
              {iconButton('Restaurar', <RestoreIcon />, () => { void run(async () => { await onRestore(board.id); await loadArchived() }) })}
              {iconButton('Excluir definitivamente', <TrashIcon />, () => confirmDelete(board))}
            </>
          )}
        </div>
      ))}
    </Modal>
  )
}
