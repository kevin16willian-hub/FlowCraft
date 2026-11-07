import { useCallback, useEffect, useState } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'
const STORAGE_KEY = 'fc-theme'

const resolve = (choice: ThemeChoice) => (choice === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : choice)

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => (localStorage.getItem(STORAGE_KEY) as ThemeChoice | null) ?? 'light')

  useEffect(() => {
    const apply = () => { document.documentElement.dataset.theme = resolve(choice) }
    apply()
    if (choice !== 'system') return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [choice])

  const update = useCallback((next: ThemeChoice) => { localStorage.setItem(STORAGE_KEY, next); setChoice(next) }, [])
  return { choice, resolved: resolve(choice), setChoice: update }
}
