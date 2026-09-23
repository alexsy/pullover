import { describe, expect, it } from 'vitest'
import { branchName, htmlToText } from './work-items'

describe('branchName', () => {
  it('prefixes a bug with bug/', () => {
    expect(branchName({ id: 148640, type: 'Bug', title: 'Footer fix' })).toBe(
      'bug/148640_footer_fix',
    )
  })

  it('prefixes everything else with feature/', () => {
    expect(branchName({ id: 151699, type: 'User Story', title: 'Bump to .NET 10!' })).toBe(
      'feature/151699_bump_to_net_10',
    )
    expect(branchName({ id: 7, type: 'Product Backlog Item', title: 'x' })).toBe('feature/7_x')
  })

  it('spells Norwegian letters and accents in ASCII', () => {
    expect(branchName({ id: 1, type: 'Bug', title: 'Min side: bøker på én gang, æ' })).toBe(
      'bug/1_min_side_boker_pa_en_gang_ae',
    )
  })

  it('keeps a long title to a sensible length', () => {
    const name = branchName({ id: 2, type: 'Task', title: 'word '.repeat(40) })
    expect(name.length).toBeLessThanOrEqual('feature/2_'.length + 60)
    expect(name.endsWith('_')).toBe(false)
  })

  it('falls back to the id when the title has nothing usable', () => {
    expect(branchName({ id: 3, type: 'Bug', title: '!!!' })).toBe('bug/3')
  })
})

describe('htmlToText', () => {
  it('keeps the text and the line structure, and drops the markup', () => {
    expect(
      htmlToText(
        '<div>First line<br>second &amp; <b>bold</b></div><ul><li>one</li><li>two</li></ul><p>x&nbsp;&#8594;&#x2192;</p>',
      ),
    ).toBe('First line\nsecond & bold\n\n• one\n• two\nx →→')
  })

  it('drops script and style content entirely', () => {
    expect(htmlToText('<script>alert(1)</script><style>p{}</style>hi')).toBe('hi')
  })
})
