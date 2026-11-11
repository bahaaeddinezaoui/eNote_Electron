import React, { useEffect, useState } from 'react'
import { AlertCircle, Check } from 'lucide-react'
import { tr } from '../i18n'
import Modal from './ui/Modal'

// Teaching volume and section volume belong together: the group's target, the
// hours its sessions have put on the timetable, how the target is split by
// session type, and which sections receive those hours. They used to sit in two
// collapsed panels at the foot of the page, each repeating the same selectors,
// and the section panel re-read the group's own total under another name.
// One dialog with one fetch keeps both halves on the same numbers.

const fmtHours = (value) => {
  const number = Number(value) || 0
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

const toneOf = (progress) => (
  progress >= 100
    ? 'var(--color-success)'
    : progress >= 50
      ? 'var(--color-jade-solid)'
      : 'var(--color-warning)'
)

function ProgressBar({ value }) {
  return (
    <div className="h-1 w-full overflow-hidden bg-sunken">
      <div
        className="h-full"
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%`, background: toneOf(value) }}
      />
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="px-3 py-2">
      <div className="mono text-[17px] leading-tight text-ink" style={tone ? { color: tone } : undefined}>{value}</div>
      <div className="mt-0.5 text-[9.5px] uppercase tracking-[0.1em] text-ink-3">{label}</div>
    </div>
  )
}

const ScheduleVolumePanel = ({ open, onClose, majors = [], semesterId = '', semesterLabel = '' }) => {
  const [majorId, setMajorId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [progress, setProgress] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [targetDraft, setTargetDraft] = useState('0')
  const [typeDrafts, setTypeDrafts] = useState({})

  // A fresh opening starts on a major that still exists, with every group's
  // totals in view; drilling into one group is a click, not the default.
  useEffect(() => {
    if (!open) return
    setError('')
    setMessage('')
    setGroupId('')
    setMajorId((current) => (
      current && majors.some((major) => String(major.MAJOR_ID) === String(current))
        ? current
        : (majors[0] ? String(majors[0].MAJOR_ID) : '')
    ))
  }, [open, majors])

  const load = async (nextMajorId, nextGroupId) => {
    if (!nextMajorId || !semesterId) {
      setProgress(null)
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await window.api.getMajorHourlyProgress(nextMajorId, semesterId, nextGroupId)
      setProgress(result?.data || result || null)
    } catch (err) {
      console.error('Failed to load hourly volume progress', err)
      setProgress(null)
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    load(majorId, groupId)
  }, [open, majorId, groupId, semesterId])

  // Drafts follow the saved numbers, so a reload after a save shows the value
  // the database now holds.
  useEffect(() => {
    if (!progress) return
    setTargetDraft(String(progress.targetVolume ?? 0))
    const drafts = {}
    for (const row of progress.progressBySessionType || []) {
      drafts[row.sessionTypeId] = String(row.targetHours ?? 0)
    }
    setTypeDrafts(drafts)
  }, [progress])

  const groups = progress?.groups || []
  const selected = progress?.teachingGroupId ? progress : null
  const typeRows = selected ? selected.progressBySessionType || [] : []
  const groupTargetSet = !!selected && selected.targetSet !== false

  const saveGroupTarget = async () => {
    const value = Number(targetDraft)
    if (!Number.isFinite(value) || value < 0) {
      setError(tr('Enter a target of 0 hours or more.'))
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      // The service upserts, so the first target for a group is saved the same
      // way as a correction to an existing one.
      await window.api.createMajorHourlyVolume({
        MAJOR_ID: Number(majorId),
        STUDY_SEMESTER_ID: Number(semesterId),
        TEACHING_GROUP_ID: Number(groupId),
        HOURLY_VOLUME: value
      })
      await load(majorId, groupId)
      setMessage(tr('Group target saved.'))
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  const saveTypeTarget = async (row) => {
    const value = Number(typeDrafts[row.sessionTypeId])
    if (!Number.isFinite(value) || value < 0) {
      setError(tr('Enter a target of 0 hours or more.'))
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await window.api.createMajorHourlyVolumeBySessionType({
        MAJOR_ID: Number(majorId),
        STUDY_SEMESTER_ID: Number(semesterId),
        STUDY_SESSION_TYPE_ID: row.sessionTypeId,
        TEACHING_GROUP_ID: Number(groupId),
        HOURLY_VOLUME: value
      })
      await load(majorId, groupId)
      setMessage(tr('Session-type target saved.'))
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  const allGroupsTarget = groups.reduce((sum, group) => sum + (Number(group.targetVolume) || 0), 0)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr('Teaching volume')}
      description={tr('Targets and scheduled hours for a major, its groups and their sections.')}
      maxWidth="max-w-[760px]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="mono text-[9.5px] text-ink-3">
            {progress
              ? `${fmtHours(progress.actualHours)} ${tr('h')} · ${fmtHours(progress.targetVolume)} ${tr('h')}`
              : '—'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted"
          >
            {tr('Close')}
          </button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
          <div>
            <label className="field-label" htmlFor="volume-panel-major">{tr('Major')}</label>
            <select
              id="volume-panel-major"
              value={majorId}
              onChange={(event) => { setMajorId(event.target.value); setGroupId('') }}
              className="field"
            >
              {majors.length === 0 && <option value="">{tr('No major available')}</option>}
              {majors.map((major) => (
                <option key={major.MAJOR_ID} value={major.MAJOR_ID}>{major.MAJOR_LABEL}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="volume-panel-group">{tr('Teaching group')}</label>
            <select
              id="volume-panel-group"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              className="field"
              disabled={groups.length === 0}
            >
              <option value="">{tr('All teaching groups')}</option>
              {groups.map((group) => (
                <option key={group.teachingGroupId} value={group.teachingGroupId}>
                  {group.teachingGroupLabel || tr('Teaching group')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="field-label">{tr('Semester')}</span>
            <div className="field flex items-center text-ink-3">
              {semesterLabel || tr('No semester selected')}
            </div>
          </div>
        </div>

        {error && (
          <div
            className="flex items-start gap-2 border px-2.5 py-2 text-[11.5px] leading-relaxed"
            style={{ background: 'var(--color-danger-bg)', borderColor: 'var(--color-danger)', color: 'var(--color-danger-ink)' }}
          >
            <AlertCircle size={13} className="mt-px shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {message && (
          <div className="flex items-start gap-2 border border-line bg-surface-muted px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-2">
            <Check size={13} className="mt-px shrink-0" style={{ color: 'var(--color-success)' }} />
            <span>{message}</span>
          </div>
        )}

        {!majorId ? (
          <p className="text-[11px] text-ink-3">{tr('Choose a major to read its volume targets.')}</p>
        ) : loading && !progress ? (
          <p className="text-[11px] text-ink-3">{tr('Loading…')}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 divide-line border border-line sm:grid-cols-4 sm:divide-x">
              <Stat label={tr('Target hours')} value={fmtHours(progress?.targetVolume)} />
              <Stat label={tr('Scheduled hours')} value={fmtHours(progress?.actualHours)} />
              <Stat label={tr('Remaining hours')} value={fmtHours(progress?.remainingHours)} />
              <Stat
                label={tr('Progress')}
                value={`${progress?.progress ?? 0}%`}
                tone={toneOf(progress?.progress ?? 0)}
              />
            </div>
            <ProgressBar value={progress?.progress ?? 0} />

            {!selected && allGroupsTarget === 0 && groups.length > 0 && (
              <p className="border border-line bg-surface-muted px-3 py-2 text-[11px] text-ink-3">
                {tr('No volume target is set for this major in the current semester yet. Pick a group below and give it a target.')}
              </p>
            )}

            {selected && (
              <div className="space-y-3">
                <div className="border-t border-line pt-2.5">
                  <label className="field-label" htmlFor="volume-panel-target">
                    {tr('Target hourly volume for')}{' '}
                    {selected.teachingGroupLabel || tr('the selected teaching group')}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="volume-panel-target"
                      type="number"
                      min="0"
                      value={targetDraft}
                      onChange={(event) => setTargetDraft(event.target.value)}
                      className="field h-7"
                      style={{ width: 88 }}
                    />
                    <button
                      type="button"
                      onClick={saveGroupTarget}
                      disabled={saving}
                      className="inline-flex h-7 items-center rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold hover:brightness-110 disabled:opacity-60"
                      style={{ color: 'var(--color-on-jade)' }}
                    >
                      {tr('Update')}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">
                    {fmtHours(selected.allocatedHours)}{' '}{tr('of')}{' '}{fmtHours(selected.targetVolume)}{' '}
                    {tr('hours allocated to this group’s session types. Set the group target before its session-type targets.')}
                  </p>
                </div>

                <div className="border-t border-line pt-2.5">
                  <div className="kicker mb-2 text-[9px]">{tr('Target hours by session type')}</div>
                  {!groupTargetSet && (
                    <p
                      className="mb-2 border border-line px-2 py-1.5 text-[10.5px]"
                      style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning-ink)' }}
                    >
                      {tr('Set the overall target hourly volume first — session-type targets stay disabled until then.')}
                    </p>
                  )}
                  <div className="space-y-2">
                    {typeRows.map((row) => (
                      <div key={row.sessionTypeId} className="border border-line px-2.5 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{row.sessionTypeLabel}</span>
                          <span className="mono text-[10px] text-ink-3">
                            {fmtHours(row.actualHours)}/{fmtHours(row.targetHours)}{tr('h')}
                          </span>
                          <input
                            type="number"
                            min="0"
                            aria-label={tr('Target hours by session type')}
                            value={typeDrafts[row.sessionTypeId] ?? '0'}
                            onChange={(event) => setTypeDrafts((current) => ({ ...current, [row.sessionTypeId]: event.target.value }))}
                            disabled={!groupTargetSet || saving}
                            className="field h-7 w-20 disabled:cursor-not-allowed"
                          />
                          <button
                            type="button"
                            onClick={() => saveTypeTarget(row)}
                            disabled={!groupTargetSet || saving}
                            className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2 text-[10.5px] text-ink-2 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {tr('Set')}
                          </button>
                        </div>
                        <div className="mt-1.5">
                          <ProgressBar value={row.progress} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-line pt-2.5">
                  <div className="kicker mb-2 text-[9px]">{tr('Sections of this group')}</div>
                  {selected.sections && selected.sections.length > 0 ? (
                    <>
                      <div className="divide-y divide-line overflow-hidden rounded-[4px] border border-line">
                        {selected.sections.map((section) => (
                          <div key={section.sectionId} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                            <span className="truncate text-[11.5px] text-ink-2">{section.label || tr('Section')}</span>
                            <span className="mono shrink-0 text-[11px] text-ink">{fmtHours(section.hours)}{tr('h')}</span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">
                        {tr('Every section of a teaching group attends all of its sessions, so each one receives the hours shown.')}
                      </p>
                    </>
                  ) : (
                    <p className="text-[10.5px] text-ink-3">{tr('This teaching group has no sections yet.')}</p>
                  )}
                </div>
              </div>
            )}

            <div className="border-t border-line pt-2.5">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="kicker text-[9px]">{tr('Groups of this major')}</span>
                <span className="text-[10px] text-ink-3">{tr('Click a group to set its target and read its session types.')}</span>
              </div>
              {groups.length === 0 ? (
                <p className="text-[11px] text-ink-3">{tr('No teaching group studies this major in the selected semester yet.')}</p>
              ) : (
                <div className="divide-y divide-line overflow-hidden rounded-[4px] border border-line">
                  <div className="grid grid-cols-[1fr_64px_74px_60px] gap-2 bg-surface-muted px-2.5 py-1.5 text-[9px] uppercase tracking-[0.08em] text-ink-3">
                    <span>{tr('Teaching group')}</span>
                    <span className="text-end">{tr('Target hours')}</span>
                    <span className="text-end">{tr('Scheduled hours')}</span>
                    <span className="text-end">{tr('Progress')}</span>
                  </div>
                  {groups.map((group) => {
                    const active = String(group.teachingGroupId) === String(selected?.teachingGroupId || '')
                    return (
                      <button
                        key={group.teachingGroupId}
                        type="button"
                        onClick={() => setGroupId(String(group.teachingGroupId))}
                        className={`grid w-full grid-cols-[1fr_64px_74px_60px] items-center gap-2 px-2.5 py-1.5 text-start ${active ? 'bg-selection' : 'hover:bg-surface-muted'}`}
                        aria-pressed={active}
                      >
                        <span className="truncate text-[11.5px] text-ink">{group.teachingGroupLabel || tr('Teaching group')}</span>
                        <span className="mono text-end text-[11px] text-ink-2">{fmtHours(group.targetVolume)}</span>
                        <span className="mono text-end text-[11px] text-ink-2">{fmtHours(group.actualHours)}</span>
                        <span className="mono text-end text-[11px]" style={{ color: toneOf(group.progress) }}>{group.progress}%</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

export default ScheduleVolumePanel
