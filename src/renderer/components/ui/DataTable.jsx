import React from 'react'
import { sortColumnProps } from './tableA11y'

// The one table shell. Every list in the app renders through this component so
// that header semantics cannot drift screen by screen: each column is a real
// `scope="col"` header, the sorted column — and only it — carries `aria-sort`,
// the caption stays available to screen readers, and fixed widths come from one
// colgroup instead of per-screen `<col style>` markup.
//
// Rows are passed as children and belong to the screen: some tables group rows
// by day, some expand a detail row, some own a selection checkbox. They keep
// `role="row"` and use `activatableRowProps` from ./tableA11y when a row opens
// a record.
//
//   <DataTable
//     className="data-table"
//     label={tr('Students')}
//     caption={tr('Registered students, with placement and record status')}
//     colWidths={[32, undefined, 40]}
//     sort={{ key: sortKey, dir: sortDir }}
//     columns={[
//       { key: 'select', className: 'text-center', header: <input ... /> },
//       { key: 'name', header: <>{tr('Student')}</>, sortKey: 'name' },
//       { key: 'when', when: tracksCompletion, header: <>{tr('Information')}</> }
//     ]}
//   >
//     {rows}
//   </DataTable>
//
// A table whose header is generated from its own row schema (interactive sort
// buttons per column) passes that markup as `head` instead of `columns`.
const DataTable = ({
  label,
  caption,
  className = 'data-table',
  bodyClassName,
  colWidths,
  columns = [],
  head,
  headClassName,
  sort,
  children
}) => (
  <table className={className} aria-label={label}>
    {caption ? <caption className="sr-only">{caption}</caption> : null}
    {colWidths ? (
      <colgroup>
        {colWidths
          .filter((width) => width !== null)
          .map((width, index) =>
            width && width !== 'auto' ? <col key={index} style={{ width }} /> : <col key={index} />
          )}
      </colgroup>
    ) : null}
    {head ? (
      <thead>{head}</thead>
    ) : columns.length > 0 && (
      <thead>
        <tr className={headClassName}>
          {columns.filter((column) => column && (column.when === undefined || column.when)).map((column, index) => (
            <th
              key={column.key ?? index}
              scope="col"
              className={column.className}
              style={column.width ? { width: column.width } : undefined}
              {...(column.sortKey ? sortColumnProps(column.sortKey, sort) : {})}
            >
              {column.header ?? (column.srLabel ? <span className="sr-only">{column.srLabel}</span> : column.label)}
            </th>
          ))}
        </tr>
      </thead>
    )}
    <tbody className={bodyClassName}>{children}</tbody>
  </table>
)

export default DataTable
