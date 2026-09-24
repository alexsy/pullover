import type { Build, BuildState } from '@shared/types'

/** A run as `_apis/build/builds` returns it, cut down to what the tab shows. */
export interface AzureBuild {
  id: number
  buildNumber: string
  status: string
  result?: string
  queueTime: string
  finishTime?: string
  sourceBranch: string
  definition: { name: string }
  project: { name: string }
  requestedFor?: { displayName: string }
  _links?: { web?: { href?: string } }
}

const RESULTS: Record<string, BuildState> = {
  succeeded: 'succeeded',
  partiallySucceeded: 'partially-succeeded',
  failed: 'failed',
  canceled: 'cancelled',
}

export function buildState(status: string, result: string | undefined): BuildState {
  if (status === 'completed') return RESULTS[result ?? ''] ?? 'failed'
  if (status === 'inProgress') return 'running'
  if (status === 'cancelling') return 'cancelling'
  return 'queued'
}

export function mapAzureBuild(organization: string, build: AzureBuild): Build {
  return {
    id: build.id,
    number: build.buildNumber,
    pipeline: build.definition.name,
    project: build.project.name,
    branch: build.sourceBranch.replace(/^refs\/(heads\/)?/, ''),
    state: buildState(build.status, build.result),
    requestedBy: build.requestedFor?.displayName ?? '',
    queuedAt: build.queueTime,
    finishedAt: build.finishTime ?? null,
    url:
      build._links?.web?.href ??
      `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(build.project.name)}/_build/results?buildId=${build.id}`,
  }
}

export function filterBuilds(builds: Build[], project: string | null): Build[] {
  return project === null ? builds : builds.filter((build) => build.project === project)
}
