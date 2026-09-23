import { ACTIVITY_VERBS, type ActivityKind, lastActivity } from '@core/activity'
import { formatAge, formatChangedAt } from '@core/format'
import type { CiStatus, PullRequest, SortOrder } from '@shared/types'
import {
  Check,
  Clock,
  Eye,
  GitCommitHorizontal,
  GitPullRequest,
  Link2,
  MessageSquare,
  X,
} from 'lucide-react'
import { Actionable, Icon, Text, View } from 'reshaped/bundle'
import { accentTint, CI_BADGES, statusAccent } from './pr-colors'

/**
 * The pieces both card layouts draw the same way. They were compact's alone
 * until the comfortable row was rebuilt around the same right-hand group;
 * keeping one copy is what stops the two layouts drifting apart on a colour
 * or a size that is meant to read as the same thing.
 */

const CI_ICONS = { success: Check, failure: X, pending: Clock } as const

/** Every badge on a meta line stands this tall, so a row's badges line up. */
export const BADGE_HEIGHT_PX = 16

/** Two letters: one is ambiguous at a glance across a list of teammates. */
export function initialsOf(login: string): string {
  return login.slice(0, 2).toUpperCase()
}

const AVATAR_HUES = 8

/**
 * A class tinting an initials avatar, the same one for the same person every
 * time, so a list of teammates without photos can still be told apart.
 */
export function avatarHueClass(login: string): string {
  // FNV-1a: logins sharing a domain differ only at the front, which a plain
  // multiply-and-add hash spreads poorly across so few buckets.
  let hash = 0x811c9dc5
  for (const char of login) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0
  return `pv-avatar-initials pv-avatar-hue pv-avatar-hue-${hash % AVATAR_HUES}`
}

/**
 * The CI state as an icon alone. The chip is the only thing carrying it, so
 * the label rides along as the accessible name rather than as visible text.
 *
 * Fill and no border, which is why the background comes from `accentTint`
 * rather than a `backgroundColor` token — see `pr-colors.ts` for why a
 * `*-faded` fill cannot hold an edge by itself.
 */
export function CiChip({ status }: { status: CiStatus }): React.JSX.Element | null {
  if (status === 'none') return null
  const ci = CI_BADGES[status]

  return (
    <View
      width={`${BADGE_HEIGHT_PX}px`}
      height={`${BADGE_HEIGHT_PX}px`}
      align="center"
      justify="center"
      borderRadius="small"
      attributes={{
        role: 'img',
        'aria-label': ci.label,
        style: { backgroundColor: accentTint(ci.accent) },
      }}
    >
      <Icon svg={CI_ICONS[status]} size="10px" color={ci.accent} />
    </View>
  )
}

/**
 * Why the row is in the inbox, as plain coloured text.
 *
 * Uncapped, so the title yields instead: a clipped reason ("Re-review
 * reque…") says less than the title it was protecting, and every reason
 * `classify` produces is short — the longest is "Waiting on reviewers".
 */
export function StatusText({ reason }: { reason: string }): React.JSX.Element | null {
  if (reason === '') return null

  return (
    <Text as="span" variant="caption-1" weight="semibold" color={statusAccent(reason)}>
      {reason}
    </Text>
  )
}

const ACTIVITY_ICONS: Record<ActivityKind, typeof Check> = {
  opened: GitPullRequest,
  pushed: GitCommitHorizontal,
  commented: MessageSquare,
  reviewed: Eye,
  approved: Check,
  rejected: X,
}

/** What last happened and when: `commented 7h ago`, or a clock time when sorted by change. */
export function LastActivity({
  pr,
  now,
  sortOrder,
}: {
  pr: PullRequest
  now: string
  sortOrder: SortOrder
}): React.JSX.Element {
  const activity = lastActivity(pr)
  const when =
    sortOrder === 'recent' ? formatChangedAt(activity.at, now) : formatAge(activity.at, now)
  return (
    <View
      as="span"
      direction="row"
      align="center"
      gap={1}
      wrap={false}
      attributes={{ title: `${ACTIVITY_VERBS[activity.kind]} by ${activity.by}` }}
    >
      <Icon svg={ACTIVITY_ICONS[activity.kind]} size="11px" color="neutral-faded" />
      <Text as="span" variant="caption-1" color="neutral-faded" numeric>
        {ACTIVITY_VERBS[activity.kind]} {when}
      </Text>
    </View>
  )
}

/**
 * The linked work items and who approved, under the title. Each work item
 * opens itself; the click stops there rather than also opening the card.
 */
export function PrLinks({ pr }: { pr: PullRequest }): React.JSX.Element | null {
  if (pr.workItems.length === 0 && pr.approvedBy.length === 0) return null
  return (
    <View direction="row" align="center" gap={2} wrap={false} minWidth={0}>
      {pr.workItems.map((workItem) => (
        <Actionable
          key={workItem.id}
          stopPropagation
          onClick={() => void window.api.openPr(workItem.url)}
          attributes={{ title: workItem.title ?? `Work item ${workItem.id}` }}
        >
          <View direction="row" align="center" gap={1} wrap={false} minWidth={0}>
            <Icon svg={Link2} size="11px" color="primary" />
            <Text as="span" variant="caption-1" color="primary" maxLines={1}>
              #{workItem.id}
              {workItem.title !== null && workItem.title !== '' ? ` ${workItem.title}` : ''}
            </Text>
          </View>
        </Actionable>
      ))}
      {pr.approvedBy.length > 0 && (
        <View direction="row" align="center" gap={1} wrap={false} minWidth={0}>
          <Icon svg={Check} size="11px" color="positive" />
          <Text as="span" variant="caption-1" color="neutral-faded" maxLines={1}>
            {pr.approvedBy.join(', ')}
          </Text>
        </View>
      )}
    </View>
  )
}
