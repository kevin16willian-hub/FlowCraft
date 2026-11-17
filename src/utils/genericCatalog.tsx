import type { LucideIcon } from 'lucide-react'
import {
  AppWindow, Boxes, Cable, Database, FileSpreadsheet, FileText, Folder, Globe, Laptop, Mail, Monitor,
  Server, Smartphone, Table, Tablet, UserRound, UsersRound, Webhook, Workflow,
} from 'lucide-react'
import type { Shape } from '../types/board'
import { buildNode, type FlowNode } from './graphMapping'

export type GenericItem = { key: string; label: string; category: string; icon: LucideIcon }

export const GENERIC_ITEMS: GenericItem[] = [
  { key: 'generic:user', label: 'Usuário', category: 'Pessoas', icon: UserRound },
  { key: 'generic:team', label: 'Equipe ou grupo', category: 'Pessoas', icon: UsersRound },
  { key: 'generic:cellphone', label: 'Celular', category: 'Dispositivos', icon: Smartphone },
  { key: 'generic:tablet', label: 'Tablet', category: 'Dispositivos', icon: Tablet },
  { key: 'generic:laptop', label: 'Notebook', category: 'Dispositivos', icon: Laptop },
  { key: 'generic:desktop', label: 'Computador desktop', category: 'Dispositivos', icon: Monitor },
  { key: 'generic:browser', label: 'Navegador web', category: 'Aplicações', icon: Globe },
  { key: 'generic:web-app', label: 'Aplicação web', category: 'Aplicações', icon: AppWindow },
  { key: 'generic:mobile-app', label: 'Aplicativo mobile', category: 'Aplicações', icon: Smartphone },
  { key: 'generic:external-system', label: 'Sistema externo', category: 'Aplicações', icon: Cable },
  { key: 'generic:spreadsheet', label: 'Planilha Excel', category: 'Arquivos e dados', icon: FileSpreadsheet },
  { key: 'generic:pdf', label: 'Documento PDF', category: 'Arquivos e dados', icon: FileText },
  { key: 'generic:csv', label: 'Arquivo CSV', category: 'Arquivos e dados', icon: Table },
  { key: 'generic:folder', label: 'Pasta de arquivos', category: 'Arquivos e dados', icon: Folder },
  { key: 'generic:relational-db', label: 'Banco relacional', category: 'Arquivos e dados', icon: Database },
  { key: 'generic:nosql-db', label: 'Banco NoSQL', category: 'Arquivos e dados', icon: Boxes },
  { key: 'generic:on-prem-server', label: 'Servidor local', category: 'Infraestrutura e integração', icon: Server },
  { key: 'generic:api', label: 'API ou serviço web', category: 'Infraestrutura e integração', icon: Webhook },
  { key: 'generic:email', label: 'E-mail', category: 'Infraestrutura e integração', icon: Mail },
  { key: 'generic:queue', label: 'Fila de mensagens', category: 'Infraestrutura e integração', icon: Workflow },
]

export const genericItemOf = (key: string) => GENERIC_ITEMS.find((item) => item.key === key)

export const buildGenericNode = (item: GenericItem, frame: { x: number; y: number; width: number; height: number }, parentId?: string): FlowNode => {
  const shape: Shape = { key: 'rectangle', label: item.label, type: 'shape', width: frame.width, height: frame.height, style: null }
  const node = buildNode(shape, frame, parentId)
  return { ...node, data: { ...node.data, title: item.label, extra: { generic: item.key } } }
}
