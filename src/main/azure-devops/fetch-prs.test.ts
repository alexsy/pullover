import { describe, expect, it } from 'vitest'
import { isAuthError } from '../github/auth-error'
import { rateLimitResetAt } from '../github/rate-limit'
import { createAzureDevOpsSource } from '../source'

type Route = (url: URL) => Response | undefined

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

const IDENTITY = {
  authenticatedUser: {
    id: 'me-id',
    providerDisplayName: 'Vlad',
    properties: { Account: { $value: 'Vlad@Contoso.com' } },
  },
}

function azurePr(id: number, reviewers: Array<{ id: string; vote: number }> = []) {
  return {
    pullRequestId: id,
    title: `PR ${id}`,
    status: 'active',
    creationDate: '2026-08-01T10:00:00Z',
    createdBy: { id: 'alice-id', displayName: 'Alice', uniqueName: 'alice@contoso.com' },
    sourceRefName: 'refs/heads/feature',
    targetRefName: 'refs/heads/main',
    mergeStatus: 'succeeded',
    reviewers: reviewers.map((r) => ({ ...r, displayName: r.id, uniqueName: `${r.id}@x` })),
    repository: { id: 'repo-id', name: 'api', project: { id: 'proj-id', name: 'Web' } },
  }
}

function fakeFetch(routes: Route[]) {
  const seen: Array<{ url: URL; headers: Record<string, string>; body: unknown }> = []
  const impl = (async (input: URL, init?: RequestInit) => {
    const url = new URL(input)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    seen.push({ url, headers: init?.headers as Record<string, string>, body })
    for (const route of routes) {
      const response = route(url)
      if (response !== undefined) return response
    }
    return json({ value: [] })
  }) as typeof fetch
  return { impl, seen }
}

const identity: Route = (url) =>
  url.pathname.endsWith('/_apis/connectionData') ? json(IDENTITY) : undefined

describe('Azure DevOps source', () => {
  it('signs every request with the token and reads the login from the identity', async () => {
    const { impl, seen } = fakeFetch([identity])
    const source = createAzureDevOpsSource('contoso', 'secret', impl)

    await expect(source.fetchLogin()).resolves.toBe('vlad@contoso.com')
    expect(seen[0]?.url.origin + seen[0]?.url.pathname).toBe(
      'https://dev.azure.com/contoso/_apis/connectionData',
    )
    expect(seen[0]?.headers.authorization).toBe(`Basic ${btoa(':secret')}`)
  })

  it('finds pull requests to review and authored ones, each once', async () => {
    const reviewing = azurePr(1, [{ id: 'me-id', vote: 0 }])
    const { impl, seen } = fakeFetch([
      identity,
      (url) => {
        if (!url.pathname.endsWith('/_apis/git/pullrequests')) return undefined
        if (url.searchParams.get('searchCriteria.reviewerId') === 'me-id') {
          return json({ value: [reviewing] })
        }
        return json({ value: [reviewing, azurePr(2)] })
      },
    ])
    const source = createAzureDevOpsSource('contoso', 'secret', impl)

    const { prs } = await source.fetchPullRequests('vlad@contoso.com')
    expect(prs.map((p) => [p.number, p.buckets])).toEqual([
      [1, ['author', 'review-requested']],
      [2, ['author']],
    ])
    const search = seen.find((s) => s.url.pathname.endsWith('/git/pullrequests'))
    expect(search?.url.searchParams.get('searchCriteria.status')).toBe('active')
    expect(
      seen.some((s) =>
        s.url.pathname.endsWith('/proj-id/_apis/git/repositories/repo-id/pullRequests/1/threads'),
      ),
    ).toBe(true)
  })

  it('searches project by project where the organization-wide route is missing', async () => {
    const { impl } = fakeFetch([
      identity,
      (url) =>
        url.pathname === '/contoso/_apis/git/pullrequests'
          ? json({ message: 'nope' }, 404)
          : undefined,
      (url) =>
        url.pathname === '/contoso/_apis/projects' ? json({ value: [{ id: 'p1' }] }) : undefined,
      (url) =>
        url.pathname === '/contoso/p1/_apis/git/pullrequests'
          ? json({ value: [azurePr(7, [{ id: 'me-id', vote: 0 }])] })
          : undefined,
    ])
    const source = createAzureDevOpsSource('contoso', 'secret', impl)

    const { prs } = await source.fetchPullRequests('vlad@contoso.com')
    expect(prs.map((p) => p.number)).toEqual([7])
  })

  it('still lists a pull request whose build policies it may not read', async () => {
    const { impl } = fakeFetch([
      identity,
      (url) =>
        url.pathname.endsWith('/_apis/git/pullrequests')
          ? json({ value: [azurePr(1, [{ id: 'me-id', vote: 0 }])] })
          : undefined,
      (url) =>
        url.pathname.endsWith('/_apis/policy/evaluations')
          ? json({ message: 'no' }, 403)
          : undefined,
    ])
    const source = createAzureDevOpsSource('contoso', 'secret', impl)

    const { prs } = await source.fetchPullRequests('vlad@contoso.com')
    expect(prs[0]?.ciStatus).toBe('none')
  })

  it('reports a rejected token as an auth error, whether a 401 or a sign-in page', async () => {
    const unauthorized = createAzureDevOpsSource(
      'contoso',
      'x',
      fakeFetch([() => json({}, 401)]).impl,
    )
    await expect(unauthorized.fetchLogin()).rejects.toSatisfy(isAuthError)

    const page = new Response('<html>Sign in</html>', {
      status: 203,
      headers: { 'content-type': 'text/html' },
    })
    const signInPage = createAzureDevOpsSource('contoso', 'x', fakeFetch([() => page]).impl)
    await expect(signInPage.fetchLogin()).rejects.toSatisfy(isAuthError)
  })

  it('reports throttling so the inbox waits it out', async () => {
    const throttled = fakeFetch([
      () => json({ message: 'slow down' }, 429, { 'retry-after': '30' }),
    ])
    const source = createAzureDevOpsSource('contoso', 'x', throttled.impl)

    const error = await source.fetchLogin().catch((e: unknown) => e)
    expect(rateLimitResetAt(error, '2026-08-10T12:00:00.000Z')).toBe('2026-08-10T12:00:30.000Z')
  })
})

describe('Azure DevOps source with watched teams', () => {
  const teams: Route = (url) =>
    url.pathname === '/contoso/_apis/teams'
      ? json({ value: [{ id: 'team-id', name: 'MinSide Dev Team', projectName: 'Web' }] })
      : undefined

  it("finds pull requests assigned to a team by the team's name", async () => {
    const { impl, seen } = fakeFetch([
      identity,
      teams,
      (url) =>
        url.searchParams.get('searchCriteria.reviewerId') === 'team-id'
          ? json({ value: [azurePr(5, [{ id: 'team-id', vote: 0 }])] })
          : undefined,
    ])
    const source = createAzureDevOpsSource('contoso', 'x', impl, () => ['minside dev team'])

    const { prs, warning } = await source.fetchPullRequests('vlad@contoso.com')
    expect(prs.map((p) => [p.number, p.teams])).toEqual([[5, ['MinSide Dev Team']]])
    expect(prs[0]?.buckets).toContain('review-requested')
    expect(warning).toBeNull()
    expect(seen.some((s) => s.url.pathname === '/contoso/_apis/teams')).toBe(true)
  })

  it('names a team it cannot find, and still fetches the rest', async () => {
    const { impl } = fakeFetch([identity, teams])
    const source = createAzureDevOpsSource('contoso', 'x', impl, () => ['Nobody'])

    const { warning } = await source.fetchPullRequests('vlad@contoso.com')
    expect(warning).toBe('No team named "Nobody"')
  })

  it("warns rather than signing out when the token can't read teams", async () => {
    const { impl } = fakeFetch([
      identity,
      (url) => (url.pathname === '/contoso/_apis/teams' ? json({}, 401) : undefined),
    ])
    const source = createAzureDevOpsSource('contoso', 'x', impl, () => ['MinSide Dev Team'])

    const { warning } = await source.fetchPullRequests('vlad@contoso.com')
    expect(warning).toMatch(/Project and Team/)
  })
})

describe('Azure DevOps work items', () => {
  it('links the work items of a pull request, with their titles', async () => {
    const { impl } = fakeFetch([
      identity,
      (url) =>
        url.pathname.endsWith('/_apis/git/pullrequests')
          ? json({ value: [azurePr(1, [{ id: 'me-id', vote: 0 }])] })
          : undefined,
      (url) =>
        url.pathname.endsWith('/pullRequests/1/workitems')
          ? json({ value: [{ id: '151699', url: 'api' }] })
          : undefined,
      (url) =>
        url.pathname.endsWith('/_apis/wit/workitemsbatch')
          ? json({ value: [{ id: 151699, fields: { 'System.Title': 'Bump to net10' } }] })
          : undefined,
    ])
    const source = createAzureDevOpsSource('contoso', 'x', impl)

    const { prs } = await source.fetchPullRequests('vlad@contoso.com')
    expect(prs[0]?.workItems).toEqual([
      {
        id: 151699,
        title: 'Bump to net10',
        url: 'https://dev.azure.com/contoso/_workitems/edit/151699',
      },
    ])
  })

  it('still links them when the token cannot read work items', async () => {
    const { impl } = fakeFetch([
      identity,
      (url) =>
        url.pathname.endsWith('/_apis/git/pullrequests')
          ? json({ value: [azurePr(1, [{ id: 'me-id', vote: 0 }])] })
          : undefined,
      (url) =>
        url.pathname.endsWith('/pullRequests/1/workitems')
          ? json({ value: [{ id: '7' }] })
          : undefined,
      (url) => (url.pathname.endsWith('/_apis/wit/workitemsbatch') ? json({}, 401) : undefined),
    ])
    const source = createAzureDevOpsSource('contoso', 'x', impl)

    const { prs } = await source.fetchPullRequests('vlad@contoso.com')
    expect(prs[0]?.workItems.map((w) => [w.id, w.title])).toEqual([[7, null]])
  })

  it('lists the open work items assigned to me, in the order the query gives', async () => {
    const { impl, seen } = fakeFetch([
      (url) =>
        url.pathname.endsWith('/_apis/wit/wiql')
          ? json({ workItems: [{ id: 2 }, { id: 1 }] })
          : undefined,
      (url) =>
        url.pathname.endsWith('/_apis/wit/workitemsbatch')
          ? json({
              value: [
                {
                  id: 1,
                  fields: {
                    'System.Title': 'Footer fix',
                    'System.WorkItemType': 'Bug',
                    'System.State': 'Active',
                    'System.TeamProject': 'Utvikling',
                    'Microsoft.VSTS.TCM.ReproSteps': '<div>Open <b>Min side</b></div>',
                  },
                },
                {
                  id: 2,
                  fields: {
                    'System.Title': 'Net10 upgrade',
                    'System.WorkItemType': 'User Story',
                    'System.State': 'New',
                    'System.TeamProject': 'Utvikling',
                    'System.Description': '<p>Upgrade</p>',
                  },
                },
              ],
            })
          : undefined,
    ])
    const source = createAzureDevOpsSource('contoso', 'x', impl)

    const items = await source.fetchWorkItems?.()
    expect(items).toEqual([
      {
        id: 2,
        title: 'Net10 upgrade',
        type: 'User Story',
        state: 'New',
        project: 'Utvikling',
        url: 'https://dev.azure.com/contoso/_workitems/edit/2',
        description: 'Upgrade',
      },
      {
        id: 1,
        title: 'Footer fix',
        type: 'Bug',
        state: 'Active',
        project: 'Utvikling',
        url: 'https://dev.azure.com/contoso/_workitems/edit/1',
        description: 'Open Min side',
      },
    ])
    const query = seen.find((s) => s.url.pathname.endsWith('/wiql'))?.body as { query: string }
    expect(query.query).toMatch(/\[System.AssignedTo\] = @Me/)
  })
})

describe('Azure DevOps paging', () => {
  it('keeps asking past the first page of 200', async () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => azurePr(from + i))
    const { impl, seen } = fakeFetch([
      identity,
      (url) => {
        if (!url.pathname.endsWith('/_apis/git/pullrequests')) return undefined
        if (url.searchParams.get('searchCriteria.creatorId') !== 'me-id') return json({ value: [] })
        const skip = Number(url.searchParams.get('$skip'))
        return json({ value: skip === 0 ? page(1, 200) : page(201, 3) })
      },
    ])
    const source = createAzureDevOpsSource('contoso', 'x', impl)

    const { prs } = await source.fetchPullRequests('vlad@contoso.com')
    expect(prs).toHaveLength(203)
    const authored = seen.filter((s) => s.url.searchParams.get('searchCriteria.creatorId'))
    expect(authored.map((s) => s.url.searchParams.get('$skip'))).toEqual(['0', '200'])
  })
})
