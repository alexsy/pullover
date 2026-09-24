import type { Build, BuildState } from '@shared/types'
import { NOW, visualCase } from '../test/visual'
import BuildsList from './BuildsList'

function run(
  id: number,
  state: BuildState,
  pipeline: string,
  project: string,
  minutesAgo: number,
): Build {
  const at = new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString()
  return {
    id,
    number: `20260924.${id}`,
    pipeline,
    project,
    branch: id % 2 === 0 ? 'main' : 'feature/151699_net10_upgrade',
    state,
    requestedBy: 'Kari Nordmann',
    queuedAt: at,
    finishedAt: state === 'running' || state === 'queued' ? null : at,
    url: `https://dev.azure.com/acme/Utvikling/_build/results?buildId=${id}`,
  }
}

const BUILDS: Build[] = [
  run(7, 'queued', 'MinSide Web CI', 'Utvikling', 1),
  run(6, 'running', 'CaseAPI CI', 'Utvikling', 4),
  run(5, 'succeeded', 'ContactAndConsentAPI CI', 'Utvikling', 25),
  run(4, 'partially-succeeded', 'Nightly integration tests', 'Drift', 90),
  run(3, 'failed', 'CaseAPI CI', 'Utvikling', 180),
  run(2, 'cancelled', 'Deploy to production', 'Drift', 1500),
]

const noop = (): void => {}

visualCase('list', <BuildsList builds={BUILDS} project={null} now={NOW} onProjectChange={noop} />)

visualCase(
  'one-project',
  <BuildsList builds={BUILDS} project="Drift" now={NOW} onProjectChange={noop} />,
)

visualCase('empty', <BuildsList builds={[]} project={null} now={NOW} onProjectChange={noop} />)
