import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeGraphs } from '../utils/graph-merge.js'

const node = (id, extra = {}) => ({ id, type: 'stage', parentId: null, x: 0, y: 0, title: id, ...extra })
const graph = (...nodes) => ({ nodes, edges: [] })

describe('mergeGraphs', () => {
  it('une mudancas em elementos diferentes', () => {
    const base = graph(node('a'), node('b'))
    const mine = graph(node('a', { title: 'meu' }), node('b'))
    const theirs = graph(node('a'), node('b', { x: 50 }), node('c'))
    const { graph: merged, conflicts } = mergeGraphs(base, mine, theirs)
    assert.deepEqual(conflicts, [])
    assert.equal(merged.nodes.find((item) => item.id === 'a').title, 'meu')
    assert.equal(merged.nodes.find((item) => item.id === 'b').x, 50)
    assert.ok(merged.nodes.some((item) => item.id === 'c'))
  })

  it('aponta conflito quando os dois mudam o mesmo elemento', () => {
    const base = graph(node('a'))
    const { conflicts } = mergeGraphs(base, graph(node('a', { title: 'x' })), graph(node('a', { title: 'y' })))
    assert.deepEqual(conflicts, ['a'])
  })

  it('exclusao: remove o elemento e as setas que dependiam dele', () => {
    const base = { nodes: [node('a'), node('b')], edges: [{ id: 'e', source: 'a', target: 'b' }] }
    const mine = { nodes: [node('a')], edges: [] }
    const theirs = { nodes: [node('a'), node('b')], edges: [{ id: 'e', source: 'a', target: 'b' }] }
    const { graph: merged, conflicts } = mergeGraphs(base, mine, theirs)
    assert.deepEqual(conflicts, [])
    assert.deepEqual(merged.nodes.map((item) => item.id), ['a'])
    assert.equal(merged.edges.length, 0)
  })
})
