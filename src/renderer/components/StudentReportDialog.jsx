import React, { useEffect, useState } from 'react'
import { FileDown, Check, AlertCircle, IdCard, UserX, Notebook, Award, Gavel } from 'lucide-react'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { tr } from '../i18n'
import { personNameLastFirst } from '../../shared/personNames'

// Asked before a report is generated: which blocks to print and in which
// language, or in a bilingual pair. The PDF itself is built in the main
// process (Chromium print) from an A4 stylesheet; the dialog mirrors the same
// section order.
const SECTION_OPTIONS = [
  { id: 'details', label: 'Student details', hint: 'Identity, birth place, health, schooling, family, contacts, uniforms and photo', icon: IdCard },
  { id: 'absences', label: 'Absences', hint: 'Every recorded absence with its justification and instructor', icon: UserX },
  { id: 'observations', label: 'Observations', hint: 'Teacher observations with their motif and note', icon: Notebook },
  { id: 'rewards', label: 'Rewards', hint: 'Rewards granted, with dates and the recording office', icon: Award },
  { id: 'punishments', label: 'Punishments', hint: 'Punishments applied, with dates and the recording office', icon: Gavel }
]

// Bilingual pairs carry both languages; the main process prints the complete
// report once per language, Arabic first, each pass on a new page.
const LANGUAGE_OPTIONS = [
  { id: 'en', label: 'English', tag: 'EN', languages: ['en'] },
  { id: 'ar', label: 'العربية', tag: 'AR', languages: ['ar'], dir: 'rtl' },
  { id: 'fr', label: 'Français', tag: 'FR', languages: ['fr'] },
  { id: 'ar-fr', label: 'Arabic + French', tag: 'AR + FR', languages: ['ar', 'fr'] },
  { id: 'ar-en', label: 'Arabic + English', tag: 'AR + EN', languages: ['ar', 'en'] }
]

const StudentReportDialog = ({ open, onClose, user, student }) => {
  const [sections, setSections] = useState(SECTION_OPTIONS.map((option) => option.id))
  const [language, setLanguage] = useState('en')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedPath, setSavedPath] = useState('')

  useEffect(() => {
    if (!open) return
    setSections(SECTION_OPTIONS.map((option) => option.id))
    setLanguage('en')
    setSaving(false)
    setError('')
    setSavedPath('')
  }, [open, student?.PERSON_ID])

  if (!open || !student) return null

  const selectedLanguage = LANGUAGE_OPTIONS.find((option) => option.id === language) || LANGUAGE_OPTIONS[0]

  const toggleSection = (id) => {
    setError('')
    setSavedPath('')
    setSections((current) =>
      current.includes(id) ? current.filter((section) => section !== id) : [...current, id]
    )
  }

  const name = personNameLastFirst(student.PERSON_LAST_NAME, student.PERSON_FIRST_NAME) || tr('Student')

  const generate = async () => {
    setError('')
    setSavedPath('')
    if (sections.length === 0) {
      setError(tr('Select at least one section to include in the report.'))
      return
    }
    setSaving(true)
    try {
      const response = await window.api.generateStudentReportPdf(user?.id, student.PERSON_ID, {
        sections,
        languages: selectedLanguage.languages
      })
      if (response?.canceled) return
      if (response?.success) setSavedPath(response.filePath)
    } catch (err) {
      setError(err.message || tr('Could not generate the report.'))
    } finally {
      setSaving(false)
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10.5px] text-ink-3">
        {tr('A4 · {count} of {total} blocks · {language}', {
          count: sections.length,
          total: SECTION_OPTIONS.length,
          language: selectedLanguage.tag
        })}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose} autoFocus>{savedPath ? tr('Close') : tr('Cancel')}</Button>
        <Button onClick={generate} loading={saving} disabled={sections.length === 0}>
          {!saving && <FileDown size={12} strokeWidth={2} />}
          {saving ? tr('Generating…') : tr('Export PDF')}
        </Button>
      </div>
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title={tr('Export student report')} maxWidth="max-w-[560px]" footer={footer}>
      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2.5">
        <div className="min-w-0">
          <div className="serif truncate text-[20px] leading-tight text-ink">{name}</div>
          <div className="mono mt-0.5 text-[10px] text-ink-3">
            № {String(student.PERSON_ID).padStart(4, '0')}
            {student.sectionData?.SECTION_LABEL ? ` · ${student.sectionData.SECTION_LABEL}` : ''}
          </div>
        </div>
        <span className="kicker shrink-0 text-[9px]">{tr('Registry copy')}</span>
      </div>

      <fieldset className="mt-3">
        <legend className="kicker mb-1.5 text-[9.5px]">{tr('Blocks to include')}</legend>
        <div className="overflow-hidden rounded-[4px] border border-line">
          {SECTION_OPTIONS.map((option, index) => {
            const Icon = option.icon
            const checked = sections.includes(option.id)
            return (
              <label
                key={option.id}
                className={`flex cursor-pointer items-start gap-2.5 px-2.5 py-2 ${index ? 'border-t border-line' : ''} ${
                  checked ? 'bg-surface' : 'bg-surface-muted'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSection(option.id)}
                  className="mt-0.5 h-3 w-3 shrink-0 cursor-pointer"
                  style={{ accentColor: 'var(--color-jade-solid)' }}
                />
                <Icon size={13} strokeWidth={1.75} className={`mt-px shrink-0 ${checked ? 'text-jade-600' : 'text-ink-3'}`} />
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium text-ink">{tr(option.label)}</span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-3">{tr(option.hint)}</span>
                </span>
                <span className="mono ms-auto shrink-0 text-[9.5px] text-ink-3">{String(index + 1).padStart(2, '0')}</span>
              </label>
            )
          })}
        </div>
        <p className="mt-1.5 text-[10px] text-ink-3">
          {tr('The student photo is included with the details, or an anonymous placeholder when none is on file.')}
        </p>
      </fieldset>

      <fieldset className="mt-3">
        <legend className="kicker mb-1.5 text-[9.5px]">{tr('Language')}</legend>
        <div className="grid grid-cols-2 overflow-hidden rounded-[4px] border border-line-strong">
          {LANGUAGE_OPTIONS.map((option, index) => {
            const active = language === option.id
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => { setLanguage(option.id); setError(''); setSavedPath('') }}
                title={tr(option.label)}
                className={`h-8 border-line-strong text-[11.5px] ${index % 2 === 1 ? 'border-s' : ''} ${index >= 2 ? 'border-t' : ''} ${index === LANGUAGE_OPTIONS.length - 1 ? 'col-span-2' : ''} ${
                  active ? 'bg-selection text-ink' : 'bg-surface text-ink-3 hover:bg-surface-muted hover:text-ink'
                }`}
              >
                <span dir={option.dir} className="me-1.5">{tr(option.label)}</span>
                <span className="mono text-[9px] opacity-60">{option.tag}</span>
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-[10px] text-ink-3">
          {selectedLanguage.languages.length > 1
            ? tr('Bilingual reports print the complete report in both languages, Arabic first, each starting on a new page.')
            : tr('Arabic reports are right-to-left and use Arabic-Indic figures inside RTL text.')}
        </p>
      </fieldset>

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-center gap-1.5 rounded-[3px] border px-2 py-1.5 text-[11px]"
          style={{ background: 'var(--color-danger-bg)', borderColor: 'var(--color-danger)', color: 'var(--color-danger-ink)' }}
        >
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {savedPath && (
        <div
          role="status"
          aria-live="polite"
          className="mt-3 rounded-[3px] border px-2 py-1.5"
          style={{ background: 'var(--color-success-bg)', borderColor: 'var(--color-success)' }}
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--color-success-ink)' }}>
            <Check size={12} /> {tr('Report saved')}
          </div>
          <div className="mono mt-1 break-all text-[10px]" style={{ color: 'var(--color-success-ink)' }}>{savedPath}</div>
        </div>
      )}
    </Modal>
  )
}

export default StudentReportDialog
