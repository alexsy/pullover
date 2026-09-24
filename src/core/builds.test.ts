import { describe, expect, it } from 'vitest'
import { type AzureBuild, buildState, filterBuilds, mapAzureBuild } from './builds'

function azureBuild(overrides: Partial<AzureBuild> = {}): AzureBuild {
  return {
    id: 901,
    buildNumber: '20260924.3',
    status: 'completed',
    result: 'succeeded',
    queueTime: '2026-09-24T09:00:00Z',
    finishTime: '2026-09-24T09:06:00Z',
    sourceBranch: 'refs/heads/main',
    definition: { name: 'CaseAPI CI' },
    project: { name: 'Utvikling' },
    requestedFor: { displayName: 'Alice' },
    _links: { web: { href: 'https://dev.azure.com/contoso/abc/_build/results?buildId=901' } },
    ...overrides,
  }
}

describe('buildState', () => {
  it('reads a finished run from its result and an unfinished one from its status', () => {
    expect(buildState('completed', 'succeeded')).toBe('succeeded')
    expect(buildState('completed', 'partiallySucceeded')).toBe('partially-succeeded')
    expect(buildState('completed', 'failed')).toBe('failed')
    expect(buildState('completed', 'canceled')).toBe('cancelled')
    expect(buildState('inProgress', 'none')).toBe('running')
    expect(buildState('cancelling', undefined)).toBe('cancelling')
    expect(buildState('notStarted', undefined)).toBe('queued')
    expect(buildState('postponed', undefined)).toBe('queued')
  })
})

describe('mapAzureBuild', () => {
  it('fills in what the tab shows', () => {
    expect(mapAzureBuild('contoso', azureBuild())).toEqual({
      id: 901,
      number: '20260924.3',
      pipeline: 'CaseAPI CI',
      project: 'Utvikling',
      branch: 'main',
      state: 'succeeded',
      requestedBy: 'Alice',
      queuedAt: '2026-09-24T09:00:00Z',
      finishedAt: '2026-09-24T09:06:00Z',
      url: 'https://dev.azure.com/contoso/abc/_build/results?buildId=901',
    })
  })

  it('keeps a pull request ref readable and builds a link when none is given', () => {
    const mapped = mapAzureBuild(
      'contoso',
      azureBuild({
        sourceBranch: 'refs/pull/42/merge',
        _links: undefined,
        project: { name: 'Min Side' },
      }),
    )
    expect(mapped.branch).toBe('pull/42/merge')
    expect(mapped.url).toBe('https://dev.azure.com/contoso/Min%20Side/_build/results?buildId=901')
  })
})

describe('filterBuilds', () => {
  it('narrows to one project', () => {
    const builds = [
      mapAzureBuild('c', azureBuild({ id: 1 })),
      mapAzureBuild('c', azureBuild({ id: 2, project: { name: 'Drift' } })),
    ]
    expect(filterBuilds(builds, null).map((b) => b.id)).toEqual([1, 2])
    expect(filterBuilds(builds, 'Drift').map((b) => b.id)).toEqual([2])
  })
})
