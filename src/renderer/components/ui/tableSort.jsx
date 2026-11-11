import React from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'

// Sortable table headers, one implementation for every list in the app.
//
// A page keeps a single `sort` object ({ key, dir }) and hands its columns to
// SortHeader; `sortRows` does the ordering. Sorting is stable, so rows that tie
// keep the order the server sent them in, and empty values always sink to the
// bottom instead of deciding the order of the list.
//
//   const ACCESSORS = { name: (r) => r.NAME, date: (r) => new Date(r.AT).getTime() }
//   const [sort, setSort] = useState({ key: 'name', dir: 'asc' })
//   const rows = useMemo(() => sortRows(filtered, sort, ACCESSORS), [filtered, sort])
//
//   <SortHeader label={tr('Name')} column="name" sort={sort} onSort={toggleSort} />

export const compareValues = (a, b) => {
  const aEmpty = a === null || a === undefined || a === ''
  const bEmpty = b === null || b === undefined || b === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export const sortRows = (rows, sort, accessors) => {
  const read = sort?.key ? accessors?.[sort.key] : null
  if (!read) return rows
  const factor = sort.dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => factor * compareValues(read(a), read(b)))
}

// Flip a column: a new column starts ascending, the current one reverses.
export const toggleSort = (sort, column) =>
  sort.key === column ? { key: column, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: column, dir: 'asc' }

export const SortHeader = ({
  label,
  column,
  sort,
  onSort,
  width,
  numeric = false,
  className = ''
}) => {
  const active = sort?.key === column
  const dir = active ? sort.dir : null
  const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ChevronsUpDown

  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={className || undefined}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`flex h-full w-full items-center gap-1 text-start uppercase transition-colors hover:text-ink ${
          numeric ? 'justify-end' : ''
        } ${active ? 'text-ink' : 'text-inherit'}`}
      >
        <span className="truncate">{label}</span>
        <Icon size={9} aria-hidden="true" className={active ? 'shrink-0' : 'shrink-0 opacity-50'} />
      </button>
    </th>
  )
}

export default SortHeader
