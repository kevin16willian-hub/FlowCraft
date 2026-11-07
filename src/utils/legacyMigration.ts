import type { ApiEdge, ApiNode, Graph } from '../types/board'

const LEGACY_KEY = 'process-design-studio:current-process'
const MIGRATED_KEY = 'fc-legacy-migrated'
const PRINT_NAME = /^print-[0-9a-f-]{36}\.(png|jpg|webp)$/

type LegacyStage = { id: string; area: string; title: string; description?: string; inputs?: string; outputs?: string; prints?: { name: string }[] }
type LegacyProcess = { areas: string[]; stages: LegacyStage[] }

const readLegacy = (): LegacyProcess | null => {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw || localStorage.getItem(MIGRATED_KEY)) return null
    const parsed = JSON.parse(raw) as Partial<LegacyProcess>
    if (!Array.isArray(parsed.areas) || !Array.isArray(parsed.stages) || !parsed.stages.length) return null
    return { areas: parsed.areas, stages: parsed.stages }
  } catch {
    return null
  }
}

export const hasLegacyProcess = () => readLegacy() !== null
export const markLegacyMigrated = () => localStorage.setItem(MIGRATED_KEY, '1')

const STAGE_WIDTH = 260
const STAGE_HEIGHT = 110
const COLUMN = 320
const LANE_HEIGHT = 240

// Converte o processo salvo no navegador (areas + etapas) em nos e arestas do quadro livre. Condicionais nao sao migradas.
export const legacyToGraph = (): Graph => {
  const legacy = readLegacy()
  if (!legacy) return { nodes: [], edges: [] }
  const blank = { shapeKey: null, parentId: null, rotation: 0, zIndex: 0, style: null, data: null, locked: false, attachments: [], description: null, inputs: null, outputs: null }

  const laneWidth = legacy.stages.length * COLUMN + 100
  const areaNodes: ApiNode[] = legacy.areas.map((area, index) => ({
    ...blank, id: `area-${index + 1}`, type: 'area', shapeKey: 'lane', title: area, x: 0, y: index * LANE_HEIGHT, width: laneWidth, height: LANE_HEIGHT - 20,
  }))
  const stageNodes: ApiNode[] = legacy.stages.map((stage, index) => {
    const lane = Math.max(legacy.areas.indexOf(stage.area), 0)
    return {
      ...blank, id: stage.id.replace(/[^\w.:-]/g, '_').slice(0, 64), type: 'stage', shapeKey: 'stage', title: stage.title,
      description: stage.description || null, inputs: stage.inputs || null, outputs: stage.outputs || null,
      x: 60 + index * COLUMN, y: lane * LANE_HEIGHT + 55, width: STAGE_WIDTH, height: STAGE_HEIGHT,
      attachments: (stage.prints ?? []).filter((print) => PRINT_NAME.test(print.name)).slice(0, 3).map((print) => ({ name: print.name })),
    }
  })
  const edges: ApiEdge[] = stageNodes.slice(1).map((node, index) => ({
    id: `edge-${index + 1}`, source: stageNodes[index].id, target: node.id, sourceHandle: 'r', targetHandle: 'l', type: 'smoothstep', label: null, branch: null, style: null, data: null,
  }))
  return { nodes: [...areaNodes, ...stageNodes], edges }
}
