import { useCallback, useEffect, useMemo, useState } from 'react'
import { collabApi } from '../api/client'
import type { CommentItem, Severity } from '../types/realtime'

// Comentarios do quadro: carga inicial por REST e atualizacoes ao vivo via eventos do canal.
export function useComments(boardId: string | null, enabled: boolean) {
  const [items, setItems] = useState<CommentItem[]>([])

  useEffect(() => {
    if (!boardId || !enabled) return undefined
    let cancelled = false
    void collabApi.comments(boardId).then((list) => { if (!cancelled) setItems(list) }).catch(() => {})
    return () => { cancelled = true; setItems([]) }
  }, [boardId, enabled])

  const apply = useCallback((action: 'add' | 'update' | 'delete', comment: CommentItem) => {
    setItems((current) => {
      if (action === 'delete') return current.filter((item) => item.id !== comment.id && item.parentId !== comment.id)
      return current.some((item) => item.id === comment.id) ? current.map((item) => (item.id === comment.id ? comment : item)) : [...current, comment]
    })
  }, [])

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    items.forEach((item) => { if (item.nodeId && !item.resolved && !item.parentId) map.set(item.nodeId, (map.get(item.nodeId) ?? 0) + 1) })
    return map
  }, [items])

  // Pior pendencia aberta por elemento: define a cor do selo no cartao.
  const tones = useMemo(() => {
    const rank = { issue: 3, warning: 2, ok: 1 } as const
    const map = new Map<string, Severity>()
    items.forEach((item) => {
      if (!item.nodeId || item.resolved || item.parentId || !item.severity) return
      const current = map.get(item.nodeId)
      if (!current || rank[item.severity] > rank[current]) map.set(item.nodeId, item.severity)
    })
    return map
  }, [items])

  const add = async (body: string, nodeId?: string | null, severity?: Severity | null) => { if (boardId) apply('add', await collabApi.addComment(boardId, body, nodeId, severity)) }
  const resolve = async (id: string, resolved: boolean) => { if (boardId) apply('update', await collabApi.resolveComment(boardId, id, resolved)) }
  const remove = async (id: string) => { if (boardId) { await collabApi.deleteComment(boardId, id); apply('delete', { id } as CommentItem) } }

  return { items, counts, tones, apply, add, resolve, remove }
}

export type Comments = ReturnType<typeof useComments>
