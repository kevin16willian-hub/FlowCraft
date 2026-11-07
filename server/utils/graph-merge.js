// Merge de tres vias por id: base (ponto de partida), mine (proposta) e theirs (estado atual do main).
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const mergeList = (base, mine, theirs) => {
  const index = (list) => new Map(list.map((item) => [item.id, item]))
  const [b, m, t] = [index(base), index(mine), index(theirs)]
  const merged = new Map()
  const conflicts = []
  for (const id of new Set([...b.keys(), ...m.keys(), ...t.keys()])) {
    const [base0, mine0, theirs0] = [b.get(id), m.get(id), t.get(id)]
    let pick
    if (same(mine0, base0)) pick = theirs0
    else if (same(theirs0, base0) || same(mine0, theirs0)) pick = mine0
    else { conflicts.push(id); pick = theirs0 }
    if (pick) merged.set(id, pick)
  }
  const order = [...theirs.map((item) => item.id), ...mine.map((item) => item.id)]
  return { items: [...new Set(order)].filter((id) => merged.has(id)).map((id) => merged.get(id)), conflicts }
}

// Resultado: grafo mesclado e ids em conflito (em conflito prevalece a versao do main).
export const mergeGraphs = (base, mine, theirs) => {
  const nodes = mergeList(base.nodes, mine.nodes, theirs.nodes)
  const edges = mergeList(base.edges, mine.edges, theirs.edges)
  const ids = new Set(nodes.items.map((node) => node.id))
  return {
    graph: {
      nodes: nodes.items.map((node) => (node.parentId && !ids.has(node.parentId) ? { ...node, parentId: null } : node)),
      edges: edges.items.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    },
    conflicts: [...nodes.conflicts, ...edges.conflicts],
  }
}
