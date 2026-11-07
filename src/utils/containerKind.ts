export type ContainerKind = 'pool' | 'lane' | 'phase'

// Swimlanes BPMN sao nos do tipo "area" (coluna do banco) diferenciados por shapeKey; sem chave valida, e phase.
export const containerKind = (type: string | undefined, shapeKey: string | null): ContainerKind | null => {
  if (type !== 'area') return null
  return shapeKey === 'pool' || shapeKey === 'lane' ? shapeKey : 'phase'
}
