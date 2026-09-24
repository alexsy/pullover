import { orderSection } from '@core/stack'
import { compareIso, myLatestVote } from '@core/threads'
import {
  CATEGORY_TITLES,
  type ClassifiedPullRequest,
  type Grouping,
  type SortOrder,
  VISIBLE_CATEGORIES,
} from '@shared/types'

export interface Section {
  key: string
  title: string
  /** In draw order, stacks gathered into contiguous runs. */
  items: ClassifiedPullRequest[]
}

export type StatusGroup = 'mine' | 'new' | 'waiting-on-author' | 'approved'

const STATUS_GROUPS: { key: StatusGroup; title: string }[] = [
  { key: 'mine', title: 'Your PRs' },
  { key: 'new', title: 'New' },
  { key: 'waiting-on-author', title: 'Waiting on author' },
  { key: 'approved', title: 'Approved' },
]

/**
 * Where a pull request stands, as opposed to why it is in the inbox. A
 * pull request that wants something from the user is new whatever its vote,
 * so one approved and then pushed to lands back in `new`.
 */
export function statusGroup(item: ClassifiedPullRequest, myLogin: string): StatusGroup {
  const { pr } = item
  if (pr.authorLogin === myLogin) return 'mine'
  if (!item.isSnoozed && item.category !== 'waiting') return 'new'
  if (myLatestVote(pr, myLogin)?.state === 'APPROVED' || pr.reviewDecision === 'APPROVED') {
    return 'approved'
  }
  return 'waiting-on-author'
}

export function buildSections(
  items: ClassifiedPullRequest[],
  {
    groupBy,
    sortOrder,
    myLogin,
  }: { groupBy: Grouping; sortOrder: SortOrder; myLogin: string | null },
): Section[] {
  if (groupBy === 'reason' || myLogin === null) {
    return VISIBLE_CATEGORIES.map((category) => ({
      key: category,
      title: CATEGORY_TITLES[category],
      items: orderSection(items.filter((item) => item.category === category)),
    }))
  }

  return STATUS_GROUPS.map(({ key, title }) => {
    const inGroup = items.filter((item) => statusGroup(item, myLogin) === key)
    // Otherwise the classifier's order stands, which is by reason first — the
    // most pressing kind of request heads each group.
    if (sortOrder === 'recent') inGroup.sort((a, b) => compareIso(b.pr.updatedAt, a.pr.updatedAt))
    return { key, title, items: orderSection(inGroup) }
  })
}
