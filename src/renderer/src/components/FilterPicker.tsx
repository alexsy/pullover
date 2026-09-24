import { Select } from 'reshaped/bundle'

const ALL = ''

/** A small select that narrows a list to one value, or offers `allLabel` for none. */
export default function FilterPicker({
  name,
  label,
  allLabel,
  options,
  value,
  onChange,
}: {
  name: string
  /** What the picker narrows by, for screen readers; nothing on screen names it. */
  label: string
  allLabel: string
  options: string[]
  value: string | null
  onChange: (value: string | null) => void
}): React.JSX.Element {
  return (
    <Select
      name={name}
      size="small"
      value={value ?? ALL}
      inputAttributes={{ 'aria-label': label }}
      onChange={({ value: next }) => onChange(next === ALL ? null : next)}
    >
      <option value={ALL}>{allLabel}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </Select>
  )
}
