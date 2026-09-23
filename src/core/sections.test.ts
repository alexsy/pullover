import { classifyAll } from '@core/classify'
import { describe, expect, it } from 'vitest'
import { buildSections } from './sections'
import { makePullRequest, makeReview } from './test-factory'

const NOW = '2026-08-10T12:00:00Z'
const ctx = { myLogin: 'vlad', snoozes: {}, now: NOW }

function sectionsOf(
  prs: Parameters<typeof classifyAll>[0],
  sortOrder: 'waiting' | 'recent' = 'waiting',
) {
  const items = classifyAll(prs, ctx).map((item) => ({ ...item, stack: null }))
  return buildSections(items, { grouping: 'status', sortOrder, myLogin: 'vlad' })
    .filter((s) => s.items.length > 0)
    .map((s) => [s.key, s.items.map((i) => i.pr.id)])
}

describe('buildSections by status', () => {
  const mine = makePullRequest({ id: 'mine', authorLogin: 'vlad', buckets: ['author'] })
  const fresh = makePullRequest({ id: 'new', buckets: ['review-requested'] })
  const commented = makePullRequest({
    id: 'waiting',
    buckets: ['involves'],
    reviews: [makeReview('vlad', '2026-08-02T10:00:00Z', { state: 'CHANGES_REQUESTED' })],
  })
  const approved = makePullRequest({
    id: 'approved',
    buckets: ['involves'],
    reviews: [makeReview('vlad', '2026-08-02T10:00:00Z', { state: 'APPROVED' })],
  })

  it('puts mine first, then new, then waiting on the author, then approved', () => {
    expect(sectionsOf([approved, commented, fresh, mine])).toEqual([
      ['mine', ['mine']],
      ['new', ['new']],
      ['waiting-on-author', ['waiting']],
      ['approved', ['approved']],
    ])
  })

  it('brings an approved pull request back to new when it is pushed to', () => {
    const pushed = { ...approved, lastCommitPushedAt: '2026-08-05T10:00:00Z' }
    expect(sectionsOf([pushed])).toEqual([['new', ['approved']]])
  })

  it('orders a group by the latest change when asked', () => {
    const older = makePullRequest({
      id: 'a',
      buckets: ['review-requested'],
      updatedAt: '2026-08-02T10:00:00Z',
    })
    const newer = makePullRequest({
      id: 'b',
      buckets: ['review-requested'],
      updatedAt: '2026-08-06T10:00:00Z',
    })
    expect(sectionsOf([older, newer], 'recent')).toEqual([['new', ['b', 'a']]])
  })
})
