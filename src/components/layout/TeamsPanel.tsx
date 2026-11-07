import { useCallback, useEffect, useState } from 'react'
import { collabApi } from '../../api/client'
import type { CurrentUser, TeamDetail, TeamRole, TeamSummary } from '../../types/board'
import { Modal } from '../ui/Modal'
import { UserPicker } from '../ui/UserPicker'

type TeamsPanelProps = { user: CurrentUser | null; onOpenBoard: (id: string) => void; onClose: () => void }

const ROLE_LABELS = { editor: 'edita', viewer: 'vê', member: 'Membro', team_admin: 'Admin do time' } as const

export function TeamsPanel({ user, onOpenBoard, onClose }: TeamsPanelProps) {
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [detail, setDetail] = useState<TeamDetail | null>(null)
  const [name, setName] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const loadTeams = useCallback(() => collabApi.teams().then(setTeams).catch(() => {}), [])
  useEffect(() => { void loadTeams() }, [loadTeams])

  const run = async (task: () => Promise<void>) => {
    setMessage(null)
    try { await task() } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'erro inesperado') }
  }
  const open = (id: string) => run(async () => setDetail(await collabApi.team(id)))
  const canManage = detail?.role === 'team_admin'

  if (detail) {
    return (
      <Modal title={`Time: ${detail.name}`} onClose={onClose}>
        <button type="button" className="excalidraw-button" onClick={() => { setDetail(null); void loadTeams() }}>← Todos os times</button>
        {message && <p role="alert" className="Modal__error">{message}</p>}
        {detail.description && <p className="Modal__hint">{detail.description}</p>}
        <div className="Modal__section"><strong>Quadros do time</strong></div>
        {detail.boards.length === 0 && <p className="Modal__hint">Nenhum quadro compartilhado com o time. Use "Compartilhar" em um quadro seu.</p>}
        {detail.boards.map((board) => (
          <div key={board.id} className="Modal__row">
            <button type="button" className="Modal__row-main row-button" onClick={() => { onOpenBoard(board.id); onClose() }}>
              <strong>{board.name}</strong><small>de {board.ownerName ?? board.ownerUnumber} · time {ROLE_LABELS[board.role]}</small>
            </button>
          </div>
        ))}
        <div className="Modal__section"><strong>Membros ({detail.members.length})</strong></div>
        {canManage && <UserPicker placeholder="Adicionar pessoa" onPick={(unumber) => { void run(async () => setDetail(await collabApi.setMember(detail.id, unumber, 'member'))) }} />}
        {detail.members.map((member) => (
          <div key={member.unumber} className="Modal__row">
            <div className="Modal__row-main"><strong>{member.name ?? member.unumber}</strong><small>{member.unumber}{member.pending ? ' · convite pendente' : ''}</small></div>
            {canManage ? (
              <select value={member.role} aria-label="Papel" onChange={(event) => { void run(async () => setDetail(await collabApi.setMember(detail.id, member.unumber, event.target.value as TeamRole))) }}>
                <option value="member">{ROLE_LABELS.member}</option>
                <option value="team_admin">{ROLE_LABELS.team_admin}</option>
              </select>
            ) : <small>{ROLE_LABELS[member.role]}</small>}
            {(canManage || member.unumber === user?.unumber) && (
              <button type="button" className="excalidraw-button" onClick={() => {
                if (window.confirm(member.unumber === user?.unumber ? 'Sair deste time?' : `Remover ${member.unumber} do time?`)) void run(async () => { await collabApi.removeMember(detail.id, member.unumber); if (member.unumber === user?.unumber) { setDetail(null); await loadTeams() } else setDetail(await collabApi.team(detail.id)) })
              }}>{member.unumber === user?.unumber ? 'Sair' : 'Remover'}</button>
            )}
          </div>
        ))}
        {canManage && (
          <div className="Modal__section">
            <button type="button" className="excalidraw-button excalidraw-button--danger" onClick={() => {
              if (window.confirm(`Arquivar o time "${detail.name}"? Os compartilhamentos com ele deixam de valer.`)) void run(async () => { await collabApi.updateTeam(detail.id, { archived: true }); setDetail(null); await loadTeams() })
            }}>Arquivar time</button>
          </div>
        )}
      </Modal>
    )
  }

  return (
    <Modal title="Times" onClose={onClose}>
      <form className="Modal__form" onSubmit={(event) => { event.preventDefault(); const value = name.trim(); if (value) void run(async () => { const team = await collabApi.createTeam(value); setName(''); await loadTeams(); await open(team.id) }) }}>
        <input type="text" value={name} maxLength={100} placeholder="Nome do novo time" aria-label="Nome do novo time" onChange={(event) => setName(event.target.value)} />
        <button type="submit" className="excalidraw-button excalidraw-button--primary" disabled={!name.trim()}>Criar</button>
      </form>
      {message && <p role="alert" className="Modal__error">{message}</p>}
      {teams.length === 0 && <p className="Modal__hint">Você ainda não participa de nenhum time.</p>}
      {teams.map((team) => (
        <div key={team.id} className="Modal__row">
          <button type="button" className="Modal__row-main row-button" onClick={() => { void open(team.id) }}>
            <strong>{team.name}</strong><small>{team.memberCount} membros · {team.boardCount} quadros · {ROLE_LABELS[team.role]}</small>
          </button>
        </div>
      ))}
    </Modal>
  )
}
