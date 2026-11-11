// Imported first on purpose: it moves the previous app-data folder under the
// new name before documentService resolves its documents folder.
import './appDataMigration.js'
import { app, shell, BrowserWindow, ipcMain, dialog, screen, Notification, protocol, nativeTheme } from 'electron'
import { previewLegacyImport, runLegacyImport } from './services/legacyImport'
import { join } from 'path'
import { hostname } from 'os'
import fs from 'fs'
import { Readable } from 'stream'
import { DEFAULT_INTERFACE_SCALE, normalizeInterfaceScale } from '../shared/interfaceScale'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDb, connectPostgres, disconnectPostgres, reconnectPostgres, query, closeDb, getSavedPgConfig, getActivePgConfig, listenForNotifications, stopNotificationListener, getOfflineState } from './db'
import { scheduleWarmup } from './offlineWarmup'
import {
  discardOutboxEntry,
  flushOutbox,
  getOutboxState,
  getSessionPending,
  listOutboxEntries,
  resolveOutboxConflict,
  retryOutboxEntry,
  setOutboxChangeListener
} from './offlineSync'
import { getOfflineSummary } from './offlineStatus'
import { offlineFileIds } from './offlineFiles'
import { removeLibraryItemOffline, saveLibraryItemForOffline } from './services/libraryService'
import { removeDocumentOffline, saveDocumentForOffline } from './services/documentService'
import { getDeploymentInfo } from './deployment'
import { initStorage, getStorageConfig } from './services/resourceStorage'
import { buildToastXml, fileUrl } from './services/desktopNotification'
import { setLanguage } from './localization'
import { getPersons, getTeachers, getPersonnel, getStudentsWithSections, createPerson, updatePerson, deletePerson, assignPersonRole, endPersonRole, setPersonDepartment } from './services/personService'
import { choosePersonPhoto, readPersonPhoto, readPersonPhotos, setPersonPhoto } from './services/photoService'
import { getWeekSessionRecords, getSessionStudentInfo } from './services/sessionRecordsService'
import { getMyTeachingScope, loadScope, setAccountCategories, setAccountDepartments } from './services/teachingScopeService'
import {
  getSecretaries,
  updateSecretaryAccount,
  setSecretaryPermissions,
  getConductGlobalRights,
  setConductGlobalRights
} from './services/secretaryService'
import { generateStudentReportPdf } from './services/studentReportService'
import { getStudySessions, getStudyWeekDays, createStudySession, deleteStudySession, getTeacherSessions, getStudentSessions, getSessionTypeRemainingHours, getExamEvents } from './services/scheduleService'
import {
  getTeacherConstraints,
  getTeacherConstraintSettings,
  getTeacherConstraintOptions,
  createTeacherConstraint,
  deleteTeacherConstraint,
  createTeacherConstraintOption,
  updateTeacherConstraintOption,
  deleteTeacherConstraintOption
} from './services/teacherConstraintService'
import {
  getDocuments,
  getDocumentTypes,
  getPopularDocuments,
  recordDocumentAccess,
  uploadDocument,
  deleteDocument,
  resolveDocumentFile,
  hasMediaGrant,
  downloadDocument,
  openDocument,
  getMajorCategories as getDocMajorCategories,
  getMajorsByCategory,
  getChaptersByMajor,
  getLessonsByChapter,
  createChapter,
  updateChapter,
  deleteChapter,
  createLesson,
  updateLesson,
  deleteLesson
} from './services/documentService'
import {
  getLibraryItems,
  getLibraryCategories,
  getLibraryPolicy,
  getLibraryReviewQueue,
  getLibraryReviewCount,
  uploadLibraryItem,
  updateLibraryItem,
  reviewLibraryItem,
  setLibraryItemArchived,
  deleteLibraryItem,
  downloadLibraryItem,
  openLibraryItem,
  recordLibraryAccess,
  resolveLibraryFile,
  hasLibraryMediaGrant,
  createLibraryCategory,
  updateLibraryCategory,
  deleteLibraryCategory
} from './services/libraryService'
import { createBugReport, getBugReports, getMyBugReports, updateBugReport, uploadBugScreenshot, openBugScreenshot } from './services/bugReportService'
import {
  getChangelogs,
  createChangelog,
  updateChangelog,
  deleteChangelog,
  userCanManageChangelog,
  getPendingChangelog,
  markChangelogSeen
} from './services/changelogService'
import { getMyProfile, updateMyUsername, changeMyPassword } from './services/myProfileService'
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  getNotificationComments,
  addNotificationComment,
  deleteNotificationComment,
  getNotificationPreferences,
  setNotificationMute
} from './services/notificationService'
import { getRewardsPunishmentsStudents, getPunishmentTypes, getRewardTypes, getPunishmentJustifications, getRewardJustifications, getStudentRewardsPunishments, applyPunishment, applyReward, applyPunishmentBulk, applyRewardBulk, updatePunishment, updateReward, deletePunishment, deleteReward } from './services/rewardsPunishmentsService'
import { login, register } from './services/authService'
import {
  startUserSession,
  heartbeatUserSession,
  getUserSessions,
  getAllUserSessions,
  endUserSession,
  endOtherUserSessions,
  endAllUserSessions
} from './services/userSessionService'
import { getDashboardStats } from './services/statsService'
import { getAdminStatistics } from './services/adminStatsService'
import { 
  createStudyYear, 
  createStudySemester, 
  createStudyWeek, 
  updateStudyYear,
  updateStudySemester,
  updateStudyWeek,
  generateStudyWeeks,
  deleteStudyYear,
  deleteStudySemester,
  deleteStudyWeek,
  getStudyYears,
  getStudySemesters,
  getStudyWeeks,
  getMajors,
  getMajorTeachers,
  updateMajorTeachers,
  getMajorsTaughtByTeacher,
  createMajor,
  updateMajor,
  deleteMajor,
  getPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  getMajorCategories,
  createMajorCategory,
  updateMajorCategory,
  deleteMajorCategory,
  getTeachingCategories,
  createTeachingCategory,
  updateTeachingCategory,
  deleteTeachingCategory,
  getClassrooms,
  createClassroom,
  updateClassroom,
  deleteClassroom,
  getClassroomSeats,
  addClassroomSeat,
  deleteClassroomSeat,
  generateClassroomSeats,
  getClassroomCategories,
  createClassroomCategory,
  updateClassroomCategory,
  deleteClassroomCategory,
  getTeachingGroups,
  createTeachingGroup,
  updateTeachingGroup,
  deleteTeachingGroup,
  getStudySessionTypes,
  createStudySessionType,
  updateStudySessionType,
  deleteStudySessionType,
  getStudySessionTimeSlots,
  createStudySessionTimeSlot,
  updateStudySessionTimeSlot,
  deleteStudySessionTimeSlot,
  getSections,
  createSection,
  updateSection,
  deleteSection,
  getTeachingGroupsByMajor,
  getTeachingGroupsForSemester,
  createStudentDynamicGroupByMajor,
  getAcademicGrades,
  createAcademicGrade,
  updateAcademicGrade,
  deleteAcademicGrade,
  getDepartments,
  getDirections,
  createDirection,
  updateDirection,
  deleteDirection,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getGrades,
  createGrade,
  updateGrade,
  deleteGrade,
  getMajorHourlyVolumes,
  createMajorHourlyVolume,
  updateMajorHourlyVolume,
  deleteMajorHourlyVolume,
  getMajorHourlyProgress,
  getMajorHourlyVolumesBySessionType,
  createMajorHourlyVolumeBySessionType,
  updateMajorHourlyVolumeBySessionType,
  deleteMajorHourlyVolumeBySessionType,
  getTeachingSectionHourlyVolumes,
  createTeachingSectionHourlyVolume,
  updateTeachingSectionHourlyVolume,
  deleteTeachingSectionHourlyVolume,
  getTeachingGroupHourlyProgress,
  getStudentSections,
  getStudentSectionHistory,
  getSectionStudents,
  assignStudentToSection,
  removeStudentFromSection,
  updateStudentSections,
  getStudentsInTeachingGroup,
  addStudentToTeachingGroup,
  removeStudentFromTeachingGroup,
  updateTeachingGroupRoster,
  getTeachingGroupsForStudent,
  getMajorSemesterFactors,
  setMajorSemesterFactor
} from './services/academicService'
import { getAppOptions, setAppOption, getBetaTesterUsers, setBetaTester } from './services/settingsService'
import { getUpdateInfo, downloadUpdate, installUpdate } from './services/appUpdate'
import { getAuditLog, exportAuditCsv, recordAudit, setAuditAppVersion, pruneExpiredAuditLogs } from './services/auditService'
import { assertPageAccess, getLockedPages, setPageLocked, setPageLockRoles } from './services/pageLockService'
import { getBetaTestVersions, getBetaTestReports, saveBetaTestReport } from './services/betaTestService'
import { getAccounts, setAccountActive, updateAccount, createAccount, createPersonWithAccount, searchAccountCandidates } from './services/accountService'
import {
  getInbox,
  getInboxUnreadCount,
  markMessageSeen,
  markAllMessagesSeen,
  getMessageRoles,
  getMessageAudience,
  sendMessage,
  getSentMessages,
  getMessageRecipients
} from './services/inboxService'
import { searchUsersForPasswordReset, resetUserPassword } from './services/userAdminService'
import { getSuspendedAccounts, unlockAccount } from './services/accountSecurityService'
import {
  getMessagingRules,
  setMessagingRule,
  setMessagingScope,
  getContactableUsers,
  getConversations,
  openConversation,
  getConversation,
  sendDirectMessage,
  getUnreadDirectCount,
  touchLastSeen,
  encryptStoredDirectMessages
} from './services/messagingService'
import { ensureMessageKey } from './messageCrypto'
import { processSyncQueue } from './sync'
import {
  getExaminationTypes,
  createExaminationType,
  updateExaminationType,
  deleteExaminationType,
  getExaminations,
  getExaminationById,
  createExamination,
  updateExamination,
  deleteExamination,
  getExaminationGuards,
  setExaminationGuards,
  getFreeGuards,
  getExaminationSeating,
  saveExaminationSeating,
  getFreeSeats,
  getTeacherExaminations,
  getExaminationMarks,
  saveExaminationMarks,
  getSemesterMarks,
  getStudentMarks
} from './services/examinationService'
import {
  getAbsenceJustifications,
  getAbsencesForSession,
  getSessionStudentsForAbsence,
  markStudentAbsent,
  markStudentPresent,
  getTeacherActiveSession,
  getTeacherCurrentSession,
  getTeacherSessionsForPeriod,
  getStudentAbsenceHistory,
  getGlobalAbsenceHistory
} from './services/absenceService'
import {
  getSessionRegister,
  markSessionAttended,
  scanMissedSessions,
  scanStartedSessions,
  getTeacherAttendanceReport
} from './services/teacherAttendanceService'
import {
  scanMissingExamMarks,
  scanAbsenceThresholds,
  scanTeacherAttendanceSummary
} from './services/notificationScanService'
import {
  getObservationMotifs,
  getObservationsForSession,
  createObservation,
  deleteObservation,
  deleteStudentObservationsForSession,
  getStudentObservationHistory,
  getGlobalObservationHistory
} from './services/observationService'
import {
  getHealthStatuses,
  getHobbies,
  getProfessions,
  getRelations,
  getStudentSpecialities,
  getAcademicLevels,
  getEducationalCertificates,
  getArmies,
  getCountries,
  getRecruitmentSources,
  getWilayas,
  getDairas,
  getCommunes,
  getStudentProfile,
  getStudentRecordOptions,
  createStudentProfile,
  checkStudentIdentifiers,
  updateStudentDetail,
  updateStudentIdentity,
  updateStudentParents,
  addEmergencyContact,
  updateEmergencyContact,
  deleteEmergencyContact,
  setStudentHobbies,
  updateCombatOutfit,
  updateParadeUniform,
  updateStudentPersonalAddress
} from './services/profileService'
import {
  getUniformSizeOptions,
  createUniformSizeOption,
  updateUniformSizeOption,
  deleteUniformSizeOption
} from './services/uniformSizeService'

// Server-side role check: does the user hold any of the given role codes?
// Follows the same pattern as the other role gates (settings, bug reports,
// changelog) — verified against the database, not the renderer's claim.
async function userHasAnyRole(userId, roleCodes) {
  if (!userId) return false
  const inList = roleCodes.map(c => `'${c}'`).join(', ')
  const res = await query(
    `SELECT 1 FROM "user" u
     JOIN "role" r ON r.role_id = u.role_id
     WHERE u.user_id = $1 AND r.role_code IN (${inList})
     LIMIT 1`,
    [userId]
  )
  return res.rowCount > 0
}

// Lesson files — including videos — are played by the page, so the renderer
// needs to read them. It never gets a path: it asks for `lesson-media://media/
// <document id>` and the main process decides which file that is. The scheme has
// to be declared before the app is ready, and it is treated as a real, secure
// origin so <video> will load it and a fetch from the page can read it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lesson-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  },
  {
    scheme: 'library-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

const gotTheLock = app.requestSingleInstanceLock()

// The application mark, wherever this build keeps it: an extra resource in a
// packaged build, build/ next to the source while developing. One file per
// accent palette (scripts/make-icon.cjs); the window, the taskbar and the
// notification popup all use the chosen one.
const ACCENT_NAMES = ['emerald', 'red', 'gold', 'blue', 'pink']

function accentChoiceFile() {
  return join(app.getPath('userData'), 'ui_accent.json')
}

// Device-local, like the database connection: the window's own mark is drawn by
// the operating system before the renderer paints, so the main process has to
// know the choice on its own.
function readStoredAccent() {
  try {
    const saved = JSON.parse(fs.readFileSync(accentChoiceFile(), 'utf8'))
    return ACCENT_NAMES.includes(saved?.accent) ? saved.accent : 'emerald'
  } catch {
    return 'emerald'
  }
}

function writeStoredAccent(accent) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(accentChoiceFile(), JSON.stringify({ accent }, null, 2), 'utf8')
  } catch (error) {
    console.warn('Could not store the accent choice:', error.message)
  }
}

// The interface scale is device-local for the same reason as the accent: the
// window is shown only after its page has loaded, so the zoom has to be applied
// before that first visible frame or the layout would jump. The renderer keeps
// the control's copy in localStorage; this file keeps the copy the window opens
// with.
function interfaceScaleFile() {
  return join(app.getPath('userData'), 'ui_scale.json')
}

function readStoredInterfaceScale() {
  try {
    const saved = JSON.parse(fs.readFileSync(interfaceScaleFile(), 'utf8'))
    return normalizeInterfaceScale(saved?.scale)
  } catch {
    return DEFAULT_INTERFACE_SCALE
  }
}

function writeStoredInterfaceScale(scale) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(interfaceScaleFile(), JSON.stringify({ scale }, null, 2), 'utf8')
  } catch (error) {
    console.warn('Could not store the interface scale:', error.message)
  }
}

// Zoom is a per-window setting. It is applied only to the window that asked for
// it: the report window is A4 print geometry and must keep a factor of 1.
function applyInterfaceScale(win, scale = readStoredInterfaceScale()) {
  if (!win || win.isDestroyed()) return
  try {
    win.webContents.setZoomFactor(normalizeInterfaceScale(scale))
  } catch (error) {
    console.warn('Could not apply the interface scale:', error.message)
  }
}

// The window paints its own background before React mounts, so it has to be the
// palette's canvas already: a red or gold session must not open on a pine flash.
const ACCENT_CANVAS = {
  emerald: '#0d1310',
  red: '#130d0d',
  gold: '#13110d',
  blue: '#0d1013',
  pink: '#130d0f'
}

function accentCanvas(accent = readStoredAccent()) {
  return ACCENT_CANVAS[accent] || ACCENT_CANVAS.emerald
}

function appIconPath(accent = readStoredAccent()) {
  const file = accentIconFile(accent)
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, file), join(__dirname, '../renderer', file)]
    : [join(__dirname, '../../build', file), join(__dirname, '../renderer', file)]
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) {
    console.warn('Application icon not found, the window keeps its default mark:', candidates[0])
  }
  return found || candidates[0]
}

function accentIconFile(accent) {
  return ACCENT_NAMES.includes(accent) && accent !== 'emerald' ? `icon-${accent}.png` : 'icon.png'
}

// The identity Windows files this application's windows under. The installer
// registers 'com.enote' on its shortcuts; an unpackaged run has no such
// shortcut and identifies itself by its executable, as the Electron docs ask.
function appUserModelId() {
  return app.isPackaged ? 'com.enote' : process.execPath
}

// Puts the accent's mark on a window: the icon the taskbar draws for it, and -
// on Windows - the taskbar button's own icon. A packaged build identifies itself
// by AppUserModelId, so Windows draws that button (and a pinned shortcut) from
// the executable's icon unless the button's icon is named too; without this the
// palette colours the interface and the taskbar stays emerald.
//
// The id has to travel with the icon: setAppDetails documents appId as the
// property the rest are written to, and Windows ignores appIconPath without it,
// which is what left the button on the executable's mark.
function applyWindowIcon(win, accent = readStoredAccent()) {
  if (!win || win.isDestroyed() || process.platform === 'darwin') return
  const icon = appIconPath(accent)
  try {
    win.setIcon(icon)
  } catch (error) {
    console.warn('Could not set the window icon:', error.message)
    return
  }
  if (process.platform === 'win32') {
    try {
      win.setAppDetails({ appId: appUserModelId(), appIconPath: icon, appIconIndex: 0 })
    } catch (error) {
      console.warn('Could not set the taskbar icon:', error.message)
    }
  }
}

// Native notifications currently on screen. A Notification object that is
// garbage-collected while it is showing takes the toast with it, so each one is
// held here until it closes or is clicked.
const liveDesktopNotifications = new Set()

// A frameless window can report isMaximized() as false on Windows even when it
// fills the work area, so fall back to comparing the frame with the display.
function isMaximizedWindow(win) {
  if (!win || win.isDestroyed()) return false
  if (win.isFullScreen()) return false
  try {
    if (win.isMaximized()) return true
    const bounds = win.getBounds()
    const { workArea } = screen.getDisplayMatching(bounds)
    return (
      Math.abs(bounds.x - workArea.x) <= 8 &&
      Math.abs(bounds.y - workArea.y) <= 8 &&
      Math.abs(bounds.width - workArea.width) <= 8 &&
      Math.abs(bounds.height - workArea.height) <= 8
    )
  } catch {
    return win.isMaximized()
  }
}

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, we should focus our window.
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    // The renderer owns the title bar: window controls live in the app header
    // so the chrome matches the registry surface instead of the OS default.
    frame: false,
    backgroundColor: accentCanvas(),
    // Taskbar/dock mark. Packaged builds carry it as an extra resource; during
    // development it is read from build/, where the installer icons live too.
    icon: appIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      // Needed for the ESM preload bridge, which cannot run in a sandboxed
      // renderer. DevTools are a development affordance only: a packaged build
      // must not expose the preload API through a console.
      sandbox: false,
      devTools: !app.isPackaged
    }
  })

  mainWindow.on('ready-to-show', () => {
    // The taskbar button is created with the window, so the accent's mark is
    // applied again here: the stored choice read at launch and one switched
    // later in the session then look the same on the taskbar.
    applyWindowIcon(mainWindow)
    // Before the first visible frame: the stored interface scale is already in
    // effect, so the window never opens at 100% and then jumps.
    applyInterfaceScale(mainWindow)
    mainWindow.show()
  })

  // Keep the renderer's maximize glyph in sync when the window is maximized by
  // double-clicking the title bar, Aero snap, or the taskbar.
  const sendMaximizedState = () => {
    if (mainWindow.isDestroyed()) return
    const next = isMaximizedWindow(mainWindow)
    if (mainWindow.__maximizedState === next) return
    mainWindow.__maximizedState = next
    mainWindow.webContents.send('window:maximized', next)
  }
  mainWindow.on('maximize', sendMaximizedState)
  mainWindow.on('unmaximize', sendMaximizedState)
  mainWindow.on('resize', sendMaximizedState)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // A reload (or a dev-server refresh) resets the zoom; the stored scale is
  // applied again on every load so the window keeps the size the user chose.
  mainWindow.webContents.on('did-finish-load', () => applyInterfaceScale(mainWindow))
}

// Makes sure the direct-message key is usable before anything needs it: a
// broken key file is replaced here, once, instead of on the first message.
//
// A replacement is deliberately silent. The messages the old key protected are
// unreadable whatever the user does about it, so there is nothing to decide and
// nothing to ask — the details go to the log (see rotateUnreadableKeyFile). An
// earlier version showed a dialog here, which on a machine whose key store
// cannot read its own output meant the same modal on every launch.
function prepareDirectMessageKey() {
  try {
    ensureMessageKey()
  } catch (error) {
    // Leave the detailed reason in the log; messaging handlers surface their
    // own errors when the key is actually needed.
    console.error('Could not initialise the direct-message encryption key:', error.message)
  }
}

function upgradeDirectMessageStorage() {
  encryptStoredDirectMessages()
    .then(count => {
      if (count > 0) console.log(`Encrypted ${count} direct message(s) at rest.`)
    })
    .catch(error => console.warn('Could not encrypt stored direct messages:', error.message))
}

app.whenReady().then(async () => {
  // Windows only shows a toast for an application whose AppUserModelId matches
  // an installed shortcut. Packaged builds own 'com.enote' through their
  // installer; an unpackaged run (npm run dev, electron-vite preview) has no
  // such shortcut, so it identifies itself by its executable — the shortcut the
  // Electron docs ask you to pin to the Start menu during development.
  electronApp.setAppUserModelId(appUserModelId())
  setAuditAppVersion(app.getVersion())

  // Photos, lesson material and screenshots live under the configured storage
  // root: this computer by default, the shared server folder in a deployment.
  // Logged here so a share that is down is reported before the first save.
  await initStorage()

  await initDb()
  upgradeDirectMessageStorage()
  prepareDirectMessageKey()

  // Retention: entries older than 12 months are removed once a day. The call
  // reports its own failure and does nothing before the audit migration exists.
  pruneExpiredAuditLogs()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC handlers
  // Window controls for the custom title bar.
  // The accent chosen in the interface also colours the window's own mark: the
  // taskbar icon and the notification popup are files, not CSS, so the renderer
  // hands the choice over and the main process swaps them. Stored in userData so
  // the next launch opens with the right mark, before the first paint.
  ipcMain.handle('app:setAccent', async (_, accent) => {
    if (!ACCENT_NAMES.includes(accent)) return { success: false }
    writeStoredAccent(accent)
    // Windows and Linux take the icon on the window; macOS draws the dock mark
    // from the bundle and ignores this.
    for (const win of BrowserWindow.getAllWindows()) applyWindowIcon(win, accent)
    return { success: true, accent }
  })

  // Chromium draws select popups, date pickers and system menus itself, outside
  // the page's CSS, and follows the window's native appearance for them. Without
  // this switch a dark (or pure-black) window on a light Windows session still
  // opens its option lists in white; the renderer sends the resolved mode.
  ipcMain.handle('app:setNativeTheme', async (_, mode) => {
    const next = mode === 'light' || mode === 'dark' ? mode : 'system'
    nativeTheme.themeSource = next
    return { success: true, mode: next }
  })

  // Interface scale: stored for the next launch and applied to the window that
  // changed it (the application window), never to the report/print window.
  ipcMain.handle('app:setInterfaceScale', async (event, scale) => {
    const next = normalizeInterfaceScale(scale)
    writeStoredInterfaceScale(next)
    applyInterfaceScale(BrowserWindow.fromWebContents(event.sender), next)
    return { success: true, scale: next }
  })

  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle('window:toggleMaximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (isMaximizedWindow(win)) win.unmaximize()
    else win.maximize()
    return isMaximizedWindow(win)
  })

  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('window:isMaximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? isMaximizedWindow(win) : false
  })

  ipcMain.handle('db:connect', async (_, config) => {
    const result = await connectPostgres(config)
    if (result.success) {
      upgradeDirectMessageStorage()
      // Fill the local copy of the pages that are read every day, so the next
      // outage starts with them already on disk.
      scheduleWarmup(null, { force: true })
      // Anything attendance work left in the queue goes out now.
      flushOutbox({ trigger: 'connect' })
    }
    return result
  })

  // Audit trail (Admin and Developer only). Reading is re-checked against the
  // database in the service; the visit itself is written to the log.
  ipcMain.handle('audit:list', async (_, userId, filters) => {
    return await getAuditLog(userId, filters || {})
  })

  ipcMain.handle('audit:exportCsv', async (_, userId, filters) => {
    return await exportAuditCsv(userId, filters || {})
  })

  ipcMain.handle('db:disconnect', async () => {
    return await disconnectPostgres()
  })

  ipcMain.handle('db:reconnect', async () => {
    const result = await reconnectPostgres()
    if (result.success) {
      upgradeDirectMessageStorage()
      scheduleWarmup(null, { force: true })
      flushOutbox({ trigger: 'reconnect' })
    }
    return result
  })

  ipcMain.handle('db:getConfig', async (_, userId) => {
    if (!(await userHasAnyRole(userId, ['ADMIN', 'DEVELOPER']))) {
      throw new Error('Not allowed: the Database page requires the Admin or Developer role.')
    }
    return getSavedPgConfig() || {
      user: 'postgres',
      host: 'localhost',
      database: 'eNote',
      password: '',
      port: 5432
    }
  })

  // Raw SQL console (Database page). Restricted to ADMIN and DEVELOPER
  // server-side: arbitrary SQL can read or modify any table, so the check is
  // done against the database's role table rather than the renderer's claim.
  ipcMain.handle('db:query', async (_, userId, sql, params) => {
    if (!(await userHasAnyRole(userId, ['ADMIN', 'DEVELOPER']))) {
      throw new Error('Not allowed: the Database page requires the Admin or Developer role.')
    }
    return await query(sql, params)
  })

  // Display language for database labels (see ./localization.js). It is a
  // device-local UI preference sent by the renderer before it reloads data.
  ipcMain.handle('i18n:setLanguage', async (_, language) => {
    return { language: setLanguage(language) }
  })

  // The offline queue (attendance recorded while the server was away). The chip
  // in the title bar reads these; the dialog resolves conflicts one entry at a
  // time, never in bulk.
  ipcMain.handle('offline:outbox:list', async () => listOutboxEntries())
  ipcMain.handle('offline:outbox:counts', async () => getOutboxState())
  ipcMain.handle('offline:outbox:flush', async () => await flushOutbox({ trigger: 'manual' }))
  ipcMain.handle('offline:outbox:resolve', async (_, id, choice) => await resolveOutboxConflict(id, choice))
  ipcMain.handle('offline:outbox:retry', async (_, id) => {
    retryOutboxEntry(id)
    return await flushOutbox({ trigger: 'retry' })
  })
  ipcMain.handle('offline:outbox:discard', async (_, id) => discardOutboxEntry(id))
  // Unsent attendance and observations for one session, so both pages show the
  // same register while the server is away.
  ipcMain.handle('offline:session:pending', async (_, sessionId) => getSessionPending(sessionId))

  // Queued, sent or conflicted: every window hears about it at once, so the
  // count never depends on the polling timer.
  setOutboxChangeListener((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('offline:outbox:changed', state)
    }
  })

  // What is held on this computer, for the offline details panel: records,
  // photographs and the last session-roster warm-up, with their timestamps.
  ipcMain.handle('offline:cache:summary', async () => getOfflineSummary())

  // Connection status for any signed-in screen (no arbitrary SQL involved).
  ipcMain.handle('db:status', async () => {
    // The endpoint is reported even when the query fails: the sign-in screen
    // needs to name the server it cannot reach. The password never leaves the
    // main process.
    const active = getActivePgConfig()
    const preset = getDeploymentInfo()
    const endpoint = {
      host: active?.host || preset.host || null,
      port: active?.port || preset.port || 5432,
      database: active?.database || preset.database || 'eNote',
      user: active?.user || preset.user || null
    }
    try {
      const res = await query('SELECT 1')
      const state = getOfflineState()
      // The server answers: send whatever the attendance queue is holding. The
      // call is not awaited — a status check must stay fast — and it is a no-op
      // when the queue is empty or a send is already running.
      flushOutbox({ trigger: 'status' })
      return {
        connected: res.source === 'postgres',
        source: res.source,
        checked: true,
        offline: res.source !== 'postgres',
        cachedAt: res.cachedAt || null,
        lastSyncAt: state.lastSyncAt,
        cache: state.cache,
        outbox: getOutboxState(),
        ...endpoint
      }
    } catch (error) {
      const state = getOfflineState()
      return {
        connected: false,
        source: 'disconnected',
        checked: true,
        offline: true,
        error: error.message,
        lastSyncAt: state.lastSyncAt,
        cache: state.cache,
        outbox: getOutboxState(),
        ...endpoint
      }
    }
  })

  // Global application settings (Settings page). Only ADMIN users may change
  // them, except the exam marks lock, which a Director holds as well; reading
  // is open to every logged-in user (the UI needs the state).
  ipcMain.handle('settings:get', async (_, userId) => {
    return await getAppOptions()
  })

  ipcMain.handle('settings:set', async (_, userId, key, value) => {
    if (!userId) {
      throw new Error('Not allowed: you must be signed in to change settings.')
    }
    // The exam marks lock is the one global option a Director shares with an
    // Admin: it is an academic decision, and Settings offers the row to those
    // two roles only.
    if (key === 'exam_marks_locked') {
      if (!(await userHasAnyRole(userId, ['ADMIN', 'DIRECTOR']))) {
        throw new Error('Not allowed: the exam marks lock requires the Director or Admin role.')
      }
    } else if (!(await userHasAnyRole(userId, ['ADMIN']))) {
      throw new Error('Not allowed: changing settings requires the Admin role.')
    }
    return await setAppOption(key, value, userId)
  })

  // Client version gate. Reading is open to every client — the check runs
  // before sign-in as well — while the required version itself is written
  // through settings:set, which is Admin-only.
  ipcMain.handle('update:status', async () => {
    return await getUpdateInfo()
  })

  // Copies the published installer from the LAN share into a local folder and
  // checks it against the manifest's checksum. Progress is pushed to the window
  // that asked, so it can show a percentage while the file crosses the network.
  ipcMain.handle('update:download', async (event) => {
    const webContents = event.sender
    return await downloadUpdate((percent) => {
      if (!webContents.isDestroyed()) webContents.send('update:progress', percent)
    })
  })

  // Runs the verified installer and quits, so it can replace the files.
  ipcMain.handle('update:install', async () => {
    return installUpdate()
  })

  // Opens the installers folder on the LAN share where releases are published,
  // so the "update required" screen leads straight to the file to run. Without
  // a shared storage root there is nothing to open; the renderer then tells the
  // user to ask the administrator.
  ipcMain.handle('update:openInstallerFolder', async () => {
    const config = getStorageConfig()
    if (config.mode !== 'shared' || !config.root) {
      return { opened: false, reason: 'no-share' }
    }
    const installers = join(config.root, 'installers')
    const target = fs.existsSync(installers) ? installers : config.root
    const error = await shell.openPath(target)
    return error ? { opened: false, reason: error } : { opened: true, path: target }
  })

  // The gate is re-checked on a timer as well as at startup: a workstation left
  // open overnight must pick up a release published the next morning without
  // anybody restarting it. A check that fails leaves the client running.
  const checkForRequiredUpdate = async () => {
    try {
      const status = await getUpdateInfo()
      if (!status?.required) return
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('update:required', status)
      }
    } catch {
      // The database is unreachable; the renderer keeps its current state.
    }
  }
  setInterval(checkForRequiredUpdate, 30 * 60 * 1000)

  // Locked pages (Settings page). Everyone may read the list — the sidebar
  // draws the lock mark from it — but only an Admin or a Developer may lock or
  // unlock a page.
  ipcMain.handle('pageLock:list', async () => {
    return await getLockedPages()
  })

  ipcMain.handle('pageLock:set', async (_, userId, route, locked) => {
    if (!userId) {
      throw new Error('Not allowed: you must be signed in to lock pages.')
    }
    if (!(await userHasAnyRole(userId, ['ADMIN', 'DEVELOPER']))) {
      throw new Error('Not allowed: locking pages requires the Admin or Developer role.')
    }
    return await setPageLocked(userId, route, locked)
  })

  // Which roles a lock closes the page for. The page-wide switch above still
  // writes "every role"; this narrows an existing lock to the roles an
  // administrator picked.
  ipcMain.handle('pageLock:setRoles', async (_, userId, route, roles) => {
    if (!userId) {
      throw new Error('Not allowed: you must be signed in to lock pages.')
    }
    if (!(await userHasAnyRole(userId, ['ADMIN', 'DEVELOPER']))) {
      throw new Error('Not allowed: locking pages requires the Admin or Developer role.')
    }
    return await setPageLockRoles(userId, route, roles)
  })

  // Beta testers (Settings page): admins and developers may list accounts or
  // flip the flag — testing and releases are what the Developer role is for.
  // The gate is checked against the database, not the renderer's claim.
  ipcMain.handle('settings:getBetaTesters', async (_, userId) => {
    if (!(await userHasAnyRole(userId, ['ADMIN', 'DEVELOPER']))) {
      throw new Error('Not allowed: requires the Admin or Developer role.')
    }
    return await getBetaTesterUsers()
  })

  ipcMain.handle('settings:setBetaTester', async (_, userId, targetUserId, enabled) => {
    if (!(await userHasAnyRole(userId, ['ADMIN', 'DEVELOPER']))) {
      throw new Error('Not allowed: requires the Admin or Developer role.')
    }
    return await setBetaTester(targetUserId, enabled)
  })

  // Legacy registry import (Settings → Legacy registry). The dump is chosen in
  // the main process so the renderer only ever receives a path. The service
  // re-checks that the caller is an active Admin or Developer.
  ipcMain.handle('legacy:pickDump', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Choose the old eNote dump',
      properties: ['openFile'],
      filters: [
        { name: 'SQL dump', extensions: ['sql'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('legacy:preview', async (_, userId, filePath, selectedSteps, mode) => {
    return await previewLegacyImport(userId, filePath, { selectedSteps, mode })
  })

  ipcMain.handle('legacy:run', async (_, userId, filePath, selectedSteps, mode) => {
    return await runLegacyImport(userId, filePath, { selectedSteps, mode })
  })

  // The machine details stored with a user session. The renderer never supplies
  // these: a page could otherwise claim any device for a session.
  const sessionClient = (event) => ({
    deviceName: hostname(),
    devicePlatform: `${process.platform} ${process.arch}`,
    appVersion: app.getVersion(),
    userAgent: event?.sender?.getUserAgent?.() || null
  })

  // Auth handlers. A successful sign-in also opens the user_session row the
  // sessions page lists; failing to record it must not refuse a valid sign-in.
  ipcMain.handle('auth:login', async (event, { username, password }) => {
    const result = await login(username, password)
    // An offline sign-in has no server to record a session on, and asking would
    // only add a failed connection attempt to a sign-in that already worked.
    if (result?.success && result.user?.id && !result.offline) {
      try {
        const started = await startUserSession(result.user.id, sessionClient(event))
        if (started?.sessionId) result.user.sessionId = started.sessionId
      } catch (error) {
        console.warn('Could not record the sign-in session:', error.message)
      }
      // The pages this account reads every day are cached while online, so an
      // outage does not begin with an empty local copy. For a teacher that
      // includes the rosters of the coming week.
      scheduleWarmup(result.user.id, { force: true, personId: result.user.personId })
    }
    return result
  })

  // User sessions (every account). Own sessions need no role; the all-accounts
  // list and ending somebody else's session are re-checked in the service.
  ipcMain.handle('userSessions:start', async (event, userId) => {
    return await startUserSession(userId, sessionClient(event))
  })

  ipcMain.handle('userSessions:heartbeat', async (_, userId, sessionId) => {
    return await heartbeatUserSession(userId, sessionId)
  })

  ipcMain.handle('userSessions:getMine', async (_, userId, currentSessionId) => {
    return await getUserSessions(userId, currentSessionId)
  })

  ipcMain.handle('userSessions:getAll', async (_, userId, options) => {
    return await getAllUserSessions(userId, options || {})
  })

  ipcMain.handle('userSessions:end', async (_, userId, sessionId) => {
    return await endUserSession(userId, sessionId)
  })

  ipcMain.handle('userSessions:endOthers', async (_, userId, currentSessionId) => {
    return await endOtherUserSessions(userId, currentSessionId)
  })

  ipcMain.handle('userSessions:endAll', async (_, userId, currentSessionId) => {
    return await endAllUserSessions(userId, currentSessionId)
  })

  ipcMain.handle('auth:register', async (_, data) => {
    return await register(data)
  })

  // Stats handler
  ipcMain.handle('stats:getDashboard', async () => {
    return await getDashboardStats()
  })

  // Admin statistics & analytics
  ipcMain.handle('stats:getAdminStatistics', async (_, semesterId) => {
    return await getAdminStatistics(semesterId)
  })

  // Service handlers
  ipcMain.handle('persons:get', async () => {
    return await getPersons()
  })

  // The register is scoped inside the service: a secretary receives only the
  // students of the categories an admin made them responsible for.
  ipcMain.handle('students:getWithSections', async (_, userId) => {
    return await getStudentsWithSections(userId)
  })

  ipcMain.handle('teachers:get', async () => {
    return await getTeachers()
  })

  // The People page manages every staff member, not only the teachers.
  ipcMain.handle('personnel:get', async () => {
    return await getPersonnel()
  })

  ipcMain.handle('persons:create', async (_, data) => {
    return await createPerson(data)
  })

  ipcMain.handle('persons:update', async (_, userId, id, data) => {
    return await updatePerson(userId, id, data)
  })

  ipcMain.handle('persons:delete', async (_, userId, id) => {
    return await deletePerson(userId, id)
  })

  // A person's roles are rows in person_has_role, so they are added and ended
  // one at a time rather than through the flags on the person form — a form
  // that knows about one role would otherwise clear the other.
  // Changing a person's roles is an administrative act, so the acting account
  // is passed through and re-checked in the service against the database; the
  // renderer's own claim about who it is never decides this.
  ipcMain.handle('persons:assignRole', async (_, userId, personId, roleCode) => {
    return await assignPersonRole(userId, personId, roleCode)
  })

  ipcMain.handle('persons:endRole', async (_, userId, personId, roleCode) => {
    return await endPersonRole(userId, personId, roleCode)
  })

  // The department a teacher belongs to is part of the TEACHER role row, so it
  // is changed on its own and re-checked in the service like the role itself.
  ipcMain.handle('persons:setDepartment', async (_, userId, personId, departmentId) => {
    return await setPersonDepartment(userId, personId, departmentId)
  })

  // Student photos: pick (native dialog), preview, store or clear.
  ipcMain.handle('personPhoto:choose', async () => {
    return await choosePersonPhoto()
  })

  ipcMain.handle('personPhoto:read', async (_, path) => {
    return await readPersonPhoto(path)
  })

  // The same read for a whole page of the student list, in one round-trip.
  ipcMain.handle('personPhoto:readMany', async (_, paths) => {
    return await readPersonPhotos(paths)
  })

  ipcMain.handle('personPhoto:set', async (_, userId, personId, sourcePath) => {
    return await setPersonPhoto(userId, personId, sourcePath)
  })

  // Teaching-category responsibility (which categories a secretary manages)
  ipcMain.handle('scope:getMine', async (_, userId) => {
    return await getMyTeachingScope(userId)
  })

  ipcMain.handle('scope:setAccountCategories', async (_, userId, accountUserId, categoryIds) => {
    return await setAccountCategories(userId, accountUserId, categoryIds)
  })

  // Scheduler department responsibility (which departments' schedules an
  // account manages). Combined with the teaching-category scope above.
  ipcMain.handle('scope:setAccountDepartments', async (_, userId, accountUserId, departmentIds) => {
    return await setAccountDepartments(userId, accountUserId, departmentIds)
  })

  // Secretary accounts page (Admin): the account itself, the categories it may
  // work in and its rights over the conduct ledger. Each service re-checks the
  // Admin role against the account's role_id.
  ipcMain.handle('secretaries:get', async (_, userId) => {
    return await getSecretaries(userId)
  })

  ipcMain.handle('secretaries:updateAccount', async (_, userId, secretaryUserId, data) => {
    return await updateSecretaryAccount(userId, secretaryUserId, data || {})
  })

  ipcMain.handle('secretaries:setPermissions', async (_, userId, secretaryUserId, permissions) => {
    return await setSecretaryPermissions(userId, secretaryUserId, permissions || {})
  })

  ipcMain.handle('secretaries:getConductGlobalRights', async (_, userId) => {
    return await getConductGlobalRights(userId)
  })

  ipcMain.handle('secretaries:setConductGlobalRights', async (_, userId, rights) => {
    return await setConductGlobalRights(userId, rights || {})
  })

  // Schedule handlers
  ipcMain.handle('schedule:get', async (_, userId, weekId, sectionId) => {
    return await getStudySessions(weekId, sectionId, await loadScope(userId))
  })

  // Study-session consultation (Admin and Director): a week's sessions with the
  // absences and observations recorded against each one.
  ipcMain.handle('sessionRecords:getWeek', async (_, userId, weekId) => {
    return await getWeekSessionRecords(userId, weekId)
  })

  // The identity card behind an absence or observation line on that page.
  ipcMain.handle('sessionRecords:getStudent', async (_, userId, personId) => {
    return await getSessionStudentInfo(userId, personId)
  })
  ipcMain.handle('schedule:getExamEvents', async (_, weekId, teachingGroupId) => {
    return await getExamEvents(weekId, teachingGroupId)
  })

  ipcMain.handle('schedule:getWeekDays', async (_, weekId) => {
    return await getStudyWeekDays(weekId)
  })

  ipcMain.handle('schedule:create', async (_, userId, data, constraintChoice) => {
    return await createStudySession(data, await loadScope(userId), constraintChoice || {})
  })

  ipcMain.handle('schedule:delete', async (_, userId, id) => {
    return await deleteStudySession(id, await loadScope(userId))
  })

  ipcMain.handle('schedule:getSessionTypeRemainingHours', async (_, data) => {
    return await getSessionTypeRemainingHours(data)
  })

  // Weekly teacher constraints. Reading the settings is open to every signed-in
  // account; the service checks the account's own role for writes, and
  // scheduleService re-applies the policy whenever a session is created.
  ipcMain.handle('teacherConstraints:get', async (_, weekId, instructorId) => {
    return await getTeacherConstraints(weekId, instructorId)
  })

  ipcMain.handle('teacherConstraints:getSettings', async () => {
    return await getTeacherConstraintSettings()
  })

  // The predefined hard/soft windows. Reading is open to every signed-in user
  // (a teacher picks from the list); editing is Admin work and is re-checked
  // against the database inside the service.
  ipcMain.handle('teacherConstraints:getOptions', async () => {
    return await getTeacherConstraintOptions()
  })

  ipcMain.handle('teacherConstraints:createOption', async (_, userId, data) => {
    return await createTeacherConstraintOption(userId, data || {})
  })

  ipcMain.handle('teacherConstraints:updateOption', async (_, userId, id, data) => {
    return await updateTeacherConstraintOption(userId, id, data || {})
  })

  ipcMain.handle('teacherConstraints:deleteOption', async (_, userId, id) => {
    return await deleteTeacherConstraintOption(userId, id)
  })

  ipcMain.handle('teacherConstraints:create', async (_, userId, data) => {
    return await createTeacherConstraint(userId, data || {})
  })

  ipcMain.handle('teacherConstraints:delete', async (_, userId, id) => {
    return await deleteTeacherConstraint(userId, id)
  })

  ipcMain.handle('schedule:getTeacherSessions', async (_, instructorId, weekId, sectionId) => {
    return await getTeacherSessions(instructorId, weekId, sectionId)
  })

  ipcMain.handle('schedule:getStudentSessions', async (_, personId, weekId, sectionId) => {
    return await getStudentSessions(personId, weekId, sectionId)
  })

  // Document handlers. The library is cut to what the calling account may
  // read, so every call carries the account rather than the window's claims.
  ipcMain.handle('documents:get', async (_, userId) => {
    await assertPageAccess(userId, '/lessons')
    return await getDocuments(userId)
  })

  ipcMain.handle('documents:getTypes', async () => {
    return await getDocumentTypes()
  })

  ipcMain.handle('documents:upload', async (_, filePath, metadata) => {
    return await uploadDocument(filePath, metadata)
  })

  ipcMain.handle('documents:delete', async (_, id, userId) => {
    return await deleteDocument(id, userId)
  })

  ipcMain.handle('documents:download', async (_, id, userId) => {
    await assertPageAccess(userId, '/lessons')
    return await downloadDocument(id, userId)
  })

  ipcMain.handle('documents:open', async (_, id, userId) => {
    await assertPageAccess(userId, '/lessons')
    return await openDocument(id, userId)
  })

  // The popular shelf reads a rolling window of opens, plays and downloads.
  ipcMain.handle('documents:getPopular', async (_, options) => {
    return await getPopularDocuments(options || {})
  })

  ipcMain.handle('documents:trackView', async (_, id, userId) => {
    await assertPageAccess(userId, '/lessons')
    await recordDocumentAccess(id, userId, 'PLAY')
    return { success: true }
  })

  // Library handlers. The catalogue, the review queue and every file action
  // read the account from the database, so the window's claims never widen what
  // it can see.
  ipcMain.handle('library:getItems', async (_, userId) => await getLibraryItems(userId))
  ipcMain.handle('library:getCategories', async (_, userId) => await getLibraryCategories(userId))
  ipcMain.handle('library:getPolicy', async () => await getLibraryPolicy())
  ipcMain.handle('library:getReviewQueue', async (_, userId) => await getLibraryReviewQueue(userId))
  ipcMain.handle('library:getReviewCount', async (_, userId) => await getLibraryReviewCount(userId))
  ipcMain.handle('library:upload', async (_, userId, filePath, metadata) => await uploadLibraryItem(userId, filePath, metadata))
  ipcMain.handle('library:update', async (_, userId, id, data) => await updateLibraryItem(userId, id, data))
  ipcMain.handle('library:review', async (_, userId, id, decision, note) => await reviewLibraryItem(userId, id, decision, note))
  ipcMain.handle('library:archive', async (_, userId, id, archived) => await setLibraryItemArchived(userId, id, archived))
  ipcMain.handle('library:delete', async (_, userId, id) => await deleteLibraryItem(userId, id))
  ipcMain.handle('library:download', async (_, userId, id) => await downloadLibraryItem(userId, id))
  ipcMain.handle('library:open', async (_, userId, id) => await openLibraryItem(userId, id))
  ipcMain.handle('library:trackView', async (_, id, userId, kind) => {
    await recordLibraryAccess(id, userId, kind || 'PLAY')
    return { success: true }
  })
  ipcMain.handle('library:createCategory', async (_, userId, data) => await createLibraryCategory(userId, data))
  ipcMain.handle('library:updateCategory', async (_, userId, id, data) => await updateLibraryCategory(userId, id, data))
  ipcMain.handle('library:deleteCategory', async (_, userId, id) => await deleteLibraryCategory(userId, id))

  // Copies kept on this computer for an outage. Saving one reads the share and
  // the access check once, online; afterwards the copy opens without the
  // server. Nothing here writes to PostgreSQL.
  ipcMain.handle('library:saveOffline', async (_, userId, id) => await saveLibraryItemForOffline(userId, id))
  ipcMain.handle('library:removeOffline', async (_, id) => removeLibraryItemOffline(id))
  ipcMain.handle('documents:saveOffline', async (_, userId, id) => await saveDocumentForOffline(userId, id))
  ipcMain.handle('documents:removeOffline', async (_, id) => removeDocumentOffline(id))
  // Which items of one kind this computer already holds.
  ipcMain.handle('offline:files:ids', async (_, kind) => offlineFileIds(kind))

  // Bug report handlers. Only ADMIN/DEVELOPER callers may set priority.
  const canSetBugPriority = async (userId) => {
    const res = await query(
      `SELECT 1 FROM "user" u
       JOIN "role" r ON r.role_id = u.role_id
       WHERE u.user_id = $1 AND r.role_code IN ('ADMIN', 'DEVELOPER')
       LIMIT 1`,
      [userId]
    )
    return res.rowCount > 0
  }

  ipcMain.handle('bugReport:create', async (_, userId, data) => {
    return await createBugReport(userId, data || {}, await canSetBugPriority(userId))
  })

  ipcMain.handle('bugReport:getMine', async (_, userId) => {
    return await getMyBugReports(userId)
  })

  ipcMain.handle('bugReport:getAll', async () => {
    return await getBugReports()
  })

  ipcMain.handle('bugReport:update', async (_, reportId, data, actingUserId) => {
    const payload = data || {}
    // Priority belongs to triage: even if a caller reaches this channel
    // outside the Bug reports page, only ADMIN/DEVELOPER may change it.
    if ('REPORT_PRIORITY' in payload && !(await canSetBugPriority(actingUserId))) {
      throw new Error('Not allowed: setting a bug report priority requires the Admin or Developer role.')
    }
    return await updateBugReport(reportId, payload, actingUserId)
  })

  ipcMain.handle('bugReport:uploadScreenshot', async (_, filePath, userId) => {
    return await uploadBugScreenshot(filePath, userId)
  })

  ipcMain.handle('bugReport:openScreenshot', async (_, reportId) => {
    return await openBugScreenshot(reportId)
  })

  // Changelog handlers. Mutations require ADMIN or DEVELOPER (verified
  // against the database, not the renderer's claim).
  ipcMain.handle('changelog:getAll', async () => {
    return await getChangelogs()
  })

  // The "new version" dialog: the newest release this account has not been
  // shown yet, and the acknowledgement that it has been.
  ipcMain.handle('changelog:getPending', async (_, userId) => {
    return await getPendingChangelog(userId)
  })

  ipcMain.handle('changelog:markSeen', async (_, userId, changelogId) => {
    return await markChangelogSeen(userId, changelogId)
  })

  ipcMain.handle('changelog:canManage', async (_, userId) => {
    return await userCanManageChangelog(userId)
  })

  ipcMain.handle('changelog:create', async (_, userId, data) => {
    if (!(await userCanManageChangelog(userId))) {
      throw new Error('Not allowed: requires the Admin or Developer role.')
    }
    return await createChangelog(data || {})
  })

  ipcMain.handle('changelog:update', async (_, userId, id, data) => {
    if (!(await userCanManageChangelog(userId))) {
      throw new Error('Not allowed: requires the Admin or Developer role.')
    }
    return await updateChangelog(id, data || {})
  })

  ipcMain.handle('changelog:delete', async (_, userId, id) => {
    if (!(await userCanManageChangelog(userId))) {
      throw new Error('Not allowed: requires the Admin or Developer role.')
    }
    return await deleteChangelog(id)
  })

  // My-profile handlers (any logged-in user)
  ipcMain.handle('myProfile:get', async (_, userId) => {
    return await getMyProfile(userId)
  })

  ipcMain.handle('myProfile:updateUsername', async (_, userId, newUsername) => {
    return await updateMyUsername(userId, newUsername)
  })

  ipcMain.handle('myProfile:changePassword', async (_, userId, currentPassword, newPassword) => {
    return await changeMyPassword(userId, currentPassword, newPassword)
  })

  // Notifications: one store for every kind, addressed to the roles that should
  // receive it. The account's roles and person are resolved from the signed-in
  // user id in the database — never supplied by the renderer — so an account
  // only ever reads what its roles were addressed. Comments remain a director
  // feature and are re-checked in the service.
  ipcMain.handle('notifications:get', async (_, userId) => {
    return await getNotifications(userId)
  })

  ipcMain.handle('notifications:getCount', async (_, userId) => {
    return await getUnreadCount(userId)
  })

  ipcMain.handle('notifications:markRead', async (_, userId, recordKey) => {
    return await markNotificationRead(userId, recordKey)
  })

  // Per-account muting by family. The account is resolved from the user id in the
  // database, so one person can never change another's preferences.
  ipcMain.handle('notifications:getPreferences', async (_, userId) => {
    return await getNotificationPreferences(userId)
  })

  ipcMain.handle('notifications:setMute', async (_, userId, family, muted) => {
    return await setNotificationMute(userId, family, muted)
  })

  ipcMain.handle('notifications:markAllRead', async (_, userId) => {
    return await markAllNotificationsRead(userId)
  })

  ipcMain.handle('notifications:getComments', async (_, userId, recordKey) => {
    return await getNotificationComments(userId, recordKey)
  })

  ipcMain.handle('notifications:addComment', async (_, userId, recordKey, commentText) => {
    return await addNotificationComment(userId, recordKey, commentText)
  })

  ipcMain.handle('notifications:deleteComment', async (_, userId, commentId) => {
    return await deleteNotificationComment(userId, commentId)
  })

  // A native (operating-system) notification, shown alongside the in-app bell:
  // a director whose window is behind another application still sees that an
  // absence was recorded. The renderer decides what is new — it already diffs
  // its own unread count for the chime — and passes the single line to show, so
  // nothing is announced twice.
  //
  // Always silent: the app's chime is the sound of a new notification and the
  // Settings switch governs it. A toast that also played the system sound would
  // double every event and could not be muted from inside the app.
  // The renderer decides what the popup says — name, detail, kind — and the
  // toast is built here so the operating-system notification carries the app's
  // own mark and reads in the same order as a row in the bell.
  ipcMain.handle('notifications:showDesktop', (event, payload) => {
    const { title, body, kind, recordKey } = payload || {}
    const heading = String(title || '').trim()
    if (!heading) return { shown: false, reason: 'empty' }
    if (!Notification.isSupported()) return { shown: false, reason: 'unsupported' }

    // Resolved now: by the time the toast is clicked, the sender's webContents
    // may already be gone.
    const senderWindow = BrowserWindow.fromWebContents(event.sender)

    const toastOptions = {
      title: heading.slice(0, 120),
      body: String(body || '').slice(0, 300),
      silent: true
    }
    if (process.platform === 'win32') {
      // Windows ignores the title/body pair once the XML is given; both are kept
      // so the remaining platforms and the accessibility name still have them.
      toastOptions.toastXml = buildToastXml({
        heading: toastOptions.title,
        body: toastOptions.body,
        kindLabel: kind,
        iconSrc: fileUrl(appIconPath())
      })
    }
    const toast = new Notification(toastOptions)

    liveDesktopNotifications.add(toast)
    toast.on('close', () => liveDesktopNotifications.delete(toast))
    toast.on('click', () => {
      liveDesktopNotifications.delete(toast)
      const win = senderWindow && !senderWindow.isDestroyed()
        ? senderWindow
        : BrowserWindow.getAllWindows()[0]
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send('notifications:open', { recordKey: recordKey ? String(recordKey) : '' })
    })

    toast.show()
    return { shown: true }
  })

  // Teacher attendance: whether a programmed session was actually taken. The
  // teacher (or an administrator) can confirm a session, and any window may ask
  // for a scan; the roles are re-checked in the service.
  ipcMain.handle('teacherAttendance:getRegister', async (_, sessionId) => {
    return await getSessionRegister(sessionId)
  })

  ipcMain.handle('teacherAttendance:markAttended', async (_, userId, sessionId) => {
    return await markSessionAttended(userId, sessionId)
  })

  ipcMain.handle('teacherAttendance:scan', async () => {
    return await scanMissedSessions()
  })

  // Per-teacher attendance over a period, for Directors and Admins.
  ipcMain.handle('teacherAttendance:report', async (_, userId, period) => {
    return await getTeacherAttendanceReport(userId, period || {})
  })

  // Beta test reports: the service re-checks the beta tester flag in the
  // database, so a modified renderer cannot submit reports without it.
  ipcMain.handle('betaTest:getVersions', async (_, userId) => {
    return await getBetaTestVersions(userId)
  })

  ipcMain.handle('betaTest:saveReport', async (_, userId, changelogId, data) => {
    return await saveBetaTestReport(userId, changelogId, data || {})
  })

  // Reviewing what testers filed is for ADMIN / DEVELOPER only; the service
  // verifies the role against the account's role_id, not the renderer's claim.
  ipcMain.handle('betaTest:getReports', async (_, userId) => {
    return await getBetaTestReports(userId)
  })

  // Account administration (ADMIN / DEVELOPER, re-checked in the service).
  ipcMain.handle('accounts:getAll', async (_, userId) => {
    return await getAccounts(userId)
  })

  ipcMain.handle('accounts:setActive', async (_, userId, targetUserId, active) => {
    return await setAccountActive(userId, targetUserId, active === true)
  })

  // Edit an account: username, email and (when given) a new password. The
  // service re-checks the manager role against the database and records the
  // change in the activity log.
  ipcMain.handle('accounts:update', async (_, userId, targetUserId, data) => {
    return await updateAccount(userId, targetUserId, data || {})
  })

  // A new account for a person already on file: the dialog searches the roster
  // and then chooses the account role. The service re-checks the manager role
  // before it reads the roster or writes the account.
  ipcMain.handle('accounts:searchCandidates', async (_, userId, term) => {
    return await searchAccountCandidates(userId, term)
  })

  ipcMain.handle('accounts:create', async (_, userId, data) => {
    return await createAccount(userId, data || {})
  })

  // Register a new person and create their account together: one transaction,
  // so a failure leaves neither a person without a login nor the reverse.
  ipcMain.handle('accounts:createWithPerson', async (_, userId, data) => {
    return await createPersonWithAccount(userId, data || {})
  })

  // Inbox. Reading is open to the signed-in account that received the message;
  // sending, the role picker and the seen-by receipts are admin-only, re-checked
  // inside the service.
  ipcMain.handle('inbox:get', async (_, userId) => {
    return await getInbox(userId)
  })

  ipcMain.handle('inbox:getUnreadCount', async (_, userId) => {
    return await getInboxUnreadCount(userId)
  })

  ipcMain.handle('inbox:markSeen', async (_, userId, messageId) => {
    return await markMessageSeen(userId, messageId)
  })

  ipcMain.handle('inbox:markAllSeen', async (_, userId) => {
    return await markAllMessagesSeen(userId)
  })

  ipcMain.handle('inbox:getRoles', async (_, userId) => {
    return await getMessageRoles(userId)
  })

  ipcMain.handle('inbox:getAudience', async (_, userId, roleCodes) => {
    return await getMessageAudience(userId, roleCodes)
  })

  ipcMain.handle('inbox:send', async (_, userId, data) => {
    return await sendMessage(userId, data || {})
  })

  ipcMain.handle('inbox:getSent', async (_, userId) => {
    return await getSentMessages(userId)
  })

  ipcMain.handle('inbox:getRecipients', async (_, userId, messageId) => {
    return await getMessageRecipients(userId, messageId)
  })

  // Admin account tools: find an account by username, name or person id and
  // reset its password. The service re-checks the Admin role in the database.
  ipcMain.handle('adminUsers:search', async (_, userId, term) => {
    return await searchUsersForPasswordReset(userId, term)
  })

  ipcMain.handle('adminUsers:resetPassword', async (_, userId, targetUserId, newPassword) => {
    return await resetUserPassword(userId, targetUserId, newPassword)
  })

  // Accounts locked out after repeated wrong passwords: list them and restore
  // access. Admin-only, re-checked in the service.
  ipcMain.handle('accountSecurity:listSuspended', async (_, userId) => {
    return await getSuspendedAccounts(userId)
  })

  ipcMain.handle('accountSecurity:unlock', async (_, userId, targetUserId) => {
    return await unlockAccount(userId, targetUserId)
  })

  // Direct messages between users. Reading and sending are scoped to the
  // signed-in participant inside the service; the role-to-role contact matrix
  // is Admin-only there as well.
  ipcMain.handle('messaging:getRules', async (_, userId) => {
    return await getMessagingRules(userId)
  })

  ipcMain.handle('messaging:setRule', async (_, userId, senderRoleCode, targetRoleCode, allowed) => {
    return await setMessagingRule(userId, senderRoleCode, targetRoleCode, allowed)
  })

  ipcMain.handle('messaging:setScope', async (_, userId, scope, roleCode, allowed) => {
    return await setMessagingScope(userId, scope, roleCode, allowed)
  })

  ipcMain.handle('messaging:getContacts', async (_, userId) => {
    await assertPageAccess(userId, '/messages')
    return await getContactableUsers(userId)
  })

  ipcMain.handle('messaging:getConversations', async (_, userId) => {
    await assertPageAccess(userId, '/messages')
    return await getConversations(userId)
  })

  ipcMain.handle('messaging:openConversation', async (_, userId, otherUserId) => {
    await assertPageAccess(userId, '/messages')
    return await openConversation(userId, otherUserId)
  })

  ipcMain.handle('messaging:getConversation', async (_, userId, conversationId) => {
    await assertPageAccess(userId, '/messages')
    return await getConversation(userId, conversationId)
  })

  ipcMain.handle('messaging:send', async (_, userId, conversationId, body) => {
    await assertPageAccess(userId, '/messages')
    return await sendDirectMessage(userId, conversationId, body)
  })

  ipcMain.handle('messaging:getUnread', async (_, userId) => {
    await assertPageAccess(userId, '/messages')
    return await getUnreadDirectCount(userId)
  })

  // Presence heartbeat while the app is open.
  ipcMain.handle('presence:heartbeat', async (_, userId) => {
    return await touchLastSeen(userId)
  })

  // Rewards & punishments handlers. The actor is the signed-in
  // account, not the person: a person may hold more than one account and each
  // carries its own roles and rights.
  ipcMain.handle('rewardsPunishments:getStudents', async (_, actorUserId) => {
    return await getRewardsPunishmentsStudents(actorUserId)
  })

  ipcMain.handle('rewardsPunishments:getTypes', async () => {
    const [punishmentTypes, rewardTypes, punishmentJustifications, rewardJustifications] = await Promise.all([
      getPunishmentTypes(),
      getRewardTypes(),
      getPunishmentJustifications(),
      getRewardJustifications()
    ])
    return {
      punishmentTypes: punishmentTypes.data,
      rewardTypes: rewardTypes.data,
      punishmentJustifications: punishmentJustifications.data,
      rewardJustifications: rewardJustifications.data
    }
  })

  ipcMain.handle('rewardsPunishments:getStudent', async (_, userId, personId) => {
    return await getStudentRewardsPunishments(userId, personId)
  })

  ipcMain.handle('rewardsPunishments:applyPunishment', async (_, secretaryUserId, data) => {
    return await applyPunishment(secretaryUserId, data || {})
  })

  ipcMain.handle('rewardsPunishments:applyReward', async (_, secretaryUserId, data) => {
    return await applyReward(secretaryUserId, data || {})
  })

  ipcMain.handle('rewardsPunishments:applyPunishmentBulk', async (_, secretaryUserId, data) => {
    return await applyPunishmentBulk(secretaryUserId, data || {})
  })

  ipcMain.handle('rewardsPunishments:applyRewardBulk', async (_, secretaryUserId, data) => {
    return await applyRewardBulk(secretaryUserId, data || {})
  })

  ipcMain.handle('rewardsPunishments:updatePunishment', async (_, secretaryUserId, punishmentId, data) => {
    return await updatePunishment(secretaryUserId, punishmentId, data || {})
  })

  ipcMain.handle('rewardsPunishments:updateReward', async (_, secretaryUserId, rewardId, data) => {
    return await updateReward(secretaryUserId, rewardId, data || {})
  })

  ipcMain.handle('rewardsPunishments:deletePunishment', async (_, secretaryUserId, punishmentId) => {
    return await deletePunishment(secretaryUserId, punishmentId)
  })

  ipcMain.handle('rewardsPunishments:deleteReward', async (_, secretaryUserId, rewardId) => {
    return await deleteReward(secretaryUserId, rewardId)
  })

  ipcMain.handle('documents:getMajorCategories', async () => {
    return await getDocMajorCategories()
  })

  ipcMain.handle('documents:getMajorsByCategory', async (_, categoryId) => {
    return await getMajorsByCategory(categoryId)
  })

  ipcMain.handle('documents:getChaptersByMajor', async (_, majorId) => {
    return await getChaptersByMajor(majorId)
  })

  ipcMain.handle('documents:getLessonsByChapter', async (_, chapterId) => {
    return await getLessonsByChapter(chapterId)
  })

  ipcMain.handle('documents:createChapter', async (_, data) => {
    return await createChapter(data)
  })

  ipcMain.handle('documents:updateChapter', async (_, id, data) => {
    return await updateChapter(id, data)
  })

  ipcMain.handle('documents:deleteChapter', async (_, id) => {
    return await deleteChapter(id)
  })

  ipcMain.handle('documents:createLesson', async (_, data) => {
    return await createLesson(data)
  })

  ipcMain.handle('documents:updateLesson', async (_, id, data) => {
    return await updateLesson(id, data)
  })

  ipcMain.handle('documents:deleteLesson', async (_, id) => {
    return await deleteLesson(id)
  })

// Academic handlers
  ipcMain.handle('academic:createYear', async (_, data) => {
    return await createStudyYear(data)
  })

  ipcMain.handle('academic:createSemester', async (_, data) => {
    return await createStudySemester(data)
  })

  ipcMain.handle('academic:createWeek', async (_, data) => {
    return await createStudyWeek(data)
  })

  ipcMain.handle('academic:updateYear', async (_, id, data) => {
    return await updateStudyYear(id, data)
  })

  ipcMain.handle('academic:updateSemester', async (_, id, data) => {
    return await updateStudySemester(id, data)
  })

  ipcMain.handle('academic:updateWeek', async (_, id, data) => {
    return await updateStudyWeek(id, data)
  })

  ipcMain.handle('academic:generateWeeks', async (_, options) => {
    return await generateStudyWeeks(options)
  })

  ipcMain.handle('academic:deleteYear', async (_, id) => {
    return await deleteStudyYear(id)
  })

  ipcMain.handle('academic:deleteSemester', async (_, id) => {
    return await deleteStudySemester(id)
  })

  ipcMain.handle('academic:deleteWeek', async (_, id) => {
    return await deleteStudyWeek(id)
  })

  ipcMain.handle('academic:getYears', async () => {
    return await getStudyYears()
  })

  ipcMain.handle('academic:getSemesters', async (_, yearId) => {
    return await getStudySemesters(yearId)
  })

  ipcMain.handle('academic:getWeeks', async (_, semesterId) => {
    return await getStudyWeeks(semesterId)
  })

  ipcMain.handle('academic:getMajors', async () => {
    return await getMajors()
  })

  ipcMain.handle('academic:getMajorTeachers', async () => {
    return await getMajorTeachers()
  })

  ipcMain.handle('academic:getMajorsTaughtByTeacher', async (_, personId) => {
    return await getMajorsTaughtByTeacher(personId)
  })

  ipcMain.handle('academic:updateMajorTeachers', async (_, majorId, teacherIds) => {
    return await updateMajorTeachers(majorId, teacherIds)
  })

  ipcMain.handle('academic:createMajor', async (_, data) => {
    return await createMajor(data)
  })

  ipcMain.handle('academic:getPromotions', async () => {
    return await getPromotions()
  })

  ipcMain.handle('academic:createPromotion', async (_, userId, data) => {
    return await createPromotion(data, userId)
  })

  ipcMain.handle('academic:updatePromotion', async (_, userId, id, data) => {
    return await updatePromotion(id, data, userId)
  })

  ipcMain.handle('academic:deletePromotion', async (_, userId, id) => {
    return await deletePromotion(id, userId)
  })

  ipcMain.handle('academic:updateMajor', async (_, id, data) => {
    return await updateMajor(id, data)
  })

  ipcMain.handle('academic:deleteMajor', async (_, id) => {
    return await deleteMajor(id)
  })

  ipcMain.handle('academic:getMajorCategories', async () => {
    return await getMajorCategories()
  })

  ipcMain.handle('academic:createMajorCategory', async (_, data) => {
    return await createMajorCategory(data)
  })

  ipcMain.handle('academic:updateMajorCategory', async (_, id, data) => {
    return await updateMajorCategory(id, data)
  })

  ipcMain.handle('academic:deleteMajorCategory', async (_, id) => {
    return await deleteMajorCategory(id)
  })

  ipcMain.handle('academic:getTeachingCategories', async () => {
    return await getTeachingCategories()
  })

  ipcMain.handle('academic:createTeachingCategory', async (_, data) => {
    return await createTeachingCategory(data)
  })

  ipcMain.handle('academic:updateTeachingCategory', async (_, id, data) => {
    return await updateTeachingCategory(id, data)
  })

  ipcMain.handle('academic:deleteTeachingCategory', async (_, id) => {
    return await deleteTeachingCategory(id)
  })

  ipcMain.handle('academic:getSections', async () => {
    return await getSections()
  })

  ipcMain.handle('academic:createSection', async (_, data) => {
    return await createSection(data)
  })

  ipcMain.handle('academic:updateSection', async (_, id, data) => {
    return await updateSection(id, data)
  })

  ipcMain.handle('academic:deleteSection', async (_, id) => {
    return await deleteSection(id)
  })

  ipcMain.handle('academic:getClassrooms', async () => {
    return await getClassrooms()
  })

  ipcMain.handle('academic:createClassroom', async (_, data) => {
    return await createClassroom(data)
  })

  ipcMain.handle('academic:updateClassroom', async (_, id, data) => {
    return await updateClassroom(id, data)
  })

  ipcMain.handle('academic:deleteClassroom', async (_, id) => {
    return await deleteClassroom(id)
  })

  // Classroom seats (every classroom has seats, each with a seat number)
  ipcMain.handle('academic:getClassroomSeats', async (_, classroomId) => {
    return await getClassroomSeats(classroomId)
  })

  ipcMain.handle('academic:addClassroomSeat', async (_, classroomId, seatNumber) => {
    return await addClassroomSeat(classroomId, seatNumber)
  })

  ipcMain.handle('academic:deleteClassroomSeat', async (_, classroomId, seatNumber) => {
    return await deleteClassroomSeat(classroomId, seatNumber)
  })

  ipcMain.handle('academic:generateClassroomSeats', async (_, classroomId, count) => {
    return await generateClassroomSeats(classroomId, count)
  })

  ipcMain.handle('academic:getClassroomCategories', async () => {
    return await getClassroomCategories()
  })

  ipcMain.handle('academic:createClassroomCategory', async (_, data) => {
    return await createClassroomCategory(data)
  })

  ipcMain.handle('academic:updateClassroomCategory', async (_, id, data) => {
    return await updateClassroomCategory(id, data)
  })

  ipcMain.handle('academic:deleteClassroomCategory', async (_, id) => {
    return await deleteClassroomCategory(id)
  })

  ipcMain.handle('academic:getTeachingGroups', async () => {
    return await getTeachingGroups()
  })

  ipcMain.handle('academic:createTeachingGroup', async (_, userId, data) => {
    return await createTeachingGroup(data, await loadScope(userId))
  })

  ipcMain.handle('academic:updateTeachingGroup', async (_, id, data) => {
    return await updateTeachingGroup(id, data)
  })

  ipcMain.handle('academic:deleteTeachingGroup', async (_, id) => {
    return await deleteTeachingGroup(id)
  })

  ipcMain.handle('academic:getTeachingGroupsForSemester', async (_, semesterId, yearId) => {
    return await getTeachingGroupsForSemester(semesterId, yearId)
  })

  ipcMain.handle('academic:getTeachingGroupsByMajor', async (_, majorId, semesterId) => {
    return await getTeachingGroupsByMajor(majorId, semesterId)
  })

  ipcMain.handle('academic:createStudentDynamicGroupByMajor', async (_, data) => {
    return await createStudentDynamicGroupByMajor(data)
  })

  ipcMain.handle('academic:getStudySessionTypes', async () => {
    return await getStudySessionTypes()
  })
  ipcMain.handle('academic:createStudySessionType', async (_, data) => {
    return await createStudySessionType(data)
  })

  ipcMain.handle('academic:updateStudySessionType', async (_, id, data) => {
    return await updateStudySessionType(id, data)
  })

  ipcMain.handle('academic:deleteStudySessionType', async (_, id) => {
    return await deleteStudySessionType(id)
  })

  ipcMain.handle('academic:getStudySessionTimeSlots', async () => {
    return await getStudySessionTimeSlots()
  })

  ipcMain.handle('academic:createStudySessionTimeSlot', async (_, data) => {
    return await createStudySessionTimeSlot(data)
  })

  ipcMain.handle('academic:updateStudySessionTimeSlot', async (_, id, data) => {
    return await updateStudySessionTimeSlot(id, data)
  })

  ipcMain.handle('academic:deleteStudySessionTimeSlot', async (_, id) => {
    return await deleteStudySessionTimeSlot(id)
  })

  ipcMain.handle('academic:getAcademicGrades', async () => {
    return await getAcademicGrades()
  })

  // The administrative departments a teacher can belong to, each with the
  // direction above it, and the two registers Settings edits them through.
  ipcMain.handle('academic:getDepartments', async () => {
    return await getDepartments()
  })

  ipcMain.handle('academic:getDirections', async () => {
    return await getDirections()
  })

  ipcMain.handle('academic:createDirection', async (_, data) => {
    return await createDirection(data)
  })

  ipcMain.handle('academic:updateDirection', async (_, id, data) => {
    return await updateDirection(id, data)
  })

  ipcMain.handle('academic:deleteDirection', async (_, id) => {
    return await deleteDirection(id)
  })

  ipcMain.handle('academic:createDepartment', async (_, data) => {
    return await createDepartment(data)
  })

  ipcMain.handle('academic:updateDepartment', async (_, id, data) => {
    return await updateDepartment(id, data)
  })

  ipcMain.handle('academic:deleteDepartment', async (_, id) => {
    return await deleteDepartment(id)
  })

  ipcMain.handle('academic:createAcademicGrade', async (_, data) => {
    return await createAcademicGrade(data)
  })

  ipcMain.handle('academic:updateAcademicGrade', async (_, id, data) => {
    return await updateAcademicGrade(id, data)
  })

  ipcMain.handle('academic:deleteAcademicGrade', async (_, id) => {
    return await deleteAcademicGrade(id)
  })

  ipcMain.handle('academic:getGrades', async () => {
    return await getGrades()
  })

  ipcMain.handle('academic:createGrade', async (_, data) => {
    return await createGrade(data)
  })

  ipcMain.handle('academic:updateGrade', async (_, id, data) => {
    return await updateGrade(id, data)
  })

  ipcMain.handle('academic:deleteGrade', async (_, id) => {
    return await deleteGrade(id)
  })

  ipcMain.handle('academic:getMajorHourlyVolumes', async (_, majorId, semesterId) => {
    return await getMajorHourlyVolumes(majorId, semesterId)
  })

  ipcMain.handle('academic:createMajorHourlyVolume', async (_, data) => {
    return await createMajorHourlyVolume(data)
  })

  ipcMain.handle('academic:updateMajorHourlyVolume', async (_, majorId, semesterId, teachingGroupId, data) => {
    return await updateMajorHourlyVolume(majorId, semesterId, teachingGroupId, data)
  })

  ipcMain.handle('academic:deleteMajorHourlyVolume', async (_, majorId, semesterId, teachingGroupId) => {
    return await deleteMajorHourlyVolume(majorId, semesterId, teachingGroupId)
  })

  ipcMain.handle('academic:getMajorHourlyProgress', async (_, majorId, semesterId, sectionId) => {
    return await getMajorHourlyProgress(majorId, semesterId, sectionId)
  })

  ipcMain.handle('academic:getMajorHourlyVolumesBySessionType', async (_, majorId, semesterId) => {
    return await getMajorHourlyVolumesBySessionType(majorId, semesterId)
  })

  ipcMain.handle('academic:createMajorHourlyVolumeBySessionType', async (_, data) => {
    return await createMajorHourlyVolumeBySessionType(data)
  })

  ipcMain.handle('academic:updateMajorHourlyVolumeBySessionType', async (_, majorId, semesterId, sessionTypeId, teachingGroupId, data) => {
    return await updateMajorHourlyVolumeBySessionType(majorId, semesterId, sessionTypeId, teachingGroupId, data)
  })

  ipcMain.handle('academic:deleteMajorHourlyVolumeBySessionType', async (_, majorId, semesterId, sessionTypeId, teachingGroupId) => {
    return await deleteMajorHourlyVolumeBySessionType(majorId, semesterId, sessionTypeId, teachingGroupId)
  })

  ipcMain.handle('academic:getTeachingSectionHourlyVolumes', async (_, sectionId, majorId, semesterId) => {
    return await getTeachingSectionHourlyVolumes(sectionId, majorId, semesterId)
  })

  ipcMain.handle('academic:createTeachingSectionHourlyVolume', async (_, data) => {
    return await createTeachingSectionHourlyVolume(data)
  })

  ipcMain.handle('academic:updateTeachingSectionHourlyVolume', async (_, sectionId, majorId, semesterId, data) => {
    return await updateTeachingSectionHourlyVolume(sectionId, majorId, semesterId, data)
  })

  ipcMain.handle('academic:deleteTeachingSectionHourlyVolume', async (_, sectionId, majorId, semesterId) => {
    return await deleteTeachingSectionHourlyVolume(sectionId, majorId, semesterId)
  })

  ipcMain.handle('academic:getTeachingGroupHourlyProgress', async (_, teachingGroupId, majorId, semesterId) => {
    return await getTeachingGroupHourlyProgress(teachingGroupId, majorId, semesterId)
  })

  ipcMain.handle('academic:getStudentSections', async (_, userId, personId) => {
    return await getStudentSections(userId, personId)
  })

  ipcMain.handle('academic:getStudentSectionHistory', async (_, userId, personId) => {
    return await getStudentSectionHistory(userId, personId)
  })

  ipcMain.handle('academic:getSectionStudents', async (_, sectionId) => {
    return await getSectionStudents(sectionId)
  })

  ipcMain.handle('academic:assignStudentToSection', async (_, userId, personId, sectionId) => {
    return await assignStudentToSection(userId, personId, sectionId)
  })

  ipcMain.handle('academic:removeStudentFromSection', async (_, userId, personId, sectionId) => {
    return await removeStudentFromSection(userId, personId, sectionId)
  })

  ipcMain.handle('academic:updateStudentSections', async (_, userId, personId, sectionIds) => {
    return await updateStudentSections(userId, personId, sectionIds)
  })

  // Teaching-group roster (per-student memberships in student_dynamic_group_by_major,
  // scoped per major + semester)
  ipcMain.handle('academic:getStudentsInTeachingGroup', async (_, majorId, semesterId, teachingGroupId) => {
    return await getStudentsInTeachingGroup(majorId, semesterId, teachingGroupId)
  })

  ipcMain.handle('academic:addStudentToTeachingGroup', async (_, personId, majorId, semesterId, teachingGroupId) => {
    return await addStudentToTeachingGroup(personId, majorId, semesterId, teachingGroupId)
  })

  ipcMain.handle('academic:removeStudentFromTeachingGroup', async (_, personId, majorId, semesterId, teachingGroupId) => {
    return await removeStudentFromTeachingGroup(personId, majorId, semesterId, teachingGroupId)
  })

  ipcMain.handle('academic:updateTeachingGroupRoster', async (_, majorId, semesterId, teachingGroupId, personIds) => {
    return await updateTeachingGroupRoster(majorId, semesterId, teachingGroupId, personIds)
  })

  ipcMain.handle('academic:getTeachingGroupsForStudent', async (_, userId, personId) => {
    return await getTeachingGroupsForStudent(userId, personId)
  })

  // Examination handlers. Each major has its own exams (possibly none). An
  // exam's type comes from the examination_type lookup. Seating shuffles the
  // major's teaching-group members into exam groups (each with its own room);
  // every seated student gets a seat number and a response-paper code.
  ipcMain.handle('academic:getExaminations', async (_, userId, majorId) => {
    await assertPageAccess(userId, '/exams')
    return await getExaminations(majorId)
  })

  ipcMain.handle('academic:getExaminationById', async (_, userId, id) => {
    await assertPageAccess(userId, '/exams')
    return await getExaminationById(id)
  })

  ipcMain.handle('academic:createExamination', async (_, data, guardPersonIds) => {
    return await createExamination(data, guardPersonIds)
  })

  ipcMain.handle('academic:updateExamination', async (_, id, data) => {
    return await updateExamination(id, data)
  })

  ipcMain.handle('academic:deleteExamination', async (_, id) => {
    return await deleteExamination(id)
  })

  // Examination types (dedicated lookup, no longer study-session types)
  ipcMain.handle('academic:getExaminationTypes', async () => {
    return await getExaminationTypes()
  })

  ipcMain.handle('academic:createExaminationType', async (_, data) => {
    return await createExaminationType(data)
  })

  ipcMain.handle('academic:updateExaminationType', async (_, id, data) => {
    return await updateExaminationType(id, data)
  })

  ipcMain.handle('academic:deleteExaminationType', async (_, id) => {
    return await deleteExaminationType(id)
  })

  // Examination guards (person_is_guard_in_examination). Guards proctor the
  // exam; exam groups (not teaching groups) sit it.
  ipcMain.handle('academic:getExaminationGuards', async (_, examinationId) => {
    return await getExaminationGuards(examinationId)
  })

  ipcMain.handle('academic:setExaminationGuards', async (_, examinationId, personIds) => {
    return await setExaminationGuards(examinationId, personIds)
  })

  ipcMain.handle('academic:getFreeGuards', async (_, startDatetime, endDatetime) => {
    return await getFreeGuards(startDatetime, endDatetime)
  })

  // Examination seating: shuffles the major's students into exam groups (each
  // with its own room); every seated student gets a seat number in the group's
  // room and the code of their response paper.
  ipcMain.handle('academic:getExaminationSeating', async (_, userId, examinationId) => {
    await assertPageAccess(userId, '/exams')
    return await getExaminationSeating(examinationId)
  })

  ipcMain.handle('academic:getFreeSeats', async (_, examinationId) => {
    return await getFreeSeats(examinationId)
  })

  ipcMain.handle('academic:saveExaminationSeating', async (_, examinationId, groups, seating) => {
    return await saveExaminationSeating(examinationId, { groups, seating })
  })

  // Exam marks (teacher-facing): list the exams of the teacher's majors with
  // mark progress, load the seated roster with current marks, and save marks.
  // Saving re-checks in the service that the exam belongs to the teacher's
  // majors — the renderer's claim is never trusted.
  ipcMain.handle('academic:getTeacherExaminations', async (_, userId, teacherPersonId, semesterId) => {
    await assertPageAccess(userId, '/exam-marks')
    return await getTeacherExaminations(teacherPersonId, semesterId)
  })

  ipcMain.handle('academic:getExaminationMarks', async (_, userId, examinationId) => {
    await assertPageAccess(userId, '/exam-marks')
    return await getExaminationMarks(examinationId)
  })

  ipcMain.handle('academic:saveExaminationMarks', async (_, userId, examinationId, marks, teacherPersonId) => {
    await assertPageAccess(userId, '/exam-marks')
    return await saveExaminationMarks(examinationId, marks, teacherPersonId)
  })

  // Major semester factors (admin, Majors page): the weight of a major when
  // averaging a student's semester mark across majors, per semester.
  ipcMain.handle('academic:getMajorSemesterFactors', async (_, semesterId) => {
    return await getMajorSemesterFactors(semesterId)
  })

  ipcMain.handle('academic:setMajorSemesterFactor', async (_, majorId, semesterId, factor) => {
    return await setMajorSemesterFactor(majorId, semesterId, factor)
  })

  // Semester marks: per student, the factor-weighted average of their major
  // marks (each major mark being the exam-factor-weighted average of the
  // student's exam marks in that major's exams of the semester).
  ipcMain.handle('academic:getSemesterMarks', async (_, userId, semesterId) => {
    await assertPageAccess(userId, '/exam-marks')
    return await getSemesterMarks(semesterId)
  })

  // A student's own marks for a semester: their exam marks plus the weighted
  // major averages and the semester mark. The personId always comes from the
  // logged-in session (never a client-supplied other student's id).
  ipcMain.handle('academic:getStudentMarks', async (_, personId, semesterId) => {
    return await getStudentMarks(personId, semesterId)
  })

  // `multiple` lets a page attach a whole batch of files in one pick; callers
  // that omit it keep the single-file dialog they have always had.
  ipcMain.handle('dialog:openFile', async (_, options) => {
    const result = await dialog.showOpenDialog({
      properties: options?.multiple ? ['openFile', 'multiSelections'] : ['openFile']
    })
    return result
  })

  // Absence handlers
  ipcMain.handle('absences:getJustifications', async () => {
    return await getAbsenceJustifications()
  })

  ipcMain.handle('absences:getForSession', async (_, sessionId) => {
    return await getAbsencesForSession(sessionId)
  })

  ipcMain.handle('absences:getSessionStudents', async (_, sessionId) => {
    return await getSessionStudentsForAbsence(sessionId)
  })

  ipcMain.handle('absences:markAbsent', async (_, data) => {
    return await markStudentAbsent(data)
  })

  ipcMain.handle('absences:markPresent', async (_, userId, studentId, sessionId, expectedAbsence) => {
    return await markStudentPresent(userId, studentId, sessionId, expectedAbsence)
  })

  ipcMain.handle('absences:getTeacherActiveSession', async (_, instructorId, currentDate, currentTime) => {
    return await getTeacherActiveSession(instructorId, currentDate, currentTime)
  })

  ipcMain.handle('absences:getTeacherCurrentSession', async (_, instructorId) => {
    return await getTeacherCurrentSession(instructorId)
  })

  ipcMain.handle('absences:getTeacherSessionsForPeriod', async (_, instructorId) => {
    return await getTeacherSessionsForPeriod(instructorId)
  })

  ipcMain.handle('absences:getStudentHistory', async (_, personId, filters) => {
    return await getStudentAbsenceHistory(personId, filters || {})
  })

  ipcMain.handle('absences:getGlobalHistory', async (_, filters) => {
    return await getGlobalAbsenceHistory(filters || {})
  })

  // Observation handlers
  ipcMain.handle('observations:getMotifs', async () => {
    return await getObservationMotifs()
  })

  ipcMain.handle('observations:getForSession', async (_, sessionId) => {
    return await getObservationsForSession(sessionId)
  })

  ipcMain.handle('observations:create', async (_, data) => {
    return await createObservation(data)
  })

  ipcMain.handle('observations:delete', async (_, data) => {
    return await deleteObservation(data)
  })

  ipcMain.handle('observations:deleteStudentForSession', async (_, studentId, sessionId) => {
    return await deleteStudentObservationsForSession(studentId, sessionId)
  })

  ipcMain.handle('observations:getStudentHistory', async (_, personId, filters) => {
    return await getStudentObservationHistory(personId, filters || {})
  })

  ipcMain.handle('observations:getGlobalHistory', async (_, filters) => {
    return await getGlobalObservationHistory(filters || {})
  })

  // Student profile editor (secretary) handlers
  ipcMain.handle('profile:getLookups', async () => {
    const [healthStatuses, hobbies, professions, relations, specialities, academicLevels, educationalCertificates, armies, countries, recruitmentSources, grades] = await Promise.all([
      getHealthStatuses(), getHobbies(), getProfessions(), getRelations(),
      getStudentSpecialities(), getAcademicLevels(), getEducationalCertificates(), getArmies(), getCountries(), getRecruitmentSources(),
      getGrades()
    ])
    return { healthStatuses: healthStatuses.data, hobbies: hobbies.data, professions: professions.data, relations: relations.data, specialities: specialities.data, academicLevels: academicLevels.data, educationalCertificates: educationalCertificates.data, armies: armies.data, countries: countries.data, recruitmentSources: recruitmentSources.data, grades: grades.data }
  })

  ipcMain.handle('profile:getWilayas', async (_, countryId) => {
    return await getWilayas(countryId)
  })

  ipcMain.handle('profile:getDairas', async (_, wilayaId) => {
    return await getDairas(wilayaId)
  })

  ipcMain.handle('profile:getCommunes', async (_, dairaId) => {
    return await getCommunes(dairaId)
  })

  ipcMain.handle('profile:getStudentProfile', async (_, userId, personId) => {
    return await getStudentProfile(userId, personId)
  })

  ipcMain.handle('profile:getStudentRecordOptions', async () => {
    return await getStudentRecordOptions()
  })

  ipcMain.handle('profile:createStudent', async (_, userId, data) => {
    const created = await createStudentProfile(userId, data || {})
    await recordAudit({
      actorUserId: userId,
      action: 'student.create',
      entityType: 'person',
      entityId: created?.PERSON_ID,
      entityLabel: [data?.identity?.firstName, data?.identity?.lastName].filter(Boolean).join(' ') || null,
      detail: { sectionIds: data?.sectionIds || [] }
    })
    return created
  })

  // Printable student report (Director only; checked again in the service)
  ipcMain.handle('reports:studentPdf', async (_, userId, personId, options) => {
    return await generateStudentReportPdf(userId, personId, options || {})
  })

  ipcMain.handle('profile:updateDetail', async (_, userId, personId, data) => {
    return await updateStudentDetail(userId, personId, data || {})
  })

  // Live uniqueness check for the student forms: the constraint rule, asked
  // while the field is being typed rather than after Save.
  ipcMain.handle('profile:checkIdentifiers', async (_, userId, personId, data) => {
    return await checkStudentIdentifiers(userId, personId, data || {})
  })

  ipcMain.handle('profile:updateIdentity', async (_, userId, personId, data) => {
    return await updateStudentIdentity(userId, personId, data || {})
  })

  ipcMain.handle('profile:updateParents', async (_, userId, personId, data) => {
    return await updateStudentParents(userId, personId, data || {})
  })

  ipcMain.handle('profile:addEmergencyContact', async (_, userId, personId, data) => {
    return await addEmergencyContact(userId, personId, data || {})
  })

  ipcMain.handle('profile:updateEmergencyContact', async (_, userId, contactId, data) => {
    return await updateEmergencyContact(userId, contactId, data || {})
  })

  ipcMain.handle('profile:deleteEmergencyContact', async (_, userId, contactId) => {
    return await deleteEmergencyContact(userId, contactId)
  })

  ipcMain.handle('profile:setHobbies', async (_, userId, personId, hobbyIds) => {
    return await setStudentHobbies(userId, personId, hobbyIds)
  })

  ipcMain.handle('profile:updateCombatOutfit', async (_, userId, personId, data) => {
    return await updateCombatOutfit(userId, personId, data || {})
  })

  ipcMain.handle('profile:updateParadeUniform', async (_, userId, personId, data) => {
    return await updateParadeUniform(userId, personId, data || {})
  })

  // Uniform sizes (Settings -> Registers -> Uniform sizes): the enumeration an
  // administrator defines. Reading is open to signed-in accounts; the writes
  // re-check the Admin role against the database inside the service.
  ipcMain.handle('uniformSizes:getOptions', async () => {
    return await getUniformSizeOptions()
  })

  ipcMain.handle('uniformSizes:createOption', async (_, userId, data) => {
    return await createUniformSizeOption(userId, data || {})
  })

  ipcMain.handle('uniformSizes:updateOption', async (_, userId, id, data) => {
    return await updateUniformSizeOption(userId, id, data || {})
  })

  ipcMain.handle('uniformSizes:deleteOption', async (_, userId, id) => {
    return await deleteUniformSizeOption(userId, id)
  })

  ipcMain.handle('profile:updatePersonalAddress', async (_, userId, personId, data) => {
    return await updateStudentPersonalAddress(userId, personId, data || {})
  })

  // Start sync loop
  setInterval(() => {
    processSyncQueue()
  }, 30000)

  // Teacher attendance: a finished session nobody registered becomes a
  // notification for its teacher, the directors and the administrators. The
  // scan compares the schedule with the application's own clock, so it is run
  // on a timer and once shortly after start-up; each session is reported once.
  const runAttendanceScan = () => {
    scanMissedSessions()
      .then((res) => {
        if (res?.reported) console.log(`Reported ${res.reported} session(s) with no attendance taken.`)
      })
      .catch((err) => console.warn('Teacher attendance scan failed:', err.message))
  }
  setTimeout(runAttendanceScan, 15000)
  setInterval(runAttendanceScan, 5 * 60 * 1000)

  // The in-class nudge: a session that has started and still has nothing
  // recorded raises one reminder for its own teacher, while there is still time
  // to take attendance. Cheaper than the alarms above because it only looks at
  // the slots running now, so it runs more often.
  const runReminderScan = () => {
    scanStartedSessions()
      .then((res) => {
        if (res?.reported) console.log(`Reminded ${res.reported} session(s) with attendance still to take.`)
      })
      .catch((err) => console.warn('Session reminder scan failed:', err.message))
  }
  setTimeout(runReminderScan, 20000)
  setInterval(runReminderScan, 2 * 60 * 1000)

  // The slow truths: marks still missing after an examination, a student who has
  // crossed the absence threshold, and the weekly attendance picture. Nothing
  // here changes minute to minute, and every detector is keyed by the record and
  // the period it describes, so an hourly pass is enough and repeats nothing.
  const runNotificationScans = () => {
    const scans = [
      ['missing marks', scanMissingExamMarks],
      ['absence thresholds', scanAbsenceThresholds],
      ['attendance summary', scanTeacherAttendanceSummary]
    ]
    for (const [label, scan] of scans) {
      scan()
        .then((res) => {
          if (res?.reported) console.log(`Notification scan (${label}): ${res.reported} row(s) raised.`)
        })
        .catch((err) => console.warn(`Notification scan (${label}) failed:`, err.message))
    }
  }
  setTimeout(runNotificationScans, 45000)
  setInterval(runNotificationScans, 60 * 60 * 1000)

  // Lesson media: stream a stored file by document id. Ranges are honoured so
  // the video player can seek instead of buffering from the start each time.
  protocol.handle('lesson-media', async (request) => {
    try {
      const url = new URL(request.url)
      const id = parseInt(url.pathname.split('/').filter(Boolean).pop() || '', 10)
      // The <video> element asks on its own, with no account attached, so the
      // file is served only when the page was already given it by a listing.
      if (!hasMediaGrant(id)) return new Response('Forbidden', { status: 403 })
      const file = await resolveDocumentFile(id)
      if (!file) return new Response('Not found', { status: 404 })

      const size = fs.statSync(file.path).size
      const headers = {
        'Content-Type': file.mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        // The window itself is the only client, but it is a file:// origin, so a
        // fetch from the page needs this even though <video> does not.
        'Access-Control-Allow-Origin': '*'
      }

      const range = request.headers.get('range')
      const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
      if (!match) {
        return new Response(Readable.toWeb(fs.createReadStream(file.path)), {
          status: 200,
          headers: { ...headers, 'Content-Length': String(size) }
        })
      }

      const start = match[1] ? parseInt(match[1], 10) : 0
      const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1
      if (Number.isNaN(start) || start >= size || start > end) {
        return new Response('Range not satisfiable', {
          status: 416,
          headers: { ...headers, 'Content-Range': `bytes */${size}` }
        })
      }

      return new Response(Readable.toWeb(fs.createReadStream(file.path, { start, end })), {
        status: 206,
        headers: {
          ...headers,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`
        }
      })
    } catch (err) {
      console.error('Could not serve lesson media:', err.message)
      return new Response('Not available', { status: 500 })
    }
  })

  // Library media: the same range-aware streaming, for the files that belong to
  // the Library rather than to a lesson. The id is resolved against
  // library_item, so the two catalogues cannot serve each other's files.
  protocol.handle('library-media', async (request) => {
    try {
      const url = new URL(request.url)
      const id = parseInt(url.pathname.split('/').filter(Boolean).pop() || '', 10)
      if (!hasLibraryMediaGrant(id)) return new Response('Forbidden', { status: 403 })
      const file = await resolveLibraryFile(id)
      if (!file) return new Response('Not found', { status: 404 })

      const size = fs.statSync(file.path).size
      const headers = {
        'Content-Type': file.mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      }

      const range = request.headers.get('range')
      const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
      if (!match) {
        return new Response(Readable.toWeb(fs.createReadStream(file.path)), {
          status: 200,
          headers: { ...headers, 'Content-Length': String(size) }
        })
      }

      const start = match[1] ? parseInt(match[1], 10) : 0
      const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1
      if (Number.isNaN(start) || start >= size || start > end) {
        return new Response('Range not satisfiable', {
          status: 416,
          headers: { ...headers, 'Content-Range': `bytes */${size}` }
        })
      }

      return new Response(Readable.toWeb(fs.createReadStream(file.path, { start, end })), {
        status: 206,
        headers: {
          ...headers,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`
        }
      })
    } catch (err) {
      console.error('Could not serve library media:', err.message)
      return new Response('Not available', { status: 500 })
    }
  })

  // Live notifications. The database announces each new notification on the
  // app_notification channel; every open window is told to refresh, so a badge
  // follows an absence or an observation immediately instead of on a timer.
  try {
    await listenForNotifications(() => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('notifications:changed')
      }
    })
  } catch (err) {
    console.warn('Live notifications unavailable:', err.message)
  }

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      closeDb()
      app.quit()
    }
  })

  app.on('quit', () => {
    stopNotificationListener()
    closeDb()
  })
}
