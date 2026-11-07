import { useEffect, useState } from 'react'
import { loadAwsCatalog, type AwsItem } from '../utils/awsCatalog'

export function useAwsCatalog(enabled: boolean) {
  const [items, setItems] = useState<AwsItem[]>([])
  useEffect(() => {
    if (!enabled) return
    void loadAwsCatalog().then(setItems).catch(() => {})
  }, [enabled])
  return items
}
