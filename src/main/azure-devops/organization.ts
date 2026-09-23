const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * The organization name out of whatever the user pasted: the bare name, a
 * `dev.azure.com/{organization}` URL, or an older
 * `{organization}.visualstudio.com` one.
 */
export function parseOrganization(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  let name = trimmed
  if (trimmed.includes('.') || trimmed.includes('/')) {
    try {
      const url = new URL(withScheme)
      const host = url.hostname.toLowerCase()
      if (host === 'dev.azure.com') name = url.pathname.split('/')[1] ?? ''
      else if (host.endsWith('.visualstudio.com')) name = host.slice(0, -'.visualstudio.com'.length)
    } catch {}
  }

  name = decodeURIComponent(name)
  if (!NAME.test(name)) {
    throw new Error('Enter your organization, like "contoso" or https://dev.azure.com/contoso')
  }
  return name
}
