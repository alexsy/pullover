import { describe, expect, it } from 'vitest'
import { lastActivity } from './activity'
import { makeComment, makePullRequest, makeReview, makeThread } from './test-factory'

describe('lastActivity', () => {
  it('is the push when nothing happened since', () => {
    const pr = makePullRequest({ lastCommitPushedAt: '2026-08-05T10:00:00Z' })
    expect(lastActivity(pr)).toEqual({ kind: 'pushed', at: '2026-08-05T10:00:00Z', by: 'alice' })
  })

  it('is a comment made after the push', () => {
    const pr = makePullRequest({
      lastCommitPushedAt: '2026-08-05T10:00:00Z',
      reviewThreads: [makeThread({ comments: [makeComment('kari', '2026-08-09T17:00:00Z')] })],
    })
    expect(lastActivity(pr)).toEqual({ kind: 'commented', at: '2026-08-09T17:00:00Z', by: 'kari' })
  })

  it('names a vote', () => {
    const pr = makePullRequest({
      reviews: [makeReview('kari', '2026-08-06T10:00:00Z', { state: 'APPROVED' })],
    })
    expect(lastActivity(pr).kind).toBe('approved')
  })

  it('prefers the comment over the bare review it came with', () => {
    const pr = makePullRequest({
      reviews: [makeReview('kari', '2026-08-06T10:00:00Z')],
      conversationComments: [makeComment('kari', '2026-08-06T10:00:00Z')],
    })
    expect(lastActivity(pr).kind).toBe('commented')
  })
})
