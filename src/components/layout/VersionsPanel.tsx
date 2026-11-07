import { useState } from 'react'
import type { useVersioning } from '../../hooks/useVersioning'
import { Modal } from '../ui/Modal'

type VersionsPanelProps = {
  versioning: ReturnType<typeof useVersioning>
  dirty: boolean
  readOnly: boolean
  onCompare: () => void
  onClose: () => void
}

export function VersionsPanel({ versioning, dirty, readOnly, onCompare, onClose }: VersionsPanelProps) {
  const { commits, branches, tags, baseCommitId, headBranchId } = versioning
  const [message, setMessage] = useState('')
  const [branchName, setBranchName] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (task: () => Promise<void>) => {
    setFeedback(null)
    setBusy(true)
    try { await task() } catch (cause) { setFeedback(cause instanceof Error ? cause.message : 'erro inesperado') } finally { setBusy(false) }
  }

  const headsByCommit = new Map<string, string[]>()
  branches.forEach((branch) => { if (branch.headCommitId) headsByCommit.set(branch.headCommitId, [...(headsByCommit.get(branch.headCommitId) ?? []), branch.name]) })
  const tagsByCommit = new Map<string, string[]>()
  tags.forEach((tag) => tagsByCommit.set(tag.commitId, [...(tagsByCommit.get(tag.commitId) ?? []), tag.name]))

  return (
    <Modal title="Histórico de versões" onClose={onClose}>
      {readOnly && <p className="Modal__hint">Você tem acesso somente leitura: pode consultar e comparar versões.</p>}
      {!readOnly && <form className="Modal__form" onSubmit={(event) => {
        event.preventDefault()
        const value = message.trim()
        if (value) void run(async () => { await versioning.commit(value); setMessage('') })
      }}>
        <input type="text" value={message} maxLength={500} placeholder={dirty ? 'Descreva o que mudou' : 'Sem alterações desde a última versão'} aria-label="Mensagem da versão" disabled={!dirty || busy} onChange={(event) => setMessage(event.target.value)} />
        <button type="submit" className="excalidraw-button excalidraw-button--primary" disabled={!dirty || busy || !message.trim()}>Registrar versão</button>
      </form>}

      <div className="Modal__form">
        <select aria-label="Branch atual" className="versions-select" value={headBranchId ?? ''} disabled={busy || readOnly} onChange={(event) => {
          if (dirty && !window.confirm('Há alterações não registradas. Trocar de branch descarta essas alterações. Continuar?')) return
          void run(() => versioning.switchBranch(event.target.value))
        }}>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
        {!readOnly && <input type="text" value={branchName} maxLength={100} placeholder="Novo branch" aria-label="Nome do novo branch" onChange={(event) => setBranchName(event.target.value)} />}
        {!readOnly && <button type="button" className="excalidraw-button" disabled={busy || !branchName.trim()} onClick={() => { void run(async () => { await versioning.createBranch(branchName.trim()); setBranchName('') }) }}>Criar</button>}
        <button type="button" className="excalidraw-button" onClick={onCompare}>Comparar...</button>
      </div>

      {feedback && <p role="alert" style={{ color: 'var(--color-danger)', fontSize: '0.875rem' }}>{feedback}</p>}

      {commits.map((commit) => (
        <div key={commit.id} className={`Modal__row ${commit.id === baseCommitId ? 'current' : ''}`}>
          <div className="Modal__row-main">
            <strong>{commit.message}</strong>
            <small>
              #{commit.seq} · {commit.author} · {new Date(commit.createdAt).toLocaleString('pt-BR')} · {commit.nodeCount} elementos
              {commit.id === baseCommitId && ' · versão atual'}
              {(headsByCommit.get(commit.id) ?? []).map((name) => ` · branch ${name}`)}
              {(tagsByCommit.get(commit.id) ?? []).map((name) => ` · tag ${name}`)}
            </small>
          </div>
          {!readOnly && <button type="button" className="excalidraw-button" disabled={busy} onClick={() => {
            const name = window.prompt('Nome da tag (ex.: v1.0)')?.trim()
            if (name) void run(() => versioning.createTag(name, commit.id))
          }}>Tag</button>}
          {!readOnly && <button type="button" className="excalidraw-button" disabled={busy || (commit.id === baseCommitId && !dirty)} onClick={() => {
            if (dirty && !window.confirm('As alterações não registradas serão descartadas. Restaurar esta versão?')) return
            void run(async () => { await versioning.restoreCommit(commit.id); onClose() })
          }}>Restaurar</button>}
        </div>
      ))}
    </Modal>
  )
}
