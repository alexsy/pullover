import { describe, expect, it } from 'vitest'
import { decodeCredentials, encodeCredentials } from './credentials'

describe('credentials', () => {
  it('reads a bare token saved by an older release as GitHub', () => {
    expect(decodeCredentials('gho_abc')).toEqual({ provider: 'github', token: 'gho_abc' })
  })

  it('keeps a GitHub token in the old bare format', () => {
    expect(encodeCredentials({ provider: 'github', token: 'gho_abc' })).toBe('gho_abc')
  })

  it('round-trips Azure DevOps credentials', () => {
    const credentials = { provider: 'azure-devops', organization: 'acme', token: 'pat' } as const
    expect(decodeCredentials(encodeCredentials(credentials))).toEqual(credentials)
  })

  it('treats anything unreadable as no credentials', () => {
    expect(decodeCredentials('')).toBeNull()
    expect(decodeCredentials('{not json')).toBeNull()
    expect(decodeCredentials('{"provider":"azure-devops"}')).toBeNull()
  })
})
