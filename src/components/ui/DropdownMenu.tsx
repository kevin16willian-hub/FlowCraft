import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Island } from './Island'

const CloseContext = createContext<() => void>(() => {})
export const useCloseMenu = () => useContext(CloseContext)

type DropdownMenuProps = {
  triggerIcon: ReactNode
  triggerTitle: string
  triggerClassName?: string
  align?: 'start' | 'end'
  children: ReactNode
}

export function DropdownMenu({ triggerIcon, triggerTitle, triggerClassName = '', align = 'start', children }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); return }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
      if (!items.length) return
      event.preventDefault()
      const index = items.indexOf(document.activeElement as HTMLElement)
      const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length
      items[next].focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown) }
  }, [open])

  return (
    <div className="dropdown-menu-wrapper" ref={rootRef}>
      <button type="button" className={`dropdown-menu-button ${triggerClassName}`.trim()} title={triggerTitle} aria-label={triggerTitle} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {triggerIcon}
      </button>
      {open && (
        <div className={`dropdown-menu ${align === 'end' ? 'dropdown-menu--end' : ''}`.trim()} role="menu">
          <CloseContext.Provider value={() => setOpen(false)}>
            <Island className="dropdown-menu-container" padding={2}>{children}</Island>
          </CloseContext.Provider>
        </div>
      )}
    </div>
  )
}

type ItemProps = { icon?: ReactNode; shortcut?: string; selected?: boolean; keepOpen?: boolean; onSelect: () => void; children: ReactNode }

export function DropdownMenuItem({ icon, shortcut, selected = false, keepOpen = false, onSelect, children }: ItemProps) {
  const close = useContext(CloseContext)
  return (
    <button type="button" role="menuitem" tabIndex={-1} className={`dropdown-menu-item ${selected ? 'selected' : ''}`.trim()} onClick={() => { onSelect(); if (!keepOpen) close() }}>
      <div className="dropdown-menu-item__icon">{icon}</div>
      <div className="dropdown-menu-item__text">{children}</div>
      {shortcut && <div className="dropdown-menu-item__shortcut">{shortcut}</div>}
    </button>
  )
}

export const DropdownMenuSeparator = () => <div className="dropdown-menu-separator" role="separator" />

export const DropdownMenuLabel = ({ children }: { children: ReactNode }) => <div className="dropdown-menu-label">{children}</div>
