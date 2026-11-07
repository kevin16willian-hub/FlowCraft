import { ViewportPortal, useStore } from '@xyflow/react'
import type { Peer, Reaction } from '../../types/realtime'

type RemoteLayerProps = { peers: Peer[]; reactions: Reaction[] }

type Box = { x: number; y: number; width: number; height: number }

// Cursores, selecao, edicao e reacoes dos colegas, desenhados em coordenadas do canvas.
export function RemoteLayer({ peers, reactions }: RemoteLayerProps) {
  const zoom = useStore((state) => state.transform[2])
  const boxes = useStore((state) => state.nodeLookup)
  const scale = 1 / zoom

  const boxOf = (id: string): Box | null => {
    const node = boxes.get(id)
    if (!node?.measured.width || !node.measured.height) return null
    return { x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y, width: node.measured.width, height: node.measured.height }
  }

  return (
    <ViewportPortal>
      {peers.map((peer) => (
        <div key={peer.id}>
          {peer.selection.map((id) => {
            const box = boxOf(id)
            if (!box) return null
            const editing = peer.editing?.nodeId === id
            const holding = peer.holding.includes(id)
            return (
              <div key={id} className="remote-selection" style={{ left: box.x, top: box.y, width: box.width, height: box.height, borderColor: peer.color, borderStyle: holding ? 'dashed' : 'solid' }}>
                <span className="remote-tag" style={{ background: peer.color, transform: `scale(${scale})` }}>{peer.name.split(' ')[0]}{editing ? ' · editando' : holding ? ' · movendo' : ''}</span>
              </div>
            )
          })}
          {peer.cursor && (
            peer.cursor.laser
              ? <div className="remote-laser" style={{ left: peer.cursor.x, top: peer.cursor.y, background: peer.color, boxShadow: `0 0 ${12 * scale}px ${6 * scale}px ${peer.color}`, width: 10 * scale, height: 10 * scale }} />
              : (
                <div className="remote-cursor" style={{ left: peer.cursor.x, top: peer.cursor.y, transform: `scale(${scale})` }}>
                  <svg width="18" height="18" viewBox="0 0 18 18"><path d="M1 1l6.5 15 2-6 6-2z" fill={peer.color} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                  <span style={{ background: peer.color }}>{peer.name.split(' ')[0]}</span>
                </div>
              )
          )}
        </div>
      ))}
      {reactions.map((reaction) => (
        <div key={reaction.key} className="remote-reaction" style={{ left: reaction.x, top: reaction.y, fontSize: 28 * scale }}>{reaction.emoji}</div>
      ))}
    </ViewportPortal>
  )
}
