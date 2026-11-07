export type Rect = { x: number; y: number; width: number; height: number }
export type Guide = { axis: 'x' | 'y'; position: number; start: number; end: number }
type Axis = 'x' | 'y'

const MAX_CANDIDATES = 25
const EPSILON = 0.5

const origin = (rect: Rect, axis: Axis) => (axis === 'x' ? rect.x : rect.y)
const length = (rect: Rect, axis: Axis) => (axis === 'x' ? rect.width : rect.height)
const marks = (rect: Rect, axis: Axis) => [origin(rect, axis), origin(rect, axis) + length(rect, axis) / 2, origin(rect, axis) + length(rect, axis)]

// Menor ajuste que alinha borda/centro com algum vizinho ou repete um espacamento ja existente entre dois vizinhos.
const snapAxis = (moving: Rect, others: Rect[], axis: Axis, threshold: number) => {
  let best: number | null = null
  const consider = (delta: number) => {
    if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best))) best = delta
  }
  const mine = marks(moving, axis)
  for (const other of others) for (const target of marks(other, axis)) for (const point of mine) consider(target - point)
  if (best !== null) return best

  const center = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
  const mc = center(moving)
  const near = [...others]
    .sort((a, b) => Math.hypot(center(a).x - mc.x, center(a).y - mc.y) - Math.hypot(center(b).x - mc.x, center(b).y - mc.y))
    .slice(0, MAX_CANDIDATES)
    .sort((a, b) => origin(a, axis) - origin(b, axis))
  for (let i = 0; i < near.length; i += 1) {
    for (let j = i + 1; j < near.length; j += 1) {
      const a = near[i]
      const b = near[j]
      const gap = origin(b, axis) - (origin(a, axis) + length(a, axis))
      if (gap <= 0) continue
      consider(origin(b, axis) + length(b, axis) + gap - origin(moving, axis))
      consider(origin(a, axis) - gap - length(moving, axis) - origin(moving, axis))
    }
  }
  return best ?? 0
}

const guidesFor = (snapped: Rect, others: Rect[]): Guide[] => {
  const guides = new Map<string, Guide>()
  for (const axis of ['x', 'y'] as const) {
    const cross: Axis = axis === 'x' ? 'y' : 'x'
    for (const other of others) {
      for (const position of marks(snapped, axis)) {
        if (!marks(other, axis).some((point) => Math.abs(point - position) < EPSILON)) continue
        const start = Math.min(origin(snapped, cross), origin(other, cross))
        const end = Math.max(origin(snapped, cross) + length(snapped, cross), origin(other, cross) + length(other, cross))
        const key = `${axis}:${Math.round(position)}`
        const known = guides.get(key)
        guides.set(key, known ? { ...known, start: Math.min(known.start, start), end: Math.max(known.end, end) } : { axis, position, start, end })
      }
    }
  }
  return [...guides.values()]
}

export const computeSnap = (moving: Rect, others: Rect[], threshold: number): { dx: number; dy: number; guides: Guide[] } => {
  const dx = snapAxis(moving, others, 'x', threshold)
  const dy = snapAxis(moving, others, 'y', threshold)
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy }
  return { dx, dy, guides: guidesFor(snapped, others) }
}
