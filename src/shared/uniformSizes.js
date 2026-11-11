// The uniform items whose size a student record keeps. A size is not free
// text: an administrator defines the values it may take in Settings →
// Registers → Uniform sizes, and the student forms only offer those values.
//
// One entry per stored column keeps the two editors, the services that write
// the rows and the administrator's register in agreement.

export const UNIFORM_SIZE_KINDS = [
  { code: 'COMBAT_OUTFIT_SIZE', label: 'Combat Outfit Size' },
  { code: 'COMBAT_SHOE_SIZE', label: 'Combat Shoe Size' },
  { code: 'SUMMER_JACKET_SIZE', label: 'Summer Jacket' },
  { code: 'WINTER_JACKET_SIZE', label: 'Winter Jacket' },
  { code: 'SUMMER_TROUSERS_SIZE', label: 'Summer Trousers' },
  { code: 'WINTER_TROUSERS_SIZE', label: 'Winter Trousers' },
  { code: 'SUMMER_SHIRT_SIZE', label: 'Summer Shirt' },
  { code: 'WINTER_SHIRT_SIZE', label: 'Winter Shirt' },
  { code: 'SUMMER_HAT_SIZE', label: 'Summer Hat' },
  { code: 'WINTER_HAT_SIZE', label: 'Winter Hat' },
  { code: 'SUMMER_SKIRT_SIZE', label: 'Summer Skirt' },
  { code: 'WINTER_SKIRT_SIZE', label: 'Winter Skirt' }
]

// Combat outfit (student_combat_outfit): both outfit sizes share one list.
export const COMBAT_UNIFORM_FIELDS = [
  { key: 'FIRST_OUTFIT_SIZE', kind: 'COMBAT_OUTFIT_SIZE', label: '1st Outfit Size' },
  { key: 'SECOND_OUTFIT_SIZE', kind: 'COMBAT_OUTFIT_SIZE', label: '2nd Outfit Size' },
  { key: 'COMBAT_SHOE_SIZE', kind: 'COMBAT_SHOE_SIZE', label: 'Combat Shoe Size' }
]

// Parade uniform (student_parade_uniform), in the order the form shows them.
export const PARADE_UNIFORM_FIELDS = [
  { key: 'SUMMER_JACKET_SIZE', kind: 'SUMMER_JACKET_SIZE', label: 'Summer Jacket' },
  { key: 'WINTER_JACKET_SIZE', kind: 'WINTER_JACKET_SIZE', label: 'Winter Jacket' },
  { key: 'SUMMER_TROUSERS_SIZE', kind: 'SUMMER_TROUSERS_SIZE', label: 'Summer Trousers' },
  { key: 'WINTER_TROUSERS_SIZE', kind: 'WINTER_TROUSERS_SIZE', label: 'Winter Trousers' },
  { key: 'SUMMER_SHIRT_SIZE', kind: 'SUMMER_SHIRT_SIZE', label: 'Summer Shirt' },
  { key: 'WINTER_SHIRT_SIZE', kind: 'WINTER_SHIRT_SIZE', label: 'Winter Shirt' },
  { key: 'SUMMER_HAT_SIZE', kind: 'SUMMER_HAT_SIZE', label: 'Summer Hat' },
  { key: 'WINTER_HAT_SIZE', kind: 'WINTER_HAT_SIZE', label: 'Winter Hat' },
  { key: 'SUMMER_SKIRT_SIZE', kind: 'SUMMER_SKIRT_SIZE', label: 'Summer Skirt' },
  { key: 'WINTER_SKIRT_SIZE', kind: 'WINTER_SKIRT_SIZE', label: 'Winter Skirt' }
]

export const UNIFORM_SIZE_FIELDS = [...COMBAT_UNIFORM_FIELDS, ...PARADE_UNIFORM_FIELDS]

// Skirts belong to the female uniform only: a male student has neither a summer
// nor a winter skirt, so those columns stay empty on his record.
export const FEMALE_ONLY_UNIFORM_KEYS = ['SUMMER_SKIRT_SIZE', 'WINTER_SKIRT_SIZE']

export const isFemaleOnlyUniformKey = (key) => FEMALE_ONLY_UNIFORM_KEYS.includes(key)

export const uniformKindLabel = (code) =>
  UNIFORM_SIZE_KINDS.find((kind) => kind.code === code)?.label || String(code || '')
