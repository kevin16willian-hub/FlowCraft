import { useEffect, useRef } from 'react'

const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  return !!element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable)
}

// Atalhos de tecla unica (sem modificadores); ignorados durante a digitacao.
export function useShortcuts(handlers: Record<string, () => void>) {
  const ref = useRef(handlers)
  useEffect(() => { ref.current = handlers })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return
      const handler = ref.current[event.key.toLowerCase()]
      if (!handler) return
      event.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
