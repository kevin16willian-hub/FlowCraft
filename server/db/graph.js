import { httpError } from '../utils/http.js'
import { query, sql } from './pool.js'

const parse = (value) => (value == null ? null : JSON.parse(value))
const board = (boardId) => ({ boardId: [sql.UniqueIdentifier, boardId] })

// Le a working copy do quadro. Ordem deterministica (por id) para o hash do snapshot.
export const readGraph = async (boardId, executor) => {
  const nodes = (await query('SELECT * FROM flowcraft.nodes WHERE board_id = @boardId ORDER BY node_id', board(boardId), executor)).recordset
  const edges = (await query('SELECT * FROM flowcraft.edges WHERE board_id = @boardId ORDER BY edge_id', board(boardId), executor)).recordset
  const attachments = (await query(
    'SELECT node_id, s3_key, file_name FROM flowcraft.attachments WHERE board_id = @boardId ORDER BY node_id, sort_order, file_name',
    board(boardId), executor,
  )).recordset

  const byNode = new Map()
  for (const row of attachments) {
    const list = byNode.get(row.node_id) ?? []
    list.push({ name: row.file_name, url: `/api/process-prints/${row.file_name}` })
    byNode.set(row.node_id, list)
  }

  return {
    nodes: nodes.map((row) => ({
      id: row.node_id,
      type: row.node_type,
      shapeKey: row.shape_key,
      parentId: row.parent_node_id,
      x: row.pos_x,
      y: row.pos_y,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
      zIndex: row.z_index,
      title: row.title,
      description: row.description,
      inputs: row.inputs,
      outputs: row.outputs,
      style: parse(row.style_json),
      data: parse(row.data_json),
      locked: row.is_locked,
      attachments: byNode.get(row.node_id) ?? [],
    })),
    edges: edges.map((row) => ({
      id: row.edge_id,
      source: row.source_node_id,
      target: row.target_node_id,
      sourceHandle: row.source_handle,
      targetHandle: row.target_handle,
      type: row.edge_type,
      label: row.label,
      branch: row.branch,
      style: parse(row.style_json),
      data: parse(row.data_json),
    })),
  }
}

const NODE_COLUMNS = `id nvarchar(64) '$.id', nodeType varchar(30) '$.type', shapeKey varchar(40) '$.shapeKey',
  parentId nvarchar(64) '$.parentId', x float '$.x', y float '$.y', width float '$.width', height float '$.height',
  rotation float '$.rotation', zIndex int '$.zIndex', title nvarchar(300) '$.title', description nvarchar(max) '$.description',
  inputs nvarchar(max) '$.inputs', outputs nvarchar(max) '$.outputs', styleJson nvarchar(max) '$.style' AS JSON,
  dataJson nvarchar(max) '$.data' AS JSON, isLocked bit '$.locked'`

// Substitui a working copy inteira. Deve rodar dentro de uma transacao (tx).
export const replaceGraph = async (tx, boardId, graph, unumber) => {
  const knownShapes = new Set((await query('SELECT shape_key FROM flowcraft.shape_catalog', {}, tx)).recordset.map((row) => row.shape_key))
  for (const node of graph.nodes) {
    if (node.shapeKey && !knownShapes.has(node.shapeKey)) throw httpError(400, `shapeKey desconhecido: ${node.shapeKey}`)
  }

  await query('DELETE FROM flowcraft.edges WHERE board_id = @boardId', board(boardId), tx)
  await query('DELETE FROM flowcraft.nodes WHERE board_id = @boardId', board(boardId), tx)

  const maxDepth = graph.nodes.reduce((max, node) => Math.max(max, node.depth ?? 0), -1)
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const level = graph.nodes.filter((node) => (node.depth ?? 0) === depth)
    await query(
      `INSERT INTO flowcraft.nodes (board_id, node_id, node_type, shape_key, parent_node_id, pos_x, pos_y, width, height,
         rotation, z_index, title, description, inputs, outputs, style_json, data_json, is_locked)
       SELECT @boardId, id, nodeType, shapeKey, parentId, x, y, width, height, rotation, zIndex, title, description,
         inputs, outputs, styleJson, dataJson, isLocked
       FROM OPENJSON(@json) WITH (${NODE_COLUMNS})`,
      { ...board(boardId), json: [sql.NVarChar(sql.MAX), JSON.stringify(level)] }, tx,
    )
  }

  if (graph.edges.length) {
    await query(
      `INSERT INTO flowcraft.edges (board_id, edge_id, source_node_id, target_node_id, source_handle, target_handle,
         edge_type, label, branch, style_json, data_json)
       SELECT @boardId, id, source, target, sourceHandle, targetHandle, edgeType, label, branch, styleJson, dataJson
       FROM OPENJSON(@json) WITH (
         id nvarchar(64) '$.id', source nvarchar(64) '$.source', target nvarchar(64) '$.target',
         sourceHandle varchar(30) '$.sourceHandle', targetHandle varchar(30) '$.targetHandle', edgeType varchar(30) '$.type',
         label nvarchar(200) '$.label', branch varchar(5) '$.branch',
         styleJson nvarchar(max) '$.style' AS JSON, dataJson nvarchar(max) '$.data' AS JSON)`,
      { ...board(boardId), json: [sql.NVarChar(sql.MAX), JSON.stringify(graph.edges)] }, tx,
    )
  }

  const attachments = graph.nodes.flatMap((node) => node.attachments.map((attachment, order) => ({ nodeId: node.id, name: attachment.name, order })))
  if (attachments.length) {
    await query(
      `INSERT INTO flowcraft.attachments (board_id, node_id, s3_key, file_name, sort_order, created_by)
       SELECT @boardId, nodeId, 'prints/' + name, name, sortOrder, @unumber
       FROM OPENJSON(@json) WITH (nodeId nvarchar(64) '$.nodeId', name nvarchar(260) '$.name', sortOrder tinyint '$.order')`,
      { ...board(boardId), unumber: [sql.VarChar(20), unumber], json: [sql.NVarChar(sql.MAX), JSON.stringify(attachments)] }, tx,
    )
  }
}
