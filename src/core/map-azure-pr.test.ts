import { classify } from '@core/classify'
import { describe, expect, it } from 'vitest'
import {
  type AzureComment,
  type AzurePullRequest,
  type AzurePullRequestDetails,
  type AzureReviewer,
  type AzureThread,
  mapAzurePullRequest,
  mapBuildStatus,
} from './map-azure-pr'

const ME = { id: 'me-id', login: 'vlad@contoso.com' }
const ALICE = { id: 'alice-id', displayName: 'Alice', uniqueName: 'Alice@Contoso.com' }
const VLAD = { id: 'me-id', displayName: 'Vlad', uniqueName: 'Vlad@Contoso.com' }
const BUILD = { isEnabled: true, type: { id: '0609b952-1397-4640-95ec-e00a01b2c241' } }

function reviewer(identity: typeof ALICE, vote: number, extra: Partial<AzureReviewer> = {}) {
  return { ...identity, vote, ...extra }
}

function pr(overrides: Partial<AzurePullRequest> = {}): AzurePullRequest {
  return {
    pullRequestId: 42,
    title: 'Add checkout',
    description: '',
    status: 'active',
    isDraft: false,
    creationDate: '2026-08-01T10:00:00Z',
    createdBy: ALICE,
    sourceRefName: 'refs/heads/feature/checkout',
    targetRefName: 'refs/heads/main',
    mergeStatus: 'succeeded',
    autoCompleteSetBy: null,
    reviewers: [reviewer(VLAD, 0)],
    repository: { id: 'repo-id', name: 'api', project: { id: 'proj-id', name: 'Contoso Web' } },
    ...overrides,
  }
}

function comment(author: typeof ALICE, publishedDate: string, content = ''): AzureComment {
  return { author, publishedDate, content, commentType: 'text' }
}

function thread(id: number, comments: AzureComment[], extra: Partial<AzureThread> = {}) {
  return {
    id,
    status: 'active',
    publishedDate: comments[0]?.publishedDate ?? '2026-08-01T10:00:00Z',
    comments,
    ...extra,
  }
}

function systemThread(type: string, author: typeof ALICE, at: string, props = {}): AzureThread {
  return {
    id: 900,
    publishedDate: at,
    comments: [{ author, publishedDate: at, content: '', commentType: 'system' }],
    properties: { CodeReviewThreadType: { $value: type }, ...props },
  }
}

function details(overrides: Partial<AzurePullRequestDetails> = {}): AzurePullRequestDetails {
  return { threads: [], iterations: [], policyEvaluations: [], ...overrides }
}

function map(p: AzurePullRequest, d = details(), buckets = ['review-requested' as const]) {
  return mapAzurePullRequest('contoso', p, d, [...buckets], ME)
}

const NOW = '2026-08-10T12:00:00Z'

function category(p: AzurePullRequest, d = details()) {
  return classify(map(p, d), { myLogin: ME.login, snoozes: {}, now: NOW }).category
}

describe('mapAzurePullRequest', () => {
  it('fills in the fields the cards show', () => {
    const mapped = map(pr())
    expect(mapped).toMatchObject({
      id: 'repo-id/42',
      number: 42,
      url: 'https://dev.azure.com/contoso/Contoso%20Web/_git/api/pullrequest/42',
      repository: 'Contoso Web/api',
      authorLogin: 'alice@contoso.com',
      headRefName: 'feature/checkout',
      baseRefName: 'main',
      mergeable: 'MERGEABLE',
      additions: null,
      deletions: null,
    })
  })

  it('asks for a review while my vote is still empty', () => {
    expect(map(pr()).buckets).toContain('review-requested')
    expect(category(pr())).toBe('needs-review')
  })

  it("doesn't ask again once I've voted, since Azure DevOps keeps voters on the list", () => {
    const voted = pr({ reviewers: [reviewer(VLAD, 10)] })
    const d = details({
      threads: [
        systemThread('VoteUpdate', VLAD, '2026-08-02T10:00:00Z', {
          CodeReviewVoteResult: { $value: '10' },
        }),
      ],
    })
    expect(map(voted, d).buckets).not.toContain('review-requested')
    expect(map(voted, d).reviews).toEqual([
      {
        authorLogin: 'vlad@contoso.com',
        state: 'APPROVED',
        submittedAt: '2026-08-02T10:00:00Z',
        bodyText: '',
      },
    ])
    expect(category(voted, d)).toBe('waiting')
  })

  it('asks for another look after a push once I have voted', () => {
    const voted = pr({ reviewers: [reviewer(VLAD, 5)] })
    const d = details({
      threads: [
        systemThread('VoteUpdate', VLAD, '2026-08-02T10:00:00Z', {
          CodeReviewVoteResult: { $value: '5' },
        }),
      ],
      iterations: [
        { createdDate: '2026-08-01T10:00:00Z' },
        { createdDate: '2026-08-03T10:00:00Z' },
      ],
    })
    expect(map(voted, d).lastCommitPushedAt).toBe('2026-08-03T10:00:00Z')
    expect(category(voted, d)).toBe('re-review')
  })

  it('dates a review request from the event that added me', () => {
    const d = details({
      threads: [
        {
          ...systemThread('ReviewersUpdate', ALICE, '2026-08-04T09:00:00Z', {
            CodeReviewReviewersUpdatedAddedIdentity: { $value: '1' },
          }),
          identities: { '1': VLAD },
        },
      ],
    })
    expect(map(pr(), d).reviewRequestedAt).toBe('2026-08-04T09:00:00Z')
  })

  it('dates a review request from creation when I was named from the start', () => {
    expect(map(pr()).reviewRequestedAt).toBe('2026-08-01T10:00:00Z')
  })

  it('treats comment threads as review threads and system threads as neither', () => {
    const d = details({
      threads: [
        thread(1, [comment(VLAD, '2026-08-02T10:00:00Z'), comment(ALICE, '2026-08-03T10:00:00Z')]),
        thread(2, [comment(ALICE, '2026-08-02T11:00:00Z')], { status: 'fixed' }),
        systemThread('RefUpdate', ALICE, '2026-08-03T12:00:00Z'),
      ],
    })
    const mapped = map(pr({ reviewers: [reviewer(VLAD, 0)] }), d)
    expect(mapped.reviewThreads.map((t) => [t.id, t.isResolved])).toEqual([
      ['1', false],
      ['2', true],
    ])
    expect(mapped.updatedAt).toBe('2026-08-03T12:00:00Z')
    expect(category(pr(), d)).toBe('new-replies')
  })

  it('finds mentions written as @<identity id>', () => {
    const d = details({
      threads: [thread(1, [comment(ALICE, '2026-08-02T10:00:00Z', 'thoughts, @<ME-ID>?')])],
    })
    const mapped = map(pr({ reviewers: [] }), d, [])
    expect(mapped.mentionsAt).toEqual(['2026-08-02T10:00:00Z'])
    expect(mapped.buckets).toContain('mentions')
  })

  it('reports my own pull request with a rejecting vote as changes requested', () => {
    const mine = pr({ createdBy: VLAD, reviewers: [reviewer(ALICE, -10)] })
    const d = details({
      threads: [
        systemThread('VoteUpdate', ALICE, '2026-08-02T10:00:00Z', {
          CodeReviewVoteResult: { $value: '-10' },
        }),
      ],
    })
    expect(map(mine, d, []).reviewDecision).toBe('CHANGES_REQUESTED')
    expect(category(mine, d)).toBe('my-pr-action')
  })

  it('is approved only once every required reviewer approves', () => {
    const required = reviewer(ALICE, 0, { isRequired: true })
    expect(map(pr({ reviewers: [required, reviewer(VLAD, 10)] })).reviewDecision).toBe(
      'REVIEW_REQUIRED',
    )
    expect(map(pr({ reviewers: [{ ...required, vote: 10 }] })).reviewDecision).toBe('APPROVED')
  })

  it('maps conflicts and auto-complete', () => {
    const mapped = map(pr({ mergeStatus: 'conflicts', autoCompleteSetBy: ALICE }))
    expect(mapped.mergeable).toBe('CONFLICTING')
    expect(mapped.hasAutoMerge).toBe(true)
  })
})

describe('mapBuildStatus', () => {
  it('reads build policies only, the worst one winning', () => {
    expect(mapBuildStatus([{ status: 'approved', configuration: BUILD }])).toBe('success')
    expect(
      mapBuildStatus([
        { status: 'approved', configuration: BUILD },
        { status: 'running', configuration: BUILD },
      ]),
    ).toBe('pending')
    expect(
      mapBuildStatus([
        { status: 'running', configuration: BUILD },
        { status: 'rejected', configuration: BUILD },
      ]),
    ).toBe('failure')
    expect(
      mapBuildStatus([{ status: 'rejected', configuration: { type: { id: 'min-reviewers' } } }]),
    ).toBe('none')
  })

  it('shows nothing when the evaluations could not be read', () => {
    expect(mapBuildStatus(null)).toBe('none')
  })
})

describe('mapAzurePullRequest with watched teams', () => {
  const TEAM = { id: 'team-id', displayName: 'MinSide Dev Team', isContainer: true }
  const watching = { ...ME, teams: [{ id: 'team-id', name: 'MinSide Dev Team' }] }

  function mapFor(p: AzurePullRequest) {
    return mapAzurePullRequest('contoso', p, details(), ['review-requested'], watching)
  }

  it("counts a team's pending request as mine", () => {
    const mapped = mapFor(pr({ reviewers: [{ ...TEAM, vote: 0 }] }))
    expect(mapped.buckets).toContain('review-requested')
    expect(mapped.teams).toEqual(['MinSide Dev Team'])
    expect(mapped.reviewRequestedAt).toBe('2026-08-01T10:00:00Z')
  })

  it('stops once the team has voted', () => {
    expect(mapFor(pr({ reviewers: [{ ...TEAM, vote: 10 }] })).buckets).not.toContain(
      'review-requested',
    )
  })

  it('lets my own vote speak over the team', () => {
    const mapped = mapFor(pr({ reviewers: [{ ...TEAM, vote: 0 }, reviewer(VLAD, 10)] }))
    expect(mapped.buckets).not.toContain('review-requested')
  })
})

describe('mapAzurePullRequest approvers', () => {
  it('names the people whose vote approves, not groups and not other votes', () => {
    const mapped = map(
      pr({
        reviewers: [
          reviewer(ALICE, 10),
          reviewer(VLAD, 5),
          { id: 'team', displayName: 'Team', vote: 10, isContainer: true },
          { id: 'x', displayName: 'Rejecting', vote: -10 },
        ],
      }),
    )
    expect(mapped.approvedBy).toEqual(['Alice', 'Vlad'])
  })
})
