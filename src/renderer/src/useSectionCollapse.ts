import { useCallback, useState } from 'react'

export interface SectionCollapse {
  collapsed: Set<string>
  toggleSection: (key: string) => void
}

/** Keyed by section, which is a category or a status group depending on the grouping. */
export function useSectionCollapse(initiallyCollapsed: string[] = ['waiting']): SectionCollapse {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(initiallyCollapsed))

  const toggleSection = useCallback((key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  return { collapsed, toggleSection }
}
