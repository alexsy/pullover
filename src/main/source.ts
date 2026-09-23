import type { AzureMe } from '@core/map-azure-pr'
import { createAzureDevOpsClient } from './azure-devops/client'
import { fetchAzureIdentity, fetchAzurePullRequests } from './azure-devops/fetch-prs'
import type { FetchedPullRequests } from './github/fetch-prs'
import { createGraphQLClient, fetchPullRequests, fetchViewerLogin } from './github/fetch-prs'

/** Where the pull requests come from. `Inbox` only ever talks to one of these. */
export interface PullRequestSource {
  /** How the interface names the site, as in "Open on GitHub". */
  siteName: string
  fetchLogin: () => Promise<string>
  fetchPullRequests: (myLogin: string) => Promise<FetchedPullRequests>
}

export function createGitHubSource(token: string): PullRequestSource {
  const client = createGraphQLClient(token)
  return {
    siteName: 'GitHub',
    fetchLogin: () => fetchViewerLogin(client),
    fetchPullRequests: (myLogin) => fetchPullRequests(client, myLogin),
  }
}

export function createAzureDevOpsSource(
  organization: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): PullRequestSource {
  const client = createAzureDevOpsClient(organization, token, fetchImpl)
  let me: AzureMe | null = null
  const identity = async (): Promise<AzureMe> => {
    me ??= await fetchAzureIdentity(client)
    return me
  }
  return {
    siteName: 'Azure DevOps',
    fetchLogin: async () => (await identity()).login,
    fetchPullRequests: async () => fetchAzurePullRequests(client, organization, await identity()),
  }
}
