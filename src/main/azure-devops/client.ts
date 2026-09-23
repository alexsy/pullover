/**
 * Carries `status` and `response.headers` the way Octokit's errors do, so
 * `isAuthError`, `isTransientError` and `rateLimitResetAt` read it unchanged.
 */
export class AzureDevOpsError extends Error {
  readonly response: { headers: Record<string, string> }

  constructor(
    message: string,
    readonly status: number,
    headers: Record<string, string> = {},
  ) {
    super(message)
    this.name = 'AzureDevOpsError'
    this.response = { headers }
  }
}

/**
 * A request to `https://dev.azure.com/{organization}/{path}`, answering the
 * parsed JSON: a GET, or a POST of `body` where one is given — WIQL and the
 * work item batch are queries sent as POSTs, and read nothing.
 */
export type AzureDevOpsClient = (
  path: string,
  params?: Record<string, string>,
  apiVersion?: string | null,
  body?: unknown,
) => Promise<unknown>

export function createAzureDevOpsClient(
  organization: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): AzureDevOpsClient {
  const base = `https://dev.azure.com/${encodeURIComponent(organization)}/`
  const authorization = `Basic ${Buffer.from(`:${token}`).toString('base64')}`

  return async (path, params = {}, apiVersion = '7.1', body = undefined) => {
    const url = new URL(path, base)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    if (apiVersion !== null) url.searchParams.set('api-version', apiVersion)

    let response: Response
    try {
      response = await fetchImpl(url, {
        method: body === undefined ? 'GET' : 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          authorization,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          // Without it a rejected token is answered with a redirect to the
          // sign-in page instead of a 401.
          'x-tfs-fedauthredirect': 'Suppress',
        },
      })
    } catch (cause) {
      throw new AzureDevOpsError(`Couldn't reach Azure DevOps: ${String(cause)}`, 500)
    }

    const headers = Object.fromEntries(response.headers.entries())
    const isJson = (headers['content-type'] ?? '').includes('application/json')

    // A 203 with an HTML sign-in page is how Azure DevOps sometimes turns a
    // bad token away, even with the header above.
    if (response.status === 203 || (response.ok && !isJson)) {
      throw new AzureDevOpsError('Azure DevOps rejected the personal access token', 401, headers)
    }
    if (!response.ok) {
      const body = isJson ? ((await response.json()) as { message?: string }) : null
      const message = body?.message ?? `Azure DevOps answered HTTP ${response.status}`
      throw new AzureDevOpsError(message, response.status, headers)
    }
    return response.json()
  }
}
