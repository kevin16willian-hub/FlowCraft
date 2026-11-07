import { useEffect, type ReactNode } from 'react'
import { Island } from './Island'
import { CloseIcon } from './icons'

type ModalProps = { title: string; onClose: () => void; wide?: boolean; children: ReactNode }

export function Modal({ title, onClose, wide = false, children }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="Modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <Island className={`Modal__content ${wide ? 'Modal__content--wide' : ''}`.trim()} padding={0} role="dialog" aria-modal="true" aria-label={title}>
        <div className="Modal__header">
          <h2>{title}</h2>
          <button type="button" className="ToolIcon" aria-label="Fechar" onClick={onClose}><div className="ToolIcon__icon"><CloseIcon /></div></button>
        </div>
        {children}
      </Island>
    </div>
  )
}
