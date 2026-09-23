import type { WorkItem } from '@shared/types'

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/**
 * Azure DevOps stores descriptions as HTML. The window shows them as text, so
 * nothing a work item's author wrote is ever rendered as markup here.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\s*\/\s*(p|div|h[1-6]|tr|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === '#') {
        const point =
          code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
        return Number.isFinite(point) ? String.fromCodePoint(point) : match
      }
      return ENTITIES[code.toLowerCase()] ?? match
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const TRANSLITERATIONS: Record<string, string> = { æ: 'ae', ø: 'o', å: 'a', ß: 'ss' }

/** The words of a title as a branch-safe run of lowercase ASCII joined by underscores. */
function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[æøåß]/g, (c) => TRANSLITERATIONS[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .replace(/_+$/, '')
}

/** `bug/148640_footer_fix` for a bug, `feature/151699_net10_upgrade` for anything else. */
export function branchName(item: Pick<WorkItem, 'id' | 'type' | 'title'>): string {
  const prefix = item.type.toLowerCase() === 'bug' ? 'bug' : 'feature'
  const name = slug(item.title)
  return name === '' ? `${prefix}/${item.id}` : `${prefix}/${item.id}_${name}`
}
