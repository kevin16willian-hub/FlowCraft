import type { CSSProperties } from 'react'
import type { Realtime } from '../../hooks/useRealtime'
import type { LiveStatus, Notice } from '../../types/realtime'

const STATUS_TEXT: Record<LiveStatus, string> = {
  off: '', connecting: 'Conectando...', live: 'Ao vivo', paused: 'Pausado — mexa para retomar', offline: 'Sem conexão ao vivo',
}

const initials = (name: string) => name.split(' ').filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()

type RosterProps = { realtime: Realtime; canPresent: boolean; onToggleChat: () => void; chatOpen: boolean }

// Status da conexao, quem esta no quadro (clique para seguir) e apresentacao.
export function Roster({ realtime, canPresent, onToggleChat, chatOpen }: RosterProps) {
  const { peers, status, followId, presenting } = realtime
  return (
    <>
      {status !== 'off' && (
        <span className={`live-chip live-chip--${status}`} role="status" title="O canal ao vivo abre quando você mexe no quadro e dorme após alguns minutos parado"><span className="live-chip__dot" />{STATUS_TEXT[status]}</span>
      )}
      {peers.map((peer) => (
        <button key={peer.id} type="button" className={`presence-chip__avatar ${followId === peer.id ? 'following' : ''}`} style={{ background: peer.color } as CSSProperties}
          title={`${peer.name} (${peer.role === 'viewer' ? 'leitura' : 'edição'})${peer.presenting ? ' — apresentando' : ''}. Clique para ${followId === peer.id ? 'parar de seguir' : 'seguir'}`}
          onClick={() => realtime.setFollowId(followId === peer.id ? null : peer.id)}>{initials(peer.name)}{peer.presenting ? ' ▶' : ''}</button>
      ))}
      {canPresent && status === 'live' && (
        <button type="button" className={`excalidraw-button ${presenting ? 'excalidraw-button--primary' : ''}`} title="Os outros podem seguir sua tela" onClick={() => realtime.setPresenting(!presenting)}>{presenting ? 'Parar apresentação' : 'Apresentar'}</button>
      )}
      <button type="button" className="excalidraw-button" aria-pressed={chatOpen} title="Chat e comentários" onClick={onToggleChat}>Chat{realtime.unread > 0 ? ` (${realtime.unread})` : ''}</button>
    </>
  )
}

const EMOJIS = ['👍', '❤️', '🎉', '👀', '😂', '🤔']

type ReactionBarProps = { realtime: Realtime; laser: boolean; onLaser: (value: boolean) => void; onReact: (emoji: string) => void }

export function ReactionBar({ realtime, laser, onLaser, onReact }: ReactionBarProps) {
  if (realtime.status !== 'live') return null
  return (
    <div className="reaction-bar" role="toolbar" aria-label="Reações">
      {EMOJIS.map((emoji) => <button key={emoji} type="button" title="Reagir" onClick={() => onReact(emoji)}>{emoji}</button>)}
      <button type="button" className={laser ? 'active' : ''} aria-pressed={laser} title="Ponteiro laser" onClick={() => onLaser(!laser)}>🔴</button>
    </div>
  )
}

export function Toasts({ notices, onDismiss }: { notices: (Notice & { action?: () => void; actionLabel?: string })[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status">
      {notices.map((notice) => (
        <div key={notice.id} className={`toast toast--${notice.tone ?? 'info'}`}>
          <span>{notice.text}</span>
          {notice.action && <button type="button" className="link-button" onClick={() => { notice.action?.(); onDismiss(notice.id) }}>{notice.actionLabel ?? 'Abrir'}</button>}
          <button type="button" className="link-button" aria-label="Dispensar" onClick={() => onDismiss(notice.id)}>×</button>
        </div>
      ))}
    </div>
  )
}

export function FollowBanner({ realtime }: { realtime: Realtime }) {
  const presenter = realtime.peers.find((peer) => peer.presenting)
  if (!presenter || realtime.followId === presenter.id) return null
  return (
    <div className="remote-banner" role="status">
      {presenter.name} está apresentando.
      <button type="button" className="excalidraw-button excalidraw-button--primary" onClick={() => realtime.setFollowId(presenter.id)}>Seguir</button>
    </div>
  )
}
