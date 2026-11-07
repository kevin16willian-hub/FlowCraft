import { useEffect, useState } from 'react'
import { boardsApi } from '../api/client'
import type { CurrentUser, Shape } from '../types/board'

export function useShapes() {
  const [shapes, setShapes] = useState<Shape[]>([])
  useEffect(() => { void boardsApi.shapes().then(setShapes).catch(() => {}) }, [])
  return shapes
}

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null)
  useEffect(() => { void boardsApi.me().then(setUser).catch(() => {}) }, [])
  return user
}
