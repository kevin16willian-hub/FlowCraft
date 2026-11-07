import { useRef, type CSSProperties, type ReactNode } from 'react'
import type { ThemeChoice } from '../../hooks/useTheme'
import type { CurrentUser } from '../../types/board'
import { DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '../ui/DropdownMenu'
import { BoardsIcon, DownloadIcon, FolderIcon, HelpIcon, HistoryIcon, ImageExportIcon, LogoutIcon, MenuIcon, MonitorIcon, MoonIcon, PlusIcon, SearchIcon, ShareIcon, ShieldIcon, SunIcon, TrashIcon, UsersIcon } from '../ui/icons'

export const BACKGROUNDS = ['#ffffff', '#f8f9fa', '#f5faff', '#fffce8', '#fdf8f6']

const THEMES: { id: ThemeChoice; title: string; icon: ReactNode }[] = [
  { id: 'light', title: 'Modo claro', icon: <SunIcon /> },
  { id: 'dark', title: 'Modo escuro', icon: <MoonIcon /> },
  { id: 'system', title: 'Modo do sistema', icon: <MonitorIcon /> },
]

type MainMenuProps = {
  user: CurrentUser | null
  theme: ThemeChoice
  background: string
  readOnly: boolean
  onShare: () => void
  onTeams: () => void
  onAdmin: () => void
  onOpenBoards: () => void
  onNewBoard: () => void
  onImport: (file: File) => void
  onImportMermaid: () => void
  onExport: () => void
  onExportImage: () => void
  onSearch: () => void
  onHelp: () => void
  onVersions: () => void
  onClear: () => void
  onThemeChange: (theme: ThemeChoice) => void
  onBackgroundChange: (color: string) => void
}

export function MainMenu({ user, theme, background, readOnly, onShare, onTeams, onAdmin, onOpenBoards, onNewBoard, onImport, onImportMermaid, onExport, onExportImage, onSearch, onHelp, onVersions, onClear, onThemeChange, onBackgroundChange }: MainMenuProps) {
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <>
      <DropdownMenu triggerIcon={<MenuIcon />} triggerTitle="Menu principal" triggerClassName="main-menu-trigger">
        <DropdownMenuItem icon={<BoardsIcon />} onSelect={onOpenBoards}>Quadros...</DropdownMenuItem>
        <DropdownMenuItem icon={<PlusIcon />} onSelect={onNewBoard}>Novo quadro...</DropdownMenuItem>
        <DropdownMenuItem icon={<ShareIcon />} onSelect={onShare}>Compartilhar...</DropdownMenuItem>
        <DropdownMenuItem icon={<UsersIcon />} onSelect={onTeams}>Times...</DropdownMenuItem>
        {user?.isAdmin && <DropdownMenuItem icon={<ShieldIcon />} onSelect={onAdmin}>Administração...</DropdownMenuItem>}
        {!readOnly && <DropdownMenuItem icon={<FolderIcon />} shortcut="Ctrl+O" onSelect={() => fileInput.current?.click()}>Abrir...</DropdownMenuItem>}
        {!readOnly && <DropdownMenuItem icon={<FolderIcon />} onSelect={onImportMermaid}>Importar Mermaid...</DropdownMenuItem>}
        <DropdownMenuItem icon={<DownloadIcon />} onSelect={onExport}>Salvar como...</DropdownMenuItem>
        <DropdownMenuItem icon={<ImageExportIcon />} onSelect={onExportImage}>Exportar imagem...</DropdownMenuItem>
        <DropdownMenuItem icon={<SearchIcon />} shortcut="Ctrl+F" onSelect={onSearch}>Procurar na tela</DropdownMenuItem>
        <DropdownMenuItem icon={<HistoryIcon />} onSelect={onVersions}>Histórico de versões...</DropdownMenuItem>
        <DropdownMenuItem icon={<HelpIcon />} shortcut="?" onSelect={onHelp}>Ajuda</DropdownMenuItem>
        {!readOnly && <DropdownMenuItem icon={<TrashIcon />} onSelect={onClear}>Limpar a tela</DropdownMenuItem>}
        <DropdownMenuSeparator />
        {user && <DropdownMenuLabel>{user.name ?? user.email} · {user.unumber}</DropdownMenuLabel>}
        <DropdownMenuItem icon={<LogoutIcon />} onSelect={() => window.location.assign('/api/auth/logout')}>Sair</DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="dropdown-menu-item-bare">
          <label>Tema</label>
          <div className="RadioGroup">
            {THEMES.map((item) => (
              <div key={item.id} className={`RadioGroup__choice ${theme === item.id ? 'active' : ''}`} title={item.title}>
                <input type="radio" name="theme" aria-label={item.title} checked={theme === item.id} onChange={() => onThemeChange(item.id)} />
                {item.icon}
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <DropdownMenuLabel>Fundo da tela</DropdownMenuLabel>
          <div className="color-picker__top-picks">
            {BACKGROUNDS.map((color) => (
              <button key={color} type="button" className={`color-picker__button ${background === color ? 'active' : ''}`} title={color} style={{ '--swatch-color': color } as CSSProperties} onClick={() => onBackgroundChange(color)} />
            ))}
          </div>
        </div>
      </DropdownMenu>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onImport(file)
          event.target.value = ''
        }}
      />
    </>
  )
}
