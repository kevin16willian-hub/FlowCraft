import type { ReactNode } from 'react'
import { DiamondIcon, EllipseIcon, EndEventIcon, LaneIcon, NoteIcon, PhaseIcon, PoolIcon, RectangleIcon, SquareIcon, TextIcon, TriangleIcon } from './icons'

// Icone por chave do catalogo de formas (flowcraft.shape_catalog).
export const SHAPE_ICONS: Record<string, ReactNode> = {
  pool: <PoolIcon />,
  lane: <LaneIcon />,
  phase: <PhaseIcon />,
  stage: <RectangleIcon />,
  gateway: <DiamondIcon />,
  start: <EllipseIcon />,
  end: <EndEventIcon />,
  text: <TextIcon />,
  note: <NoteIcon />,
  rectangle: <RectangleIcon />,
  square: <SquareIcon />,
  circle: <EllipseIcon />,
  ellipse: <EllipseIcon />,
  right_triangle: <TriangleIcon />,
}
