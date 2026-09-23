import { compareIso } from '@core/threads'
import type {
  CiStatus,
  MergeableState,
  PullRequest,
  Review,
  ReviewDecision,
  ReviewState,
  ReviewThread,
  SearchBucket,
  ThreadComment,
} from '@shared/types'

/** The shapes below are the parts of Azure DevOps' REST responses (api-version 7.1) this app reads. */
export interface AzureIdentity {
  id: string
  displayName: string
  uniqueName?: string
  imageUrl?: string
  isContainer?: boolean
}

export interface AzureReviewer extends AzureIdentity {
  /** 10 approved, 5 approved with suggestions, 0 no vote, -5 waiting for author, -10 rejected. */
  vote: number
  isRequired?: boolean
  hasDeclined?: boolean
}

export interface AzurePullRequest {
  pullRequestId: number
  title: string
  description?: string
  status: string
  isDraft?: boolean
  creationDate: string
  createdBy: AzureIdentity
  sourceRefName: string
  targetRefName: string
  mergeStatus?: string
  autoCompleteSetBy?: AzureIdentity | null
  reviewers?: AzureReviewer[]
  repository: { id: string; name: string; project: { id: string; name: string } }
}

interface AzurePropertyValue {
  $value?: string | number
}

export interface AzureComment {
  author: AzureIdentity
  content?: string
  publishedDate: string
  commentType?: string
  isDeleted?: boolean
}

export interface AzureThread {
  id: number
  status?: string
  isDeleted?: boolean
  publishedDate: string
  lastUpdatedDate?: string
  comments: AzureComment[]
  properties?: Record<string, AzurePropertyValue | undefined> | null
  identities?: Record<string, AzureIdentity> | null
}

export interface AzureIteration {
  createdDate: string
}

export interface AzurePolicyEvaluation {
  status: string
  configuration?: { isEnabled?: boolean; type?: { id?: string } }
}

export interface AzurePullRequestDetails {
  threads: AzureThread[]
  iterations: AzureIteration[]
  /** Null when the evaluations couldn't be read; the pull request then shows no CI. */
  policyEvaluations: AzurePolicyEvaluation[] | null
}

export interface AzureTeam {
  id: string
  name: string
}

export interface AzureMe {
  id: string
  login: string
  /** Teams the user watches, whose review requests count as theirs. */
  teams?: AzureTeam[]
}

/** Azure DevOps' built-in "Build" policy type, the one build validation runs under. */
const BUILD_POLICY_TYPE_ID = '0609b952-1397-4640-95ec-e00a01b2c241'

/**
 * Azure DevOps identities have no login; the unique name (usually the email)
 * stands in, lowercased because the same account comes back in different
 * cases from different endpoints.
 */
export function azureLogin(identity: AzureIdentity): string {
  return (identity.uniqueName ?? identity.displayName).toLowerCase()
}

/** Azure DevOps stores a mention as `@<identity id>` in the comment's markdown. */
export function mentionsIdentity(text: string, id: string): boolean {
  return text.toLowerCase().includes(`@<${id.toLowerCase()}>`)
}

export function azureWebUrl(organization: string, pr: AzurePullRequest): string {
  const project = encodeURIComponent(pr.repository.project.name)
  const repo = encodeURIComponent(pr.repository.name)
  return `https://dev.azure.com/${encodeURIComponent(organization)}/${project}/_git/${repo}/pullrequest/${pr.pullRequestId}`
}

function stripRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, '')
}

function property(thread: AzureThread, name: string): string | null {
  const value = thread.properties?.[name]?.$value
  return value === undefined ? null : String(value)
}

function threadType(thread: AzureThread): string | null {
  return property(thread, 'CodeReviewThreadType')
}

function visibleComments(thread: AzureThread): AzureComment[] {
  return thread.comments.filter((c) => !c.isDeleted)
}

/** Pushes, votes and reviewer changes arrive as threads of system comments. */
function isSystemThread(thread: AzureThread): boolean {
  if (threadType(thread) !== null) return true
  const comments = visibleComments(thread)
  return comments.length > 0 && comments.every((c) => c.commentType === 'system')
}

function toComment(comment: AzureComment): ThreadComment {
  return {
    authorLogin: azureLogin(comment.author),
    createdAt: comment.publishedDate,
    bodyText: comment.content ?? '',
  }
}

/** Only `active` and `pending` are still open; every other status is a way of closing a thread. */
function isOpen(status: string | undefined): boolean {
  return status === 'active' || status === 'pending'
}

function reviewState(vote: number): ReviewState {
  if (vote >= 5) return 'APPROVED'
  if (vote <= -5) return 'CHANGES_REQUESTED'
  return 'COMMENTED'
}

function votesFrom(threads: AzureThread[]): Review[] {
  return threads.flatMap((thread) => {
    if (threadType(thread) !== 'VoteUpdate') return []
    const vote = Number(property(thread, 'CodeReviewVoteResult'))
    const author = visibleComments(thread)[0]?.author
    if (author === undefined || !Number.isFinite(vote)) return []
    return [
      {
        authorLogin: azureLogin(author),
        state: reviewState(vote),
        submittedAt: thread.publishedDate,
        bodyText: '',
      },
    ]
  })
}

/**
 * When the user, or a team they watch, was last added as a reviewer.
 * Reviewers named when the pull request is opened leave no event behind, so a
 * reviewer with no event naming them was asked at creation.
 */
function computeReviewRequestedAt(pr: AzurePullRequest, threads: AzureThread[], me: AzureMe) {
  const ids = new Set([me.id, ...(me.teams ?? []).map((team) => team.id)])
  const isReviewer = (pr.reviewers ?? []).some((r) => ids.has(r.id))
  const added = threads.flatMap((thread) => {
    if (threadType(thread) !== 'ReviewersUpdate') return []
    const keys = property(thread, 'CodeReviewReviewersUpdatedAddedIdentity')
    if (keys === null) return []
    const identities = thread.identities ?? {}
    const named = keys.split(',').some((key) => ids.has(identities[key.trim()]?.id ?? ''))
    return named ? [thread.publishedDate] : []
  })
  const latest = added.sort(compareIso).at(-1)
  if (latest !== undefined) return latest
  return isReviewer ? pr.creationDate : null
}

function computeReviewDecision(reviewers: AzureReviewer[]): ReviewDecision {
  if (reviewers.some((r) => r.vote <= -5)) return 'CHANGES_REQUESTED'
  const required = reviewers.filter((r) => r.isRequired)
  const approved = reviewers.some((r) => r.vote >= 5)
  if (approved && required.every((r) => r.vote >= 5)) return 'APPROVED'
  return 'REVIEW_REQUIRED'
}

function mapMergeable(status: string | undefined): MergeableState {
  if (status === 'succeeded') return 'MERGEABLE'
  if (status === 'conflicts') return 'CONFLICTING'
  return 'UNKNOWN'
}

export function mapBuildStatus(evaluations: AzurePolicyEvaluation[] | null): CiStatus {
  if (evaluations === null) return 'none'
  const statuses = evaluations
    .filter((e) => e.configuration?.type?.id === BUILD_POLICY_TYPE_ID)
    .filter((e) => e.configuration?.isEnabled !== false)
    .map((e) => e.status)
  if (statuses.some((s) => s === 'rejected' || s === 'broken')) return 'failure'
  if (statuses.some((s) => s === 'queued' || s === 'running')) return 'pending'
  if (statuses.some((s) => s === 'approved')) return 'success'
  return 'none'
}

/**
 * On Azure DevOps a reviewer stays on the list after voting, unlike GitHub,
 * which clears them. So only a reviewer who hasn't voted yet — or whose vote
 * a push reset — is being asked for a review; one who has voted is merely
 * involved. A watched team's request counts only while the user isn't a
 * reviewer in their own right, whose vote then speaks for them.
 */
function computeBuckets(
  pr: AzurePullRequest,
  found: SearchBucket[],
  me: AzureMe,
  mentioned: boolean,
): SearchBucket[] {
  const buckets = new Set<SearchBucket>(found.filter((b) => b !== 'review-requested'))
  const pending = (r: AzureReviewer): boolean => r.vote === 0 && !r.hasDeclined
  const mine = (pr.reviewers ?? []).find((r) => r.id === me.id)
  const teamIds = new Set((me.teams ?? []).map((team) => team.id))
  const teams = (pr.reviewers ?? []).filter((r) => teamIds.has(r.id))
  if (mine !== undefined) {
    buckets.add(pending(mine) ? 'review-requested' : 'involves')
  } else if (teams.length > 0) {
    buckets.add(teams.some(pending) ? 'review-requested' : 'involves')
  }
  if (mentioned) buckets.add('mentions')
  return [...buckets]
}

function latest(dates: string[]): string {
  return dates.reduce((a, b) => (compareIso(a, b) >= 0 ? a : b))
}

export function mapAzurePullRequest(
  organization: string,
  pr: AzurePullRequest,
  details: AzurePullRequestDetails,
  found: SearchBucket[],
  me: AzureMe,
): PullRequest {
  const threads = details.threads.filter((t) => !t.isDeleted)
  const humanThreads = threads.filter((t) => !isSystemThread(t))

  const reviewThreads: ReviewThread[] = humanThreads
    .filter((t) => t.status !== undefined && t.status !== 'unknown')
    .map((t) => ({
      id: String(t.id),
      isResolved: !isOpen(t.status),
      comments: visibleComments(t).map(toComment),
    }))
  const conversationComments = humanThreads
    .filter((t) => t.status === undefined || t.status === 'unknown')
    .flatMap((t) => visibleComments(t).map(toComment))
    .sort((a, b) => compareIso(a.createdAt, b.createdAt))

  const openComments = humanThreads
    .filter((t) => isOpen(t.status) || t.status === undefined || t.status === 'unknown')
    .flatMap(visibleComments)
  const mentionsAt = [
    ...openComments
      .filter((c) => c.author.id !== me.id && mentionsIdentity(c.content ?? '', me.id))
      .map((c) => c.publishedDate),
    ...(pr.createdBy.id !== me.id && mentionsIdentity(pr.description ?? '', me.id)
      ? [pr.creationDate]
      : []),
  ].sort(compareIso)

  const pushes = details.iterations.map((i) => i.createdDate)
  const lastCommitPushedAt = pushes.length > 0 ? latest(pushes) : pr.creationDate
  const updatedAt = latest([
    pr.creationDate,
    lastCommitPushedAt,
    ...threads.map((t) => t.lastUpdatedDate ?? t.publishedDate),
  ])

  return {
    id: `${pr.repository.id}/${pr.pullRequestId}`,
    number: pr.pullRequestId,
    title: pr.title,
    url: azureWebUrl(organization, pr),
    repository: `${pr.repository.project.name}/${pr.repository.name}`,
    authorLogin: azureLogin(pr.createdBy),
    // Azure DevOps serves avatars only to an authenticated request, which an
    // <img> in the renderer can't make, so the card falls back to initials.
    authorAvatarUrl: '',
    createdAt: pr.creationDate,
    updatedAt,
    isDraft: pr.isDraft ?? false,
    additions: null,
    deletions: null,
    headRefName: stripRef(pr.sourceRefName),
    baseRefName: stripRef(pr.targetRefName),
    ciStatus: mapBuildStatus(details.policyEvaluations),
    lastCommitPushedAt,
    reviewDecision: computeReviewDecision(pr.reviewers ?? []),
    mergeable: mapMergeable(pr.mergeStatus),
    hasAutoMerge: pr.autoCompleteSetBy != null,
    reviews: votesFrom(threads).sort((a, b) => compareIso(a.submittedAt, b.submittedAt)),
    reviewThreads,
    conversationComments,
    reviewRequestedAt: computeReviewRequestedAt(pr, threads, me),
    readyForReviewAt: null,
    mentionsAt,
    buckets: computeBuckets(pr, found, me, mentionsAt.length > 0),
    teams: (me.teams ?? [])
      .filter((team) => (pr.reviewers ?? []).some((r) => r.id === team.id))
      .map((team) => team.name),
  }
}
