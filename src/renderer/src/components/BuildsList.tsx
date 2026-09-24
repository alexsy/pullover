import { filterBuilds } from '@core/builds'
import { formatAge } from '@core/format'
import { pickerOptions } from '@core/work-items'
import type { Build, BuildState } from '@shared/types'
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Clock,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react'
import { Actionable, Divider, Icon, Text, View } from 'reshaped/bundle'
import FilterPicker from './FilterPicker'

type IconColor = 'positive' | 'critical' | 'warning' | 'primary' | 'neutral-faded'

const STATES: Record<BuildState, { icon: LucideIcon; color: IconColor; label: string }> = {
  queued: { icon: Clock, color: 'neutral-faded', label: 'Queued' },
  running: { icon: LoaderCircle, color: 'primary', label: 'Running' },
  succeeded: { icon: CircleCheck, color: 'positive', label: 'Succeeded' },
  'partially-succeeded': { icon: CircleAlert, color: 'warning', label: 'Partially succeeded' },
  failed: { icon: CircleX, color: 'critical', label: 'Failed' },
  cancelling: { icon: CircleDashed, color: 'neutral-faded', label: 'Cancelling' },
  cancelled: { icon: CircleSlash, color: 'neutral-faded', label: 'Cancelled' },
}

function BuildRow({ build, now }: { build: Build; now: string }): React.JSX.Element {
  const state = STATES[build.state]
  const details = [state.label, build.branch, build.requestedBy, build.number].filter(
    (part) => part !== '',
  )

  return (
    <Actionable
      fullWidth
      onClick={() => void window.api.openPr(build.url)}
      attributes={{ title: `${build.pipeline} ${build.number} — ${state.label}` }}
    >
      <View direction="row" align="start" gap={3} paddingInline={4} paddingBlock={3}>
        <View paddingTop={0.5}>
          <Icon svg={state.icon} size="16px" color={state.color} />
        </View>
        <View.Item grow>
          <View gap={0.5} minWidth={0}>
            <View direction="row" align="center" gap={2} wrap={false}>
              <View minWidth={0} grow>
                <Text variant="body-2" weight="medium" maxLines={1}>
                  {build.pipeline}
                </Text>
              </View>
              <Text as="span" variant="caption-1" color="neutral-faded">
                {formatAge(build.finishedAt ?? build.queuedAt, now)}
              </Text>
            </View>
            <Text variant="caption-1" color="neutral-faded" maxLines={1}>
              {details.join(' · ')}
            </Text>
          </View>
        </View.Item>
      </View>
    </Actionable>
  )
}

interface Props {
  builds: Build[]
  project: string | null
  now: string
  onProjectChange: (project: string | null) => void
}

/** Recent pipeline runs, newest first; each opens its run in the browser. */
export default function BuildsList({
  builds,
  project,
  now,
  onProjectChange,
}: Props): React.JSX.Element {
  const projects = pickerOptions(
    builds.map((build) => build.project),
    project,
  )
  const shown = filterBuilds(builds, project)

  return (
    <View>
      {(builds.length > 0 || project !== null) && (
        <View paddingInline={4} paddingTop={3} paddingBottom={1}>
          <FilterPicker
            name="build-project"
            allLabel="All projects"
            options={projects}
            value={project}
            onChange={onProjectChange}
          />
        </View>
      )}

      {shown.length === 0 && (
        <View padding={6} align="center">
          <Text variant="body-2" color="neutral-faded">
            {project === null ? 'No pipeline runs yet.' : 'No recent runs in this project.'}
          </Text>
        </View>
      )}

      {shown.map((build, index) => (
        <View key={`${build.project}/${build.id}`}>
          {index > 0 && <Divider color="neutral" />}
          <BuildRow build={build} now={now} />
        </View>
      ))}
    </View>
  )
}
