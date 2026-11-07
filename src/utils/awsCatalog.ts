import type { Shape } from '../types/board'
import { buildNode, type FlowNode } from './graphMapping'

export type AwsKind = 'service' | 'resource' | 'group' | 'category'
export type AwsItem = { key: string; label: string; category: string; kind: AwsKind; file: string; common: boolean; rank: number | null }

const BASE = '/aws-icons/'
const GROUP_Z = -10

export const awsIconUrl = (file: string) => `${BASE}${file}`
export const isAwsGroupFile = (file: string | undefined) => !!file && file.startsWith('group/')

// Arquivo do icone guardado em data.extra.aws (o catalogo de formas do servidor nao conhece os icones AWS).
export const awsFileOf = (extra: Record<string, unknown> | null | undefined): string | undefined => (typeof extra?.aws === 'string' ? extra.aws : undefined)

let catalog: Promise<AwsItem[]> | null = null
export const loadAwsCatalog = (): Promise<AwsItem[]> => {
  catalog ??= fetch(`${BASE}manifest.json`)
    .then((response) => { if (!response.ok) throw new Error('catálogo AWS indisponível'); return response.json() as Promise<{ items: AwsItem[] }> })
    .then((data) => data.items.filter((item) => item.kind !== 'category'))
    .catch((cause) => { catalog = null; throw cause })
  return catalog
}

// Cores oficiais dos grupos de arquitetura AWS.
const GROUP_STYLE: Record<string, { color: string; dashed?: boolean; noIcon?: boolean; title: string; width: number; height: number }> = {
  'aws-cloud': { color: '#5a6b7f', title: 'AWS Cloud', width: 520, height: 360 },
  'aws-account': { color: '#e7157b', title: 'AWS Account', width: 480, height: 320 },
  region: { color: '#00a4a6', dashed: true, title: 'Region', width: 440, height: 300 },
  'availability-zone': { color: '#147eba', dashed: true, noIcon: true, title: 'Availability Zone', width: 260, height: 400 },
  'virtual-private-cloud-vpc': { color: '#8c4fff', title: 'VPC', width: 400, height: 280 },
  'public-subnet': { color: '#7aa116', title: 'Public subnet', width: 240, height: 180 },
  'private-subnet': { color: '#00a4a6', title: 'Private subnet', width: 240, height: 180 },
  'auto-scaling-group': { color: '#ed7100', dashed: true, title: 'Auto Scaling group', width: 240, height: 180 },
}
const FALLBACK_GROUP = { color: '#7d8998', title: '', width: 240, height: 180, dashed: false, noIcon: false }

const groupName = (file: string) => file.replace(/^group\//, '').replace(/\.svg$/, '')
export const awsGroupStyle = (file: string) => GROUP_STYLE[groupName(file)] ?? FALLBACK_GROUP

export const awsDefaultSize = (item: AwsItem) => {
  if (item.kind === 'group') { const { width, height } = awsGroupStyle(item.file); return { width, height } }
  return { width: 88, height: 104 }
}

export const buildAwsNode = (item: AwsItem, frame: { x: number; y: number; width: number; height: number }, parentId?: string): FlowNode => {
  const shape: Shape = { key: 'rectangle', label: item.label, type: 'shape', width: frame.width, height: frame.height, style: null }
  const node = buildNode(shape, frame, parentId)
  const title = item.kind === 'group' ? awsGroupStyle(item.file).title || item.label : item.label
  return { ...node, zIndex: item.kind === 'group' ? GROUP_Z : undefined, data: { ...node.data, title, extra: { aws: item.file } } }
}

const RECENT_KEY = 'fc-aws-recent'
const RECENT_MAX = 8
export const readRecentAws = (): string[] => {
  try { const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [] } catch { return [] }
}
export const pushRecentAws = (key: string): string[] => {
  const next = [key, ...readRecentAws().filter((item) => item !== key)].slice(0, RECENT_MAX)
  localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  return next
}
