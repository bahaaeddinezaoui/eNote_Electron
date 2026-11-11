// Table accessibility helpers. A screen that opens a record from a row should
// not make that row mouse-only, and a screen that sorts a column should say so
// on the header even when the order is changed from a toolbar control.

// Props for a row that activates on click. The row keeps its `row` role, so a
// screen reader still reads the cells in order; it simply becomes reachable
// with Tab and activatable with Enter or Space. The focus ring is drawn by
// index.css on [data-activatable].
//
//   <tr {...activatableRowProps(() => open(record))} onClick={() => open(record)}>
export const activatableRowProps = (onActivate) => ({
  'data-activatable': true,
  tabIndex: 0,
  onKeyDown: (event) => {
    // A checkbox, button or link inside the row owns its own keys.
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
    event.preventDefault()
    // A page may also listen for Enter on the window to activate the row under
    // its own cursor; the row that already handled the key must not activate
    // the record a second time.
    event.stopPropagation()
    onActivate?.(event)
  }
})

// aria-sort belongs on the header of the sorted column. Other headers carry no
// attribute at all, which is what assistive technology expects for a table
// where only one column can be the sort key.
//
//   <th {...sortColumnProps('name', sort)}>{tr('Student')}</th>
export const sortColumnProps = (column, sort) => {
  if (!sort?.key || sort.key !== column) return {}
  return { 'aria-sort': sort.dir === 'desc' ? 'descending' : 'ascending' }
}
