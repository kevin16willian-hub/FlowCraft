import { useCallback, useEffect, useState } from 'react'
import { reviewApi } from '../api/client'
import type { ChangeRequest } from '../types/review'

// Proposta ligada ao quadro aberto (quando ele e uma copia de trabalho) e quantas revisoes aguardam esta pessoa.
export function useReview(boardId: string | null, ready: boolean) {
  const [change, setChange] = useState<ChangeRequest | null>(null)
  const [pending, setPending] = useState(0)

  const refresh = useCallback(async () => {
    const [mine, waiting] = await Promise.all([
      boardId ? reviewApi.ofFork(boardId).catch(() => null) : Promise.resolve(null),
      reviewApi.pending('review').catch(() => []),
    ])
    setChange(mine)
    setPending(waiting.length)
  }, [boardId])

  useEffect(() => {
    if (!ready) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [ready, refresh])

  return { change, pending, refresh }
}
