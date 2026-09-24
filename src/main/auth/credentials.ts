export type Credentials =
  | { provider: 'github'; token: string }
  | { provider: 'azure-devops'; organization: string; token: string }

export function encodeCredentials(credentials: Credentials): string {
  // A GitHub token stays a bare string, which is how every release before
  // Azure DevOps support saved it.
  return credentials.provider === 'github' ? credentials.token : JSON.stringify(credentials)
}

export function decodeCredentials(stored: string): Credentials | null {
  if (!stored.startsWith('{')) return stored === '' ? null : { provider: 'github', token: stored }
  try {
    const parsed = JSON.parse(stored) as Partial<Record<string, unknown>>
    if (
      parsed.provider === 'azure-devops' &&
      typeof parsed.organization === 'string' &&
      typeof parsed.token === 'string'
    ) {
      return { provider: 'azure-devops', organization: parsed.organization, token: parsed.token }
    }
  } catch {}
  return null
}
