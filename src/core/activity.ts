import { compareIso } from '@core/threads'
import type { PullRequest } from '@shared/types'

export type ActivityKind = 'opened' | 'pushed' | 'commented' | 'reviewed' | 'approved' | 'rejected'

export interface Activity {
  kind: ActivityKind
  at: string
  by: string
}

/**
 * The latest thing that happened on a pull request that a person would call
 * an event — a push, a comment or a vote. `updatedAt` can't say which, and
 * the time a pull request has waited on the user is often a different moment.
 */
export function lastActivity(pr: PullRequest): Activity {
  const candidates: Activity[] = [
    { kind: 'opened', at: pr.createdAt, by: pr.authorLogin },
    { kind: 'pushed', at: pr.lastCommitPushedAt, by: pr.authorLogin },
    ...[...pr.conversationComments, ...pr.reviewThreads.flatMap((t) => t.comments)].map(
      (c): Activity => ({ kind: 'commented', at: c.createdAt, by: c.authorLogin }),
    ),
    ...pr.reviews.flatMap((r): Activity[] => {
      if (r.state === 'PENDING') return []
      const kind =
        r.state === 'APPROVED'
          ? 'approved'
          : r.state === 'CHANGES_REQUESTED'
            ? 'rejected'
            : 'reviewed'
      return [{ kind, at: r.submittedAt, by: r.authorLogin }]
    }),
  ]
  // Later in the list wins a tie: a GitHub review and the comments posted
  // with it share a second, and the comment says more than "reviewed".
  return candidates.reduce((latest, next) =>
    compareIso(next.at, latest.at) >= 0 && !(next.kind === 'reviewed' && next.at === latest.at)
      ? next
      : latest,
  )
}

export const ACTIVITY_VERBS: Record<ActivityKind, string> = {
  opened: 'opened',
  pushed: 'pushed',
  commented: 'commented',
  reviewed: 'reviewed',
  approved: 'approved',
  rejected: 'requested changes',
}
