import React from 'react'
import { tr } from '../../i18n'

// The two naming contracts used by the database:
//   en -> <base>_en / _ar / _fr  (reference labels)
//   la -> <base>_la / _ar        (person names)
const SCHEMES = {
  en: [
    ['EN', 'English', 'ltr'],
    ['AR', 'Arabic', 'rtl'],
    ['FR', 'French', 'ltr']
  ],
  la: [
    ['LA', 'Latin', 'ltr'],
    ['AR', 'Arabic', 'rtl']
  ]
}

export const localizedKeys = (base, scheme = 'en') =>
  (SCHEMES[scheme] || SCHEMES.en).map(([suffix]) => `${base}_${suffix}`)

// The primary language is the one the rest of the app displays by default.
export const primaryLocalizedKey = (base, scheme = 'en') =>
  `${base}_${scheme === 'la' ? 'LA' : 'EN'}`

export const hasLocalizedValue = (form, base, scheme = 'en') =>
  String(form?.[primaryLocalizedKey(base, scheme)] ?? '').trim().length > 0

// Copies the three (or two) variants out of a form into an IPC payload.
export function localizedPayload(form, base, scheme = 'en') {
  const payload = {}
  for (const key of localizedKeys(base, scheme)) {
    payload[key] = form?.[key] ?? null
  }
  return payload
}

export default function LocalizedInput({
  base,
  form,
  setForm,
  scheme = 'en',
  label,
  textarea = false,
  rows = 2,
  inputClassName = '',
  required = false,
  placeholder = '',
  // Rooms where the form is the whole dialog stack the variants on one line
  // each instead of spreading them across a row.
  stacked = false,
  // Optional (key, value) => value applied as the field is typed. Person names
  // use it so the stored shape is visible while entering it: a Latin first name
  // capitalised word by word, a Latin last name in capitals.
  formatValue = null
}) {
  const fields = SCHEMES[scheme] || SCHEMES.en
  const gridCls = stacked ? '' : fields.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'

  return (
    <div className="space-y-1.5">
      {label && (
        <span className="block text-xs font-semibold text-ink-3">{label}</span>
      )}
      <div className={`grid grid-cols-1 gap-2 ${gridCls}`}>
        {fields.map(([suffix, languageLabel, dir], index) => {
          const key = `${base}_${suffix}`
          const isPrimary = index === 0
          return (
            <label key={key} className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-1">
                {tr(languageLabel)}
                {isPrimary && required ? ' *' : ''}
              </span>
              {textarea ? (
                <textarea
                  dir={dir}
                  rows={rows}
                  className={inputClassName}
                  placeholder={placeholder}
                  required={isPrimary && required}
                  value={form?.[key] ?? ''}
                  onChange={(e) => setForm({ ...form, [key]: formatValue ? formatValue(key, e.target.value) : e.target.value })}
                />
              ) : (
                <input
                  type="text"
                  dir={dir}
                  className={inputClassName}
                  placeholder={placeholder}
                  autoComplete="off"
                  required={isPrimary && required}
                  value={form?.[key] ?? ''}
                  onChange={(e) => setForm({ ...form, [key]: formatValue ? formatValue(key, e.target.value) : e.target.value })}
                />
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}
