import { useEffect, useState } from 'react'
import { collabApi } from '../../api/client'
import type { UserHit } from '../../types/board'

type UserPickerProps = { placeholder?: string; onPick: (unumber: string) => void }

// Busca pessoas por nome ou unumber; um unumber completo (U123456) tambem pode ser usado direto, mesmo sem login previo.
export function UserPicker({ placeholder = 'Nome ou unumber (U123456)', onPick }: UserPickerProps) {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<UserHit[]>([])

  useEffect(() => {
    if (term.trim().length < 2) { setHits([]); return undefined }
    let cancelled = false
    const timer = window.setTimeout(() => { void collabApi.searchUsers(term).then((found) => { if (!cancelled) setHits(found) }).catch(() => {}) }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [term])

  const pick = (unumber: string) => { onPick(unumber); setTerm(''); setHits([]) }
  const typed = /^u\d{5,8}$/i.test(term.trim()) ? term.trim().toUpperCase() : null

  return (
    <div className="user-picker">
      <input type="text" value={term} placeholder={placeholder} aria-label="Buscar pessoa" onChange={(event) => setTerm(event.target.value)} />
      {(hits.length > 0 || typed) && (
        <ul className="user-picker__list">
          {hits.map((hit) => (
            <li key={hit.unumber}><button type="button" onClick={() => pick(hit.unumber)}>{hit.name ?? hit.email} <small>{hit.unumber}{hit.pending ? ' · ainda não entrou' : ''}</small></button></li>
          ))}
          {typed && !hits.some((hit) => hit.unumber === typed) && <li><button type="button" onClick={() => pick(typed)}>Convidar {typed} <small>ainda não entrou</small></button></li>}
        </ul>
      )}
    </div>
  )
}
