import type { WorkItem } from '@shared/types'
import { visualCase } from '../test/visual'
import WorkItemsList from './WorkItemsList'

const ITEMS: WorkItem[] = [
  {
    id: 151699,
    title: 'Upgrade services to .NET 10',
    type: 'User Story',
    state: 'Active',
    url: 'https://dev.azure.com/acme/_workitems/edit/151699',
    description: 'Every service moves to .NET 10.\n\n• CaseAPI\n• ContactAndConsentAPI',
  },
  {
    id: 148640,
    title: 'Footer overlaps the cookie banner on Min side',
    type: 'Bug',
    state: 'New',
    url: 'https://dev.azure.com/acme/_workitems/edit/148640',
    description: '',
  },
]

visualCase('list', <WorkItemsList items={ITEMS} />)

visualCase('empty', <WorkItemsList items={[]} />)
