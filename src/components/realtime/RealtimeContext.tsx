import { createContext, useContext } from 'react'
import type { Peer, Severity } from '../../types/realtime'

export type RealtimeContextValue = {
  // Quem (outra pessoa) esta editando aquele campo do elemento.
  editorOf: (nodeId: string, field: string) => Peer | undefined
  heldBy: (nodeId: string) => Peer | undefined
  commentCount: (nodeId: string) => number
  commentTone: (nodeId: string) => Severity | undefined
  setEditing: (nodeId: string | null, field?: string) => void
  openComments: (nodeId: string) => void
}

const idle: RealtimeContextValue = {
  editorOf: () => undefined,
  heldBy: () => undefined,
  commentCount: () => 0,
  commentTone: () => undefined,
  setEditing: () => {},
  openComments: () => {},
}

export const RealtimeContext = createContext<RealtimeContextValue>(idle)
export const useRealtimeContext = () => useContext(RealtimeContext)
