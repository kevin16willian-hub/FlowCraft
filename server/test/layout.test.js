import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LANE_BAND, MIN_PHASE_WIDTH, POOL_HEADER, moveDivider, nextLaneFrame, nextPhaseSlot, normalizePool } from '../../src/utils/containerLayout.ts'
import { computeSnap } from '../../src/utils/snapGuides.ts'
import { applyOps, diffOps, isEmptyOps } from '../../src/utils/graphOps.ts'

const node = (id, shapeKey, frame, parentId, type = 'area') => ({
  id, type, parentId, position: { x: frame.x, y: frame.y }, width: frame.width, height: frame.height, data: { shapeKey },
})

describe('snapGuides', () => {
  const others = [{ x: 100, y: 100, width: 100, height: 50 }]

  it('gruda borda esquerda e topo dentro da tolerancia', () => {
    const { dx, dy, guides } = computeSnap({ x: 103, y: 147, width: 60, height: 40 }, others, 6)
    assert.equal(dx, -3)
    assert.equal(dy, 3)
    assert.ok(guides.some((guide) => guide.axis === 'x' && guide.position === 100))
  })

  it('nao mexe fora da tolerancia', () => {
    const { dx, dy } = computeSnap({ x: 300, y: 400, width: 60, height: 40 }, others, 6)
    assert.deepEqual([dx, dy], [0, 0])
  })

  it('repete espacamento existente', () => {
    const pair = [{ x: 0, y: 0, width: 50, height: 50 }, { x: 100, y: 0, width: 50, height: 50 }]
    const { dx } = computeSnap({ x: 203, y: 0, width: 50, height: 50 }, pair, 6)
    assert.equal(dx, -3)
  })
})

describe('containerLayout', () => {
  const pool = node('p', 'pool', { x: 0, y: 0, width: 800, height: 100 })

  it('lane ocupa a largura da pool e empilha', () => {
    assert.deepEqual(nextLaneFrame([pool], pool), { x: 0, y: POOL_HEADER, width: 800, height: 140 })
    const lane = node('l1', 'lane', { x: 0, y: POOL_HEADER, width: 800, height: 140 }, 'p')
    assert.equal(nextLaneFrame([pool, lane], pool).y, POOL_HEADER + 140)
  })

  it('normalizePool ajusta larguras, empilha e cresce a pool', () => {
    const lanes = [node('a', 'lane', { x: 0, y: 50, width: 300, height: 100 }, 'p'), node('b', 'lane', { x: 0, y: 400, width: 500, height: 120 }, 'p')]
    const result = normalizePool([pool, ...lanes], 'p')
    const find = (id) => result.find((item) => item.id === id)
    assert.equal(find('a').width, 800)
    assert.equal(find('b').position.y, POOL_HEADER + 100)
    assert.equal(find('p').height, POOL_HEADER + 220)
  })

  it('phases dividem a lane em colunas iguais', () => {
    const lane = node('l', 'lane', { x: 0, y: 36, width: 628, height: 140 }, 'p')
    const first = nextPhaseSlot([pool, lane], lane)
    assert.equal(first.frame.x, LANE_BAND)
    assert.equal(first.frame.width, 600)
    const phase = node('f1', 'phase', first.frame, 'l')
    const second = nextPhaseSlot([pool, lane, phase], lane)
    assert.equal(second.frame.width, 300)
    assert.deepEqual(second.resizes, [{ id: 'f1', x: LANE_BAND, width: 300 }])
  })

  it('nova phase fica a direita de formas soltas', () => {
    const lane = node('l', 'lane', { x: 0, y: 36, width: 500, height: 140 }, 'p')
    const circle = node('c', 'circle', { x: 40, y: 20, width: 100, height: 100 }, 'l', 'shape')
    const slot = nextPhaseSlot([pool, lane, circle], lane)
    assert.equal(slot.frame.x, 140)
    assert.ok(slot.laneWidth >= 140 + slot.frame.width)
  })

  it('divisoria respeita a largura minima', () => {
    const [left, right] = moveDivider({ id: 'a', x: 28, width: 300 }, { id: 'b', x: 328, width: 300 }, 1000)
    assert.equal(right.width, MIN_PHASE_WIDTH)
    assert.equal(left.width + right.width, 600)
    const [shrunk] = moveDivider({ id: 'a', x: 28, width: 300 }, { id: 'b', x: 328, width: 300 }, -50)
    assert.equal(shrunk.width, 250)
  })
})

describe('graphOps', () => {
  const base = {
    nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    edges: [{ id: 'e1', source: 'a', target: 'b' }],
  }

  it('diff envia so o que mudou, foi criado ou removido', () => {
    const next = { nodes: [{ id: 'a', title: 'A2' }, { id: 'c', title: 'C' }], edges: [] }
    const ops = diffOps(base, next)
    assert.deepEqual(ops.nodes.map((node) => node.id).sort(), ['a', 'c'])
    assert.deepEqual(ops.delNodes, ['b'])
    assert.deepEqual(ops.delEdges, ['e1'])
    assert.ok(isEmptyOps(diffOps(base, base)))
  })

  it('applyOps reproduz o estado seguinte', () => {
    const next = { nodes: [{ id: 'a', title: 'A2' }, { id: 'c', title: 'C' }], edges: [] }
    const result = applyOps(base, diffOps(base, next))
    assert.deepEqual(result.nodes.map((node) => node.id).sort(), ['a', 'c'])
    assert.equal(result.nodes.find((node) => node.id === 'a').title, 'A2')
    assert.equal(result.edges.length, 0)
  })
})
