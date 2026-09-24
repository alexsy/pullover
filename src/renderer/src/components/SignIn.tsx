import type { DeviceCodePayload } from '@shared/ipc'
import { LogIn } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Link, Text, TextField, View } from 'reshaped/bundle'

type Site = 'github' | 'azure-devops'

const PAT_HELP_URL =
  'https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate'

export default function SignIn({ initialSite = 'github' }: { initialSite?: Site }) {
  const [site, setSite] = useState<Site>(initialSite)
  const [gitHubAvailable, setGitHubAvailable] = useState(true)
  const [code, setCode] = useState<DeviceCodePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [organization, setOrganization] = useState('')
  const [token, setToken] = useState('')

  useEffect(() => window.api.onDeviceCode(setCode), [])

  // A build without a GitHub client ID can only sign in to Azure DevOps, so
  // it opens there and never offers the way back.
  useEffect(() => {
    void window.api.canSignInWithGitHub?.().then((available) => {
      if (available) return
      setGitHubAvailable(false)
      setSite('azure-devops')
    })
  }, [])

  const run = async (attempt: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await attempt()
    } catch (cause) {
      // Electron prefixes errors that cross IPC with where they were thrown.
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setCode(null)
    } finally {
      setBusy(false)
    }
  }

  const switchTo = (next: Site): void => {
    setSite(next)
    setError(null)
  }

  return (
    <View padding={6} gap={4} align="center" justify="center" height="100%" minHeight={0}>
      <Text variant="featured-3" weight="bold">
        Pullover
      </Text>

      {code !== null ? (
        <>
          <Text variant="body-2" color="neutral-faded" align="center">
            Enter this code at {code.verificationUri} — it's already on your clipboard.
          </Text>
          <Text variant="featured-2" weight="bold" monospace>
            {code.userCode}
          </Text>
          <Text variant="caption-1" color="neutral-faded">
            Waiting for you to approve…
          </Text>
        </>
      ) : site === 'github' ? (
        <>
          <Text variant="body-2" color="neutral-faded" align="center">
            Sign in with GitHub to see what needs you.
          </Text>
          <Button
            color="primary"
            icon={LogIn}
            loading={busy}
            onClick={() => void run(() => window.api.startAuth())}
          >
            Sign in with GitHub
          </Button>
          <Text variant="caption-1" color="neutral-faded">
            <Link variant="plain" color="inherit" onClick={() => switchTo('azure-devops')}>
              Use Azure DevOps instead
            </Link>
          </Text>
        </>
      ) : (
        <form
          style={{ width: '100%' }}
          onSubmit={(event) => {
            event.preventDefault()
            void run(() => window.api.signInAzureDevOps(organization, token))
          }}
        >
          <View gap={3} align="stretch">
            <Text variant="body-2" color="neutral-faded" align="center">
              Sign in to Azure DevOps with a personal access token that can read code.
            </Text>
            <TextField
              name="organization"
              placeholder="Organization, e.g. contoso"
              value={organization}
              onChange={({ value }) => setOrganization(value)}
            />
            <TextField
              name="token"
              placeholder="Personal access token"
              value={token}
              onChange={({ value }) => setToken(value)}
              inputAttributes={{ type: 'password', autoComplete: 'off' }}
            />
            <Button color="primary" icon={LogIn} loading={busy} type="submit" fullWidth>
              Sign in to Azure DevOps
            </Button>
            <View direction="row" justify="space-between">
              {gitHubAvailable && (
                <Text variant="caption-1" color="neutral-faded">
                  <Link variant="plain" color="inherit" onClick={() => switchTo('github')}>
                    Use GitHub instead
                  </Link>
                </Text>
              )}
              <Text variant="caption-1" color="neutral-faded">
                <Link
                  variant="plain"
                  color="inherit"
                  onClick={() => void window.api.openPr(PAT_HELP_URL)}
                >
                  Create a token
                </Link>
              </Text>
            </View>
          </View>
        </form>
      )}

      {error !== null && (
        <Text variant="caption-1" color="critical" align="center">
          {error}
        </Text>
      )}
    </View>
  )
}
