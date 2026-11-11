import React, { useEffect, useMemo, useState } from 'react'
import { formatDate } from '../dateFormat'
import {
  AlertCircle, Calendar, ChevronDown, History, ListPlus, Pencil, Plus, Save,
  Search, Trash2
} from 'lucide-react'
import Button from './ui/Button'
import ConfirmDialog from './ui/ConfirmDialog'
import Modal from './ui/Modal'
import { PageIntro, Panel } from './ui/PageHeader'
import { tr, useI18n } from '../i18n'

// Version history. The page is a register rather than a feed: an index of
// releases on the left, the selected release on the right, so a long history
// stays scannable and each version can be read without scrolling past the
// others. Features are entered per language in the editor and read side by side
// here — English, Arabic right-to-left, French folded away.

const EMPTY_FEATURE = { en: '', ar: '', fr: '' }
const EMPTY_FORM = {
  version: '', release_date: '', title_en: '', title_ar: '', title_fr: '',
  features: [{ ...EMPTY_FEATURE }]
}

const toDateInput = (value) => {
  if (!value) return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// A date-only value is read as a calendar day, never shifted by the timezone.
const fmtDay = (value) => {
  const key = toDateInput(value)
  if (!key) return tr('No date')
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return key
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  return formatDate(d, { day: '2-digit', month: 'short', year: 'numeric' })
}

// A version's features are stored in the `feature` table, one row per bullet,
// in the order the admin adds them.
const toFormFeatures = (entry) => {
  const list = (entry.FEATURES || []).map(f => ({
    en: f.FEATURE_TEXT_EN || '',
    ar: f.FEATURE_TEXT_AR || '',
    fr: f.FEATURE_TEXT_FR || ''
  }))
  return list.length > 0 ? list : [{ ...EMPTY_FEATURE }]
}

const featureCount = (entry) => (entry.FEATURES || []).length

// The index names a release in the interface language, falling back to English
// when that release was not written in it.
const pickTitle = (entry, language) => {
  if (language === 'ar') return entry.TITLE_AR || entry.TITLE_EN || ''
  if (language === 'fr') return entry.TITLE_FR || entry.TITLE_EN || ''
  return entry.TITLE_EN || ''
}

const Changelog = ({ user }) => {
  const { lang } = useI18n()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [canManage, setCanManage] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  // Editor modal state (null = closed, otherwise { id, form })
  const [editor, setEditor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmTarget, setConfirmTarget] = useState(null)

  const loadEntries = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await window.api.getChangelogs()
      const list = res?.data || []
      setEntries(list)
      // Keep the open release open; otherwise fall back to the newest one.
      setSelectedId(prev =>
        list.some(entry => entry.CHANGELOG_ID === prev) ? prev : (list[0]?.CHANGELOG_ID ?? null)
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEntries()
    // Role check against the database (renderer roles mirror it for the UI).
    if (user?.id) {
      window.api.canManageChangelog(user.id)
        .then(setCanManage)
        .catch(() => setCanManage(false))
    }
  }, [user?.id])

  // Search covers the version, every title and every feature, so "attendance"
  // finds the release that changed attendance whatever language it was typed in.
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return entries
    return entries.filter(entry => {
      const haystack = [
        entry.VERSION,
        entry.TITLE_EN,
        entry.TITLE_AR,
        entry.TITLE_FR,
        ...(entry.FEATURES || []).flatMap(f => [f.FEATURE_TEXT_EN, f.FEATURE_TEXT_AR, f.FEATURE_TEXT_FR])
      ]
      return haystack.some(value => String(value || '').toLowerCase().includes(term))
    })
  }, [entries, query])

  const activeEntry =
    visible.find(entry => entry.CHANGELOG_ID === selectedId) || visible[0] || null

  const openCreate = () => {
    setFormError('')
    setEditor({ id: null, form: { ...EMPTY_FORM, features: [{ ...EMPTY_FEATURE }] } })
  }

  const openEdit = (entry) => {
    setFormError('')
    setEditor({
      id: entry.CHANGELOG_ID,
      form: {
        version: entry.VERSION || '',
        release_date: toDateInput(entry.RELEASE_DATE),
        title_en: entry.TITLE_EN || '',
        title_ar: entry.TITLE_AR || '',
        title_fr: entry.TITLE_FR || '',
        features: toFormFeatures(entry)
      }
    })
  }

  const closeEditor = () => {
    if (saving) return
    setEditor(null)
    setFormError('')
  }

  const setForm = (key, value) => setEditor(e => ({ ...e, form: { ...e.form, [key]: value } }))

  const setFeature = (index, key, value) => setEditor(e => ({
    ...e,
    form: {
      ...e.form,
      features: e.form.features.map((f, i) => i === index ? { ...f, [key]: value } : f)
    }
  }))

  const addFeature = () => setEditor(e => ({
    ...e,
    form: { ...e.form, features: [...e.form.features, { ...EMPTY_FEATURE }] }
  }))

  const removeFeature = (index) => setEditor(e => ({
    ...e,
    form: { ...e.form, features: e.form.features.filter((_, i) => i !== index) }
  }))

  const formComplete = !!editor &&
    !!editor.form.version.trim() &&
    !!editor.form.release_date &&
    !!editor.form.title_en.trim() &&
    !!editor.form.title_ar.trim()

  const handleSave = async (event) => {
    event?.preventDefault()
    if (!formComplete) {
      setFormError(tr('Version, release date and both titles are required.'))
      return
    }
    // A row left entirely blank is not a feature: drop it instead of storing an
    // empty bullet the reader would see as a dash.
    const features = editor.form.features
      .map(f => ({ en: f.en, ar: f.ar, fr: f.fr }))
      .filter(f => f.en.trim() || f.ar.trim() || f.fr.trim())
    if (features.length === 0) {
      setFormError(tr('Add at least one feature.'))
      return
    }

    setSaving(true)
    setFormError('')
    try {
      const payload = { ...editor.form, features }
      if (editor.id) {
        await window.api.updateChangelog(user.id, editor.id, payload)
      } else {
        await window.api.createChangelog(user.id, payload)
      }
      setEditor(null)
      await loadEntries()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (entry) => {
    try {
      await window.api.deleteChangelog(user.id, entry.CHANGELOG_ID)
      if (entry.CHANGELOG_ID === selectedId) setSelectedId(null)
      await loadEntries()
    } catch (err) {
      setError(err.message)
    }
  }

  const releaseWord = entries.length === 1 ? tr('release') : tr('releases')

  return (
    <div className="space-y-4">
      <PageIntro
        kicker={tr('Product')}
        title={tr('Changelog')}
        meta={loading ? null : `${entries.length} ${releaseWord}`}
        actions={canManage && (
          <Button size="sm" onClick={openCreate}>
            <Plus size={12} strokeWidth={2} /> {tr('New entry')}
          </Button>
        )}
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {tr('Every version of the application and what changed in it.')}
        </p>
      </PageIntro>

      {error && (
        <div className="flex items-start gap-2 rounded-[4px] border border-danger/40 bg-danger-bg px-3 py-2 text-[11.5px] text-danger-ink">
          <AlertCircle size={13} className="mt-px shrink-0" /> {error}
        </div>
      )}

      {!loading && entries.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <History size={22} className="text-ink-3" />
            <h2 className="serif mt-3 text-[22px] leading-tight text-ink">{tr('No releases yet.')}</h2>
            <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-ink-3">
              {tr('Versions appear here as they are published, newest first.')}
            </p>
            {canManage && (
              <Button size="sm" className="mt-4" onClick={openCreate}>
                <Plus size={12} strokeWidth={2} /> {tr('Write the first entry')}
              </Button>
            )}
          </div>
        </Panel>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-[248px_minmax(0,1fr)]">
          {/* Index of releases */}
          <Panel className="md:sticky md:top-0">
            <div className="border-b border-line p-2">
              <div className="relative">
                <Search
                  size={12}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3"
                />
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={tr('Search releases')}
                  aria-label={tr('Search releases')}
                  className="field h-7 w-full ps-6 text-[11px]"
                />
              </div>
            </div>

            <div className="max-h-[260px] overflow-y-auto md:max-h-[calc(100vh-15rem)]">
              {loading ? (
                <div role="status" aria-live="polite" className="space-y-1.5 p-2">
                  <span className="sr-only">{tr('Loading changelog...')}</span>
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="h-8 rounded-[3px] bg-surface-muted" aria-hidden="true" />
                  ))}
                </div>
              ) : visible.length === 0 ? (
                <p className="px-3 py-6 text-center text-[11px] leading-relaxed text-ink-3">
                  {tr('No release matches this search.')}
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {visible.map((entry) => {
                    const active = entry.CHANGELOG_ID === activeEntry?.CHANGELOG_ID
                    const latest = entries[0]?.CHANGELOG_ID === entry.CHANGELOG_ID
                    return (
                      <li key={entry.CHANGELOG_ID}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(entry.CHANGELOG_ID)}
                          aria-current={active ? 'true' : undefined}
                          className={`relative flex w-full flex-col gap-1 px-3 py-2 text-start ${
                            active ? 'bg-selection' : 'hover:bg-surface-muted'
                          }`}
                        >
                          {active && (
                            <span
                              aria-hidden="true"
                              className="absolute inset-y-1.5 start-0 w-[2px] rounded-full"
                              style={{ background: 'var(--color-jade-500)' }}
                            />
                          )}
                          <span className="flex items-baseline gap-1.5">
                            <span className="mono text-[11.5px] font-medium text-ink">{entry.VERSION || '—'}</span>
                            {latest && (
                              <span className="mono border border-jade-500/40 px-1 text-[8px] uppercase tracking-[0.07em] text-jade-600">
                                {tr('Latest')}
                              </span>
                            )}
                            <span className="mono ms-auto shrink-0 text-[9.5px] text-ink-3">
                              {fmtDay(entry.RELEASE_DATE)}
                            </span>
                          </span>
                          <span className={`truncate text-[11px] ${active ? 'text-ink' : 'text-ink-2'}`}>
                            {pickTitle(entry, lang) || tr('Untitled')}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </Panel>

          {/* Selected release */}
          {loading ? (
            <Panel>
              <div role="status" aria-live="polite" className="space-y-3 p-4">
                <span className="sr-only">{tr('Loading changelog...')}</span>
                <div className="h-2.5 w-24 rounded-[2px] bg-surface-muted" aria-hidden="true" />
                <div className="h-5 w-2/3 rounded-[2px] bg-surface-muted" aria-hidden="true" />
                <div className="mt-5 space-y-2" aria-hidden="true">
                  {Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className="h-2 w-3/4 rounded-[2px] bg-surface-muted" />
                  ))}
                </div>
              </div>
            </Panel>
          ) : !activeEntry ? (
            <Panel>
              <div className="px-6 py-16 text-center">
                <h2 className="serif text-[20px] leading-tight text-ink">{tr('Nothing selected')}</h2>
                <p className="mx-auto mt-1.5 max-w-xs text-[11.5px] leading-relaxed text-ink-3">
                  {tr('Pick a release from the list to read what changed in it.')}
                </p>
              </div>
            </Panel>
          ) : (
            <Panel>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="mono border border-jade-500/40 bg-selection px-1.5 py-0.5 text-[10.5px] font-medium text-jade-600">
                      v{activeEntry.VERSION || '—'}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-3">
                      <Calendar size={10} /> {fmtDay(activeEntry.RELEASE_DATE)}
                    </span>
                    <span className="mono text-[10px] text-ink-3">
                      {featureCount(activeEntry)} {featureCount(activeEntry) === 1 ? tr('feature') : tr('features')}
                    </span>
                  </div>
                  <h2 className="serif mt-1.5 text-[25px] leading-[1.15] text-ink">
                    {activeEntry.TITLE_EN || tr('Untitled')}
                  </h2>
                  {activeEntry.TITLE_AR && (
                    <p dir="rtl" className="mt-1 text-[12.5px] leading-snug text-ink-2">
                      {activeEntry.TITLE_AR}
                    </p>
                  )}
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(activeEntry)}>
                      <Pencil size={12} /> {tr('Edit')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmTarget(activeEntry)}>
                      <Trash2 size={12} /> {tr('Delete')}
                    </Button>
                  </div>
                )}
              </div>

              <div className="px-4 py-2">
                {featureCount(activeEntry) === 0 ? (
                  <p className="py-4 text-[11.5px] text-ink-3">{tr('No features listed for this version.')}</p>
                ) : (
                  <ol className="divide-y divide-line/70">
                    {(activeEntry.FEATURES || []).map((feature, index) => (
                      <li
                        key={feature.FEATURE_ID ?? index}
                        className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 py-2 lg:grid-cols-[20px_minmax(0,1fr)_minmax(0,0.9fr)]"
                      >
                        <span className="mono pt-[3px] text-[9.5px] leading-none text-ink-3" aria-hidden="true">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <p className="text-[12px] leading-relaxed text-ink">
                          {feature.FEATURE_TEXT_EN || tr('No English text')}
                        </p>
                        <p
                          dir="rtl"
                          className="col-start-2 mt-0.5 text-end text-[11.5px] leading-relaxed text-ink-2 lg:col-start-3 lg:mt-0"
                        >
                          {feature.FEATURE_TEXT_AR || '—'}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {(activeEntry.TITLE_FR || (activeEntry.FEATURES || []).some(f => f.FEATURE_TEXT_FR)) && (
                <details className="group border-t border-line px-4 py-2">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[10.5px] font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
                    <ChevronDown
                      size={12}
                      strokeWidth={2}
                      aria-hidden="true"
                      className="text-ink-3 transition-transform group-open:rotate-180"
                    />
                    {tr('Français')}
                  </summary>
                  <div className="pb-2 ps-4">
                    {activeEntry.TITLE_FR && (
                      <p className="text-[12px] font-medium text-ink">{activeEntry.TITLE_FR}</p>
                    )}
                    <ul className="mt-1 space-y-1">
                      {(activeEntry.FEATURES || []).filter(f => f.FEATURE_TEXT_FR).map((feature, index) => (
                        <li
                          key={feature.FEATURE_ID ?? index}
                          className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-2"
                        >
                          <span
                            aria-hidden="true"
                            className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full"
                            style={{ background: 'var(--color-ink-3)' }}
                          />
                          {feature.FEATURE_TEXT_FR}
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              )}
            </Panel>
          )}
        </div>
      )}

      {/* Editor (ADMIN / DEVELOPER only) */}
      <Modal
        open={!!editor}
        onClose={closeEditor}
        title={editor?.id ? tr('Edit release') : tr('New release')}
        description={tr('A release with its version, date and the features it brought, in every language it was written in.')}
        maxWidth="max-w-[720px]"
        footer={
          <div className="flex items-center justify-end gap-1.5">
            <Button variant="secondary" size="sm" onClick={closeEditor} disabled={saving}>
              {tr('Cancel')}
            </Button>
            <Button type="submit" form="changelog-form" size="sm" disabled={!formComplete || saving}>
              <Save size={12} /> {saving ? tr('Saving...') : tr('Save release')}
            </Button>
          </div>
        }
      >
        {editor && (
          <form id="changelog-form" onSubmit={handleSave} className="space-y-3.5">
            {formError && (
              <div className="flex items-start gap-2 rounded-[4px] border border-danger/40 bg-danger-bg px-2.5 py-2 text-[11.5px] text-danger-ink">
                <AlertCircle size={13} className="mt-px shrink-0" /> {formError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="changelog-version" className="kicker mb-1 block text-[9px]">
                  {tr('Version')} *
                </label>
                <input
                  id="changelog-version"
                  type="text"
                  value={editor.form.version}
                  onChange={e => setForm('version', e.target.value)}
                  placeholder={tr('e.g. 4.1')}
                  className="field mono text-[12px]"
                />
              </div>
              <div>
                <label htmlFor="changelog-date" className="kicker mb-1 block text-[9px]">
                  {tr('Release date')} *
                </label>
                <input
                  id="changelog-date"
                  type="date"
                  value={editor.form.release_date}
                  onChange={e => setForm('release_date', e.target.value)}
                  className="field mono text-[12px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="changelog-title-en" className="kicker mb-1 block text-[9px]">
                  {tr('Title (English)')} *
                </label>
                <input
                  id="changelog-title-en"
                  type="text"
                  value={editor.form.title_en}
                  onChange={e => setForm('title_en', e.target.value)}
                  className="field text-[12px]"
                />
              </div>
              <div>
                <label htmlFor="changelog-title-ar" className="kicker mb-1 block text-[9px]">
                  {tr('Title (Arabic)')} *
                </label>
                <input
                  id="changelog-title-ar"
                  type="text"
                  dir="rtl"
                  value={editor.form.title_ar}
                  onChange={e => setForm('title_ar', e.target.value)}
                  className="field text-[12px]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="changelog-title-fr" className="kicker mb-1 block text-[9px]">
                {tr('Title (French)')}
              </label>
              <input
                id="changelog-title-fr"
                type="text"
                value={editor.form.title_fr}
                onChange={e => setForm('title_fr', e.target.value)}
                className="field text-[12px]"
              />
            </div>

            {/* Features are entered one by one; their order is the display order. */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
                <span className="kicker text-[9px]">{tr('Features')}</span>
                <Button variant="secondary" size="sm" onClick={addFeature}>
                  <ListPlus size={12} /> {tr('Add feature')}
                </Button>
              </div>

              {editor.form.features.map((feature, index) => (
                <div key={index} className="rounded-[4px] border border-line bg-surface-muted/40 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="mono text-[9.5px] leading-none text-ink-3">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="kicker text-[9px]">{tr('Feature')}</span>
                    <button
                      type="button"
                      onClick={() => removeFeature(index)}
                      disabled={editor.form.features.length === 1}
                      title={tr('Remove feature')}
                      aria-label={`${tr('Remove feature')} ${index + 1}`}
                      className="ms-auto grid h-5 w-5 place-items-center rounded-[3px] text-ink-3 hover:bg-danger-bg hover:text-danger-ink disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  <div className="mt-2 space-y-1.5">
                    <input
                      type="text"
                      className="field text-[11.5px]"
                      maxLength={500}
                      placeholder={tr('English text')}
                      aria-label={`${tr('English text')} ${index + 1}`}
                      value={feature.en}
                      onChange={e => setFeature(index, 'en', e.target.value)}
                    />
                    <input
                      type="text"
                      className="field text-[11.5px]"
                      maxLength={500}
                      dir="rtl"
                      placeholder="النص العربي"
                      aria-label={`${tr('Arabic text')} ${index + 1}`}
                      value={feature.ar}
                      onChange={e => setFeature(index, 'ar', e.target.value)}
                    />
                    <input
                      type="text"
                      className="field text-[11.5px]"
                      maxLength={500}
                      placeholder={tr('Texte français (optionnel)')}
                      aria-label={`${tr('French text')} ${index + 1}`}
                      value={feature.fr}
                      onChange={e => setFeature(index, 'fr', e.target.value)}
                    />
                  </div>
                </div>
              ))}

              <p className="text-[10.5px] leading-relaxed text-ink-3">
                {tr('Each feature is one bullet. English is required; Arabic and French are optional.')}
              </p>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        title={tr('Delete Changelog Entry')}
        message={confirmTarget
          ? `${tr('Delete release')} ${confirmTarget.VERSION}? ${tr('Its features will be removed too.')}`
          : ''}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => { const entry = confirmTarget; setConfirmTarget(null); handleDelete(entry) }}
      />
    </div>
  )
}

export default Changelog
