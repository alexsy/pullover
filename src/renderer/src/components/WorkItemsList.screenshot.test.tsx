import type { WorkItem } from '@shared/types'
import { visualCase } from '../test/visual'
import WorkItemsList from './WorkItemsList'

const ITEMS: WorkItem[] = [
  {
    id: 151699,
    title: 'Upgrade services to .NET 10',
    type: 'User Story',
    state: 'Active',
    project: 'Utvikling',
    url: 'https://dev.azure.com/acme/_workitems/edit/151699',
    description: 'Every service moves to .NET 10.\n\n• CaseAPI\n• ContactAndConsentAPI',
  },
  {
    id: 148640,
    title: 'Footer overlaps the cookie banner on Min side',
    type: 'Bug',
    state: 'New',
    project: 'Drift',
    url: 'https://dev.azure.com/acme/_workitems/edit/148640',
    description: '',
  },
]

const noop = (): void => {}

const ALL = { workItemProject: null, workItemType: null }

visualCase('list', <WorkItemsList items={ITEMS} filter={ALL} onFilterChange={noop} />)

// Narrowed to one project and one type, from the pickers at the top.
visualCase(
  'one-project',
  <WorkItemsList
    items={ITEMS}
    filter={{ workItemProject: 'Utvikling', workItemType: 'User Story' }}
    onFilterChange={noop}
  />,
)

visualCase('empty', <WorkItemsList items={[]} filter={ALL} onFilterChange={noop} />)
