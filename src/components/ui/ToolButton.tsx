import type { ReactNode } from 'react'

type ToolButtonProps = {
  icon: ReactNode
  title: string
  checked?: boolean
  keybinding?: string
  disabled?: boolean
  className?: string
  onClick: () => void
}

export function ToolButton({ icon, title, checked = false, keybinding, disabled, className = '', onClick }: ToolButtonProps) {
  const label = title.replace(/\s+—.*$/, '')
  return (
    <button
      type="button"
      className={`ToolIcon ToolIcon_type_toggle ToolIcon_size_medium ${checked ? 'ToolIcon--checked' : ''} ${className}`.trim()}
      title={keybinding ? `${title} — ${keybinding.toUpperCase()}` : title}
      aria-label={label}
      aria-pressed={checked}
      disabled={disabled}
      onClick={onClick}
    >
      <div className="ToolIcon__icon">
        {icon}
        {keybinding && <span className="ToolIcon__keybinding">{keybinding.toUpperCase()}</span>}
      </div>
    </button>
  )
}
