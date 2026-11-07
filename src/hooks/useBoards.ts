import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, boardsApi } from '../api/client'
import type { BoardKind, BoardSummary } from '../types/board'
import { hasLegacyProcess, legacyToGraph, markLegacyMigrated } from '../utils/legacyMigration'

const CURRENT_KEY = 'fc-current-board'

// Lista de quadros do usuario e quadro atual. Na primeira abertura cria um quadro (migrando o processo salvo no navegador, se houver).
export function useBoards() {
  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)
  const refresh = useCallback(async () => {
    const list = await boardsApi.list()
    setBoards(list)
    return list
  }, [])

  const open = useCallback((id: string) => { localStorage.setItem(CURRENT_KEY, id); setCurrentId(id) }, [])

  const create = useCallback(async (name: string, graph?: Parameters<typeof boardsApi.saveGraph>[1], kind: BoardKind = 'flowchart') => {
    const board = await boardsApi.create(name, kind)
    if (graph) await boardsApi.saveGraph(board.id, graph)
    await refresh()
    open(board.id)
    return board
  }, [open, refresh])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const list = await refresh()
        if (list.length === 0) {
          if (hasLegacyProcess()) {
            await create('Processo importado', legacyToGraph())
            markLegacyMigrated()
          } else {
            await create('Meu primeiro quadro')
          }
          return
        }
        const stored = localStorage.getItem(CURRENT_KEY)
        open(list.find((board) => board.id === stored)?.id ?? list[0].id)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'falha ao carregar quadros')
      }
    })()
  }, [create, open, refresh])

  const archive = useCallback(async (id: string) => {
    await boardsApi.archive(id)
    const list = await refresh()
    if (id === currentId) {
      if (list.length) open(list[0].id)
      else await create('Meu primeiro quadro')
    }
  }, [create, currentId, open, refresh])

  const remove = useCallback(async (id: string) => {
    await boardsApi.remove(id)
    const list = await refresh()
    if (id === currentId) {
      if (list.length) open(list[0].id)
      else await create('Meu primeiro quadro')
    }
  }, [create, currentId, open, refresh])

  const duplicate = useCallback(async (id: string) => {
    const source = await boardsApi.get(id)
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const name = attempt === 1 ? `${source.name} (cópia)` : `${source.name} (cópia ${attempt})`
      try {
        await create(name, { nodes: source.nodes, edges: source.edges }, source.settings?.kind ?? 'flowchart')
        return
      } catch (cause) {
        if (!(cause instanceof ApiError && cause.status === 409)) throw cause
      }
    }
    throw new Error('não foi possível gerar um nome para a cópia')
  }, [create])

  const restore = useCallback(async (id: string) => {
    await boardsApi.update(id, { archived: false })
    await refresh()
  }, [refresh])

  return { boards, currentId, error, open, create, archive, remove, duplicate, restore, refresh }
}
