import { useEffect, useRef, useState } from 'react'
import type { Comments } from '../../hooks/useComments'
import type { Realtime } from '../../hooks/useRealtime'
import type { Severity } from '../../types/realtime'
import type { CurrentUser } from '../../types/board'
import { UserPicker } from '../ui/UserPicker'

type CollabPanelProps = {
  tab: 'chat' | 'comments'
  onTabChange: (tab: 'chat' | 'comments') => void
  realtime: Realtime
  comments: Comments
  user: CurrentUser | null
  focusNodeId: string | null
  nodeTitle: (nodeId: string) => string
  onFocusNode: (nodeId: string) => void
  onClose: () => void
}

const SEVERITY_LABEL = { issue: 'Ajustar', warning: 'Atenção', ok: 'Aprovado' } as const

const time = (value: string) => new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export function CollabPanel({ tab, onTabChange, realtime, comments, user, focusNodeId, nodeTitle, onFocusNode, onClose }: CollabPanelProps) {
  const [text, setText] = useState('')
  const [onlyNode, setOnlyNode] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const [severity, setSeverity] = useState<Severity | ''>('')
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const live = realtime.status === 'live'

  useEffect(() => { if (tab === 'chat') realtime.markChatRead() }, [tab, realtime, realtime.chat.length])
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [realtime.chat.length, comments.items.length, tab])

  const visibleComments = comments.items.filter((item) => (showResolved || !item.resolved) && (!onlyNode || !focusNodeId || item.nodeId === focusNodeId))

  const submit = async () => {
    const value = text.trim()
    if (!value) return
    setError(null)
    try {
      if (tab === 'chat') realtime.sendChat(value)
      else await comments.add(value, onlyNode ? focusNodeId : null, severity || null)
      setText('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'erro inesperado') }
  }

  return (
    <aside className="collab-panel" aria-label="Colaboração">
      <div className="collab-panel__header">
        <div className="Modal__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => onTabChange('chat')}>Chat{realtime.unread > 0 && tab !== 'chat' ? ` (${realtime.unread})` : ''}</button>
          <button type="button" role="tab" aria-selected={tab === 'comments'} onClick={() => onTabChange('comments')}>Comentários</button>
        </div>
        <button type="button" className="ToolIcon" aria-label="Fechar painel" onClick={onClose}>×</button>
      </div>

      {tab === 'comments' && (
        <div className="collab-panel__filters">
          {focusNodeId && <label><input type="checkbox" checked={onlyNode} onChange={(event) => setOnlyNode(event.target.checked)} /> só do elemento selecionado</label>}
          <label><input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} /> resolvidos</label>
        </div>
      )}

      <div className="collab-panel__list" ref={listRef}>
        {tab === 'chat' && realtime.chat.length === 0 && <p className="Modal__hint">Sem mensagens. O chat vale enquanto o quadro tem gente conectada.</p>}
        {tab === 'chat' && realtime.chat.map((message) => (
          <div key={message.id} className={`chat-message ${message.from.unumber === user?.unumber ? 'mine' : ''}`}>
            <strong style={{ color: message.from.color }}>{message.from.name.split(' ')[0]}</strong> <small>{time(message.at)}</small>
            <p>{message.text}</p>
          </div>
        ))}
        {tab === 'comments' && visibleComments.length === 0 && <p className="Modal__hint">Nenhum comentário. Use @U123456 para mencionar alguém.</p>}
        {tab === 'comments' && visibleComments.map((item) => (
          <div key={item.id} className={`chat-message ${item.resolved ? 'resolved' : ''} ${item.severity ? `chat-message--${item.severity}` : ''}`}>
            {item.severity && <span className={`severity-tag severity-tag--${item.severity}`}>{SEVERITY_LABEL[item.severity]}</span>}
            <strong>{item.author.name ?? item.author.unumber}</strong> <small>{new Date(item.createdAt).toLocaleString('pt-BR')}</small>
            {item.nodeId && <button type="button" className="link-button" onClick={() => onFocusNode(item.nodeId as string)}>em “{nodeTitle(item.nodeId) || item.nodeId}”</button>}
            <p>{item.body}</p>
            <div className="chat-message__actions">
              <button type="button" className="link-button" onClick={() => { void comments.resolve(item.id, !item.resolved) }}>{item.resolved ? 'Reabrir' : 'Resolver'}</button>
              {(item.author.unumber === user?.unumber) && <button type="button" className="link-button" onClick={() => { void comments.remove(item.id) }}>Excluir</button>}
            </div>
          </div>
        ))}
      </div>

      {error && <p role="alert" className="Modal__error">{error}</p>}
      {tab === 'chat' && !live && <p className="Modal__hint">Chat indisponível enquanto a conexão ao vivo está {realtime.status === 'paused' ? 'em pausa' : 'fora'}. Mexa no quadro para retomar.</p>}
      <form className="collab-panel__form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <input type="text" value={text} maxLength={tab === 'chat' ? 500 : 2000} placeholder={tab === 'chat' ? 'Mensagem' : onlyNode && focusNodeId ? 'Comentar no elemento' : 'Comentar no quadro'} aria-label="Mensagem" disabled={tab === 'chat' && !live} onChange={(event) => setText(event.target.value)} />
        <button type="submit" className="excalidraw-button excalidraw-button--primary" disabled={!text.trim() || (tab === 'chat' && !live)}>Enviar</button>
      </form>
      {tab === 'comments' && (
        <label className="collab-panel__severity">Tipo
          <select className="versions-select" value={severity} onChange={(event) => setSeverity(event.target.value as Severity | '')}>
            <option value="">Comentário</option>
            <option value="issue">Ajustar (vermelho)</option>
            <option value="warning">Atenção (amarelo)</option>
            <option value="ok">Aprovado (verde)</option>
          </select>
        </label>
      )}
      {tab === 'comments' && <UserPicker placeholder="Mencionar pessoa" onPick={(unumber) => setText((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@${unumber} `)} />}
    </aside>
  )
}
