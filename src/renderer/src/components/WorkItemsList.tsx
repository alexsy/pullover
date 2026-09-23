import { branchName } from '@core/work-items'
import type { WorkItem } from '@shared/types'
import { Check, ChevronDown, ChevronRight, GitBranch } from 'lucide-react'
import { useState } from 'react'
import { Actionable, Button, Divider, Icon, Link, Select, Text, View } from 'reshaped/bundle'

const COPIED_FOR_MS = 1500

function WorkItemRow({ item }: { item: WorkItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const branch = branchName(item)

  const copyBranch = async (): Promise<void> => {
    await window.api.copyText(branch)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_FOR_MS)
  }

  return (
    <View paddingInline={4} paddingBlock={3} gap={2}>
      <View direction="row" align="start" gap={2}>
        <Actionable
          onClick={() => setOpen((was) => !was)}
          attributes={{
            'aria-expanded': open,
            'aria-label': open ? 'Hide description' : 'Show description',
          }}
        >
          <View paddingTop={0.5}>
            <Icon svg={open ? ChevronDown : ChevronRight} size="14px" color="neutral-faded" />
          </View>
        </Actionable>
        <View.Item grow>
          <View gap={1} minWidth={0}>
            <View direction="row" align="center" gap={2} wrap={false}>
              <Text
                as="span"
                variant="caption-1"
                weight="semibold"
                color={item.type.toLowerCase() === 'bug' ? 'critical' : 'primary'}
              >
                {item.type}
              </Text>
              <Link variant="plain" onClick={() => void window.api.openPr(item.url)}>
                <Text as="span" variant="caption-1" numeric>
                  #{item.id}
                </Text>
              </Link>
              <Text as="span" variant="caption-1" color="neutral-faded" maxLines={1}>
                {item.state}
              </Text>
            </View>
            <Actionable onClick={() => void window.api.openPr(item.url)}>
              <Text variant="body-2" weight="medium">
                {item.title}
              </Text>
            </Actionable>
          </View>
        </View.Item>
        <Button
          size="small"
          variant="outline"
          icon={copied ? Check : GitBranch}
          onClick={() => void copyBranch()}
          attributes={{ title: branch }}
        >
          {copied ? 'Copied' : 'Copy branch'}
        </Button>
      </View>

      {open && (
        <View paddingStart={6} gap={2}>
          <Text variant="caption-1" color="neutral-faded" monospace>
            {branch}
          </Text>
          <Text variant="caption-1" attributes={{ style: { whiteSpace: 'pre-wrap' } }}>
            {item.description === '' ? 'No description.' : item.description}
          </Text>
        </View>
      )}
    </View>
  )
}

const ALL_PROJECTS = ''

interface Props {
  items: WorkItem[]
  /** The project the list is narrowed to, or null for all of them. */
  project: string | null
  onProjectChange: (project: string | null) => void
}

/** Work items assigned to the user, each with a link, its description and a branch to copy. */
export default function WorkItemsList({
  items,
  project,
  onProjectChange,
}: Props): React.JSX.Element {
  // The chosen project stays offered while nothing in it is assigned, or the
  // picker would silently fall back to showing everything.
  const projects = [
    ...new Set([...items.map((item) => item.project), ...(project ? [project] : [])]),
  ]
    .filter((name) => name !== '')
    .sort((a, b) => a.localeCompare(b))
  const shown = project === null ? items : items.filter((item) => item.project === project)

  return (
    <View>
      {projects.length > 1 || project !== null ? (
        <View paddingInline={4} paddingTop={3} paddingBottom={1}>
          <Select
            name="work-item-project"
            size="small"
            value={project ?? ALL_PROJECTS}
            onChange={({ value }) => onProjectChange(value === ALL_PROJECTS ? null : value)}
          >
            <option value={ALL_PROJECTS}>All projects</option>
            {projects.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </View>
      ) : null}

      {shown.length === 0 && (
        <View padding={6} align="center">
          <Text variant="body-2" color="neutral-faded">
            {project === null
              ? 'Nothing open is assigned to you.'
              : `Nothing open in ${project} is assigned to you.`}
          </Text>
        </View>
      )}

      {shown.map((item, index) => (
        <View key={item.id}>
          {index > 0 && <Divider color="neutral" />}
          <WorkItemRow item={item} />
        </View>
      ))}
    </View>
  )
}
