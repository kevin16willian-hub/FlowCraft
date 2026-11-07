import { useCallback, useEffect, useState } from 'react'
import { collabApi } from '../../api/client'
import type { Role, ShareList, ShareRole, TeamSummary } from '../../types/board'
import { Modal } from '../ui/Modal'
import { UserPicker } from '../ui/UserPicker'

type ShareDialogProps = { boardId: string; boardName: string; role: Role; onClose: () => void; onTransferred: () => void }

const ROLE_LABELS: Record<ShareRole, string> = { viewer: 'Pode ver', editor: 'Pode editar' }

export function ShareDialog({ boardId, boardName, role, onClose, onTransferred }: ShareDialogProps) {
  const [list, setList] = useState<ShareList | null>(null)
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [newRole, setNewRole] = useState<ShareRole>('viewer')
  const [teamId, setTeamId] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const isOwner = role === 'owner'

  const load = useCallback(() => collabApi.shares(boardId).then(setList).catch((cause: Error) => setMessage(cause.message)), [boardId])
  useEffect(() => {
    if (!isOwner) return
    void load()
    void collabApi.teams().then(setTeams).catch(() => {})
  }, [isOwner, load])

  const run = async (task: () => Promise<unknown>) => {
    setMessage(null)
    try { await task(); await load() } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'erro inesperado') }
  }

  return (
    <Modal title={`Compartilhar "${boardName}"`} onClose={onClose}>
      {!isOwner && <p className="Modal__hint">Somente a pessoa dona do quadro (ou um administrador) gerencia o compartilhamento. Seu acesso: {role === 'editor' ? 'edição' : 'leitura'}.</p>}
      {isOwner && (
        <>
          <div className="share-add">
            <UserPicker onPick={(unumber) => { void run(() => collabApi.share(boardId, { unumber }, newRole)) }} />
            <select value={newRole} aria-label="Permissão" onChange={(event) => setNewRole(event.target.value as ShareRole)}>
              <option value="viewer">{ROLE_LABELS.viewer}</option>
              <option value="editor">{ROLE_LABELS.editor}</option>
            </select>
          </div>
          {teams.length > 0 && (
            <div className="share-add">
              <select value={teamId} aria-label="Time" onChange={(event) => setTeamId(event.target.value)}>
                <option value="">Compartilhar com um time...</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
              <button type="button" className="excalidraw-button" disabled={!teamId} onClick={() => { void run(() => collabApi.share(boardId, { teamId }, newRole)); setTeamId('') }}>Adicionar</button>
            </div>
          )}
          {message && <p role="alert" className="Modal__error">{message}</p>}
          <div className="Modal__row"><div className="Modal__row-main"><strong>{list?.owner.name ?? list?.owner.unumber ?? '...'}</strong><small>{list?.owner.unumber} · dono</small></div></div>
          {list?.shares.map((share) => (
            <div key={share.id} className="Modal__row">
              <div className="Modal__row-main">
                <strong>{share.type === 'team' ? `Time: ${share.name}` : share.name ?? share.unumber}</strong>
                <small>{share.type === 'user' ? `${share.unumber}${share.pending ? ' · convite pendente (ainda não entrou)' : ''}` : 'todos os membros do time'}</small>
              </div>
              <select value={share.role} aria-label="Permissão" onChange={(event) => { void run(() => collabApi.setShareRole(boardId, share.id, event.target.value as ShareRole)) }}>
                <option value="viewer">{ROLE_LABELS.viewer}</option>
                <option value="editor">{ROLE_LABELS.editor}</option>
              </select>
              <button type="button" className="excalidraw-button" onClick={() => { void run(() => collabApi.unshare(boardId, share.id)) }}>Remover</button>
            </div>
          ))}
          {list?.shares.length === 0 && <p className="Modal__hint">Este quadro ainda não foi compartilhado.</p>}
          <div className="Modal__section">
            <strong>Transferir propriedade</strong>
            <p className="Modal__hint">A nova pessoa passa a ser a dona; você deixa de ter acesso, a menos que ela compartilhe de volta.</p>
            <UserPicker placeholder="Nova pessoa dona" onPick={(unumber) => {
              if (window.confirm(`Transferir "${boardName}" para ${unumber}?`)) void run(async () => { await collabApi.transfer(boardId, unumber); onTransferred() })
            }} />
          </div>
        </>
      )}
    </Modal>
  )
}
