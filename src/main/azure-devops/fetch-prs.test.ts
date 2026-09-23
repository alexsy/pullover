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
  const seen: Array<{ url: URL; headers: Record<string, string> }> = []
  const impl = (async (input: URL, init?: RequestInit) => {
    const url = new URL(input)
    seen.push({ url, headers: init?.headers as Record<string, string> })
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
