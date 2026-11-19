import type { ApiEdge, ApiNode, Graph } from '../types/board'
import type { Edge } from '@xyflow/react'
import { newId, type FlowNode } from './graphMapping'

type MindmapColor = { fill: string; border: string; text: string; line: string }
type Side = -1 | 1

const COLORS: Record<string, MindmapColor> = {
  company: { fill: '#ffe0df', border: '#ff4d4d', text: '#672020', line: '#ff4d4d' },
  market: { fill: '#ffeadb', border: '#ff9f43', text: '#65380d', line: '#ff9f43' },
  selling: { fill: '#fff5c2', border: '#f1c40f', text: '#594900', line: '#f1c40f' },
  executive: { fill: '#d8f8ec', border: '#10b981', text: '#064d37', line: '#10b981' },
  financial: { fill: '#dfe6ff', border: '#4f6bff', text: '#1e2d71', line: '#4f6bff' },
  root: { fill: '#ffffff', border: '#111238', text: '#111238', line: '#111238' },
}

const node = (
  title: string,
  position: { x: number; y: number },
  branch: string,
  side: Side,
  depth: number,
  description = '',
  options: { width?: number; height?: number; root?: boolean; group?: boolean } = {},
): ApiNode => {
  const color = options.root ? COLORS.root : COLORS[branch]
  return {
    id: newId(options.group ? 'mindmap-group' : 'mindmap'),
    type: options.group ? 'shape' : 'note',
    shapeKey: options.group ? 'rectangle' : 'note',
    parentId: null,
    x: position.x,
    y: position.y,
    width: options.width ?? (options.root ? 240 : 190),
    height: options.height ?? (options.root ? 84 : 58),
    rotation: 0,
    zIndex: options.group ? -1 : 0,
    title,
    description,
    inputs: null,
    outputs: null,
    style: null,
    data: {
      mindmap: true,
      mindmapColor: color,
      mindmapBranch: branch,
      mindmapSide: side,
      mindmapDepth: depth,
      ...(options.root ? { mindmapRoot: true } : {}),
      ...(options.group ? { mindmapGroup: true } : {}),
    },
    locked: false,
    attachments: [],
  }
}

export function createMindmapRoot(): FlowNode {
  const root = node('Business Plan', { x: 0, y: 0 }, 'root', 1, 0, '', { root: true, width: 250, height: 88 })
  return {
    id: root.id,
    type: 'note',
    position: { x: root.x, y: root.y },
    width: root.width ?? undefined,
    height: root.height ?? undefined,
    selected: true,
    data: {
      title: root.title ?? '',
      description: root.description ?? '',
      inputs: '',
      outputs: '',
      shapeKey: 'note',
      attachments: [],
      style: null,
      extra: root.data,
    },
  }
}

const connect = (source: ApiNode, target: ApiNode, branch: string): ApiEdge => ({
  id: newId('mindmap-edge'),
  source: source.id,
  target: target.id,
  sourceHandle: null,
  targetHandle: null,
  type: 'default',
  label: null,
  branch: null,
  style: { stroke: COLORS[branch].line, strokeWidth: 2.5 },
  data: { mindmap: true },
})

export function businessPlanTemplate(): Graph {
  const nodes: ApiNode[] = []
  const edges: ApiEdge[] = []
  const add = (topic: ApiNode) => { nodes.push(topic); return topic }
  const link = (parent: ApiNode, child: ApiNode, branch: string) => { edges.push(connect(parent, child, branch)); return child }
  const root = add(node('Business Plan', { x: 0, y: 0 }, 'root', 1, 0, '', { root: true, width: 250, height: 88 }))

  const financial = link(root, add(node('Financial', { x: -350, y: -280 }, 'financial', -1, 1, 'Organize the financial assumptions and projections for the business.')), 'financial')
  for (const [title, y, description] of [
    ['Cash Flow', -460, 'Estimate when money enters and leaves the business.'],
    ['Profit & Loss', -370, 'Record expected revenue, costs, and profitability.'],
    ['Break Even', -280, 'Estimate when revenue covers all operating costs.'],
    ['Capital Needed', -190, 'Describe the investment required and how it will be used.'],
    ['Predictions', -100, 'Document the assumptions behind your financial forecast.'],
  ] as const) link(financial, add(node(title, { x: -620, y }, 'financial', -1, 2, description)), 'financial')

  const executive = link(root, add(node('Executive Summary', { x: -430, y: 0 }, 'executive', -1, 1, 'Summarize the opportunity, purpose, and direction of the business.', { width: 220 })), 'executive')
  for (const [title, y, description] of [
    ['Overview', -180, 'What does the business do, and what opportunity does it address?'],
    ['Mission', -90, 'State the purpose and long-term intent of the business.'],
    ['Target Audience', 0, 'Identify the people or organizations the business serves.'],
    ['Continuous Work', 90, 'Describe ongoing priorities and work needed to execute the plan.'],
    ['Venture Capitalists', 180, 'Note funding needs, investor fit, and the value proposition for investors.'],
  ] as const) link(executive, add(node(title, { x: -720, y }, 'executive', -1, 2, description, { width: 205 })), 'executive')

  const selling = link(root, add(node('Selling', { x: -350, y: 280 }, 'selling', -1, 1, 'Explain what is being offered and how customers will use it.')), 'selling')
  link(selling, add(node('Unique', { x: -620, y: 120 }, 'selling', -1, 2, 'What makes the offer distinctive?')), 'selling')
  const sellingMethod = link(selling, add(node('Selling', { x: -620, y: 220 }, 'selling', -1, 2, 'Describe the sales approach and customer journey.')), 'selling')
  link(sellingMethod, add(node('USP', { x: -850, y: 175 }, 'selling', -1, 3, 'Write the unique selling proposition in one clear statement.', { width: 170 })), 'selling')
  link(sellingMethod, add(node('Proposition', { x: -850, y: 265 }, 'selling', -1, 3, 'Summarize the value customers receive.', { width: 170 })), 'selling')
  for (const [title, y, description] of [
    ['Benefits', 320, 'List the practical and emotional benefits for customers.'],
    ['When used?', 410, 'Describe when customers need or use the product or service.'],
    ['How used?', 500, 'Explain how customers use or access the offer.'],
  ] as const) link(selling, add(node(title, { x: -620, y }, 'selling', -1, 2, description)), 'selling')

  const company = link(root, add(node('Company', { x: 350, y: -280 }, 'company', 1, 1, 'Describe the organization, its people, culture, and partners.')), 'company')
  for (const [title, y, description] of [
    ['Office', -460, 'Record where the team works and relevant location needs.'],
    ['Unique Culture', -370, 'Describe the values and working culture the company wants to build.'],
    ['Employee', -280, 'Identify the roles and capabilities needed in the team.'],
  ] as const) link(company, add(node(title, { x: 620, y }, 'company', 1, 2, description)), 'company')
  const management = link(company, add(node('Management Team', { x: 620, y: -160 }, 'company', 1, 2, 'Summarize leadership experience, skills, and partnerships.', { width: 210 })), 'company')
  const experience = link(management, add(node('Experience', { x: 900, y: -250 }, 'company', 1, 3, 'Describe relevant experience across the management team.')), 'company')
  for (const [title, y] of [['Others', -325], ['Partners', -250], ['Yours', -175]] as const) link(experience, add(node(title, { x: 1150, y }, 'company', 1, 4, 'Add relevant experience and examples.', { width: 150 })), 'company')
  const skills = link(management, add(node('Skills', { x: 900, y: -115 }, 'company', 1, 3, 'Identify the skills available and gaps to address.')), 'company')
  for (const [title, y] of [['Partners', -175], ['Others', -100], ['Yours', -25]] as const) link(skills, add(node(title, { x: 1150, y }, 'company', 1, 4, 'List the relevant skills and expertise.', { width: 150 })), 'company')
  link(management, add(node('Partners', { x: 900, y: -5 }, 'company', 1, 3, 'Identify strategic partners and their contribution.')), 'company')

  const market = link(root, add(node('Market Analysis', { x: 350, y: 280 }, 'market', 1, 1, 'Understand customers, competitors, and the strategy for reaching the market.', { width: 220 })), 'market')
  const targetMarket = link(market, add(node('Target Market', { x: 640, y: 130 }, 'market', 1, 2, 'Define the market segments and customers to focus on.')), 'market')
  add(node('Persona', { x: 850, y: -30 }, 'market', 1, 3, '', { width: 380, height: 245, group: true }))
  const customers = link(targetMarket, add(node('Customers', { x: 875, y: 5 }, 'market', 1, 3, 'Describe the ideal customer and their needs.', { width: 170 })), 'market')
  for (const [title, y] of [['Who', -20], ['Ages', 40], ['Gender', 100], ['Income', 160]] as const) link(customers, add(node(title, { x: 1100, y }, 'market', 1, 4, 'Add relevant customer information.', { width: 120, height: 48 })), 'market')
  const competitors = link(targetMarket, add(node('Competitors', { x: 875, y: 145 }, 'market', 1, 3, 'Identify alternatives customers may choose.', { width: 170 })), 'market')
  link(competitors, add(node('Who', { x: 1100, y: 125 }, 'market', 1, 4, 'Name the direct and indirect competitors.', { width: 120, height: 48 })), 'market')
  link(competitors, add(node('Why different', { x: 1100, y: 185 }, 'market', 1, 4, 'Explain how your offer stands apart.', { width: 150, height: 48 })), 'market')
  const strategy = link(market, add(node('Strategy', { x: 640, y: 390 }, 'market', 1, 2, 'Set measurable goals and plans for reaching the market.')), 'market')
  const achievements = link(strategy, add(node('Achievements', { x: 900, y: 340 }, 'market', 1, 3, 'Define what success looks like and when to measure it.', { width: 180 })), 'market')
  link(achievements, add(node('When', { x: 1130, y: 305 }, 'market', 1, 4, 'Set milestones and target dates.', { width: 120, height: 48 })), 'market')
  link(achievements, add(node('What', { x: 1130, y: 365 }, 'market', 1, 4, 'Choose measurable outcomes.', { width: 120, height: 48 })), 'market')
  const plans = link(strategy, add(node('Plans', { x: 900, y: 450 }, 'market', 1, 3, 'Outline the short-term and long-term plans.', { width: 180 })), 'market')
  link(plans, add(node('Short Team', { x: 1130, y: 415 }, 'market', 1, 4, 'List near-term team and execution priorities.', { width: 150, height: 48 })), 'market')
  link(plans, add(node('Long Team', { x: 1130, y: 475 }, 'market', 1, 4, 'Describe the long-term team and growth needs.', { width: 150, height: 48 })), 'market')

  return { nodes, edges }
}

const colorOf = (node: FlowNode): MindmapColor => {
  const color = node.data.extra?.mindmapColor
  return typeof color === 'object' && color !== null && 'fill' in color && 'border' in color && 'text' in color && 'line' in color
    ? color as MindmapColor
    : COLORS.market
}

export function createMindmapTopic(nodes: FlowNode[], edges: Edge[], selectedId: string, relation: 'child' | 'sibling'): { node: FlowNode; edge: Edge } {
  const selected = nodes.find((item) => item.id === selectedId)
  if (!selected) throw new Error('O tópico selecionado não foi encontrado.')
  const incoming = edges.find((edge) => edge.target === selectedId)
  if (relation === 'sibling' && !incoming) throw new Error('O tópico central não pode receber um irmão.')
  const parentId = relation === 'child' ? selected.id : incoming?.source
  const parent = nodes.find((item) => item.id === parentId)
  if (!parent) throw new Error('O tópico pai não foi encontrado.')
  const siblings = edges.filter((edge) => edge.source === parentId && edge.target !== selectedId)
  const depth = Number(selected.data.extra?.mindmapDepth ?? 0) + (relation === 'child' ? 1 : 0)
  const rootChildCount = edges.filter((edge) => edge.source === selectedId).length
  const rootChild = relation === 'child' && selected.data.extra?.mindmapRoot === true
  const side = rootChild ? (rootChildCount % 2 === 0 ? -1 : 1) : (selected.data.extra?.mindmapSide === -1 ? -1 : 1) as Side
  const branch = rootChild ? ['company', 'market', 'selling', 'executive', 'financial'][rootChildCount % 5] : String(selected.data.extra?.mindmapBranch ?? 'market')
  const color = rootChild ? COLORS[branch] : colorOf(selected)
  const peerNodes = siblings.map((edge) => nodes.find((item) => item.id === edge.target)).filter((item): item is FlowNode => !!item)
  const y = relation === 'child'
    ? selected.position.y + (siblings.length - (peerNodes.length / 2)) * 82
    : Math.max(selected.position.y, ...peerNodes.map((item) => item.position.y)) + 82
  const position = relation === 'child'
    ? { x: selected.position.x + side * (rootChild ? 350 : 230), y: rootChild ? selected.position.y + (rootChildCount - 2) * 120 : y }
    : { x: selected.position.x, y }
  const topic: FlowNode = {
    id: newId('mindmap'),
    type: 'note',
    position,
    width: 190,
    height: 58,
    selected: true,
    data: {
      title: 'Novo tópico',
      description: '',
      inputs: '',
      outputs: '',
      shapeKey: 'note',
      attachments: [],
      style: null,
      extra: {
        mindmap: true,
        mindmapColor: color,
        mindmapBranch: branch,
        mindmapSide: side,
        mindmapDepth: depth,
      },
    },
  }
  const edge: Edge = {
    id: newId('mindmap-edge'),
    source: parent.id,
    target: topic.id,
    type: 'default',
    style: { stroke: color.line, strokeWidth: 2.5 },
    data: { extra: { mindmap: true } },
  }
  return { node: topic, edge }
}
