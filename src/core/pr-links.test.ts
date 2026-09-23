import { describe, expect, it } from 'vitest'
import { filesUrl } from './pr-links'

describe('filesUrl', () => {
  it('appends /files on GitHub', () => {
    expect(filesUrl('https://github.com/acme/web/pull/7')).toBe(
      'https://github.com/acme/web/pull/7/files',
    )
  })

  it('opens the Files tab on Azure DevOps', () => {
    expect(filesUrl('https://dev.azure.com/acme/Web/_git/api/pullrequest/42')).toBe(
      'https://dev.azure.com/acme/Web/_git/api/pullrequest/42?_a=files',
    )
  })
})
