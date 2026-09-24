import { describe, expect, it } from 'vitest'
import { parseOrganization } from './organization'

describe('parseOrganization', () => {
  it.each([
    ['contoso', 'contoso'],
    ['  contoso  ', 'contoso'],
    ['https://dev.azure.com/contoso', 'contoso'],
    ['https://dev.azure.com/contoso/', 'contoso'],
    ['dev.azure.com/contoso/Web/_git/api', 'contoso'],
    ['https://contoso.visualstudio.com', 'contoso'],
    ['contoso.visualstudio.com/DefaultCollection', 'contoso'],
  ])('reads %j as %j', (input, expected) => {
    expect(parseOrganization(input)).toBe(expected)
  })

  it.each(['', 'https://dev.azure.com/', 'two words', 'https://example.com/contoso'])(
    'refuses %j',
    (input) => {
      expect(() => parseOrganization(input)).toThrow(/organization/)
    },
  )
})
