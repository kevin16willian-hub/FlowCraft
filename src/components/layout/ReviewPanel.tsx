import { useCallback, useEffect, useState } from 'react'
import { collabApi, reviewApi } from '../../api/client'
import type { BoardMeta, TeamSummary } from '../../types/board'
import type { ChangeRequest, ChangeStatus, ChangeWithProposal, UpdateResult } from '../../types/review'
import { Modal } from '../ui/Modal'
import { UserPicker } from '../ui/UserPicker'

type ReviewPanelProps = {
  title: string
  board: BoardMeta
  isOwner: boolean
  change: ChangeRequest | null
  onClose: () => void
  onOpenBoard: (id: string) => void
  onCompare: (change: ChangeWithProposal) => void
  onChanged: () => void
}

const STATUS_LABEL: Record<ChangeStatus, string> = {
  draft: 'Rascunho', open: 'Aguardando revisão', changes_requested: 'Ajustes pedidos', merged: 'Aprovada', rejected: 'Rejeitada', cancelled: 'Cancelada',
}

const StatusChip = ({ status }: { status: ChangeStatus }) => <span className={`review-chip review-chip--${status}`}>{STATUS_LABEL[status]}</span>

export function ReviewPanel({ title: heading, board, isOwner, change, onClose, onOpenBoard, onCompare, onChanged }: ReviewPanelProps) {
  const [changes, setChanges] = useState<ChangeRequest[]>([])
  const [waiting, setWaiting] = useState<ChangeRequest[]>([])
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [teamId, setTeamId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [protectError, setProtectError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<UpdateResult['conflicts']>([])

  const load = useCallback(async () => {
    const [list, pending] = await Promise.all([
      board.protected ? reviewApi.list(board.id) : Promise.resolve([]),
      reviewApi.pending('review'),
    ])
    setChanges(list)
    setWaiting(pending)
  }, [board.id, board.protected])

  useEffect(() => { void load().catch(() => {}) }, [load])
  useEffect(() => { if (isOwner && !board.protected) void collabApi.teams().then(setTeams).catch(() => {}) }, [isOwner, board.protected])

  const run = async (task: () => Promise<unknown>) => {
    setMessage(null)
    try { await task(); await load(); onChanged() } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'erro inesperado') }
  }

  const protect = async (enable: boolean) => {
    setProtectError(null)
    try { await reviewApi.setProtection(board.id, enable, enable ? teamId : undefined); await load(); onChanged() } catch (cause) { setProtectError(cause instanceof Error ? cause.message : 'erro inesperado') }
  }
  const propose = () => run(async () => {
    const created = await reviewApi.open(board.id, { title, description: description || undefined, assignee: assignee ?? undefined })
    setTitle(''); setDescription(''); setAssignee(null)
    onOpenBoard(created.forkBoardId)
  })
  const compare = (item: ChangeRequest) => run(async () => { onCompare(await reviewApi.get(item.id)) })
  const decide = (item: ChangeRequest, decision: 'approve' | 'request_changes' | 'reject') => run(async () => { await reviewApi.decide(item.id, decision, comment || undefined); setComment('') })
  const refreshCopy = (item: ChangeRequest, thenClose = false) => run(async () => {
    const result = await reviewApi.update(item.id)
    setConflicts(result.conflicts)
    if (thenClose && result.conflicts.length === 0) onClose()
    else if (result.upToDate) setMessage('A cópia já está atualizada com o quadro original.')
    else if (result.updated) setMessage('Cópia atualizada com as mudanças do original. Reenvie para revisão.')
    else setMessage('Não foi possível mesclar: os elementos abaixo foram alterados nos dois lados.')
  })

  const decidable = changes.filter((item) => item.canDecide)

  return (
    <Modal title={heading} wide onClose={onClose}>
      {message && <p role="status" className="Modal__hint">{message}</p>}
      {conflicts.length > 0 && <ul className="review-conflicts">{conflicts.map((item) => <li key={item.id}>{item.title}</li>)}</ul>}

      {change && (
        <section className="Modal__section review-box">
          <h3>Esta é uma cópia de trabalho: {change.title} <StatusChip status={change.status} /></h3>
          {change.description && <p className="Modal__hint">{change.description}</p>}
          {change.outdated && ['draft', 'changes_requested', 'open'].includes(change.status) && <p className="review-warning">O quadro original mudou depois que esta cópia foi criada. Atualize antes de enviar.</p>}
          {change.decisionComment && <p className="review-feedback"><strong>{change.decidedBy}:</strong> {change.decisionComment}</p>}
          <div className="review-actions">
            {change.isAuthor && ['draft', 'changes_requested'].includes(change.status) && <button type="button" className="excalidraw-button excalidraw-button--primary" onClick={() => { void run(() => reviewApi.submit(change.id)) }}>Enviar para revisão</button>}
            {change.isAuthor && ['draft', 'changes_requested', 'open'].includes(change.status) && <button type="button" className="excalidraw-button" onClick={() => { void refreshCopy(change, change.status !== 'open') }}>{change.status === 'open' ? 'Atualizar com o original' : 'Iniciar edições'}</button>}
            {['draft', 'changes_requested', 'open'].includes(change.status) && (change.isAuthor || isOwner) && <button type="button" className="excalidraw-button" onClick={() => { void run(() => reviewApi.cancel(change.id)) }}>Cancelar proposta</button>}
            <button type="button" className="excalidraw-button" onClick={() => onOpenBoard(change.boardId)}>Abrir quadro original</button>
          </div>
        </section>
      )}

      {waiting.length > 0 && (
        <section className="Modal__section">
          <h3>Aguardando sua revisão</h3>
          {waiting.map((item) => (
            <div key={item.id} className="review-row">
              <span><strong>{item.title}</strong> em “{item.boardName}” · {item.author.name ?? item.author.unumber}</span>
              <button type="button" className="excalidraw-button" onClick={() => onOpenBoard(item.boardId)}>Abrir quadro</button>
            </div>
          ))}
        </section>
      )}

      {board.protected && !change && (
        <>
          <section className="Modal__section">
            <h3>Propostas deste quadro</h3>
            {changes.length === 0 && <p className="Modal__hint">Nenhuma proposta ainda.</p>}
            {changes.map((item) => (
              <div key={item.id} className="review-row">
                <span><strong>{item.title}</strong> · {item.author.name ?? item.author.unumber} <StatusChip status={item.status} />{item.outdated && item.status === 'open' ? <em className="review-warning"> desatualizada</em> : null}</span>
                <span className="review-actions">
                  {['open', 'merged', 'rejected'].includes(item.status) && <button type="button" className="excalidraw-button" onClick={() => { void compare(item) }}>Comparar</button>}
                  {item.status !== 'merged' && item.status !== 'cancelled' && item.status !== 'rejected' && <button type="button" className="excalidraw-button" onClick={() => onOpenBoard(item.forkBoardId)}>Abrir cópia</button>}
                </span>
              </div>
            ))}
            {decidable.length > 0 && (
              <div className="review-decision">
                <input type="text" value={comment} maxLength={1000} placeholder="Comentário (obrigatório ao pedir ajustes ou rejeitar)" aria-label="Comentário da decisão" onChange={(event) => setComment(event.target.value)} />
                {decidable.map((item) => (
                  <div key={item.id} className="review-row">
                    <span>{item.title}</span>
                    <span className="review-actions">
                      <button type="button" className="excalidraw-button excalidraw-button--primary" disabled={item.outdated} title={item.outdated ? 'O original mudou: o autor precisa atualizar a cópia' : 'Aprovar e mesclar'} onClick={() => { void decide(item, 'approve') }}>Aprovar</button>
                      <button type="button" className="excalidraw-button" disabled={!comment.trim()} onClick={() => { void decide(item, 'request_changes') }}>Pedir ajustes</button>
                      <button type="button" className="excalidraw-button" disabled={!comment.trim()} onClick={() => { void decide(item, 'reject') }}>Rejeitar</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="Modal__section">
            <h3>Propor uma mudança</h3>
            <p className="Modal__hint">Cria uma cópia do quadro para editar. O original só muda quando o time revisor aprovar.</p>
            <input type="text" value={title} maxLength={200} placeholder="Título da mudança" aria-label="Título da mudança" onChange={(event) => setTitle(event.target.value)} />
            <input type="text" value={description} maxLength={2000} placeholder="Descrição (opcional)" aria-label="Descrição" onChange={(event) => setDescription(event.target.value)} />
            {(isOwner || board.role === 'owner') && <UserPicker placeholder="Abrir para outra pessoa editar (opcional)" onPick={setAssignee} />}
            {assignee && <p className="Modal__hint">A cópia será de {assignee}. <button type="button" className="link-button" onClick={() => setAssignee(null)}>desfazer</button></p>}
            <button type="button" className="excalidraw-button excalidraw-button--primary" disabled={!title.trim()} onClick={() => { void propose() }}>Propor mudança</button>
          </section>
        </>
      )}

      {isOwner && (
        <section className="Modal__section">
          <h3>Proteção do quadro</h3>
          {protectError && <p role="alert" className="review-warning">{protectError}</p>}
          {board.protected ? (
            <>
              <p className="Modal__hint">Protegido: ninguém edita este quadro direto. Mudanças passam pela revisão do time.</p>
              <button type="button" className="excalidraw-button" onClick={() => { void protect(false) }}>Remover proteção</button>
            </>
          ) : (
            <>
              <p className="Modal__hint">Ao proteger, o quadro só muda por proposta aprovada pelo time revisor. Registre uma versão antes.</p>
              <select className="versions-select" value={teamId} aria-label="Time revisor" onChange={(event) => setTeamId(event.target.value)}>
                <option value="">Escolha o time revisor</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
              <button type="button" className="excalidraw-button excalidraw-button--primary" disabled={!teamId} onClick={() => { void protect(true) }}>Proteger quadro</button>
            </>
          )}
        </section>
      )}
    </Modal>
  )
}
