import {
  type AzureIteration,
  type AzureMe,
  type AzurePolicyEvaluation,
  type AzurePullRequest,
  type AzureThread,
  azureLogin,
  mapAzurePullRequest,
} from '@core/map-azure-pr'
import type { PullRequest, SearchBucket } from '@shared/types'
import { isAuthError } from '../github/auth-error'
import type { FetchedPullRequests } from '../github/fetch-prs'
import { type AzureDevOpsClient, AzureDevOpsError } from './client'

/** Pull requests fetched in detail at once; each costs three requests. */
const DETAIL_CONCURRENCY = 6

interface ListResponse<T> {
  value: T[]
}

interface ConnectionData {
  authenticatedUser: {
    id: string
    providerDisplayName?: string
    properties?: { Account?: { $value?: string } }
  }
}

export async function fetchAzureIdentity(client: AzureDevOpsClient): Promise<AzureMe> {
  const data = (await client('_apis/connectionData', {}, null)) as ConnectionData
  const user = data.authenticatedUser
  return {
    id: user.id,
    login: azureLogin({
      id: user.id,
      displayName: user.providerDisplayName ?? user.id,
      uniqueName: user.properties?.Account?.$value,
    }),
  }
}

async function listProjectIds(client: AzureDevOpsClient): Promise<string[]> {
  const data = (await client('_apis/projects', { $top: '500' })) as ListResponse<{ id: string }>
  return data.value.map((project) => project.id)
}

/**
 * Active pull requests across the organization matching `criteria`. The
 * organization-wide route is one request; should a server not offer it, the
 * same search runs project by project.
 */
async function searchPullRequests(
  client: AzureDevOpsClient,
  criteria: Record<string, string>,
): Promise<AzurePullRequest[]> {
  const params = { 'searchCriteria.status': 'active', $top: '200', ...criteria }
  try {
    const data = (await client('_apis/git/pullrequests', params)) as ListResponse<AzurePullRequest>
    return data.value
  } catch (error) {
    if (!(error instanceof AzureDevOpsError) || error.status !== 404) throw error
  }
  const projects = await listProjectIds(client)
  const perProject = await Promise.all(
    projects.map(async (project) => {
      const path = `${encodeURIComponent(project)}/_apis/git/pullrequests`
      const data = (await client(path, params)) as ListResponse<AzurePullRequest>
      return data.value
    }),
  )
  return perProject.flat()
}

async function mapLimited<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await map(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function fetchDetails(client: AzureDevOpsClient, pr: AzurePullRequest) {
  const project = encodeURIComponent(pr.repository.project.id)
  const base = `${project}/_apis/git/repositories/${pr.repository.id}/pullRequests/${pr.pullRequestId}`
  const artifactId = `vstfs:///CodeReview/CodeReviewId/${pr.repository.project.id}/${pr.pullRequestId}`

  const [threads, iterations, policyEvaluations] = await Promise.all([
    client(`${base}/threads`) as Promise<ListResponse<AzureThread>>,
    client(`${base}/iterations`) as Promise<ListResponse<AzureIteration>>,
    // Build status is a nicety: a token without policy access still gets its
    // inbox, just without the CI chip.
    (
      client(`${project}/_apis/policy/evaluations`, { artifactId }, '7.1-preview.1') as Promise<
        ListResponse<AzurePolicyEvaluation>
      >
    ).then(
      (data) => data.value,
      (error: unknown) => {
        if (isAuthError(error)) throw error
        return null
      },
    ),
  ])
  return { threads: threads.value, iterations: iterations.value, policyEvaluations }
}

export async function fetchAzurePullRequests(
  client: AzureDevOpsClient,
  organization: string,
  me: AzureMe,
): Promise<FetchedPullRequests> {
  const [reviewing, authored] = await Promise.all([
    searchPullRequests(client, { 'searchCriteria.reviewerId': me.id }),
    searchPullRequests(client, { 'searchCriteria.creatorId': me.id }),
  ])

  const found = new Map<string, { pr: AzurePullRequest; buckets: Set<SearchBucket> }>()
  const collect = (prs: AzurePullRequest[], bucket: SearchBucket): void => {
    for (const pr of prs) {
      const key = `${pr.repository.id}/${pr.pullRequestId}`
      const entry = found.get(key) ?? { pr, buckets: new Set<SearchBucket>() }
      entry.buckets.add(bucket)
      found.set(key, entry)
    }
  }
  collect(reviewing, 'review-requested')
  collect(authored, 'author')

  const prs: PullRequest[] = await mapLimited([...found.values()], DETAIL_CONCURRENCY, async (e) =>
    mapAzurePullRequest(organization, e.pr, await fetchDetails(client, e.pr), [...e.buckets], me),
  )
  return { prs, restrictedOrgs: [] }
}
