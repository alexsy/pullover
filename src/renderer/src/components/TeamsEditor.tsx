import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Button, Text, TextField, View } from 'reshaped/bundle'
import SettingsGroup from './SettingsGroup'

/** The Azure DevOps teams whose pull requests show up alongside the user's own. */
export default function TeamsEditor({ teams }: { teams: string[] }): React.JSX.Element {
  const [draft, setDraft] = useState('')

  const save = (next: string[]): void => void window.api.setSettings({ teams: next })

  const add = (): void => {
    const name = draft.trim()
    if (name === '') return
    if (!teams.some((team) => team.toLowerCase() === name.toLowerCase())) save([...teams, name])
    setDraft('')
  }

  return (
    <View gap={2}>
      <SettingsGroup>
        {teams.map((team) => (
          <View
            key={team}
            direction="row"
            align="center"
            gap={2}
            paddingInline={3}
            paddingBlock={2}
          >
            <View.Item grow>
              <Text variant="body-2">{team}</Text>
            </View.Item>
            <Button
              size="small"
              variant="ghost"
              icon={X}
              attributes={{ 'aria-label': `Stop watching ${team}` }}
              onClick={() => save(teams.filter((t) => t !== team))}
            />
          </View>
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
        >
          <View direction="row" align="center" gap={2} padding={2}>
            <View.Item grow>
              <TextField
                name="team"
                variant="headless"
                placeholder="Add a team, e.g. MinSide Dev Team"
                value={draft}
                onChange={({ value }) => setDraft(value)}
              />
            </View.Item>
            <Button size="small" icon={Plus} type="submit" disabled={draft.trim() === ''}>
              Add
            </Button>
          </View>
        </form>
      </SettingsGroup>
      <Text variant="caption-1" color="neutral-faded">
        Pull requests assigned to these teams show up too. Looking teams up needs a token with the
        Project and Team (Read) scope.
      </Text>
    </View>
  )
}
