import React, { useState, useEffect, useMemo } from 'react'
import {
  Lock, Unlock, ShieldCheck, AlertCircle, CheckCircle2, Trash2,
  FlaskConical, Search, MessageSquare, AtSign, Save, Check, Sparkles,
  BellRing, BellOff, Gauge, Leaf, ZoomIn,
  Crown, ScrollText, FileBadge, Tag, Tags, DoorOpen, DatabaseZap, Clock,
  Compass, Building2, Download, BookOpen, FolderTree, Plus, Pencil, ShieldAlert,
  MonitorSmartphone
} from 'lucide-react'
import { localizedLabel, tr } from '../i18n'
import DataTable from './ui/DataTable'
import Modal from './ui/Modal'
import { PageIntro } from './ui/PageHeader'
import Button from './ui/Button'
import { useMotion } from '../motion'
import {
  INTERFACE_SCALES,
  interfaceScalePercent,
  useInterfaceScale
} from '../interfaceScale'
import { ReleaseNoteDialog, formatReleaseDate } from './NewVersionDialog'
import { isNotificationSoundEnabled, setNotificationSoundEnabled } from '../notificationSound'
import { NOTIFICATION_FAMILIES } from '../../shared/notificationFamilies'
import { lockableRoutes } from '../nav'
import { broadcastPageLocks, LOCKABLE_ROLES } from '../pageLocks'
import RegistersDialog from './settings/RegistersDialog'
import LegacyImportDialog from './settings/LegacyImportDialog'
import { CONSTRAINT_POLICIES, constraintPolicyLabel, normalizeConstraintPolicy } from '../constraintPolicies'

// The credential dialogs live in their own chunk: the settings list is the
// common path, and none of these forms is worth parsing until one is opened.
const AccountModals = React.lazy(() => import('./settings/AccountModals'))

// Settings — global application options. Only ADMIN users can change values,
// with one exception: the exam marks lock also belongs to a DIRECTOR. The save
// is re-checked server-side against the user's roles (settings:set handler), so
// the UI's editability is a courtesy, not the gate.
//
// Options live in the app_option table (key/value):
//   exam_marks_locked: '1' → saveExaminationMarks refuses every write
//   server-side, so locking holds even against modified clients.
//   student_deletion_allowed: '0' → deletePerson refuses to delete a student
//   and Student Records hides the delete action; teachers stay deletable.
//   required_client_version: '' → no gate; a version such as '4.0.1' makes
//   every older client show the update screen until it is replaced.
//
// Beta testers are a per-account flag on "user" (is_beta_tester), managed here
// by an admin. Listing and flipping the flag are Admin-only server-side too.

// The two interface motion modes. Performance keeps the crafted animations and
// transitions; power save turns every one of them off (index.css keys off the
// data-motion attribute that motion.js sets on <html>).
const MOTION_OPTIONS = [
  {
    id: 'performance',
    icon: Gauge,
    label: 'Performance',
    description: 'Premium animations and transitions on pages, dialogs, menus and hover states.'
  },
  {
    id: 'powersave',
    icon: Leaf,
    label: 'Power save',
    description: 'No animations or transitions: the interface changes instantly and spends less power.'
  }
]

// Conduct rights stored on each secretary account (secretary_detail): what the
// account may do to the conduct ledger, per action and per entity. Adding a new
// entry, editing one that is already on the record and deleting are separate
// rights, so a secretary can be allowed to add a punishment but not to change
// or remove one. The matching column is what getSecretaries returns.
//
// The same six actions also have a global master switch in app_option, shown
// above the per-secretary list. Turning a master switch off blocks the action
// for every secretary; turning it on leaves each account's own right in charge.
const CONDUCT_RIGHTS = [
  { key: 'canAddPunishments', column: 'CAN_ADD_PUNISHMENTS', label: 'Add punishments' },
  { key: 'canEditPunishments', column: 'CAN_EDIT_PUNISHMENTS', label: 'Edit punishments' },
  { key: 'canDeletePunishments', column: 'CAN_DELETE_PUNISHMENTS', label: 'Delete punishments' },
  { key: 'canAddRewards', column: 'CAN_ADD_REWARDS', label: 'Add rewards' },
  { key: 'canEditRewards', column: 'CAN_EDIT_REWARDS', label: 'Edit rewards' },
  { key: 'canDeleteRewards', column: 'CAN_DELETE_REWARDS', label: 'Delete rewards' }
]

const defaultGlobalConductRights = () =>
  Object.fromEntries(CONDUCT_RIGHTS.map(right => [right.key, true]))

const conductAccountName = (account) =>
  [account.PERSON_FIRST_NAME_LA, account.PERSON_LAST_NAME_LA].filter(Boolean).join(' ')
  || account.USER_USERNAME

const SettingsPage = ({ user }) => {
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState(null) // { type, text }

  const [betaUsers, setBetaUsers] = useState([])
  const [betaLoading, setBetaLoading] = useState(false)
  const [betaSearch, setBetaSearch] = useState('')
  const [savingBetaId, setSavingBetaId] = useState(null)

  // Conduct rights (Admin only): the six rewards-and-punishments flags each
  // secretary account carries in secretary_detail, plus the six global master
  // switches in app_option. Saved as soon as a switch is toggled, exactly like
  // the account page.
  const [conductAccounts, setConductAccounts] = useState([])
  const [conductLoading, setConductLoading] = useState(false)
  const [conductSearch, setConductSearch] = useState('')
  const [conductSavingKey, setConductSavingKey] = useState('')
  const [conductGlobalRights, setConductGlobalRights] = useState(defaultGlobalConductRights)
  const [conductGlobalLoading, setConductGlobalLoading] = useState(false)
  const [conductGlobalSaving, setConductGlobalSaving] = useState(false)

  // Password reset for another account (Admin only). The account is looked up
  // by username, first name, last name or person id; the password itself is
  // set server-side and never returned.

  // The signed-in user's own account (every role): username and password.
  // Both forms moved here from the Profile page, which is now read-only.
  const [savedUsername, setSavedUsername] = useState('')

  // Furnishing of this machine, not a database option: the chime plays in the
  // renderer, so the preference is stored locally and applies immediately.
  const [soundEnabled, setSoundEnabled] = useState(() => isNotificationSoundEnabled())

  // Interface motion is a preference of this computer too: stored locally and
  // applied by CSS the moment the mode changes (see motion.js).
  const [motionMode, setMotionMode] = useMotion()

  // Interface scale: how large this window draws, stored on this computer and
  // applied to the whole window (see interfaceScale.js).
  const [interfaceScale, setInterfaceScale] = useInterfaceScale()

  const toggleSound = () => {
    const next = !soundEnabled
    setSoundEnabled(next)
    setNotificationSoundEnabled(next)
  }

  // Muted notification families: a preference of the account, saved in the
  // database, so a director who stops reading lesson-material notices is not
  // told about them again on the laptop in the office.
  const [mutedFamilies, setMutedFamilies] = useState({})
  const [mutingFamily, setMutingFamily] = useState('')

  const loadNotificationPreferences = async () => {
    try {
      const res = await window.api.getNotificationPreferences(user?.id)
      const next = {}
      for (const family of res?.families || []) next[family.id] = !!family.muted
      setMutedFamilies(next)
    } catch (err) {
      console.error('Failed to load notification preferences', err)
    }
  }

  const toggleFamily = async (family) => {
    const next = !mutedFamilies[family.id]
    setMutingFamily(family.id)
    setMutedFamilies(prev => ({ ...prev, [family.id]: next }))
    try {
      await window.api.setNotificationMute(user?.id, family.id, next)
      setMessage({
        type: 'ok',
        text: next
          ? `${family.label}: muted — no chime, no popup, no badge. The rows stay on the notifications page.`
          : `${family.label}: notifications are counted and announced again.`
      })
    } catch (err) {
      setMutedFamilies(prev => ({ ...prev, [family.id]: !next }))
      setMessage({ type: 'error', text: err.message || tr('Could not save the preference.') })
    } finally {
      setMutingFamily('')
    }
  }


  // Who may message whom (Admin only): roles x roles contact matrix.
  const [msgRoles, setMsgRoles] = useState([])
  const [msgRules, setMsgRules] = useState({})
  const [msgLoading, setMsgLoading] = useState(false)
  const [msgSavingKey, setMsgSavingKey] = useState('')

  // Pages an administrator has locked (app_locked_page), per role: the sidebar
  // mark is shown to everyone, the locked notice only to the roles the lock
  // names (an empty role list closes the page for every role).
  const [pageLocks, setPageLocks] = useState([])
  const [lockBusy, setLockBusy] = useState('')
  const [lockRoleBusy, setLockRoleBusy] = useState('')
  const [lockSearch, setLockSearch] = useState('')

  // What's new: the latest release, readable again after its dialog was
  // dismissed. It is the same dialog, opened on demand.
  const [latestRelease, setLatestRelease] = useState(null)
  const [showRelease, setShowRelease] = useState(false)

  const canManage = user?.roles?.includes('ADMIN')
  // The legacy import is open to Developers as well as Admins; the service
  // re-checks the role against the database before reading the dump.
  const canDevelop = canManage || user?.roles?.includes('DEVELOPER')
  // Locking exam marks is an academic decision, so the row belongs to a
  // Director and an Admin only. A teacher still meets the lock on Exam marks
  // (the page reads the option read-only) but never administers it here.
  const canLockMarks = canManage || user?.roles?.includes('DIRECTOR')

  const loadLatestRelease = async () => {
    try {
      const res = await window.api.getChangelogs()
      setLatestRelease((res?.data || [])[0] || null)
    } catch {
      // The card simply stays hidden if the releases cannot be read.
    }
  }

  const loadOptions = async () => {
    setLoading(true)
    try {
      const res = await window.api.getSettings(user?.id)
      setOptions(res?.data || [])
    } catch (err) {
      console.error('Failed to load settings', err)
      setMessage({ type: 'error', text: tr('Failed to load settings: ') + err.message })
    } finally {
      setLoading(false)
    }
  }

  const loadBetaTesters = async () => {
    setBetaLoading(true)
    try {
      const res = await window.api.getBetaTesters(user?.id)
      setBetaUsers(res?.data || [])
    } catch (err) {
      console.error('Failed to load beta testers', err)
      setMessage({ type: 'error', text: tr('Failed to load beta testers: ') + err.message })
    } finally {
      setBetaLoading(false)
    }
  }

  // Only accounts that carry the Secretary role can hold conduct rights; the
  // roster also lists schedulers, so they are filtered out here.
  const loadConductAccounts = async () => {
    setConductLoading(true)
    try {
      const res = await window.api.getSecretaries(user?.id)
      setConductAccounts((res?.accounts || []).filter(account =>
        Array.isArray(account.ROLE_CODES) && account.ROLE_CODES.includes('SECRETARY')
      ))
    } catch (err) {
      console.error('Failed to load secretary rights', err)
      setMessage({ type: 'error', text: err.message })
    } finally {
      setConductLoading(false)
    }
  }

  const loadConductGlobalRights = async () => {
    setConductGlobalLoading(true)
    try {
      const res = await window.api.getConductGlobalRights(user?.id)
      setConductGlobalRights(prev => ({ ...prev, ...(res?.rights || {}) }))
    } catch (err) {
      console.error('Failed to load global conduct rights', err)
      setMessage({ type: 'error', text: err.message })
    } finally {
      setConductGlobalLoading(false)
    }
  }

  const toggleConductGlobalRight = async (rightKey) => {
    const next = { ...conductGlobalRights, [rightKey]: !conductGlobalRights[rightKey] }
    setConductGlobalSaving(true)
    try {
      const res = await window.api.setConductGlobalRights(user?.id, next)
      setConductGlobalRights(prev => ({ ...prev, ...(res?.rights || next) }))
      const right = CONDUCT_RIGHTS.find(item => item.key === rightKey)
      setMessage({
        type: 'ok',
        text: `${tr('Secretaries')} · ${tr(right?.label || 'Right')}: ${next[rightKey] ? tr('granted') : tr('withdrawn')}`
      })
    } catch (err) {
      console.error('Failed to save global conduct rights', err)
      setMessage({ type: 'error', text: err.message })
    } finally {
      setConductGlobalSaving(false)
    }
  }

  const toggleConductRight = async (account, rightKey) => {
    const next = {}
    for (const right of CONDUCT_RIGHTS) {
      next[right.key] = account[right.column] === true
    }
    next[rightKey] = !next[rightKey]

    const savingKey = `${account.USER_ID}:${rightKey}`
    setConductSavingKey(savingKey)
    try {
      await window.api.setSecretaryPermissions(user?.id, account.USER_ID, next)
      const savedColumns = {}
      for (const right of CONDUCT_RIGHTS) savedColumns[right.column] = next[right.key]
      setConductAccounts(prev => prev.map(item => (
        item.USER_ID === account.USER_ID
          ? { ...item, ...savedColumns }
          : item
      )))
      const right = CONDUCT_RIGHTS.find(item => item.key === rightKey)
      setMessage({
        type: 'ok',
        text: `${conductAccountName(account)} · ${tr(right?.label || 'Right')}: ${next[rightKey] ? tr('granted') : tr('withdrawn')}`
      })
    } catch (err) {
      console.error('Failed to save secretary rights', err)
      setMessage({ type: 'error', text: err.message })
    } finally {
      setConductSavingKey('')
    }
  }

  const loadPageLocks = async () => {
    try {
      const res = await window.api.getLockedPages()
      setPageLocks(Array.isArray(res?.locks) ? res.locks : [])
    } catch (err) {
      console.error('Failed to load locked pages', err)
    }
  }

  const loadMessagingRules = async () => {
    setMsgLoading(true)
    try {
      const res = await window.api.getMessagingRules(user?.id)
      setMsgRoles(res?.roles || [])
      const map = {}
      for (const rule of res?.rules || []) {
        map[`${rule.SENDER_ROLE_CODE}>${rule.TARGET_ROLE_CODE}`] = true
      }
      setMsgRules(map)
    } catch (err) {
      console.error('Failed to load message permissions', err)
      setMessage({ type: 'error', text: tr('Failed to load message permissions: ') + err.message })
    } finally {
      setMsgLoading(false)
    }
  }

  // Library (Admin): the upload and distribution restrictions and the
  // categories that file its documents. libraryService re-reads these on every
  // upload, so a restriction holds even against a modified client.
  const loadLibrary = async () => {
    setLibraryLoading(true)
    try {
      const [policyRes, categoriesRes] = await Promise.all([
        window.api.getLibraryPolicy(),
        window.api.getLibraryCategories(user?.id)
      ])
      if (policyRes) setLibraryPolicy(policyRes)
      setLibraryCategories(categoriesRes?.data || [])
    } catch (err) {
      console.error('Failed to load the Library settings', err)
    } finally {
      setLibraryLoading(false)
    }
  }

  useEffect(() => {
    loadOptions()
    loadOwnAccount()
    loadLatestRelease()
    loadNotificationPreferences()
    if (canManage) loadConductAccounts()
    // The Library group is open to a Developer as well: libraryService lets a
    // librarian account (Admin or Developer) manage the categories, and the
    // policy row inside the group is Admin-only on its own.
    if (canDevelop) loadLibrary()
    if (canDevelop) {
      loadBetaTesters()
      loadMessagingRules()
      loadPageLocks()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setOption = async (key, value) => {
    try {
      await window.api.setSetting(user?.id, key, value)
      setOptions(prev => prev.map(o => (o.OPTION_KEY === key ? { ...o, OPTION_VALUE: value, IS_DEFAULT: false } : o)))
      setMessage({
        type: 'ok',
        text: key === 'student_deletion_allowed'
          ? (value === '1'
              ? tr('Student deletion is allowed — students can be deleted from the records again.')
              : tr('Student deletion is denied — the delete action is hidden and refused for every role.'))
          : key === 'absence_removal_lock_minutes'
            ? (Number(value) > 0
                ? tr('Absence removal is locked for the first {count} minutes of each session.', { count: value })
                : tr('Absence removal is unlocked — absences can be removed at any time.'))
            : key === 'required_client_version'
              ? (value
                  ? `${tr('Clients older than')} ${value} ${tr('now show the update screen.')}`
                  : tr('The client version gate is off — every version may use the server.'))
            : key === 'developer_session_management'
              ? (value === '1'
                  ? tr('Developers can now view and end every account’s sessions.')
                  : tr('Developers manage only their own sessions again.'))
            : key.startsWith('teacher_constraints_')
              ? (key === 'teacher_constraints_enabled'
                  ? (value === '1'
                      ? tr('Weekly teacher constraints are on — teachers can declare windows.')
                      : tr('Weekly teacher constraints are off — declared windows are ignored.'))
                  : key === 'teacher_constraints_forced'
                    ? (value === '1'
                        ? tr('The constraint policy is now forced on every scheduler.')
                        : tr('Schedulers choose the constraint policy again.'))
                    : tr('Teacher constraint policy saved.'))
            : (value === '1'
                ? tr('Exam marks editing is now locked — teachers can no longer save marks.')
                : tr('Exam marks editing is unlocked — teachers can save marks again.'))
      })
    } catch (err) {
      console.error('Failed to save setting', err)
      setMessage({ type: 'error', text: err.message })
      return false
    }
    return true
  }

  // The version is saved by hand: typing a partial "4.0" must not gate every
  // client that is still on the previous release.
  const saveClientVersion = async () => {
    setSavingVersion(true)
    try {
      const saved = await setOption('required_client_version', versionDraft.trim())
      if (saved) closeSetting()
    } finally {
      setSavingVersion(false)
    }
  }

  // The absence-removal lock is a number of minutes, not a switch: 0 turns it
  // off. The client checks the range for a clear message; the server enforces
  // the same rule on write.
  const saveAbsenceLock = async () => {
    const raw = String(absenceLockDraft).trim()
    const minutes = Number(raw)
    if (!/^\d+$/.test(raw) || minutes < 0 || minutes > 1440) {
      setMessage({ type: 'error', text: tr('Enter a number of minutes between 0 and 1440.') })
      return
    }
    setSavingAbsenceLock(true)
    try {
      const saved = await setOption('absence_removal_lock_minutes', String(minutes))
      if (saved) closeSetting()
    } finally {
      setSavingAbsenceLock(false)
    }
  }

  const toggleBetaTester = async (account) => {
    const next = !account.IS_BETA_TESTER
    const name = [account.PERSON_FIRST_NAME, account.PERSON_LAST_NAME].filter(Boolean).join(' ') || account.USER_USERNAME
    setSavingBetaId(account.USER_ID)
    try {
      await window.api.setBetaTester(user?.id, account.USER_ID, next)
      setBetaUsers(prev => prev.map(u => (
        u.USER_ID === account.USER_ID ? { ...u, IS_BETA_TESTER: next } : u
      )))
      setMessage({
        type: 'ok',
        text: next ? `${name} is now a beta tester.` : `${name} is no longer a beta tester.`
      })
    } catch (err) {
      console.error('Failed to update beta tester flag', err)
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSavingBetaId(null)
    }
  }

  const toggleMessagingRule = async (senderRoleCode, targetRoleCode) => {
    const key = `${senderRoleCode}>${targetRoleCode}`
    const next = !msgRules[key]
    setMsgSavingKey(key)
    try {
      await window.api.setMessagingRule(user?.id, senderRoleCode, targetRoleCode, next)
      setMsgRules((prev) => ({ ...prev, [key]: next }))
      setMessage({
        type: 'ok',
        text: next
          ? `${senderRoleCode} users can now message ${targetRoleCode} users.`
          : `${senderRoleCode} users can no longer message ${targetRoleCode} users.`
      })
    } catch (err) {
      console.error('Failed to save message permission', err)
      setMessage({ type: 'error', text: err.message })
    } finally {
      setMsgSavingKey('')
    }
  }

  // Bulk switches: the whole matrix, every target of one sender role, or every
  // sender to one target role. They are commands, not a separate stored state:
  // the individual cells remain the source of truth and stay editable as
  // exceptions after a bulk change.
  const toggleMessagingScope = async (scope, roleCode, currentlyAllowed) => {
    const next = !currentlyAllowed
    const savingKey = scope === 'all' ? 'all' : `${scope}:${roleCode}`
    setMsgSavingKey(savingKey)
    try {
      await window.api.setMessagingScope(user?.id, scope, roleCode || null, next)
      setMsgRules((prev) => {
        const updated = { ...prev }
        for (const sender of msgRoles) {
          for (const target of msgRoles) {
            const inScope = scope === 'all'
              || (scope === 'sender' && sender.ROLE_CODE === roleCode)
              || (scope === 'target' && target.ROLE_CODE === roleCode)
            if (inScope) updated[`${sender.ROLE_CODE}>${target.ROLE_CODE}`] = next
          }
        }
        return updated
      })
      setMessage({
        type: 'ok',
        text: scope === 'all'
          ? (next ? tr('Every role pair can now message.') : tr('All role pairs are blocked.'))
          : scope === 'sender'
            ? `${roleCode}: ${next ? tr('can message every role.') : tr('can no longer message any role.')}`
            : `${roleCode}: ${next ? tr('every role can message it.') : tr('no role can message it.')}`
      })
    } catch (err) {
      console.error('Failed to save message permissions', err)
      setMessage({ type: 'error', text: err.message })
    } finally {
      setMsgSavingKey('')
    }
  }

  const loadOwnAccount = async () => {
    if (!user?.id) return
    try {
      const name = (await window.api.getMyProfile(user.id))?.profile?.username || ''
      setSavedUsername(name)
    } catch (err) {
      console.error('Failed to load your account', err)
    }
  }

  const locked = options.find((o) => o.OPTION_KEY === 'exam_marks_locked')?.OPTION_VALUE === '1'
  const deletionAllowed = options.find((o) => o.OPTION_KEY === 'student_deletion_allowed')?.OPTION_VALUE !== '0'
  // The oldest client version allowed to use this server ('' = no gate).
  const requiredClientVersion = options.find((o) => o.OPTION_KEY === 'required_client_version')?.OPTION_VALUE || ''
  const absenceLockMinutes = Number(
    options.find((o) => o.OPTION_KEY === 'absence_removal_lock_minutes')?.OPTION_VALUE || 0
  ) || 0
  // Weekly teacher constraints: switched on by default, and the scheduler picks
  // the policy unless the Admin forces one here.
  const constraintsEnabled = options.find((o) => o.OPTION_KEY === 'teacher_constraints_enabled')?.OPTION_VALUE !== '0'
  const constraintsForced = options.find((o) => o.OPTION_KEY === 'teacher_constraints_forced')?.OPTION_VALUE === '1'
  const constraintsPolicy = normalizeConstraintPolicy(
    options.find((o) => o.OPTION_KEY === 'teacher_constraints_policy')?.OPTION_VALUE
  )
  // Whether the Developer role may list and end other accounts' sessions. Off
  // by default; every account keeps its own sessions either way.
  const developerSessionsAllowed =
    options.find((o) => o.OPTION_KEY === 'developer_session_management')?.OPTION_VALUE === '1'

  const togglePageLock = async (route, label) => {
    const next = !pageLocks.some((lock) => lock.route === route)
    setLockBusy(route)
    setPageLocks((prev) => (next
      ? [...prev, { route, roles: [] }]
      : prev.filter((lock) => lock.route !== route)))
    try {
      await window.api.setPageLocked(user?.id, route, next)
      broadcastPageLocks()
      setMessage({
        type: 'ok',
        text: next
          ? `${label}: ${tr('locked — only Admins can open it now.')}`
          : `${label}: ${tr('unlocked — it opens again for everyone who could reach it.')}`
      })
    } catch (err) {
      setPageLocks((prev) => (next
        ? prev.filter((lock) => lock.route !== route)
        : [...prev, { route, roles: [] }]))
      setMessage({ type: 'error', text: err.message })
    } finally {
      setLockBusy('')
    }
  }

  // Which roles a lock closes the page for. A new lock closes it for every role;
  // unticking the last one unlocks the page, because "blocked for nobody" and
  // "no lock" are the same thing.
  const togglePageLockRole = async (route, roleCode) => {
    const lock = pageLocks.find((entry) => entry.route === route)
    if (!lock) return
    const current = lock.roles?.length
      ? lock.roles
      : LOCKABLE_ROLES.map((role) => role.code)
    const remaining = current.includes(roleCode)
      ? current.filter((code) => code !== roleCode)
      : [...current, roleCode]
    const previous = lock.roles || []

    setLockRoleBusy(`${route}:${roleCode}`)
    setPageLocks((prev) => prev.map((entry) => (
      entry.route === route ? { ...entry, roles: remaining } : entry
    )))
    try {
      if (remaining.length === 0) {
        await window.api.setPageLocked(user?.id, route, false)
        setPageLocks((prev) => prev.filter((entry) => entry.route !== route))
        setMessage({
          type: 'ok',
          text: tr('unlocked — it opens again for everyone who could reach it.')
        })
      } else {
        await window.api.setPageLockRoles(user?.id, route, remaining)
      }
      broadcastPageLocks()
    } catch (err) {
      setPageLocks((prev) => prev.map((entry) => (
        entry.route === route ? { ...entry, roles: previous } : entry
      )))
      setMessage({ type: 'error', text: err.message })
    } finally {
      setLockRoleBusy('')
    }
  }

  const lockableGroups = useMemo(() => {
    const groups = []
    const byLabel = new Map()
    for (const route of lockableRoutes()) {
      if (route.to === '/') continue
      if (!byLabel.has(route.group)) {
        const group = { label: route.group, items: [] }
        byLabel.set(route.group, group)
        groups.push(group)
      }
      byLabel.get(route.group).items.push(route)
    }
    const query = lockSearch.trim().toLowerCase()
    if (!query) return groups
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => tr(item.label).toLowerCase().includes(query) || item.to.includes(query)
        )
      }))
      .filter((group) => group.items.length > 0)
  }, [lockSearch])

  const betaTesterCount = betaUsers.filter((u) => u.IS_BETA_TESTER).length

  const filteredBetaUsers = useMemo(() => {
    const q = betaSearch.trim().toLowerCase()
    if (!q) return betaUsers
    return betaUsers.filter((u) => {
      return [u.PERSON_FIRST_NAME, u.PERSON_LAST_NAME, u.USER_USERNAME, u.USER_EMAIL, u.ROLE_CODES]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [betaUsers, betaSearch])

  const filteredConductAccounts = useMemo(() => {
    const q = conductSearch.trim().toLowerCase()
    if (!q) return conductAccounts
    return conductAccounts.filter((account) => {
      return [account.PERSON_FIRST_NAME_LA, account.PERSON_LAST_NAME_LA, account.USER_USERNAME, account.USER_EMAIL]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [conductAccounts, conductSearch])

  const conductGrantedCount = useMemo(
    () => conductAccounts.reduce(
      (total, account) => total + CONDUCT_RIGHTS.filter(right => account[right.column] === true).length,
      0
    ),
    [conductAccounts]
  )

  const [openSetting, setOpenSetting] = useState(null)
  // What was typed in the "Required client version" dialog, before saving.
  const [versionDraft, setVersionDraft] = useState('')
  const [savingVersion, setSavingVersion] = useState(false)
  // What was typed in the "Absence removal lock" dialog, before saving.
  const [absenceLockDraft, setAbsenceLockDraft] = useState('0')
  const [savingAbsenceLock, setSavingAbsenceLock] = useState(false)
  // Which reference register the Registers dialog is showing: grades, exam
  // types, classrooms and the rest, all edited from here now.
  const [openRegister, setOpenRegister] = useState(null)
  const closeSetting = () => setOpenSetting(null)

  // Library settings, edited in two dialogs: the restrictions and the shelves.
  const [libraryPolicy, setLibraryPolicy] = useState({
    uploadsEnabled: true,
    teacherUploadsEnabled: true,
    reviewRequired: true,
    studentDownloads: true,
    requireCategory: true,
    maxFileMb: 512
  })
  const [libraryCategories, setLibraryCategories] = useState([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryMaxDraft, setLibraryMaxDraft] = useState('512')
  const [savingLibraryMax, setSavingLibraryMax] = useState(false)
  const [newCategory, setNewCategory] = useState({ labelEn: '', labelAr: '', labelFr: '' })
  const [categoryEdit, setCategoryEdit] = useState(null)
  const [libraryBusy, setLibraryBusy] = useState('')

  // Opening the dialog reloads the roster so an account edited on the
  // Secretaries page is never shown with stale rights here.
  useEffect(() => {
    if (openSetting === 'conductRights' && canManage) {
      loadConductAccounts()
      loadConductGlobalRights()
    }
    if (openSetting === 'clientVersion') setVersionDraft(requiredClientVersion)
    if (openSetting === 'absenceLock') setAbsenceLockDraft(String(absenceLockMinutes))
    if (openSetting === 'libraryPolicy') setLibraryMaxDraft(String(libraryPolicy.maxFileMb || 512))
    if (openSetting === 'libraryCategories' && canDevelop) loadLibrary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSetting])

  const familiesOn = NOTIFICATION_FAMILIES.filter(f => !mutedFamilies[f.id]).length
  const allowedPairs = Object.values(msgRules).filter(Boolean).length
  const msgTotalPairs = msgRoles.length * msgRoles.length
  const msgAllAllowed = msgTotalPairs > 0 && allowedPairs === msgTotalPairs
  const senderScopeAllowed = (roleCode) => msgRoles.length > 0
    && msgRoles.every(target => !!msgRules[`${roleCode}>${target.ROLE_CODE}`])
  const targetScopeAllowed = (roleCode) => msgRoles.length > 0
    && msgRoles.every(sender => !!msgRules[`${sender.ROLE_CODE}>${roleCode}`])
  const releaseSummary = latestRelease
    ? [
        latestRelease.VERSION ? `${tr('Version')} ${latestRelease.VERSION}` : '',
        latestRelease.TITLE_EN || '',
        formatReleaseDate(latestRelease.RELEASE_DATE) || ''
      ].filter(Boolean).join(' · ')
    : tr('No release notes have been published yet.')
  const lockedSummary = pageLocks.length === 0
    ? tr('No page is locked')
    : `${pageLocks.length} ${tr('locked — Admins can still open them')}`

  // ---- Library (Admin) -----------------------------------------------------
  // Each switch saves at once, like the other option dialogs; the size limit
  // needs an explicit save because it is typed rather than toggled.
  const setLibraryOption = async (field, key, value) => {
    const next = value === '1'
    setLibraryPolicy((prev) => ({ ...prev, [field]: next }))
    try {
      await window.api.setSetting(user?.id, key, value)
      setMessage({ type: 'ok', text: tr('Library setting saved.') })
    } catch (err) {
      setLibraryPolicy((prev) => ({ ...prev, [field]: !next }))
      setMessage({ type: 'error', text: err.message || tr('Could not save the setting.') })
    }
  }

  const saveLibraryMax = async () => {
    const value = String(libraryMaxDraft).trim()
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 4096) {
      setMessage({ type: 'error', text: tr('Enter a whole number of megabytes between 1 and 4096.') })
      return
    }
    setSavingLibraryMax(true)
    try {
      await window.api.setSetting(user?.id, 'library_max_file_mb', value)
      setLibraryPolicy((prev) => ({ ...prev, maxFileMb: Number(value) }))
      setMessage({ type: 'ok', text: tr('Library size limit saved.') })
    } catch (err) {
      setMessage({ type: 'error', text: err.message || tr('Could not save the size limit.') })
    } finally {
      setSavingLibraryMax(false)
    }
  }

  const createLibraryCategory = async () => {
    if (newCategory.labelEn.trim().length < 2) {
      setMessage({ type: 'error', text: tr('Enter a name for the category.') })
      return
    }
    setLibraryBusy('new')
    try {
      const result = await window.api.createLibraryCategory(user?.id, newCategory)
      if (result?.error) {
        setMessage({ type: 'error', text: result.error })
        return
      }
      setNewCategory({ labelEn: '', labelAr: '', labelFr: '' })
      await loadLibrary()
      setMessage({ type: 'ok', text: tr('Category added.') })
    } catch (err) {
      setMessage({ type: 'error', text: err.message || tr('Could not add the category.') })
    } finally {
      setLibraryBusy('')
    }
  }

  const saveCategoryEdit = async () => {
    if (!categoryEdit || categoryEdit.labelEn.trim().length < 2) {
      setMessage({ type: 'error', text: tr('Enter a name for the category.') })
      return
    }
    setLibraryBusy(`edit-${categoryEdit.id}`)
    try {
      const result = await window.api.updateLibraryCategory(user?.id, categoryEdit.id, {
        labelEn: categoryEdit.labelEn,
        labelAr: categoryEdit.labelAr,
        labelFr: categoryEdit.labelFr,
        isActive: categoryEdit.isActive
      })
      if (result?.error) {
        setMessage({ type: 'error', text: result.error })
        return
      }
      setCategoryEdit(null)
      await loadLibrary()
      setMessage({ type: 'ok', text: tr('Category saved.') })
    } catch (err) {
      setMessage({ type: 'error', text: err.message || tr('Could not save the category.') })
    } finally {
      setLibraryBusy('')
    }
  }

  const toggleCategory = async (category) => {
    setLibraryBusy(`active-${category.LIBRARY_CATEGORY_ID}`)
    try {
      const result = await window.api.updateLibraryCategory(user?.id, category.LIBRARY_CATEGORY_ID, {
        labelEn: category.LABEL_EN,
        labelAr: category.LABEL_AR,
        labelFr: category.LABEL_FR,
        isActive: !category.IS_ACTIVE
      })
      if (result?.error) {
        setMessage({ type: 'error', text: result.error })
        return
      }
      await loadLibrary()
      setMessage({
        type: 'ok',
        text: category.IS_ACTIVE ? tr('Category archived. It is hidden from uploads.') : tr('Category restored.')
      })
    } catch (err) {
      setMessage({ type: 'error', text: err.message || tr('Could not change the category.') })
    } finally {
      setLibraryBusy('')
    }
  }

  const removeLibraryCategory = async (category) => {
    setLibraryBusy(`delete-${category.LIBRARY_CATEGORY_ID}`)
    try {
      const result = await window.api.deleteLibraryCategory(user?.id, category.LIBRARY_CATEGORY_ID)
      if (result?.error) {
        setMessage({ type: 'error', text: result.error })
        return
      }
      await loadLibrary()
      setMessage({ type: 'ok', text: tr('Category removed.') })
    } catch (err) {
      setMessage({ type: 'error', text: err.message || tr('Could not remove the category.') })
    } finally {
      setLibraryBusy('')
    }
  }

  const closeButton = (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={closeSetting}
        className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
      >
        {tr('Close')}
      </button>
    </div>
  )

  return (
    <div className="anim-stagger space-y-4">
      <PageIntro
        kicker={tr('Administration')}
        title={tr('Settings')}
        meta={`${NOTIFICATION_FAMILIES.length + 20} ${tr('options')}`}
        actions={!canDevelop && !canLockMarks && (
          // The rows this account can change are the personal ones, so say that
          // rather than telling a Teacher or a Student they need the Admin role:
          // every row they are shown here is theirs to change. A Director meets
          // the same truth one row further up (the exam marks lock).
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
            <ShieldCheck size={12} /> {tr('With your role the rows you can change are your own account and this computer; the application-wide options are set by an administrator.')}
          </span>
        )}
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {tr('Each setting shows its current state here; open one to change it.')}
        </p>
      </PageIntro>

      {message && (
        <div
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-[11.5px]"
          style={{
            borderColor: message.type === 'ok'
              ? 'color-mix(in srgb, var(--color-success) 40%, transparent)'
              : 'color-mix(in srgb, var(--color-danger) 40%, transparent)',
            background: message.type === 'ok' ? 'var(--color-success-bg)' : 'var(--color-danger-bg)',
            color: message.type === 'ok' ? 'var(--color-success-ink)' : 'var(--color-danger-ink)'
          }}
        >
          {message.type === 'ok' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          <span>{message.text}</span>
          <button className="ms-auto text-[11px] opacity-70 hover:opacity-100" onClick={() => setMessage(null)} aria-label={tr('Dismiss message')}>
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-md border border-line bg-surface p-8 text-center text-[12px] text-ink-3">{tr('Loading settings…')}</div>
      ) : (
        <>
          <SettingGroup title={tr('Application')}>
            <SettingRow
              icon={Sparkles}
              title={tr("What's new")}
              value={releaseSummary}
              onOpen={() => setShowRelease(true)}
              disabled={!latestRelease}
              actionLabel={tr('View')}
            />
            {canLockMarks && (
              <SettingRow
                icon={locked ? Lock : Unlock}
                title={tr('Lock exam marks editing')}
                value={locked ? tr('Locked — mark editing is disabled') : tr('Unlocked — teachers can edit marks')}
                tone={locked ? 'bad' : 'good'}
                onOpen={() => setOpenSetting('marks')}
              />
            )}
          </SettingGroup>

          <SettingGroup title={tr('This computer')}>
            <SettingRow
              icon={soundEnabled ? BellRing : BellOff}
              title={tr('Notification sound')}
              value={soundEnabled ? tr('On — new notifications are audible') : tr('Off — notifications arrive silently')}
              tone={soundEnabled ? 'good' : 'neutral'}
              onOpen={() => setOpenSetting('sound')}
            />
            <SettingRow
              icon={motionMode === 'powersave' ? Leaf : Gauge}
              title={tr('Interface motion')}
              value={motionMode === 'powersave'
                ? tr('Power save — animations and transitions off')
                : tr('Performance — premium animations and transitions')}
              tone={motionMode === 'powersave' ? 'neutral' : 'good'}
              onOpen={() => setOpenSetting('motion')}
            />
            <SettingRow
              icon={ZoomIn}
              title={tr('Interface scale')}
              value={`${interfaceScalePercent(interfaceScale)}%`}
              onOpen={() => setOpenSetting('scale')}
            />
          </SettingGroup>

          <SettingGroup title={tr('Notifications')}>
            <SettingRow
              icon={BellOff}
              title={tr('What to be notified about')}
              value={`${familiesOn} ${tr('of')} ${NOTIFICATION_FAMILIES.length} ${tr('families on')}`}
              tone={familiesOn === NOTIFICATION_FAMILIES.length ? 'good' : 'warn'}
              onOpen={() => setOpenSetting('notifications')}
            />
          </SettingGroup>

          <SettingGroup title={tr('Your account')}>
            <SettingRow
              icon={AtSign}
              title={tr('Your username')}
              value={`@${savedUsername}`}
              onOpen={() => setOpenSetting('username')}
            />
            <SettingRow
              icon={Lock}
              title={tr('Your password')}
              value={tr('Change the password of your own account')}
              onOpen={() => setOpenSetting('password')}
            />
          </SettingGroup>

          {canDevelop && (
            <SettingGroup title={tr('Administration')}>
              {canManage && (
                <SettingRow
                  icon={Trash2}
                  title={tr('Student deletion')}
                  value={deletionAllowed ? tr('Allowed — students can be deleted') : tr('Denied — the delete action is refused')}
                  tone={deletionAllowed ? 'good' : 'bad'}
                  onOpen={() => setOpenSetting('studentDeletion')}
                />
              )}
              {canManage && (
                <SettingRow
                  icon={MonitorSmartphone}
                  title={tr('Developer session management')}
                  value={developerSessionsAllowed
                    ? tr('Allowed — developers can view and end every session')
                    : tr('Off — developers manage only their own sessions')}
                  tone={developerSessionsAllowed ? 'warn' : 'good'}
                  onOpen={() => setOpenSetting('developerSessions')}
                />
              )}
              {canManage && (
                <SettingRow
                  icon={Clock}
                  title={tr('Absence removal lock')}
                  value={absenceLockMinutes > 0
                    ? tr('Locked for the first {count} minutes of a session', { count: absenceLockMinutes })
                    : tr('Off — absences can be removed at any time')}
                  tone={absenceLockMinutes > 0 ? 'warn' : 'good'}
                  onOpen={() => setOpenSetting('absenceLock')}
                />
              )}
              {canManage && (
                <SettingRow
                  icon={ShieldAlert}
                  title={tr('Weekly teacher constraints')}
                  value={!constraintsEnabled
                    ? tr('Off — teachers cannot declare windows and schedulers ignore them')
                    : constraintsForced
                      ? `${tr('On — policy forced:')} ${tr(constraintPolicyLabel(constraintsPolicy))}`
                      : tr('On — each scheduler chooses the policy')}
                  tone={constraintsEnabled ? (constraintsForced ? 'warn' : 'good') : 'neutral'}
                  onOpen={() => setOpenSetting('teacherConstraints')}
                />
              )}
              {canManage && (
                <SettingRow
                  icon={ShieldCheck}
                  title={tr('Conduct rights')}
                  value={`${conductAccounts.length} ${tr('Secretaries')} · ${conductGrantedCount} ${tr('granted')}`}
                  tone={conductGrantedCount > 0 ? 'good' : 'neutral'}
                  onOpen={() => setOpenSetting('conductRights')}
                />
              )}
              {canManage && (
                <SettingRow
                  icon={Download}
                  title={tr('Required client version')}
                  value={requiredClientVersion
                    ? `${tr('Clients older than')} ${requiredClientVersion} ${tr('must update')}`
                    : tr('Off — every client version may use the server')}
                  tone={requiredClientVersion ? 'warn' : 'good'}
                  onOpen={() => setOpenSetting('clientVersion')}
                />
              )}
              <SettingRow
                icon={Lock}
                title={tr('Locked pages')}
                value={lockedSummary}
                tone={pageLocks.length ? 'bad' : 'good'}
                onOpen={() => setOpenSetting('lockedPages')}
              />
              <SettingRow
                icon={Lock}
                title={tr('User passwords')}
                value={tr('Reset the password of any account')}
                onOpen={() => setOpenSetting('userPasswords')}
              />
              <SettingRow
                icon={MessageSquare}
                title={tr('Message permissions')}
                value={`${allowedPairs} ${tr('allowed role pairs')}`}
                onOpen={() => setOpenSetting('messaging')}
              />
              <SettingRow
                icon={FlaskConical}
                title={tr('Beta testers')}
                value={`${betaTesterCount} ${tr('of')} ${betaUsers.length} ${tr('accounts flagged')}`}
                onOpen={() => setOpenSetting('beta')}
              />
            </SettingGroup>
          )}

          {canDevelop && (
            <SettingGroup title={tr('Library')}>
              {/* The policy switches are written through settings:set, which is
                  Admin-only: a Developer manages the shelves, not the policy. */}
              {canManage && (
                <SettingRow
                  icon={BookOpen}
                  title={tr('Uploads and review')}
                  value={[
                    libraryPolicy.uploadsEnabled ? tr('Uploads open') : tr('Uploads closed'),
                    libraryPolicy.teacherUploadsEnabled ? tr('teachers may add') : tr('administrators only'),
                    libraryPolicy.reviewRequired ? tr('review before publishing') : tr('publish immediately')
                  ].join(' · ')}
                  tone={libraryPolicy.uploadsEnabled ? 'good' : 'bad'}
                  onOpen={() => setOpenSetting('libraryPolicy')}
                />
              )}
              <SettingRow
                icon={FolderTree}
                title={tr('Categories')}
                value={`${libraryCategories.length} ${tr('shelves')} · ${libraryCategories.reduce((n, c) => n + (Number(c.ITEM_COUNT) || 0), 0)} ${tr('documents filed')}`}
                onOpen={() => setOpenSetting('libraryCategories')}
              />
            </SettingGroup>
          )}

          {canDevelop && (
            <SettingGroup title={tr('Legacy registry')}>
              <SettingRow
                icon={DatabaseZap}
                title={tr('Import from the old application')}
                value={tr('Map an old MySQL dump into this registry')}
                badge={tr('Experimental')}
                onOpen={() => setOpenSetting('legacy')}
              />
            </SettingGroup>
          )}

          {/* The vocabulary the rest of the application is built on. These were
              pages of their own; they read better as one register list. */}
          {canManage && (
            <SettingGroup title={tr('Registers')}>
              <SettingRow
                icon={Crown}
                title={tr('Grades')}
                value={tr('Ranks, their names and types in three languages')}
                onOpen={() => setOpenRegister('grades')}
              />
              <SettingRow
                icon={ScrollText}
                title={tr('Academic grades')}
                value={tr('The academic titles a person can hold')}
                onOpen={() => setOpenRegister('academicGrades')}
              />
              <SettingRow
                icon={FileBadge}
                title={tr('Exam types')}
                value={tr('How an exam sitting is classified')}
                onOpen={() => setOpenRegister('examTypes')}
              />
              <SettingRow
                icon={Tag}
                title={tr('Session types')}
                value={tr('The kinds of session a timetable can hold')}
                onOpen={() => setOpenRegister('sessionTypes')}
              />
              <SettingRow
                icon={Clock}
                title={tr('Session time slots')}
                value={tr('Predefined start and end times for scheduling sessions')}
                onOpen={() => setOpenRegister('sessionTimeSlots')}
              />
              <SettingRow
                icon={ShieldAlert}
                title={tr('Teacher constraint options')}
                value={tr('The hard and soft windows teachers choose from')}
                onOpen={() => setOpenRegister('teacherConstraintOptions')}
              />
              <SettingRow
                icon={Tag}
                title={tr('Uniform sizes')}
                value={tr('The sizes a student may be issued for each uniform item')}
                onOpen={() => setOpenRegister('uniformSizes')}
              />
              <SettingRow
                icon={Tags}
                title={tr('Teaching categories')}
                value={tr('How sections are grouped for teaching')}
                onOpen={() => setOpenRegister('teachingCategories')}
              />
              <SettingRow
                icon={Compass}
                title={tr('Directions')}
                value={tr('The administrative directions departments are grouped under')}
                onOpen={() => setOpenRegister('directions')}
              />
              <SettingRow
                icon={Building2}
                title={tr('Departments')}
                value={tr('The administrative departments teachers belong to')}
                onOpen={() => setOpenRegister('departments')}
              />
              <SettingRow
                icon={DoorOpen}
                title={tr('Classrooms')}
                value={tr('Rooms, their categories, capacity and seats')}
                onOpen={() => setOpenRegister('classrooms')}
              />
            </SettingGroup>
          )}
        </>
      )}

      {/* ---- Exam marks lock ---- */}
      <Modal
        open={canLockMarks && openSetting === 'marks'}
        onClose={closeSetting}
        title={tr('Lock exam marks editing')}
        footer={closeButton}
      >
        <p className="text-[12px] leading-relaxed text-ink-2">
          {tr('When locked, teachers can consult marks, averages and histories but cannot save any change — server-enforced, so it holds for every client. Unlock to let teachers enter marks again.')}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-[4px] border border-line bg-canvas px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-ink">
              {locked ? tr('Locked — mark editing is disabled') : tr('Unlocked — teachers can edit marks')}
            </div>
            <div className="mono mt-0.5 text-[10px] text-ink-3">
              {locked ? tr('Teachers can read but not save') : tr('Teachers can save marks')}
            </div>
          </div>
          <Switch
            checked={locked}
            disabled={!canLockMarks || loading}
            label={tr('Lock exam marks editing')}
            onChange={() => setOption('exam_marks_locked', locked ? '0' : '1')}
          />
        </div>
      </Modal>

      {/* ---- Student deletion ---- */}
      <Modal
        open={openSetting === 'studentDeletion'}
        onClose={closeSetting}
        title={tr('Student deletion')}
        footer={closeButton}
      >
        <p className="text-[12px] leading-relaxed text-ink-2">
          {tr('When denied, no role can delete a student: the delete action disappears from Student Records and the server refuses the request. Only an Admin can change this option.')}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-[4px] border border-line bg-canvas px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-ink">
              {deletionAllowed ? tr('Allowed — students can be deleted') : tr('Denied — the delete action is refused')}
            </div>
            <div className="mono mt-0.5 text-[10px] text-ink-3">
              {deletionAllowed ? tr('Student Records offers the delete action') : tr('Delete actions are hidden and refused')}
            </div>
          </div>
          <Switch
            checked={deletionAllowed}
            disabled={!canManage || loading}
            label={tr('Allow deleting students')}
            onChange={() => setOption('student_deletion_allowed', deletionAllowed ? '0' : '1')}
          />
        </div>
      </Modal>

      {/* ---- Developer session management ---- */}
      <Modal
        open={openSetting === 'developerSessions'}
        onClose={closeSetting}
        title={tr('Developer session management')}
        footer={closeButton}
      >
        <p className="text-[12px] leading-relaxed text-ink-2">
          {tr('Every account can always view and end its own sessions. This option also lets the Developer role view and end every account’s sessions; without it, a developer manages only their own.')}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-[4px] border border-line bg-canvas px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-ink">
              {developerSessionsAllowed
                ? tr('Allowed — developers can manage every session')
                : tr('Off — developers manage their own sessions only')}
            </div>
            <div className="mono mt-0.5 text-[10px] text-ink-3">
              {developerSessionsAllowed
                ? tr('The all-accounts session list is open to developers')
                : tr('The Admin role keeps the all-accounts session list')}
            </div>
          </div>
          <Switch
            checked={developerSessionsAllowed}
            disabled={!canManage || loading}
            label={tr('Developer session management')}
            onChange={() => setOption('developer_session_management', developerSessionsAllowed ? '0' : '1')}
          />
        </div>
      </Modal>

      {/* ---- Absence removal lock ---- */}
      <Modal
        open={openSetting === 'absenceLock'}
        onClose={closeSetting}
        title={tr('Absence removal lock')}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeSetting}
              className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
            >
              {tr('Cancel')}
            </button>
            <button
              type="button"
              onClick={saveAbsenceLock}
              disabled={!canManage || savingAbsenceLock || String(absenceLockDraft).trim() === String(absenceLockMinutes)}
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save size={11} /> {tr('Save')}
            </button>
          </div>
        }
      >
        <p className="text-[12px] leading-relaxed text-ink-2">
          {tr('After a session begins, teachers cannot mark a recorded absence as present for this many minutes. The server enforces it, so the rule holds for every client. Set 0 to allow removal at any time.')}
        </p>
        <label className="kicker mt-3 block text-[9px]" htmlFor="absence-removal-lock">
          {tr('Minutes after the session begins')}
        </label>
        <input
          id="absence-removal-lock"
          type="number"
          inputMode="numeric"
          min="0"
          max="1440"
          step="1"
          value={absenceLockDraft}
          disabled={!canManage || savingAbsenceLock}
          onChange={(e) => setAbsenceLockDraft(e.target.value)}
          className="field mono mt-1 h-8 w-full text-[12px]"
        />
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          {Number(absenceLockDraft) > 0
            ? tr('Removal is locked for the first {count} minutes of each session.', { count: absenceLockDraft })
            : tr('Off: absence removal is allowed at any time.')}
        </p>
      </Modal>

      {/* ---- Weekly teacher constraints ---- */}
      <Modal
        open={openSetting === 'teacherConstraints'}
        onClose={closeSetting}
        title={tr('Weekly teacher constraints')}
        maxWidth="max-w-[560px]"
        footer={closeButton}
      >
        <p className="text-[12px] leading-relaxed text-ink-2">
          {tr('Teachers declare, week by week, the windows they cannot teach (hard) or would rather not teach (soft). Hard constraints always block a session; soft ones are only binding under a policy that considers them.')}
        </p>

        <div className="mt-3 space-y-2">
          <LibraryToggle
            label={tr('Allow weekly teacher constraints')}
            description={tr('Off hides the declaration panel, and schedulers stop reading any declared window.')}
            checked={constraintsEnabled}
            disabled={!canManage || loading}
            onChange={() => setOption('teacher_constraints_enabled', constraintsEnabled ? '0' : '1')}
          />
          <LibraryToggle
            label={tr('Force the policy on schedulers')}
            description={tr('On removes the policy choice from the scheduler and applies the policy below to everyone.')}
            checked={constraintsForced}
            disabled={!canManage || loading || !constraintsEnabled}
            onChange={() => setOption('teacher_constraints_forced', constraintsForced ? '0' : '1')}
          />

          <div className="rounded-[4px] border border-line bg-canvas px-3 py-2.5">
            <div className="text-[12px] font-medium text-ink">{tr('Constraint policy')}</div>
            <div className="mono mt-0.5 text-[10px] text-ink-3">
              {constraintsForced ? tr('Binding on every scheduler') : tr('Default choice offered to schedulers')}
            </div>
            <div
              role="radiogroup"
              aria-label={tr('Constraint policy')}
              className="mt-2 space-y-1"
            >
              {CONSTRAINT_POLICIES.map((policy) => {
                const active = constraintsPolicy === policy.id
                return (
                  <button
                    key={policy.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!canManage || loading || !constraintsEnabled}
                    onClick={() => setOption('teacher_constraints_policy', policy.id)}
                    className={`flex w-full items-start gap-2 rounded-[4px] border px-2.5 py-2 text-start disabled:cursor-not-allowed disabled:opacity-50 ${
                      active ? 'border-line-strong bg-selection' : 'border-line hover:bg-surface-muted'
                    }`}
                  >
                    <span
                      className="mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border"
                      style={{ borderColor: active ? 'var(--color-jade-600)' : 'var(--color-line-strong)' }}
                      aria-hidden="true"
                    >
                      {active && (
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-jade-600)' }} />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11.5px] font-medium text-ink">{tr(policy.label)}</span>
                      <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-3">
                        {tr(policy.description)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </Modal>

      {/* ---- Required client version ---- */}
      <Modal
        open={openSetting === 'clientVersion'}
        onClose={closeSetting}
        title={tr('Required client version')}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeSetting}
              className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
            >
              {tr('Cancel')}
            </button>
            <button
              type="button"
              onClick={saveClientVersion}
              disabled={!canManage || savingVersion || versionDraft.trim() === requiredClientVersion}
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save size={11} /> {tr('Save')}
            </button>
          </div>
        }
      >
        <p className="text-[12px] leading-relaxed text-ink-2">
          {tr('Every workstation reads this from the server. A client older than the version below is replaced by an update screen: Windows clients fetch the published installer from the server share and update themselves in one click. Leave it empty to allow every version.')}
        </p>
        <label className="kicker mt-3 block text-[9px]" htmlFor="required-client-version">
          {tr('Oldest allowed version')}
        </label>
        <input
          id="required-client-version"
          type="text"
          inputMode="numeric"
          placeholder="4.0.1"
          value={versionDraft}
          disabled={!canManage || savingVersion}
          onChange={(e) => setVersionDraft(e.target.value)}
          className="field mono mt-1 h-8 w-full text-[12px]"
        />
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          {requiredClientVersion
            ? tr('Clients older than {version} currently show the update screen.', { version: requiredClientVersion })
            : tr('No gate is set: every client version may use the server.')}
        </p>
      </Modal>

      {/* ---- Conduct rights (rewards & punishments) ---- */}
      <Modal
        open={openSetting === 'conductRights'}
        onClose={closeSetting}
        title={tr('Conduct rights')}
        maxWidth="max-w-[720px]"
        footer={closeButton}
      >
        <div className="rounded-[4px] border border-line bg-canvas">
          <div className="border-b border-line px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] font-medium text-ink">{tr('Applies to every secretary')}</span>
              {conductGlobalLoading && (
                <span className="mono text-[10px] text-ink-3">{tr('Loading…')}</span>
              )}
            </div>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">
              {tr('Turning a right off here blocks it for every secretary, even where the per-secretary switch is on. Admins are never limited.')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-1.5 p-3 sm:grid-cols-2">
            {CONDUCT_RIGHTS.map(({ key: rightKey, label }) => (
              <div
                key={rightKey}
                className="flex items-center justify-between gap-2 rounded-[3px] border border-line bg-surface px-2 py-1.5"
              >
                <span className="truncate text-[10.5px] text-ink-2">{tr(label)}</span>
                <Switch
                  checked={conductGlobalRights[rightKey] === true}
                  disabled={conductGlobalLoading || conductGlobalSaving}
                  label={`${tr('Secretaries')}: ${tr(label)}`}
                  onChange={() => toggleConductGlobalRight(rightKey)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-md text-[12px] leading-relaxed text-ink-2">
            {tr('Each switch is a right stored on the secretary account and saved the moment it is toggled. An Admin is never limited.')}
          </p>
          <div className="relative w-52">
            <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3" size={12} />
            <input
              type="text"
              value={conductSearch}
              onChange={e => setConductSearch(e.target.value)}
              placeholder={tr('Search secretaries')}
              aria-label={tr('Search secretaries')}
              className="field h-7 w-full ps-7 text-[11.5px]"
            />
          </div>
        </div>

        {conductLoading ? (
          <div className="mt-3 text-[11.5px] text-ink-3">{tr('Loading secretaries')}</div>
        ) : conductAccounts.length === 0 ? (
          <div className="mt-3 text-[11.5px] text-ink-3">{tr('No secretary accounts found.')}</div>
        ) : filteredConductAccounts.length === 0 ? (
          <div className="mt-3 text-[11.5px] text-ink-3">{tr('No secretary matches this search.')}</div>
        ) : (
          <div className="mt-2 max-h-[26rem] divide-y divide-line overflow-y-auto rounded-[4px] border border-line">
            {filteredConductAccounts.map(account => (
              <div key={account.USER_ID} className="px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[11.5px] font-medium text-ink">{conductAccountName(account)}</span>
                  {account.IS_ACTIVE === false && (
                    <span className="mono rounded-[2px] border border-line-strong px-1 text-[9px] uppercase text-ink-3">{tr('Inactive')}</span>
                  )}
                  <span className="mono ms-auto shrink-0 text-[10px] text-ink-3">@{account.USER_USERNAME}</span>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {CONDUCT_RIGHTS.map(({ key: rightKey, column, label }) => (
                    <div
                      key={rightKey}
                      className="flex items-center justify-between gap-2 rounded-[3px] border border-line bg-canvas px-2 py-1.5"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[10.5px] text-ink-2">{tr(label)}</span>
                        {conductGlobalRights[rightKey] !== true && (
                          <span className="mono shrink-0 rounded-[2px] border border-line-strong px-1 text-[9px] uppercase text-ink-3">
                            {tr('Blocked globally')}
                          </span>
                        )}
                      </span>
                      <Switch
                        checked={account[column] === true}
                        disabled={conductSavingKey.startsWith(`${account.USER_ID}:`)}
                        label={`${conductAccountName(account)}: ${tr(label)}`}
                        onChange={() => toggleConductRight(account, rightKey)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-ink-3">
          <ShieldCheck size={11} />
          {tr('Rights are per action: an account may record a punishment without being able to delete one.')}
        </p>
      </Modal>

      {/* ---- Notification sound ---- */}
      <Modal
        open={openSetting === 'sound'}
        onClose={closeSetting}
        title={tr('Notification sound')}
        footer={closeButton}
      >
        <p className="text-[12px] leading-relaxed text-ink-2">
          {tr('A short chime plays when a new notification arrives. Turning it off silences this computer only — the unread badge and the notifications page keep working.')}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-[4px] border border-line bg-canvas px-3 py-2.5">
          <span className="text-[12px] font-medium text-ink">
            {soundEnabled ? tr('On — new notifications are audible') : tr('Off — notifications arrive silently')}
          </span>
          <Switch
            checked={soundEnabled}
            label={tr('Notification sound')}
            onChange={toggleSound}
          />
        </div>
      </Modal>

      {/* ---- Interface motion ---- */}
      <Modal
        open={openSetting === 'motion'}
        onClose={closeSetting}
        title={tr('Interface motion')}
        maxWidth="max-w-[560px]"
        footer={closeButton}
      >
        <p className="text-[12px] leading-relaxed text-ink-2">
          {tr("Motion is a preference of this computer, like the theme. Performance mode animates page changes, dialogs, menus and hover states; power save mode removes them all so the interface changes instantly. Your operating system's reduced-motion setting is always respected.")}
        </p>
        <div
          role="radiogroup"
          aria-label={tr('Interface motion')}
          className="mt-3 overflow-hidden rounded-[4px] border border-line"
        >
          {MOTION_OPTIONS.map((option, index) => {
            const Icon = option.icon
            const active = motionMode === option.id
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMotionMode(option.id)}
                className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-start ${index > 0 ? 'border-t border-line' : ''} ${
                  active ? 'bg-selection' : 'hover:bg-surface-muted'
                }`}
              >
                <Icon size={13} className="mt-0.5 shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium text-ink">{tr(option.label)}</span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-3">
                    {tr(option.description)}
                  </span>
                </span>
                {active && (
                  <Check size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--color-jade-600)' }} />
                )}
              </button>
            )
          })}
        </div>
      </Modal>

      {/* ---- Interface scale ---- */}
      <Modal
        open={openSetting === 'scale'}
        onClose={closeSetting}
        title={tr('Interface scale')}
        footer={closeButton}
      >
        <p className="text-[12px] leading-relaxed text-ink-2">
          {tr("Interface scale is a preference of this computer, like the theme. It resizes the whole interface — text, controls and spacing — and leaves the window's own size unchanged.")}
        </p>
        <div
          role="radiogroup"
          aria-label={tr('Interface scale')}
          className="mt-3 flex gap-1.5"
        >
          {INTERFACE_SCALES.map((value) => {
            const active = Math.abs(value - interfaceScale) < 0.001
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setInterfaceScale(value)}
                className={`mono h-9 min-w-0 flex-1 rounded-[4px] border text-[12px] transition-colors ${
                  active
                    ? 'border-line-strong bg-selection text-ink'
                    : 'border-line text-ink-3 hover:bg-surface-muted hover:text-ink'
                }`}
              >
                {interfaceScalePercent(value)}%
              </button>
            )
          })}
        </div>
      </Modal>

      {/* ---- Notification families ---- */}
      <Modal
        open={openSetting === 'notifications'}
        onClose={closeSetting}
        title={tr('What to be notified about')}
        maxWidth="max-w-[560px]"
        footer={closeButton}
      >
        <p className="text-[12px] leading-relaxed text-ink-2">
          {tr('Muting a family stops its chime, its desktop popup and its share of the unread badge for this account, on every computer you sign in from. Nothing is deleted: muted notifications stay on the notifications page, marked as muted.')}
        </p>
        <ul className="mt-3 divide-y divide-line rounded-[4px] border border-line">
          {NOTIFICATION_FAMILIES.map(family => {
            const receiving = !mutedFamilies[family.id]
            const busy = mutingFamily === family.id
            return (
              <li key={family.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-ink">{tr(family.label)}</div>
                  <div className="mono mt-0.5 truncate text-[10px] text-ink-3">
                    {receiving ? tr('On — announced when it happens') : tr('Muted — silent, still listed')}
                  </div>
                </div>
                <Switch
                  checked={receiving}
                  disabled={busy}
                  label={tr(family.label)}
                  onChange={() => toggleFamily(family)}
                />
              </li>
            )
          })}
        </ul>
      </Modal>

      {/* ---- Locked pages ---- */}
      <Modal
        open={openSetting === 'lockedPages'}
        onClose={closeSetting}
        title={tr('Locked pages')}
        maxWidth="max-w-[620px]"
        footer={closeButton}
      >
        <p className="text-[12px] leading-relaxed text-ink-2">
          {tr('A locked page keeps its sidebar entry with a lock mark. The roles ticked under it get the locked notice instead of the page — even from a direct link — while the other roles keep it. Admins and Developers always keep access.')}
        </p>

        <div className="relative mt-3">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3" size={12} />
          <input
            type="text"
            value={lockSearch}
            onChange={e => setLockSearch(e.target.value)}
            placeholder={tr('Find a page…')}
            aria-label={tr('Find a page to lock')}
            className="field h-7 w-full ps-7 text-[11.5px]"
          />
        </div>

        <div className="mt-2 max-h-[22rem] overflow-y-auto rounded-[4px] border border-line">
          {lockableGroups.length === 0 ? (
            <div className="p-4 text-[11.5px] text-ink-3">{tr('No page matches that search.')}</div>
          ) : (
            lockableGroups.map(group => (
              <div key={group.label} className="border-b border-line last:border-b-0">
                <div className="kicker px-3 pb-1 pt-2 text-[9px]">{tr(group.label)}</div>
                <ul>
                  {group.items.map(item => {
                    const Icon = item.icon
                    const lock = pageLocks.find((entry) => entry.route === item.to)
                    const isLocked = !!lock
                    const busy = lockBusy === item.to
                    // A lock with no role rows closes the page for every role.
                    const blockedRoles = lock?.roles?.length
                      ? lock.roles
                      : LOCKABLE_ROLES.map((role) => role.code)
                    return (
                      <li key={item.to} className="hover:bg-surface-muted">
                        <div className="flex items-center gap-2.5 px-3 py-1.5">
                          <Icon size={13} strokeWidth={1.75} className="shrink-0 text-ink-3" />
                          <div className="min-w-0 flex-1">
                            <div className={`truncate text-[11.5px] ${isLocked ? 'font-medium text-ink' : 'text-ink-2'}`}>
                              {tr(item.label)}
                            </div>
                            <div className="mono truncate text-[9.5px] text-ink-3">{item.to}</div>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isLocked}
                            aria-label={`${tr(item.label)} — ${tr('locked')}`}
                            disabled={busy}
                            onClick={() => togglePageLock(item.to, tr(item.label))}
                            title={isLocked ? tr('Click to unlock this page') : tr('Click to lock this page')}
                            className="shrink-0 disabled:opacity-50"
                          >
                            <Switch checked={isLocked} disabled={busy} label={tr(item.label)} />
                          </button>
                        </div>
                        {isLocked && (
                          <div className="flex flex-wrap items-center gap-1 px-3 pb-2 ps-[34px]">
                            <span className="kicker me-1 text-[8.5px]">{tr('Blocked roles')}</span>
                            {LOCKABLE_ROLES.map((role) => {
                              const blocked = blockedRoles.includes(role.code)
                              const roleBusy = lockRoleBusy === `${item.to}:${role.code}`
                              return (
                                <button
                                  key={role.code}
                                  type="button"
                                  aria-pressed={blocked}
                                  disabled={roleBusy || busy}
                                  onClick={() => togglePageLockRole(item.to, role.code)}
                                  title={blocked ? tr('This role sees the locked notice') : tr('This role keeps the page')}
                                  className={`inline-flex h-5 items-center rounded-[3px] border px-1.5 text-[9.5px] font-medium transition-colors disabled:opacity-50 ${
                                    blocked
                                      ? 'border-transparent bg-danger-bg text-danger-ink'
                                      : 'border-line-strong bg-surface text-ink-3 hover:text-ink'
                                  }`}
                                >
                                  {tr(role.label)}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-ink-3">
          <ShieldCheck size={11} />
          {tr('A lock with every role ticked closes the page for everyone; unticking the last role unlocks it. Only an Admin or a Developer can change a lock.')}
        </p>
      </Modal>

      {/* ---- Message permissions ---- */}
      <Modal
        open={openSetting === 'messaging'}
        onClose={closeSetting}
        title={tr('Message permissions')}
        maxWidth="max-w-[720px]"
        footer={closeButton}
      >
        <p className="text-[12px] leading-relaxed text-ink-2">
          {tr('Tick the roles that may start a conversation with each other. A user can message another user when')}{' '}
          <span className="font-medium text-ink">{tr('any')}</span>{' '}
          {tr('of their roles may reach')}{' '}
          <span className="font-medium text-ink">{tr('any')}</span>{' '}
          {tr("of the other's roles. Changes apply immediately to new and existing conversations.")}
        </p>

        {msgLoading ? (
          <div className="mt-4 text-[11.5px] text-ink-3">{tr('Loading permissions…')}</div>
        ) : msgRoles.length === 0 ? (
          <div className="mt-4 text-[11.5px] text-ink-3">{tr('No roles found.')}</div>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-canvas px-3 py-2">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-ink">{tr('Allow every role pair')}</div>
                <div className="mono mt-0.5 text-[10px] text-ink-3">
                  {allowedPairs} / {msgTotalPairs} {tr('allowed role pairs')}
                </div>
              </div>
              <Switch
                checked={msgAllAllowed}
                disabled={!!msgSavingKey}
                label={tr('Allow every role pair')}
                onChange={() => toggleMessagingScope('all', null, msgAllAllowed)}
              />
            </div>

            <div className="mt-3 overflow-x-auto">
              <DataTable
                className="border-separate border-spacing-1 text-[11px]"
                head={<><tr>
                    <th scope="col" className="sticky start-0 bg-surface px-2 py-1 text-start kicker text-ink-3">
                      {tr('Sender ↓ / target →')}
                    </th>
                    {msgRoles.map(target => (
                      <th scope="col" key={target.ROLE_CODE} className="px-1 py-1 align-bottom">
                        <div className="flex flex-col items-center gap-1">
                          <span
                            className="mono text-[9.5px] font-semibold uppercase text-ink-2"
                            title={target.ROLE_LABEL || target.ROLE_CODE}
                          >
                            {target.ROLE_CODE}
                          </span>
                          <Switch
                            checked={targetScopeAllowed(target.ROLE_CODE)}
                            disabled={!!msgSavingKey}
                            label={tr('Allow every role to message {role}', { role: target.ROLE_CODE })}
                            onChange={() => toggleMessagingScope('target', target.ROLE_CODE, targetScopeAllowed(target.ROLE_CODE))}
                          />
                        </div>
                      </th>
                    ))}
                  </tr></>}
              >
                  {msgRoles.map(sender => (
                    <tr key={sender.ROLE_CODE}>
                      <th className="sticky start-0 whitespace-nowrap bg-surface px-2 py-1 text-start">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10.5px] font-medium text-ink">{sender.ROLE_CODE}</span>
                          <span className="mono text-[9.5px] text-ink-3">{sender.USER_COUNT}</span>
                          <Switch
                            checked={senderScopeAllowed(sender.ROLE_CODE)}
                            disabled={!!msgSavingKey}
                            label={tr('Allow {role} to message every role', { role: sender.ROLE_CODE })}
                            onChange={() => toggleMessagingScope('sender', sender.ROLE_CODE, senderScopeAllowed(sender.ROLE_CODE))}
                          />
                        </div>
                      </th>
                      {msgRoles.map(target => {
                        const key = `${sender.ROLE_CODE}>${target.ROLE_CODE}`
                        const allowed = !!msgRules[key]
                        return (
                          <td key={target.ROLE_CODE} className="text-center">
                            <button
                              type="button"
                              onClick={() => toggleMessagingRule(sender.ROLE_CODE, target.ROLE_CODE)}
                              disabled={!!msgSavingKey}
                              aria-pressed={allowed}
                              title={`${sender.ROLE_CODE} → ${target.ROLE_CODE}: ${allowed ? 'allowed' : 'blocked'}`}
                              className={`mx-auto grid h-6 w-6 place-items-center rounded-[3px] border transition-colors disabled:opacity-40 ${
                                allowed
                                  ? 'border-transparent bg-jade-solid text-on-jade hover:brightness-110'
                                  : 'border-line bg-surface text-transparent hover:border-line-strong hover:bg-surface-muted'
                              }`}
                            >
                              <CheckCircle2 size={11} />
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
              </DataTable>
              <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">
                {tr('The top switch turns every pair on or off at once. The switch in a row turns every target of that sender role on or off; the switch in a column does the same for every sender to that target role. Individual cells stay available as exceptions.')}
              </p>
              <p className="mt-1 text-[10.5px] text-ink-3">
                {tr('The number beside each role is its active account count. People can only reach accounts that are active.')}
              </p>
            </div>
          </>
        )}
      </Modal>

      {/* ---- Beta testers ---- */}
      <Modal
        open={openSetting === 'beta'}
        onClose={closeSetting}
        title={tr('Beta testers')}
        maxWidth="max-w-[600px]"
        footer={closeButton}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-sm text-[12px] leading-relaxed text-ink-2">
            {tr('Choose the accounts that take part in beta testing. The change applies the next time that user signs in.')}
          </p>
          <div className="relative w-52">
            <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3" size={12} />
            <input
              type="text"
              value={betaSearch}
              onChange={e => setBetaSearch(e.target.value)}
              placeholder={tr('Search users...')}
              className="field h-7 w-full ps-7 text-[11.5px]"
            />
          </div>
        </div>

        {betaLoading ? (
          <div className="mt-3 text-[11.5px] text-ink-3">{tr('Loading users…')}</div>
        ) : betaUsers.length === 0 ? (
          <div className="mt-3 text-[11.5px] text-ink-3">{tr('No user accounts found.')}</div>
        ) : filteredBetaUsers.length === 0 ? (
          <div className="mt-3 text-[11.5px] text-ink-3">{tr('No users match your search.')}</div>
        ) : (
          <div className="mt-2 max-h-[22rem] divide-y divide-line overflow-y-auto rounded-[4px] border border-line">
            {filteredBetaUsers.map(account => {
              const name = [account.PERSON_FIRST_NAME, account.PERSON_LAST_NAME].filter(Boolean).join(' ')
                || account.USER_USERNAME
              const initials = name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?'
              const roles = String(account.ROLE_CODES || '').split(',').map(r => r.trim()).filter(Boolean)
              return (
                <div key={account.USER_ID} className="flex items-center gap-2.5 px-3 py-2">
                  <span className="mono grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-muted text-[11px] font-semibold text-ink-2">
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[11.5px] font-medium text-ink">{name}</span>
                      {!account.IS_ACTIVE && (
                        <span className="mono rounded-[2px] border border-line-strong px-1 text-[9px] uppercase text-ink-3">{tr('Inactive')}</span>
                      )}
                    </div>
                    <div className="mono mt-0.5 truncate text-[10px] text-ink-3">
                      @{account.USER_USERNAME} · {account.USER_EMAIL}
                      {roles.length > 0 ? ` · ${roles.join(', ')}` : ''}
                    </div>
                  </div>
                  <Switch
                    checked={!!account.IS_BETA_TESTER}
                    disabled={savingBetaId === account.USER_ID}
                    label={`${tr('Beta testers')}: ${name}`}
                    onChange={() => toggleBetaTester(account)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      {/* ---- Library uploads and review ---- */}
      <Modal
        open={openSetting === 'libraryPolicy'}
        onClose={closeSetting}
        title={tr('Library uploads and review')}
        maxWidth="max-w-[560px]"
        footer={closeButton}
      >
        <div className="space-y-2">
          <p className="text-[12px] leading-relaxed text-ink-2">
            {tr('These restrictions are enforced by the server when a document is added or downloaded, so they hold for every client. A document that needs review stays visible only to its author and to administrators until it is published.')}
          </p>

          <LibraryToggle
            label={tr('Allow Library uploads')}
            description={tr('Off closes the Library to every new document, administrators included.')}
            checked={libraryPolicy.uploadsEnabled}
            disabled={!canManage || libraryLoading}
            onChange={() => setLibraryOption('uploadsEnabled', 'library_uploads_enabled', libraryPolicy.uploadsEnabled ? '0' : '1')}
          />
          <LibraryToggle
            label={tr('Allow teachers to add documents')}
            description={tr('Off leaves uploads to administrators only; teachers keep reading the shelf.')}
            checked={libraryPolicy.teacherUploadsEnabled}
            disabled={!canManage || libraryLoading || !libraryPolicy.uploadsEnabled}
            onChange={() => setLibraryOption('teacherUploadsEnabled', 'library_teacher_uploads_enabled', libraryPolicy.teacherUploadsEnabled ? '0' : '1')}
          />
          <LibraryToggle
            label={tr('Review before publishing')}
            description={tr('On makes an administrator’s decision the last step. Off publishes a submission immediately.')}
            checked={libraryPolicy.reviewRequired}
            disabled={!canManage || libraryLoading}
            onChange={() => setLibraryOption('reviewRequired', 'library_review_required', libraryPolicy.reviewRequired ? '0' : '1')}
          />
          <LibraryToggle
            label={tr('Allow students to download')}
            description={tr('Off lets students read and watch in the page but not save a copy.')}
            checked={libraryPolicy.studentDownloads}
            disabled={!canManage || libraryLoading}
            onChange={() => setLibraryOption('studentDownloads', 'library_student_downloads', libraryPolicy.studentDownloads ? '0' : '1')}
          />
          <LibraryToggle
            label={tr('Require a category')}
            description={tr('On keeps every document filed on a shelf, which is what makes the catalogue searchable.')}
            checked={libraryPolicy.requireCategory}
            disabled={!canManage || libraryLoading}
            onChange={() => setLibraryOption('requireCategory', 'library_require_category', libraryPolicy.requireCategory ? '0' : '1')}
          />

          <div className="flex items-end justify-between gap-3 rounded-[4px] border border-line bg-canvas px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-ink">{tr('Largest document')}</div>
              <div className="mono mt-0.5 text-[10px] text-ink-3">
                {tr('A video can be large; the shared storage root has to hold it.')}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <input
                type="number"
                min="1"
                max="4096"
                value={libraryMaxDraft}
                onChange={(event) => setLibraryMaxDraft(event.target.value)}
                disabled={!canManage || libraryLoading}
                aria-label={tr('Largest Library document in megabytes')}
                className="field h-7 w-20 text-[11.5px]"
              />
              <span className="mono text-[10px] text-ink-3">MB</span>
              <Button size="sm" variant="secondary" onClick={saveLibraryMax} loading={savingLibraryMax} disabled={!canManage || libraryLoading}>
                {tr('Save')}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ---- Library categories ---- */}
      <Modal
        open={openSetting === 'libraryCategories'}
        onClose={closeSetting}
        title={tr('Library categories')}
        maxWidth="max-w-[600px]"
        footer={closeButton}
      >
        <div className="space-y-3">
          <p className="text-[12px] leading-relaxed text-ink-2">
            {tr('Categories are the shelves of the Library. A document is filed on one; archiving a category hides it from new uploads without touching the documents already on it.')}
          </p>

          <div className="rounded-[4px] border border-line bg-canvas p-2.5">
            <div className="grid gap-1.5 sm:grid-cols-3">
              <div>
                <label className="field-label" htmlFor="library-new-en">{tr('Name (English)')}</label>
                <input
                  id="library-new-en"
                  className="field h-7 text-[11.5px]"
                  value={newCategory.labelEn}
                  onChange={(event) => setNewCategory((prev) => ({ ...prev, labelEn: event.target.value }))}
                  placeholder="Mathematics"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="library-new-ar">{tr('Name (Arabic)')}</label>
                <input
                  id="library-new-ar"
                  dir="rtl"
                  className="field h-7 text-[11.5px]"
                  value={newCategory.labelAr}
                  onChange={(event) => setNewCategory((prev) => ({ ...prev, labelAr: event.target.value }))}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="library-new-fr">{tr('Name (French)')}</label>
                <input
                  id="library-new-fr"
                  className="field h-7 text-[11.5px]"
                  value={newCategory.labelFr}
                  onChange={(event) => setNewCategory((prev) => ({ ...prev, labelFr: event.target.value }))}
                />
              </div>
            </div>
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={createLibraryCategory} loading={libraryBusy === 'new'} disabled={!canManage || libraryBusy === 'new'}>
                <Plus size={11} /> {tr('Add category')}
              </Button>
            </div>
          </div>

          <div>
            {libraryLoading ? (
              <p className="py-4 text-center text-[11.5px] text-ink-3">{tr('Loading categories…')}</p>
            ) : libraryCategories.length === 0 ? (
              <p className="py-4 text-center text-[11.5px] text-ink-3">{tr('No category exists yet. Add the first shelf above.')}</p>
            ) : (
              libraryCategories.map((category) => (
                <div key={category.LIBRARY_CATEGORY_ID} className="border-t border-line py-2 first:border-t-0">
                  {categoryEdit?.id === category.LIBRARY_CATEGORY_ID ? (
                    <div className="space-y-2">
                      <div className="grid gap-1.5 sm:grid-cols-3">
                        <input
                          className="field h-7 text-[11.5px]"
                          value={categoryEdit.labelEn}
                          onChange={(event) => setCategoryEdit((prev) => ({ ...prev, labelEn: event.target.value }))}
                          aria-label={tr('Name (English)')}
                        />
                        <input
                          dir="rtl"
                          className="field h-7 text-[11.5px]"
                          value={categoryEdit.labelAr}
                          onChange={(event) => setCategoryEdit((prev) => ({ ...prev, labelAr: event.target.value }))}
                          aria-label={tr('Name (Arabic)')}
                        />
                        <input
                          className="field h-7 text-[11.5px]"
                          value={categoryEdit.labelFr}
                          onChange={(event) => setCategoryEdit((prev) => ({ ...prev, labelFr: event.target.value }))}
                          aria-label={tr('Name (French)')}
                        />
                      </div>
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => setCategoryEdit(null)} disabled={libraryBusy === `edit-${category.LIBRARY_CATEGORY_ID}`}>
                          {tr('Cancel')}
                        </Button>
                        <Button size="sm" onClick={saveCategoryEdit} loading={libraryBusy === `edit-${category.LIBRARY_CATEGORY_ID}`}>
                          {tr('Save')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[12px] text-ink">{localizedLabel(category, 'LABEL')}</span>
                          <span className="mono shrink-0 text-[9px] uppercase tracking-[0.05em] text-ink-3">
                            {category.CATEGORY_CODE}
                          </span>
                        </div>
                        <div className="mono mt-0.5 text-[9.5px] text-ink-3">
                          {category.ITEM_COUNT || 0} {tr('documents')} · {category.IS_ACTIVE ? tr('active') : tr('archived')}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => toggleCategory(category)} disabled={libraryBusy === `active-${category.LIBRARY_CATEGORY_ID}`}>
                        {category.IS_ACTIVE ? tr('Archive') : tr('Restore')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={tr('Rename category')}
                        onClick={() => setCategoryEdit({
                          id: category.LIBRARY_CATEGORY_ID,
                          labelEn: category.LABEL_EN || '',
                          labelAr: category.LABEL_AR || '',
                          labelFr: category.LABEL_FR || '',
                          isActive: category.IS_ACTIVE
                        })}
                      >
                        <Pencil size={11} />
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        aria-label={tr('Remove category')}
                        onClick={() => removeLibraryCategory(category)}
                        loading={libraryBusy === `delete-${category.LIBRARY_CATEGORY_ID}`}
                      >
                        <Trash2 size={11} />
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {(openSetting === 'username' || openSetting === 'password' || (canDevelop && openSetting === 'userPasswords')) && (
        <React.Suspense fallback={null}>
          <AccountModals
            setting={openSetting}
            canResetUsers={canDevelop}
            onClose={closeSetting}
            user={user}
            savedUsername={savedUsername}
            onUsernameSaved={setSavedUsername}
            onMessage={(text) => setMessage({ type: 'ok', text })}
          />
        </React.Suspense>
      )}

      <RegistersDialog register={openRegister} user={user} onClose={() => setOpenRegister(null)} />

      <LegacyImportDialog
        open={openSetting === 'legacy'}
        onClose={closeSetting}
        userId={user?.id}
      />

      <ReleaseNoteDialog
        entry={latestRelease}
        open={showRelease}
        onClose={() => setShowRelease(false)}
        footer={
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setShowRelease(false)}
              className="inline-flex h-8 items-center rounded-[4px] border border-line-strong bg-surface px-3 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted"
            >
              {tr('Close')}
            </button>
          </div>
        }
      />
    </div>
  )
}

// A titled plate grouping one-line setting rows.
function SettingGroup({ title, children }) {
  return (
    <section className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex h-9 items-center border-b border-line bg-surface-muted px-3">
        <h2 className="kicker text-ink-2">{title}</h2>
      </div>
      <div className="anim-stagger divide-y divide-line">{children}</div>
    </section>
  )
}

// One setting at a glance: what it is, where it currently stands, and a way in.
function SettingRow({ icon: Icon, title, value, tone = 'neutral', onOpen, disabled = false, actionLabel, badge }) {
  const dot =
    tone === 'good' ? 'var(--color-success)'
      : tone === 'bad' ? 'var(--color-danger)'
        : tone === 'warn' ? 'var(--color-warning)'
          : 'var(--color-ink-3)'
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] border border-line bg-surface-muted text-ink-3" aria-hidden="true">
        <Icon size={12} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: dot }} aria-hidden="true" />
          <span className="truncate text-[12px] font-medium text-ink">{title}</span>
          {badge && (
            <span
              className="shrink-0 rounded-full border border-warning/40 bg-warning-bg px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide text-warning-ink"
              title={badge}
            >
              {badge}
            </span>
          )}
        </div>
        <div className="mono mt-0.5 truncate text-[10px] text-ink-3">{value}</div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        aria-label={`${actionLabel || tr('Open')} — ${title}`}
        className="inline-flex h-7 shrink-0 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        {actionLabel || tr('Open')}
      </button>
    </div>
  )
}

// A Library restriction: the rule, what it means, and the switch that saves it.
function LibraryToggle({ label, description, checked, onChange, disabled = false }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[4px] border border-line bg-canvas px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-ink">{label}</div>
        <div className="mono mt-0.5 text-[10px] leading-relaxed text-ink-3">{description}</div>
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  )
}

// Two-state control shared by every switch in the dialogs.
function Switch({ checked, onChange, disabled = false, label = '' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-line-strong transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={{ background: checked ? 'var(--color-jade-solid)' : 'var(--color-surface-muted)' }}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full transition-transform"
        style={{
          background: checked ? 'var(--color-on-jade)' : 'var(--color-ink-3)',
          transform: checked ? 'translateX(18px)' : 'translateX(3px)'
        }}
      />
    </button>
  )
}

export default SettingsPage
