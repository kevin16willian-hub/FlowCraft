import type { ReactNode } from 'react'

type IconProps = { size?: number }

// Traçado no estilo do Excalidraw (viewBox 24, stroke 1.5).
const Icon = ({ children, size }: IconProps & { children: ReactNode }) => (
  <svg aria-hidden="true" focusable="false" role="img" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    {children}
  </svg>
)

export const MenuIcon = (p: IconProps) => <Icon {...p}><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></Icon>
export const SelectionIcon = (p: IconProps) => <Icon {...p}><path d="M6 6l4.153 11.793a.365.365 0 0 0 .331.207.366.366 0 0 0 .332-.207l2.184-4.793 4.787-1.994a.355.355 0 0 0 .213-.323.355.355 0 0 0-.213-.323L6 6z" /><path d="M13.5 13.5l4.5 4.5" /></Icon>
export const HandIcon = (p: IconProps) => <Icon {...p}><path d="M8 13v-7.5a1.5 1.5 0 0 1 3 0v6.5" /><path d="M11 5.5v-2a1.5 1.5 0 1 1 3 0v8.5" /><path d="M14 5.5a1.5 1.5 0 0 1 3 0v6.5" /><path d="M17 7.5a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1-6 6h-2a6 6 0 0 1-5.012-2.7c-.312-.479-1.407-2.388-3.286-5.728a1.5 1.5 0 0 1 .536-2.022 1.867 1.867 0 0 1 2.28.28l1.47 1.47" /></Icon>
export const RectangleIcon = (p: IconProps) => <Icon {...p}><rect x="4" y="4" width="16" height="16" rx="2" /></Icon>
export const DiamondIcon = (p: IconProps) => <Icon {...p}><path d="M10.5 20.4l-6.9-6.9c-.781-.781-.781-2.219 0-3l6.9-6.9c.781-.781 2.219-.781 3 0l6.9 6.9c.781.781.781 2.219 0 3l-6.9 6.9c-.781.781-2.219.781-3 0z" /></Icon>
export const EllipseIcon = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="9" /></Icon>
export const EndEventIcon = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="9" strokeWidth="3" /></Icon>
export const TextIcon = (p: IconProps) => <Icon {...p}><line x1="4" y1="20" x2="7" y2="20" /><line x1="14" y1="20" x2="21" y2="20" /><line x1="6.9" y1="15" x2="13.8" y2="15" /><line x1="10.2" y1="6.3" x2="16" y2="20" /><polyline points="5 20 11 4 13 4 20 20" /></Icon>
export const NoteIcon = (p: IconProps) => <Icon {...p}><path d="M6 4h12a2 2 0 0 1 2 2v9l-5 5H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><path d="M14 20v-4a2 2 0 0 1 2-2h4" /><path d="M8 9h8" /><path d="M8 13h5" /></Icon>
export const SquareIcon = (p: IconProps) => <Icon {...p}><rect x="5" y="5" width="14" height="14" /></Icon>
export const TriangleIcon = (p: IconProps) => <Icon {...p}><path d="M5 5v14h14z" /></Icon>
export const MoreIcon = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /><circle cx="12" cy="5" r="1" /></Icon>
export const LockIcon = (p: IconProps) => <Icon {...p}><rect x="5" y="11" width="14" height="9" rx="2.5" /><circle cx="12" cy="15.5" r="1" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icon>
export const UnlockIcon = (p: IconProps) => <Icon {...p}><rect x="5" y="11" width="14" height="9" rx="2.5" /><circle cx="12" cy="15.5" r="1" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></Icon>
export const FolderIcon = (p: IconProps) => <Icon {...p}><path d="M5 19h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6.5L10 4.5H5A2 2 0 0 0 3 6.5V17a2 2 0 0 0 2 2z" /></Icon>
export const DownloadIcon = (p: IconProps) => <Icon {...p}><path d="M4 17v1.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V17" /><path d="M7 11l5 5 5-5" /><path d="M12 4v12" /></Icon>
export const BoardsIcon = (p: IconProps) => <Icon {...p}><rect x="3.5" y="4" width="7" height="7" rx="1.5" /><rect x="13.5" y="4" width="7" height="7" rx="1.5" /><rect x="3.5" y="14" width="7" height="6" rx="1.5" /><rect x="13.5" y="14" width="7" height="6" rx="1.5" /></Icon>
export const PlusIcon = (p: IconProps) => <Icon {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>
export const MinusIcon = (p: IconProps) => <Icon {...p}><line x1="5" y1="12" x2="19" y2="12" /></Icon>
export const TrashIcon = (p: IconProps) => <Icon {...p}><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" /><path d="M9 7V4h6v3" /></Icon>
export const HelpIcon = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="9" /><line x1="12" y1="17" x2="12" y2="17.01" /><path d="M12 13.5a1.5 1.5 0 0 1 1-1.5 2.6 2.6 0 1 0-3-4" /></Icon>
export const LogoutIcon = (p: IconProps) => <Icon {...p}><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2" /><path d="M21 12H8l3-3" /><path d="M11 15l-3-3" /></Icon>
export const SunIcon = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="3.5" /><path d="M12 3.5V2M12 22v-1.5M20.5 12H22M2 12h1.5M18 6l1-1M5 19l1-1M18 18l1 1M5 5l1 1" /></Icon>
export const MoonIcon = (p: IconProps) => <Icon {...p}><path d="M12 3a7.5 7.5 0 1 0 9 9 6.25 6.25 0 0 1-9-9z" /></Icon>
export const MonitorIcon = (p: IconProps) => <Icon {...p}><path d="M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5zM7 20h10M9 16v4M15 16v4" /></Icon>
export const PencilIcon = (p: IconProps) => <Icon {...p}><path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></Icon>
export const ArchiveIcon = (p: IconProps) => <Icon {...p}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></Icon>
export const CloseIcon = (p: IconProps) => <Icon {...p}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></Icon>
export const UndoIcon = (p: IconProps) => <Icon {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Icon>
export const RedoIcon = (p: IconProps) => <Icon {...p}><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></Icon>
export const CopyIcon = (p: IconProps) => <Icon {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Icon>
export const ImageIcon = (p: IconProps) => <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" /></Icon>
export const RestoreIcon = (p: IconProps) => <Icon {...p}><path d="M4 12a8 8 0 1 0 2.5-5.8" /><path d="M4 4v4h4" /></Icon>
export const HistoryIcon = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></Icon>
export const PoolIcon = (p: IconProps) => <Icon {...p}><rect x="3.5" y="4" width="17" height="16" rx="1" /><path d="M3.5 9h17" /><rect x="3.5" y="4" width="17" height="5" fill="currentColor" fillOpacity="0.25" stroke="none" /></Icon>
export const LaneIcon = (p: IconProps) => <Icon {...p}><rect x="3.5" y="5" width="17" height="14" rx="1" /><path d="M8 5v14" /><rect x="3.5" y="5" width="4.5" height="14" fill="currentColor" fillOpacity="0.25" stroke="none" /></Icon>
export const PhaseIcon = (p: IconProps) => <Icon {...p}><rect x="5" y="3.5" width="14" height="17" rx="1" /><path d="M5 8h14" /></Icon>
export const AlignLeftIcon = (p: IconProps) => <Icon {...p}><path d="M4 4v16" /><rect x="7" y="6" width="12" height="4" /><rect x="7" y="14" width="7" height="4" /></Icon>
export const AlignCenterIcon = (p: IconProps) => <Icon {...p}><path d="M12 4v16" /><rect x="5" y="6" width="14" height="4" /><rect x="8" y="14" width="8" height="4" /></Icon>
export const AlignRightIcon = (p: IconProps) => <Icon {...p}><path d="M20 4v16" /><rect x="5" y="6" width="12" height="4" /><rect x="10" y="14" width="7" height="4" /></Icon>
export const AlignTopIcon = (p: IconProps) => <Icon {...p}><path d="M4 4h16" /><rect x="6" y="7" width="4" height="12" /><rect x="14" y="7" width="4" height="7" /></Icon>
export const DistributeHIcon = (p: IconProps) => <Icon {...p}><path d="M4 4v16M20 4v16" /><rect x="10" y="7" width="4" height="10" /></Icon>
export const DistributeVIcon = (p: IconProps) => <Icon {...p}><path d="M4 4h16M4 20h16" /><rect x="7" y="10" width="10" height="4" /></Icon>
export const AlignMiddleIcon = (p: IconProps) => <Icon {...p}><path d="M4 12h16" /><rect x="6" y="5" width="4" height="14" /><rect x="14" y="8" width="4" height="8" /></Icon>
export const AlignBottomIcon = (p: IconProps) => <Icon {...p}><path d="M4 20h16" /><rect x="6" y="5" width="4" height="12" /><rect x="14" y="10" width="4" height="7" /></Icon>
export const BringFrontIcon = (p: IconProps) => <Icon {...p}><rect x="4" y="4" width="10" height="10" rx="1" /><rect x="10" y="10" width="10" height="10" rx="1" fill="currentColor" fillOpacity="0.25" /></Icon>
export const SendBackIcon = (p: IconProps) => <Icon {...p}><rect x="10" y="10" width="10" height="10" rx="1" /><rect x="4" y="4" width="10" height="10" rx="1" fill="currentColor" fillOpacity="0.25" /></Icon>
export const SearchIcon = (p: IconProps) => <Icon {...p}><circle cx="10" cy="10" r="6.5" /><path d="M21 21l-6-6" /></Icon>
export const ImageExportIcon = (p: IconProps) => <Icon {...p}><path d="M12 20H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v5" /><path d="M4 15l4-4c.9-.9 2.1-.9 3 0l4 4" /><circle cx="15" cy="8" r="0.8" /><path d="M19 16v6M22 19l-3 3-3-3" /></Icon>
export const CompareIcon = (p: IconProps) => <Icon {...p}><rect x="3" y="5" width="8" height="14" rx="1" /><rect x="13" y="5" width="8" height="14" rx="1" /></Icon>
export const ShareIcon = (p: IconProps) => <Icon {...p}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" /></Icon>
export const UsersIcon = (p: IconProps) => <Icon {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4c2 .7 3.5 2.6 3.5 5.6" /></Icon>
export const ShieldIcon = (p: IconProps) => <Icon {...p}><path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></Icon>
