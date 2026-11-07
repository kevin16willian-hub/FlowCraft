import { useCallback, useEffect, useState } from 'react'
import { collabApi } from '../../api/client'
import type { OnlineRoom } from '../../api/client'
import type { AdminUser, AuditEntry, BoardSummary, CurrentUser, TeamSummary } from '../../types/board'
import { Modal } from '../ui/Modal'
import { UserPicker } from '../ui/UserPicker'

type Tab = 'boards' | 'online' | 'users' | 'teams' | 'audit'
type AdminPanelProps = { user: CurrentUser | null; onOpenBoard: (id: string) => void; onClose: () => void }

const date = (value: string | null) => (value ? new Date(value).toLocaleString('pt-BR') : 'nunca')

export function AdminPanel({ user, onOpenBoard, onClose }: AdminPanelProps) {
  const [tab, setTab] = useState<Tab>('boards')
  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [online, setOnline] = useState<OnlineRoom[]>([])
  const [filter, setFilter] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      if (tab === 'boards') setBoards(await collabApi.adminBoards())
      else if (tab === 'online') setOnline(await collabApi.online())
      else if (tab === 'users') setUsers(await collabApi.adminUsers())
      else if (tab === 'teams') setTeams(await collabApi.adminTeams())
      else setAudit(await collabApi.audit())
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'erro inesperado') }
  }, [tab])
  useEffect(() => { void load() }, [load])
  // Quem esta online: atualiza a cada 5 s apenas enquanto a aba esta aberta.
  useEffect(() => {
    if (tab !== 'online') return undefined
    const timer = window.setInterval(() => { void load() }, 5000)
    return () => window.clearInterval(timer)
  }, [tab, load])

  const run = async (task: () => Promise<void>) => {
    setMessage(null)
    try { await task(); await load() } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'erro inesperado') }
  }
  const match = (...values: (string | null)[]) => !filter.trim() || values.some((value) => value?.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <Modal title="Administração" wide onClose={onClose}>
      <div className="Modal__tabs" role="tablist">
        {([['boards', 'Quadros'], ['online', 'Online agora'], ['users', 'Pessoas'], ['teams', 'Times'], ['audit', 'Auditoria']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setMessage(null) }}>{label}</button>
        ))}
      </div>
      <div className="Modal__form"><input type="search" value={filter} placeholder="Filtrar" aria-label="Filtrar" onChange={(event) => setFilter(event.target.value)} /></div>
      {message && <p role="alert" className="Modal__error">{message}</p>}

      {tab === 'boards' && boards.filter((board) => match(board.name, board.ownerUnumber, board.ownerName)).map((board) => (
        <div key={board.id} className="Modal__row">
          <button type="button" className="Modal__row-main row-button" onClick={() => { onOpenBoard(board.id); onClose() }}>
            <strong>{board.name}</strong><small>dono: {board.ownerName ?? board.ownerUnumber} ({board.ownerUnumber}) · {board.nodeCount} elementos · {date(board.updatedAt)}</small>
          </button>
        </div>
      ))}

      {tab === 'online' && online.length === 0 && <p className="Modal__hint">Ninguém conectado ao vivo neste momento.</p>}
      {tab === 'online' && online.map((room) => (
        <div key={room.boardId} className="Modal__row">
          <button type="button" className="Modal__row-main row-button" onClick={() => { onOpenBoard(room.boardId); onClose() }}>
            <strong>{room.boardName} · {room.clients.length} conectado(s)</strong>
            <small>{room.clients.map((client) => `${client.name} (${client.role})`).join(', ')}</small>
          </button>
        </div>
      ))}

      {tab === 'users' && (
        <>
          <div className="Modal__section"><strong>Novo administrador</strong><UserPicker onPick={(unumber) => { void run(() => collabApi.grantAdmin(unumber)) }} /></div>
          {users.filter((item) => match(item.unumber, item.name, item.email)).map((item) => (
            <div key={item.unumber} className="Modal__row">
              <div className="Modal__row-main">
                <strong>{item.name ?? item.email}{item.admin ? ' · admin' : ''}{item.active ? '' : ' · inativo'}</strong>
                <small>{item.unumber} · {item.boardCount} quadros · {item.teamCount} times · último acesso {date(item.lastLoginAt)}</small>
              </div>
              {item.admin
                ? <button type="button" className="excalidraw-button" onClick={() => { void run(() => collabApi.revokeAdmin(item.unumber)) }}>Remover admin</button>
                : <button type="button" className="excalidraw-button" onClick={() => { void run(() => collabApi.grantAdmin(item.unumber)) }}>Tornar admin</button>}
              {item.unumber !== user?.unumber && (
                <button type="button" className="excalidraw-button" onClick={() => { void run(() => collabApi.setUserActive(item.unumber, !item.active)) }}>{item.active ? 'Desativar' : 'Ativar'}</button>
              )}
            </div>
          ))}
        </>
      )}

      {tab === 'teams' && teams.filter((team) => match(team.name)).map((team) => (
        <div key={team.id} className="Modal__row"><div className="Modal__row-main"><strong>{team.name}</strong><small>{team.memberCount} membros · {team.boardCount} quadros</small></div></div>
      ))}

      {tab === 'audit' && audit.filter((entry) => match(entry.actor, entry.action, entry.target)).map((entry) => (
        <div key={entry.id} className="Modal__row"><div className="Modal__row-main"><strong>{entry.action}</strong><small>{entry.actor} → {entry.target ?? '—'}{entry.detail ? ` (${entry.detail})` : ''} · {date(entry.at)}</small></div></div>
      ))}
    </Modal>
  )
}
