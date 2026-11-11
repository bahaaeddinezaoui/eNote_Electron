import React from 'react'
import { tr } from '../../i18n'

const optionValue = (option) =>
  String(option?.UNIFORM_SIZE_VALUE ?? option?.uniform_size_value ?? '')

// A uniform size is picked from the list the administration maintains in
// Settings → Registers → Uniform sizes. When the list is empty only "not
// specified" remains, and a value stored before the list existed stays
// selectable so opening a record never silently drops it.
const UniformSizeSelect = ({
  options = [],
  value,
  onChange,
  className = '',
  disabled = false,
  placeholder
}) => {
  const text = String(value ?? '')
  const values = options.map(optionValue)
  const stored = text !== '' && !values.includes(text)

  return (
    <select
      className={className}
      value={text}
      disabled={disabled}
      onChange={(event) => onChange?.(event.target.value)}
    >
      <option value="">{placeholder || tr('Not specified')}</option>
      {options.map((option, index) => (
        <option key={`${values[index]}-${index}`} value={values[index]}>
          {values[index]}
        </option>
      ))}
      {stored ? <option value={text}>{text}</option> : null}
    </select>
  )
}

export default UniformSizeSelect
