import {
  type AzureIteration,
  type AzureMe,
  type AzurePolicyEvaluation,
  type AzurePullRequest,
  type AzureTeam,
  type AzureThread,
  azureLogin,
  mapAzurePullRequest,
} from '@core/map-azure-pr'
import { htmlToText } from '@core/work-items'
import type { PullRequest, SearchBucket, WorkItem, WorkItemRef } from '@shared/types'
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
/** Pull requests asked for per request, and the most any one search collects. */
const PAGE_SIZE = 200
const MAX_PULL_REQUESTS = 1000

/** Every page of one search, until a page comes back short or the cap is reached. */
async function allPages(
  client: AzureDevOpsClient,
  path: string,
  params: Record<string, string>,
): Promise<AzurePullRequest[]> {
  const found: AzurePullRequest[] = []
  for (let skip = 0; skip < MAX_PULL_REQUESTS; skip += PAGE_SIZE) {
    const page = (await client(path, {
      ...params,
      $top: String(PAGE_SIZE),
      $skip: String(skip),
    })) as ListResponse<AzurePullRequest>
    found.push(...page.value)
    if (page.value.length < PAGE_SIZE) break
  }
  return found
}

async function searchPullRequests(
  client: AzureDevOpsClient,
  criteria: Record<string, string>,
): Promise<AzurePullRequest[]> {
  const params = { 'searchCriteria.status': 'active', ...criteria }
  try {
    return await allPages(client, '_apis/git/pullrequests', params)
  } catch (error) {
    if (!(error instanceof AzureDevOpsError) || error.status !== 404) throw error
  }
  const projects = await listProjectIds(client)
  const perProject = await Promise.all(
    projects.map((project) =>
      allPages(client, `${encodeURIComponent(project)}/_apis/git/pullrequests`, params),
    ),
  )
  return perProject.flat()
}

interface TeamListing {
  id: string
  name: string
  projectName?: string
}

/**
 * The watched team names as identities. A team is written as its name, or as
 * `Project\Team` where two projects have a team by the same name.
 */
async function resolveTeams(
  client: AzureDevOpsClient,
  names: string[],
): Promise<{ teams: AzureTeam[]; warning: string | null }> {
  if (names.length === 0) return { teams: [], warning: null }
  let listing: TeamListing[]
  try {
    const data = (await client(
      '_apis/teams',
      { $top: '1000' },
      '7.1-preview.3',
    )) as ListResponse<TeamListing>
    listing = data.value
  } catch {
    // Not rethrown even as a 401: that is also how a token lacking the
    // Project and Team scope is refused, and it mustn't sign the user out.
    return {
      teams: [],
      warning: "Couldn't look up teams — the token needs the Project and Team (Read) scope",
    }
  }

  const teams: AzureTeam[] = []
  const missing: string[] = []
  for (const name of names) {
    const wanted = name.toLowerCase()
    const matches = listing.filter(
      (t) =>
        t.name.toLowerCase() === wanted || `${t.projectName}\\${t.name}`.toLowerCase() === wanted,
    )
    if (matches.length === 0) missing.push(name)
    teams.push(...matches.map((t) => ({ id: t.id, name: t.name })))
  }
  const warning =
    missing.length === 0 ? null : `No team named ${missing.map((n) => `"${n}"`).join(', ')}`
  return { teams, warning }
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

  const [threads, iterations, policyEvaluations, workItemIds] = await Promise.all([
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
    (client(`${base}/workitems`) as Promise<ListResponse<{ id: string | number }>>).then(
      (data) => data.value.map((ref) => Number(ref.id)).filter(Number.isFinite),
      (error: unknown) => {
        if (isAuthError(error)) throw error
        return []
      },
    ),
  ])
  return { threads: threads.value, iterations: iterations.value, policyEvaluations, workItemIds }
}

interface WorkItemFields {
  id: number
  fields: Record<string, string | undefined>
}

/** The work item batch endpoint takes at most 200 ids a request. */
const WORK_ITEM_BATCH = 200

async function fetchWorkItemFields(
  client: AzureDevOpsClient,
  ids: number[],
  fields: string[],
): Promise<WorkItemFields[]> {
  const batches: number[][] = []
  for (let i = 0; i < ids.length; i += WORK_ITEM_BATCH)
    batches.push(ids.slice(i, i + WORK_ITEM_BATCH))
  const results = await Promise.all(
    batches.map(
      (batch) =>
        client('_apis/wit/workitemsbatch', {}, '7.1', { ids: batch, fields }) as Promise<
          ListResponse<WorkItemFields>
        >,
    ),
  )
  return results.flatMap((data) => data.value)
}

export function workItemUrl(organization: string, id: number): string {
  return `https://dev.azure.com/${encodeURIComponent(organization)}/_workitems/edit/${id}`
}

/**
 * Titles for the linked work items, or none at all when the token can't read
 * work items — the links still work without them.
 */
async function titlesFor(client: AzureDevOpsClient, ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map()
  try {
    const items = await fetchWorkItemFields(client, ids, ['System.Title'])
    return new Map(items.map((item) => [item.id, item.fields['System.Title'] ?? '']))
  } catch {
    return new Map()
  }
}

/** Open work items assigned to the user, most recently changed first. */
export async function fetchAssignedWorkItems(
  client: AzureDevOpsClient,
  organization: string,
): Promise<WorkItem[]> {
  const query = `SELECT [System.Id] FROM WorkItems
    WHERE [System.AssignedTo] = @Me
    AND [System.State] NOT IN ('Closed', 'Done', 'Removed', 'Resolved', 'Completed', 'Cut')
    ORDER BY [System.ChangedDate] DESC`
  const found = (await client('_apis/wit/wiql', { $top: '100' }, '7.1', { query })) as {
    workItems: Array<{ id: number }>
  }
  const ids = found.workItems.map((item) => item.id)
  if (ids.length === 0) return []

  const items = await fetchWorkItemFields(client, ids, [
    'System.Title',
    'System.WorkItemType',
    'System.State',
    'System.TeamProject',
    'System.Description',
    'Microsoft.VSTS.TCM.ReproSteps',
  ])
  const byId = new Map(items.map((item) => [item.id, item.fields]))
  return ids.flatMap((id) => {
    const fields = byId.get(id)
    if (fields === undefined) return []
    return [
      {
        id,
        title: fields['System.Title'] ?? '',
        type: fields['System.WorkItemType'] ?? '',
        state: fields['System.State'] ?? '',
        project: fields['System.TeamProject'] ?? '',
        url: workItemUrl(organization, id),
        // A bug keeps its story in Repro Steps and often leaves Description empty.
        description: htmlToText(
          fields['System.Description'] || fields['Microsoft.VSTS.TCM.ReproSteps'] || '',
        ),
      },
    ]
  })
}

export async function fetchAzurePullRequests(
  client: AzureDevOpsClient,
  organization: string,
  identity: AzureMe,
  teamNames: string[] = [],
): Promise<FetchedPullRequests> {
  const { teams, warning } = await resolveTeams(client, teamNames)
  const me: AzureMe = { ...identity, teams }
  const reviewerIds = [me.id, ...teams.map((team) => team.id)]
  const [reviewing, authored] = await Promise.all([
    Promise.all(
      reviewerIds.map((id) => searchPullRequests(client, { 'searchCriteria.reviewerId': id })),
    ).then((lists) => lists.flat()),
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

  const entries = [...found.values()]
  const details = await mapLimited(entries, DETAIL_CONCURRENCY, (e) => fetchDetails(client, e.pr))
  const titles = await titlesFor(client, [...new Set(details.flatMap((d) => d.workItemIds))])
  const prs: PullRequest[] = entries.map((e, index) => {
    const detail = details[index] as (typeof details)[number]
    const workItems: WorkItemRef[] = detail.workItemIds.map((id) => ({
      id,
      title: titles.get(id) ?? null,
      url: workItemUrl(organization, id),
    }))
    return mapAzurePullRequest(organization, e.pr, { ...detail, workItems }, [...e.buckets], me)
  })
  return { prs, restrictedOrgs: [], warning }
}
