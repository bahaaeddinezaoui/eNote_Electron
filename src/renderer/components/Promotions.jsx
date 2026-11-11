import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Edit2, Plus, Save, Search, Trash2 } from 'lucide-react'
import Modal from './ui/Modal'
import DataTable from './ui/DataTable'
import Button from './ui/Button'
import ConfirmDialog from './ui/ConfirmDialog'
import Notice from './ui/Notice'
import FilterBar, { FilterField, filterInputCls } from './ui/FilterBar'
import TableEmptyState from './ui/TableEmptyState'
import LocalizedInput, { hasLocalizedValue } from './ui/LocalizedInput'
import { PageIntro, Panel, PanelHeader } from './ui/PageHeader'
import { tr } from '../i18n'
import { useCurrentUser } from '../userContext'

// Reference-data page for cohort labels attached to sections. Reading happens
// in the table; every write happens in a dialog.
//
// One dialog serves both directions: `editor.id` is null for a new promotion and
// the promotion's id when editing. The shell, footer and error treatment are the
// shared ones — Modal, Button, ConfirmDialog — so this page matches the other
// dialogs in the application.

const emptyForm = () => ({
  PROMOTION_CODE: '',
  PROMOTION_LABEL_EN: '',
  PROMOTION_LABEL_AR: '',
  PROMOTION_LABEL_FR: '',
  TEACHING_CATEGORY_ID: ''
})

// Rows arrive localized in PROMOTION_LABEL; the _EN column is the value to edit,
// so it is read first and only falls back to the translated label.
const formFromRow = (promotion) => ({
  PROMOTION_CODE: promotion.PROMOTION_CODE || '',
  PROMOTION_LABEL_EN: promotion.PROMOTION_LABEL_EN ?? promotion.PROMOTION_LABEL ?? '',
  PROMOTION_LABEL_AR: promotion.PROMOTION_LABEL_AR ?? '',
  PROMOTION_LABEL_FR: promotion.PROMOTION_LABEL_FR ?? '',
  TEACHING_CATEGORY_ID: promotion.TEACHING_CATEGORY_ID ? String(promotion.TEACHING_CATEGORY_ID) : ''
})

const payloadFrom = (form) => ({
  PROMOTION_CODE: form.PROMOTION_CODE.trim(),
  PROMOTION_LABEL_EN: form.PROMOTION_LABEL_EN,
  PROMOTION_LABEL_AR: form.PROMOTION_LABEL_AR,
  PROMOTION_LABEL_FR: form.PROMOTION_LABEL_FR,
  ...(form.TEACHING_CATEGORY_ID
    ? { TEACHING_CATEGORY_ID: Number(form.TEACHING_CATEGORY_ID) }
    : {})
})

const Promotions = () => {
  const user = useCurrentUser()
  const [promotions, setPromotions] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState(null)

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  // null = closed, otherwise the dialog's draft. `id` is null for a new row.
  const [editor, setEditor] = useState(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState(null)
  const editingPromotion = editor?.id
    ? promotions.find((promotion) => promotion.PROMOTION_ID === editor.id)
    : null
  const hasSectionCategoryMismatch = Boolean(
    editor?.form.TEACHING_CATEGORY_ID &&
    editingPromotion?.SECTION_TEACHING_CATEGORY_IDS?.some(
      (categoryId) => String(categoryId) !== String(editor.form.TEACHING_CATEGORY_ID)
    )
  )

  const load = async () => {
    setLoading(true)
    try {
      const [promotionsRes, categoriesRes] = await Promise.all([
        window.api.getPromotions(),
        window.api.getTeachingCategories()
      ])
      setPromotions(promotionsRes?.data || [])
      setCategories(categoriesRes?.data || [])
    } catch (error) {
      console.error(error)
      setNotice({ type: 'error', text: error.message || tr('Failed to load promotions') })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openCreate = () => {
    setFormError('')
    setEditor({ id: null, form: emptyForm() })
  }

  const openEdit = (promotion) => {
    setFormError('')
    setEditor({ id: promotion.PROMOTION_ID, form: formFromRow(promotion) })
  }

  const closeEditor = () => {
    if (saving) return
    setEditor(null)
    setFormError('')
  }

  // The dialog's fields write through here, so the draft stays one object
  // (LocalizedInput hands back the whole form on every keystroke).
  const setForm = (next) => setEditor((current) => (current ? { ...current, form: next } : current))

  const save = async (event) => {
    event.preventDefault()
    if (!editor) return

    const form = editor.form
    if (!form.PROMOTION_CODE.trim() || !hasLocalizedValue(form, 'PROMOTION_LABEL')) {
      setFormError(tr('A code and an English label are required.'))
      return
    }

    const wasEditing = !!editor.id
    setSaving(true)
    setFormError('')
    try {
      if (wasEditing) await window.api.updatePromotion(user?.id, editor.id, payloadFrom(form))
      else await window.api.createPromotion(user?.id, payloadFrom(form))
      setEditor(null)
      await load()
      setNotice({
        type: 'success',
        text: wasEditing ? tr('Promotion updated successfully') : tr('Promotion added successfully')
      })
    } catch (error) {
      console.error(error)
      setFormError(error.message || tr('That promotion could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (promotion) => {
    try {
      await window.api.deletePromotion(user?.id, promotion.PROMOTION_ID)
      await load()
      setNotice({ type: 'success', text: tr('Promotion deleted successfully') })
    } catch (error) {
      console.error(error)
      setNotice({ type: 'error', text: tr(error.message || 'Failed to delete promotion') })
    }
  }

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return promotions.filter((promotion) => {
      if (categoryFilter && String(promotion.TEACHING_CATEGORY_ID || '') !== categoryFilter) {
        return false
      }
      if (!needle) return true
      return [promotion.PROMOTION_CODE, promotion.PROMOTION_LABEL, promotion.TEACHING_CATEGORY_LABEL]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    })
  }, [promotions, search, categoryFilter])

  const confirmPromotion = confirmTarget
    ? promotions.find((promotion) => promotion.PROMOTION_ID === confirmTarget) || null
    : null
  const confirmName = confirmPromotion
    ? confirmPromotion.PROMOTION_LABEL || confirmPromotion.PROMOTION_CODE || ''
    : ''

  return (
    <div className="space-y-4">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <PageIntro
        kicker={tr('Reference data')}
        title={tr('Promotions')}
        meta={`${promotions.length} ${promotions.length === 1 ? tr('promotion') : tr('promotions')}`}
        actions={
          <Button size="md" onClick={openCreate}>
            <Plus size={13} strokeWidth={2} /> {tr('Add Promotion')}
          </Button>
        }
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {tr('Manage cohort labels used by sections and student reports.')}
        </p>
      </PageIntro>

      <Panel>
        <PanelHeader title={tr('Promotion list')} meta={`${visible.length}/${promotions.length}`} />

        {/* Search stays on the page; the filters open from the toolbar. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div className="relative w-full max-w-[280px]">
            <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tr('Search promotions...')}
              aria-label={tr('Search promotions')}
              className="field h-7 w-full ps-6 text-[11.5px]"
            />
          </div>
          <FilterBar
            activeCount={(search.trim() ? 1 : 0) + (categoryFilter ? 1 : 0)}
            onClear={() => { setSearch(''); setCategoryFilter('') }}
            matchCount={visible.length}
            matchLabel="promotion"
            title={tr('Filter promotions')}
          >
            <FilterField label={tr('Teaching Category')}>
              <select
                className={filterInputCls}
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                aria-label={tr('Filter by teaching category')}
              >
                <option value="">{tr('All categories')}</option>
                {categories.map((category) => (
                  <option key={category.TEACHING_CATEGORY_ID} value={String(category.TEACHING_CATEGORY_ID)}>
                    {category.TEACHING_CATEGORY_LABEL}
                  </option>
                ))}
              </select>
            </FilterField>
          </FilterBar>
          <span className="mono ms-auto text-[10.5px] text-ink-3">{visible.length}/{promotions.length}</span>
        </div>

        {/* Active filters stay on the toolbar trigger, never over the table. */}

        <div className="overflow-x-auto">
          <DataTable
            className="data-table"
            label={tr('Promotion list')}
            columns={[
              { key: 'c0', width: 140, header: <>{tr('Code')}</> },
              { key: 'c1', header: <>{tr('Label')}</> },
              { key: 'c2', width: 220, header: <>{tr('Teaching Category')}</> },
              { key: 'c3', width: 96 },
            ]}
          >
              {loading && promotions.length === 0 ? (
                <TableEmptyState colSpan={4} loading loadingLabel={tr('Loading promotions…')} />
              ) : visible.length === 0 ? (
                <TableEmptyState
                  colSpan={4}
                  hasFilters={!!search.trim() || !!categoryFilter}
                  emptyLabel={tr('No promotions found')}
                  filteredLabel={tr('No promotions match this search')}
                  hint={
                    promotions.length === 0
                      ? tr('Add the first promotion with the button in the header.')
                      : tr('Clear the search or the category filter to see the rest.')
                  }
                  action={
                    promotions.length === 0 ? (
                      <Button size="sm" onClick={openCreate}>
                        <Plus size={12} /> {tr('Add Promotion')}
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                visible.map((promotion) => (
                  <tr key={promotion.PROMOTION_ID}>
                    <td className="mono text-[10.5px] text-ink-3">{promotion.PROMOTION_CODE || '—'}</td>
                    <td className="font-medium text-ink">{promotion.PROMOTION_LABEL || '—'}</td>
                    <td className="text-ink-2">{promotion.TEACHING_CATEGORY_LABEL || '—'}</td>
                    <td className="!pe-2 text-end">
                      <span className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => openEdit(promotion)}
                          title={tr('Edit')}
                          aria-label={`${tr('Edit')} ${promotion.PROMOTION_CODE}`}
                          className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
                        >
                          <Edit2 size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmTarget(promotion.PROMOTION_ID)}
                          title={tr('Delete')}
                          aria-label={`${tr('Delete')} ${promotion.PROMOTION_CODE}`}
                          className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-danger-bg hover:text-danger-ink"
                        >
                          <Trash2 size={11} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))
              )}
          </DataTable>
        </div>
      </Panel>

      {/* Add / edit — one dialog, the same shell as every other modal. */}
      <Modal
        open={!!editor}
        onClose={closeEditor}
        title={editor?.id ? tr('Edit Promotion') : tr('Add Promotion')}
        description={tr('A promotion code and its label in the three interface languages, optionally tied to a teaching category.')}
        maxWidth="max-w-[560px]"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="mono text-[10px] text-ink-3">
              {editor?.id ? `#${editor.id}` : tr('New record')}
            </span>
            <div className="flex items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={closeEditor} disabled={saving}>
                {tr('Cancel')}
              </Button>
              <Button type="submit" form="promotion-form" size="sm" loading={saving}>
                <Save size={12} /> {saving ? tr('Saving…') : tr('Save')}
              </Button>
            </div>
          </div>
        }
      >
        {editor && (
          <form id="promotion-form" onSubmit={save} className="space-y-3.5">
            {formError && (
              <div className="flex items-start gap-2 rounded-[4px] border border-danger/40 bg-danger-bg px-2.5 py-2 text-[11.5px] text-danger-ink">
                <AlertCircle size={13} className="mt-px shrink-0" /> {formError}
              </div>
            )}

            <div>
              <label htmlFor="promotion-code" className="kicker mb-1 block text-[9px]">
                {tr('Promotion Code')} *
              </label>
              <input
                id="promotion-code"
                type="text"
                autoComplete="off"
                value={editor.form.PROMOTION_CODE}
                onChange={(event) => setForm({ ...editor.form, PROMOTION_CODE: event.target.value })}
                placeholder={tr('e.g. PROMO-2026')}
                className="field mono text-[12px]"
              />
            </div>

            <LocalizedInput
              base="PROMOTION_LABEL"
              form={editor.form}
              setForm={setForm}
              label={tr('Promotion Label')}
              required
              inputClassName="field text-[12px]"
            />

            <div>
              <label htmlFor="promotion-category" className="kicker mb-1 block text-[9px]">
                {tr('Teaching Category (Optional)')}
              </label>
              <select
                id="promotion-category"
                value={editor.form.TEACHING_CATEGORY_ID || ''}
                onChange={(event) => setForm({ ...editor.form, TEACHING_CATEGORY_ID: event.target.value })}
                className="field text-[12px]"
              >
                <option value="">{tr('-- No Category --')}</option>
                {categories.map((category) => (
                  <option key={category.TEACHING_CATEGORY_ID} value={category.TEACHING_CATEGORY_ID}>
                    {category.TEACHING_CATEGORY_LABEL} ({category.TEACHING_CATEGORY_CODE})
                  </option>
                ))}
              </select>
              {hasSectionCategoryMismatch && (
                <div role="status" className="mt-2 flex items-start gap-2 rounded-[4px] border border-warning/40 bg-warning-bg px-2.5 py-2 text-[11.5px] text-warning-ink">
                  <AlertCircle size={13} className="mt-px shrink-0" />
                  {tr("Changing this promotion's category can create a mismatch with its assigned sections. Authorization still follows each section's category.")}
                </div>
              )}
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        title={tr('Delete Promotion')}
        message={
          confirmName
            ? tr('Delete “{name}”? If a section uses it, move that section to another promotion first.', { name: confirmName })
            : tr('Are you sure you want to delete this promotion?')
        }
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          const id = confirmTarget
          setConfirmTarget(null)
          const target = promotions.find((promotion) => promotion.PROMOTION_ID === id)
          if (target) remove(target)
        }}
      />
    </div>
  )
}

export default Promotions
