import { classify, classifyAll, countAttention } from '@core/classify'
import { formatWait } from '@core/format'
import { collectRepositories, filterByRepositories } from '@core/repo-filter'
import { computeStackPositions } from '@core/stack'
import type { InboxSnapshot } from '@shared/ipc'
import type { ClassifiedPullRequest, PullRequest } from '@shared/types'
import { isAuthError } from './github/auth-error'
import { describeError, httpStatus } from './github/error-message'
import type { FetchedPullRequests } from './github/fetch-prs'
import { formatRestrictedOrgs } from './github/org-restriction'
import { rateLimitResetAt } from './github/rate-limit'
import type { PullRequestSource } from './source'
import type { AppStore } from './store'

export interface InboxDeps {
  store: AppStore
  /** Returns null while the user is signed out. */
  getClient: () => PullRequestSource | null
  onChange: (snapshot: InboxSnapshot) => void
  /**
   * Called from the refresh catch block when the failure looks like a dead
   * token (see `isAuthError`) rather than a network blip. `Inbox` never
   * touches token storage itself — it only knows `getClient` — so it hands
   * the decision of what "sign out" means back to the caller.
   */
  onAuthError?: () => void
  now?: () => string
  fetchPrs?: (source: PullRequestSource, myLogin: string) => Promise<FetchedPullRequests>
  fetchLogin?: (source: PullRequestSource) => Promise<string>
}

export class Inbox {
  private snapshot: InboxSnapshot = {
    status: 'signed-out',
    items: [],
    attentionCount: 0,
    lastUpdatedAt: null,
    errorMessage: null,
    myLogin: null,
    knownRepositories: [],
    siteName: null,
    workItems: null,
  }

  private prs: PullRequest[] = []
  private myLogin: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  /** The pass currently running, if any. */
  private inFlightRefresh: Promise<void> | null = null
  /**
   * At most one extra pass queued to run once the in-flight one finishes.
   * Every caller that arrives while a pass is running shares this single
   * follow-up promise, so N overlapping callers produce one extra pass, not
   * N of them.
   */
  private queuedRefresh: Promise<void> | null = null
  /** When a hit rate limit lifts. Refreshes are skipped until then. */
  private rateLimitedUntil: string | null = null
  private readonly now: () => string
  private readonly fetchPrs: NonNullable<InboxDeps['fetchPrs']>
  private readonly fetchLogin: NonNullable<InboxDeps['fetchLogin']>

  constructor(private readonly deps: InboxDeps) {
    this.now = deps.now ?? (() => new Date().toISOString())
    this.fetchPrs = deps.fetchPrs ?? ((source, myLogin) => source.fetchPullRequests(myLogin))
    this.fetchLogin = deps.fetchLogin ?? ((source) => source.fetchLogin())
  }

  getSnapshot(): InboxSnapshot {
    return this.snapshot
  }

  private emit(patch: Partial<InboxSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.deps.onChange(this.snapshot)
  }

  /**
   * Attaches each item's stack position, computed from `this.prs` — the
   * unfiltered fetch — so a stack stays whole even when the repository
   * filter hides part of it. Shared by `doRefresh` and `reclassify`, the two
   * places that produce items, so the step isn't duplicated between them.
   */
  private attachStacks(items: Omit<ClassifiedPullRequest, 'stack'>[]): ClassifiedPullRequest[] {
    const stacks = computeStackPositions(this.prs)
    return items.map((item) => ({ ...item, stack: stacks.get(item.pr.id) ?? null }))
  }

  /**
   * Re-runs the classifier over PRs already in memory. No network. This is
   * also how a changed repository selection takes effect: `this.prs` always
   * holds the unfiltered fetch, and narrowing happens here, so ticking a
   * checkbox updates the inbox instantly instead of waiting on a refetch.
   */
  reclassify(): void {
    if (this.myLogin === null) return
    const settings = this.deps.store.getSettings()
    const filtered = filterByRepositories(
      this.prs,
      settings.watchAllRepositories ? null : settings.repositories,
    )
    const items = this.attachStacks(
      classifyAll(filtered, {
        myLogin: this.myLogin,
        snoozes: this.deps.store.getSnoozes(),
        now: this.now(),
        order: settings.sortOrder,
      }),
    )
    this.emit({
      items,
      attentionCount: countAttention(items),
    })
  }

  /**
   * Looks in the unfiltered fetch, not in the snapshot: a caller naming a
   * pull request by number should get an answer even when the repository
   * filter or the classifier keeps it out of the window.
   */
  findPullRequest(repository: string, number: number): ClassifiedPullRequest | null {
    if (this.myLogin === null) return null
    const wanted = repository.toLowerCase()
    const pr = this.prs.find((p) => p.number === number && p.repository.toLowerCase() === wanted)
    if (pr === undefined) return null
    const [item] = this.attachStacks([
      classify(pr, {
        myLogin: this.myLogin,
        snoozes: this.deps.store.getSnoozes(),
        now: this.now(),
      }),
    ])
    return item ?? null
  }

  /**
   * Runs exactly one pass at a time. A caller that arrives while a pass is
   * already running does NOT join it — that pass may have already read
   * state (settings, the signed-in client) that predates this caller's
   * change, which is exactly how a caller that mutates state and then
   * awaits refresh() (signOut, addRepository, removeRepository) used to see
   * its change silently dropped. Instead, such a caller is queued behind a
   * single follow-up pass that starts only after the current one finishes,
   * so its returned promise always resolves after a pass that began after
   * the call was made. Multiple callers arriving during the same pass share
   * one follow-up (see queuedRefresh).
   */
  async refresh(): Promise<void> {
    if (this.inFlightRefresh === null) {
      this.inFlightRefresh = this.runPass()
      return this.inFlightRefresh
    }

    this.queuedRefresh ??= this.inFlightRefresh
      // A failed pass must not strand the callers queued behind it — still
      // run the follow-up pass they asked for.
      .catch(() => undefined)
      .then(() => this.startQueuedPass())

    return this.queuedRefresh
  }

  /**
   * Resolves when the pass now running has finished, or at once when none
   * is. Never rejects: a failed pass still ends in a snapshot, which is what
   * a caller waiting for one is after.
   */
  whenIdle(): Promise<void> {
    // The queued pass when there is one: it resolves after the pass running
    // now *and* the follow-up behind it, which is what "idle" has to mean.
    const pass = this.queuedRefresh ?? this.inFlightRefresh
    return pass?.catch(() => undefined) ?? Promise.resolve()
  }

  private startQueuedPass(): Promise<void> {
    this.queuedRefresh = null
    this.inFlightRefresh = this.runPass()
    return this.inFlightRefresh
  }

  private async runPass(): Promise<void> {
    try {
      await this.doRefresh()
    } finally {
      this.inFlightRefresh = null
    }
  }

  private async doRefresh(): Promise<void> {
    const client = this.deps.getClient()
    if (client === null) {
      // Sign-out: drop the cached identity and in-memory PRs so a
      // subsequent sign-in (possibly as a different account) starts clean
      // instead of classifying against the previous user's login.
      this.myLogin = null
      this.prs = []
      this.rateLimitedUntil = null
      this.emit({
        status: 'signed-out',
        items: [],
        attentionCount: 0,
        lastUpdatedAt: null,
        errorMessage: null,
        myLogin: null,
        knownRepositories: [],
        siteName: null,
        workItems: null,
      })
      return
    }

    // Returns before the `loading` emit below, or a manual refresh would
    // strand the interface in a spinner. The snapshot is left alone: its
    // message already says why nothing is happening. Parsed, not compared as
    // strings — the two ISO values need not share precision.
    if (
      this.rateLimitedUntil !== null &&
      Date.parse(this.rateLimitedUntil) > Date.parse(this.now())
    ) {
      return
    }

    this.emit({ status: 'loading', errorMessage: null })

    try {
      this.myLogin ??= await this.fetchLogin(client)
      const myLogin = this.myLogin
      // Always fetch unfiltered: the picker's options come from what shows
      // up in the inbox, so the search itself must never be narrowed by the
      // repository selection.
      // Alongside the pull requests, and never able to fail them: a token
      // without the Work Items scope still gets its inbox.
      const workItemsPass = client.fetchWorkItems?.().then(
        (items) => ({ items, warning: null }),
        (error: unknown) => ({
          items: [],
          // A refused token is almost always one without the scope; anything
          // else is an outage or a bad answer, and a new token won't help.
          warning:
            isAuthError(error) || httpStatus(error) === 403
              ? "Couldn't read work items — the token needs the Work Items (Read) scope"
              : `Couldn't read work items: ${describeError(error)}`,
        }),
      )
      const { prs, restrictedOrgs, warning } = await this.fetchPrs(client, myLogin)
      const workItems = workItemsPass === undefined ? null : await workItemsPass
      this.prs = prs

      const settings = this.deps.store.getSettings()
      const filtered = filterByRepositories(
        this.prs,
        settings.watchAllRepositories ? null : settings.repositories,
      )

      const now = this.now()
      const items = this.attachStacks(
        classifyAll(filtered, {
          myLogin: this.myLogin,
          snoozes: this.deps.store.getSnoozes(),
          now,
          order: settings.sortOrder,
        }),
      )

      this.rateLimitedUntil = null
      this.emit({
        status: 'ready',
        items,
        attentionCount: countAttention(items),
        lastUpdatedAt: now,
        errorMessage:
          [warning ?? formatRestrictedOrgs(restrictedOrgs), workItems?.warning]
            .filter((notice) => notice != null)
            .join(' · ') || null,
        myLogin: this.myLogin,
        knownRepositories: collectRepositories(this.prs),
        siteName: client.siteName,
        workItems: workItems?.items ?? null,
      })
    } catch (error) {
      const resetAt = rateLimitResetAt(error, this.now())
      this.rateLimitedUntil = resetAt
      // Keep the last good list on screen; the header shows the staleness.
      this.emit({
        status: 'error',
        errorMessage:
          resetAt === null
            ? describeError(error)
            : `${client.siteName}'s rate limit is reached — try again in ${formatWait(resetAt, this.now())}`,
      })
      // A dead token fails every refresh the same way forever, so recognise
      // it specifically and hand off to whatever "sign out" means to the
      // caller instead of leaving the user staring at a permanently stale
      // list with a red line in the header.
      if (isAuthError(error)) this.deps.onAuthError?.()
    }
  }

  start(): void {
    this.stop()
    const minutes = this.deps.store.getSettings().pollIntervalMinutes
    this.timer = setInterval(() => void this.refresh(), minutes * 60_000)
    void this.refresh()
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
