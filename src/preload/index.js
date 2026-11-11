import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  connectDb: (config) => ipcRenderer.invoke('db:connect', config),
  disconnectDb: () => ipcRenderer.invoke('db:disconnect'),
  getDbConfig: (userId) => ipcRenderer.invoke('db:getConfig', userId),
  query: (userId, sql, params) => ipcRenderer.invoke('db:query', userId, sql, params),
  dbStatus: () => ipcRenderer.invoke('db:status'),
  reconnectDb: () => ipcRenderer.invoke('db:reconnect'),
  // Work done while the server was unreachable, waiting to be sent. A conflict
  // entry carries both versions so the page can show them side by side.
  getOutboxEntries: () => ipcRenderer.invoke('offline:outbox:list'),
  getOutboxCounts: () => ipcRenderer.invoke('offline:outbox:counts'),
  getOfflineSummary: () => ipcRenderer.invoke('offline:cache:summary'),
  // Unsent work for a session: kept in the queue but not yet on the server.
  getSessionPending: (sessionId) => ipcRenderer.invoke('offline:session:pending', sessionId),
  flushOutbox: () => ipcRenderer.invoke('offline:outbox:flush'),
  resolveOutboxConflict: (id, choice) => ipcRenderer.invoke('offline:outbox:resolve', id, choice),
  retryOutboxEntry: (id) => ipcRenderer.invoke('offline:outbox:retry', id),
  discardOutboxEntry: (id) => ipcRenderer.invoke('offline:outbox:discard', id),
  onOutboxChanged: (callback) => {
    const listener = (_event, counts) => callback(counts || {})
    ipcRenderer.on('offline:outbox:changed', listener)
    return () => ipcRenderer.removeListener('offline:outbox:changed', listener)
  },
  getPersons: () => ipcRenderer.invoke('persons:get'),
  // The signed-in account id is forwarded: the main process uses it to apply a
  // secretary's teaching-category scope and to reject calls without a session.
  getStudentsWithSections: (userId) => ipcRenderer.invoke('students:getWithSections', userId),
  getTeachers: () => ipcRenderer.invoke('teachers:get'),
  // Everyone who carries a teaching or staff role, with their roles (the People
  // page). A person who is also a student stays here.
  getPersonnel: () => ipcRenderer.invoke('personnel:get'),
  createPerson: (data) => ipcRenderer.invoke('persons:create', data),
  updatePerson: (userId, id, data) => ipcRenderer.invoke('persons:update', userId, id, data),
  deletePerson: (userId, id) => ipcRenderer.invoke('persons:delete', userId, id),
  // A person's roles are rows in person_has_role, changed one at a time — the
  // two a person record can carry are STUDENT and TEACHER.
  assignPersonRole: (userId, personId, roleCode) => ipcRenderer.invoke('persons:assignRole', userId, personId, roleCode),
  endPersonRole: (userId, personId, roleCode) => ipcRenderer.invoke('persons:endRole', userId, personId, roleCode),
  // The department a teacher belongs to. It is stored on the active TEACHER
  // row in person_has_role, so it is set separately from the roles themselves.
  setPersonDepartment: (userId, personId, departmentId) => ipcRenderer.invoke('persons:setDepartment', userId, personId, departmentId),
  // Student photos (person.person_photo): the picker runs in the main process
  // and the renderer only receives a preview data URL, never a file read.
  choosePersonPhoto: () => ipcRenderer.invoke('personPhoto:choose'),
  readPersonPhoto: (path) => ipcRenderer.invoke('personPhoto:read', path),
  readPersonPhotos: (paths) => ipcRenderer.invoke('personPhoto:readMany', paths),
  setPersonPhoto: (userId, personId, sourcePath) => ipcRenderer.invoke('personPhoto:set', userId, personId, sourcePath),
  getSchedule: (userId, weekId, sectionId) => ipcRenderer.invoke('schedule:get', userId, weekId, sectionId),
  // Study-session consultation (Admin and Director): sessions of a week, each
  // with the absences and observations recorded against it.
  getWeekSessionRecords: (userId, weekId) => ipcRenderer.invoke('sessionRecords:getWeek', userId, weekId),
  getSessionStudentInfo: (userId, personId) => ipcRenderer.invoke('sessionRecords:getStudent', userId, personId),
  getExamEvents: (weekId, teachingGroupId) => ipcRenderer.invoke('schedule:getExamEvents', weekId, teachingGroupId),
  getStudyWeekDays: (weekId) => ipcRenderer.invoke('schedule:getWeekDays', weekId),
  getSessionTypeRemainingHours: (data) => ipcRenderer.invoke('schedule:getSessionTypeRemainingHours', data),
  createSession: (userId, data, constraintChoice) => ipcRenderer.invoke('schedule:create', userId, data, constraintChoice),
  // Weekly teacher constraints: a teacher's hard/soft windows for a week, the
  // Admin's feature settings, and the teacher's own declaration changes.
  getTeacherConstraints: (weekId, instructorId) => ipcRenderer.invoke('teacherConstraints:get', weekId, instructorId),
  getTeacherConstraintSettings: () => ipcRenderer.invoke('teacherConstraints:getSettings'),
  // The predefined hard/soft windows a teacher selects from; the last three are
  // the administrator's register in Settings.
  getTeacherConstraintOptions: () => ipcRenderer.invoke('teacherConstraints:getOptions'),
  createTeacherConstraintOption: (userId, data) => ipcRenderer.invoke('teacherConstraints:createOption', userId, data),
  updateTeacherConstraintOption: (userId, id, data) => ipcRenderer.invoke('teacherConstraints:updateOption', userId, id, data),
  deleteTeacherConstraintOption: (userId, id) => ipcRenderer.invoke('teacherConstraints:deleteOption', userId, id),
  createTeacherConstraint: (userId, data) => ipcRenderer.invoke('teacherConstraints:create', userId, data),
  deleteTeacherConstraint: (userId, id) => ipcRenderer.invoke('teacherConstraints:delete', userId, id),
  deleteSession: (userId, id) => ipcRenderer.invoke('schedule:delete', userId, id),
  getTeacherSchedule: (instructorId, weekId, sectionId) => ipcRenderer.invoke('schedule:getTeacherSessions', instructorId, weekId, sectionId),
  getStudentSchedule: (personId, weekId, sectionId) => ipcRenderer.invoke('schedule:getStudentSessions', personId, weekId, sectionId),
  getDocuments: (userId) => ipcRenderer.invoke('documents:get', userId),
  getDocumentTypes: () => ipcRenderer.invoke('documents:getTypes'),
  uploadDocument: (path, metadata) => ipcRenderer.invoke('documents:upload', path, metadata),
  deleteDocument: (id, userId) => ipcRenderer.invoke('documents:delete', id, userId),
  downloadDocument: (id, userId) => ipcRenderer.invoke('documents:download', id, userId),
  openDocument: (id, userId) => ipcRenderer.invoke('documents:open', id, userId),
  // The files the library uses most (opens, in-page plays and downloads).
  getPopularDocuments: (options) => ipcRenderer.invoke('documents:getPopular', options),
  trackDocumentView: (id, userId) => ipcRenderer.invoke('documents:trackView', id, userId),
  // The Library: documents that belong to the school rather than to one lesson,
  // with an Admin review step before anything is published.
  getLibraryItems: (userId) => ipcRenderer.invoke('library:getItems', userId),
  getLibraryCategories: (userId) => ipcRenderer.invoke('library:getCategories', userId),
  getLibraryPolicy: () => ipcRenderer.invoke('library:getPolicy'),
  getLibraryReviewQueue: (userId) => ipcRenderer.invoke('library:getReviewQueue', userId),
  getLibraryReviewCount: (userId) => ipcRenderer.invoke('library:getReviewCount', userId),
  uploadLibraryItem: (userId, path, metadata) => ipcRenderer.invoke('library:upload', userId, path, metadata),
  updateLibraryItem: (userId, id, data) => ipcRenderer.invoke('library:update', userId, id, data),
  reviewLibraryItem: (userId, id, decision, note) => ipcRenderer.invoke('library:review', userId, id, decision, note),
  archiveLibraryItem: (userId, id, archived) => ipcRenderer.invoke('library:archive', userId, id, archived),
  deleteLibraryItem: (userId, id) => ipcRenderer.invoke('library:delete', userId, id),
  downloadLibraryItem: (userId, id) => ipcRenderer.invoke('library:download', userId, id),
  openLibraryItem: (userId, id) => ipcRenderer.invoke('library:open', userId, id),
  // A copy kept on this computer so the document opens during an outage.
  saveLibraryItemOffline: (userId, id) => ipcRenderer.invoke('library:saveOffline', userId, id),
  removeLibraryItemOffline: (id) => ipcRenderer.invoke('library:removeOffline', id),
  saveDocumentOffline: (userId, id) => ipcRenderer.invoke('documents:saveOffline', userId, id),
  removeDocumentOffline: (id) => ipcRenderer.invoke('documents:removeOffline', id),
  getOfflineFileIds: (kind) => ipcRenderer.invoke('offline:files:ids', kind),
  trackLibraryView: (id, userId, kind) => ipcRenderer.invoke('library:trackView', id, userId, kind),
  createLibraryCategory: (userId, data) => ipcRenderer.invoke('library:createCategory', userId, data),
  updateLibraryCategory: (userId, id, data) => ipcRenderer.invoke('library:updateCategory', userId, id, data),
  deleteLibraryCategory: (userId, id) => ipcRenderer.invoke('library:deleteCategory', userId, id),
  createBugReport: (userId, data) => ipcRenderer.invoke('bugReport:create', userId, data),
  getBugReports: () => ipcRenderer.invoke('bugReport:getAll'),
  getMyBugReports: (userId) => ipcRenderer.invoke('bugReport:getMine', userId),
  updateBugReport: (reportId, data, actingUserId) => ipcRenderer.invoke('bugReport:update', reportId, data, actingUserId),
  uploadBugScreenshot: (filePath, userId) => ipcRenderer.invoke('bugReport:uploadScreenshot', filePath, userId),
  openBugScreenshot: (reportId) => ipcRenderer.invoke('bugReport:openScreenshot', reportId),
  getChangelogs: () => ipcRenderer.invoke('changelog:getAll'),
  canManageChangelog: (userId) => ipcRenderer.invoke('changelog:canManage', userId),
  createChangelog: (userId, data) => ipcRenderer.invoke('changelog:create', userId, data),
  updateChangelog: (userId, id, data) => ipcRenderer.invoke('changelog:update', userId, id, data),
  deleteChangelog: (userId, id) => ipcRenderer.invoke('changelog:delete', userId, id),
  // "A new version is out": the newest release this account has not seen yet.
  getPendingChangelog: (userId) => ipcRenderer.invoke('changelog:getPending', userId),
  markChangelogSeen: (userId, changelogId) => ipcRenderer.invoke('changelog:markSeen', userId, changelogId),
  getMyProfile: (userId) => ipcRenderer.invoke('myProfile:get', userId),
  updateMyUsername: (userId, newUsername) => ipcRenderer.invoke('myProfile:updateUsername', userId, newUsername),
  changeMyPassword: (userId, currentPassword, newPassword) => ipcRenderer.invoke('myProfile:changePassword', userId, currentPassword, newPassword),
  // Director notifications (absences & observations)
  getNotifications: (userId) => ipcRenderer.invoke('notifications:get', userId),
  getNotificationCount: (userId) => ipcRenderer.invoke('notifications:getCount', userId),
  markNotificationRead: (userId, recordKey) => ipcRenderer.invoke('notifications:markRead', userId, recordKey),
  getNotificationPreferences: (userId) => ipcRenderer.invoke('notifications:getPreferences', userId),
  setNotificationMute: (userId, family, muted) => ipcRenderer.invoke('notifications:setMute', userId, family, muted),
  // Suspended accounts (wrong password 5 times in a row): Admin only.
  getSuspendedAccounts: (userId) => ipcRenderer.invoke('accountSecurity:listSuspended', userId),
  unlockAccount: (userId, targetUserId) => ipcRenderer.invoke('accountSecurity:unlock', userId, targetUserId),
  markAllNotificationsRead: (userId) => ipcRenderer.invoke('notifications:markAllRead', userId),
  getNotificationComments: (userId, recordKey) => ipcRenderer.invoke('notifications:getComments', userId, recordKey),
  addNotificationComment: (userId, recordKey, commentText) => ipcRenderer.invoke('notifications:addComment', userId, recordKey, commentText),
  deleteNotificationComment: (userId, commentId) => ipcRenderer.invoke('notifications:deleteComment', userId, commentId),
  // Teacher attendance (was the programmed session actually taken?)
  getSessionRegister: (sessionId) => ipcRenderer.invoke('teacherAttendance:getRegister', sessionId),
  markSessionAttended: (userId, sessionId) => ipcRenderer.invoke('teacherAttendance:markAttended', userId, sessionId),
  scanMissedSessions: () => ipcRenderer.invoke('teacherAttendance:scan'),
  getTeacherAttendanceReport: (userId, period) => ipcRenderer.invoke('teacherAttendance:report', userId, period),
  // Fires when the database announces a new notification (LISTEN/NOTIFY).
  onNotificationsChanged: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('notifications:changed', listener)
    return () => ipcRenderer.removeListener('notifications:changed', listener)
  },
  // A native (operating-system) notification, raised by the main process so it
  // survives the window losing focus.
  showDesktopNotification: (payload) => ipcRenderer.invoke('notifications:showDesktop', payload),
  // The accent palette also tints the window's own mark (taskbar, notification
  // popup): the main process holds those files, so the choice is sent across.
  setAppAccent: (accent) => ipcRenderer.invoke('app:setAccent', accent),
  // Native surfaces Chromium draws outside the page (select popups, date
  // pickers, system menus) follow the window's appearance, not the stylesheet.
  setNativeTheme: (mode) => ipcRenderer.invoke('app:setNativeTheme', mode),
  // Interface scale: a zoom factor applied to this window, so the whole
  // interface grows or shrinks together.
  setInterfaceScale: (scale) => ipcRenderer.invoke('app:setInterfaceScale', scale),
  // Fires when the user clicks one of those notifications in the OS.
  onNotificationOpen: (callback) => {
    const listener = (_event, payload) => callback(payload || {})
    ipcRenderer.on('notifications:open', listener)
    return () => ipcRenderer.removeListener('notifications:open', listener)
  },
  getRewardsPunishmentsStudents: (userId) => ipcRenderer.invoke('rewardsPunishments:getStudents', userId),
  getRewardsPunishmentsTypes: () => ipcRenderer.invoke('rewardsPunishments:getTypes'),
  getStudentRewardsPunishments: (userId, serial) => ipcRenderer.invoke('rewardsPunishments:getStudent', userId, serial),
  applyPunishment: (userId, data) => ipcRenderer.invoke('rewardsPunishments:applyPunishment', userId, data),
  applyReward: (userId, data) => ipcRenderer.invoke('rewardsPunishments:applyReward', userId, data),
  applyPunishmentBulk: (userId, data) => ipcRenderer.invoke('rewardsPunishments:applyPunishmentBulk', userId, data),
  applyRewardBulk: (userId, data) => ipcRenderer.invoke('rewardsPunishments:applyRewardBulk', userId, data),
  updatePunishment: (userId, punishmentId, data) => ipcRenderer.invoke('rewardsPunishments:updatePunishment', userId, punishmentId, data),
  updateReward: (userId, rewardId, data) => ipcRenderer.invoke('rewardsPunishments:updateReward', userId, rewardId, data),
  deletePunishment: (userId, punishmentId) => ipcRenderer.invoke('rewardsPunishments:deletePunishment', userId, punishmentId),
  deleteReward: (userId, rewardId) => ipcRenderer.invoke('rewardsPunishments:deleteReward', userId, rewardId),
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  getDocMajorCategories: () => ipcRenderer.invoke('documents:getMajorCategories'),
  getMajorsByCategory: (categoryId) => ipcRenderer.invoke('documents:getMajorsByCategory', categoryId),
  getChaptersByMajor: (majorId) => ipcRenderer.invoke('documents:getChaptersByMajor', majorId),
  getLessonsByChapter: (chapterId) => ipcRenderer.invoke('documents:getLessonsByChapter', chapterId),
  createChapter: (data) => ipcRenderer.invoke('documents:createChapter', data),
  updateChapter: (id, data) => ipcRenderer.invoke('documents:updateChapter', id, data),
  deleteChapter: (id) => ipcRenderer.invoke('documents:deleteChapter', id),
  createLesson: (data) => ipcRenderer.invoke('documents:createLesson', data),
  updateLesson: (id, data) => ipcRenderer.invoke('documents:updateLesson', id, data),
  deleteLesson: (id) => ipcRenderer.invoke('documents:deleteLesson', id),
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  register: (userData) => ipcRenderer.invoke('auth:register', userData),
  // User sessions: the signed-in window keeps its session id and heartbeat;
  // the page reads its own sessions and, for Admin (or an allowed Developer),
  // every account's sessions.
  startUserSession: (userId) => ipcRenderer.invoke('userSessions:start', userId),
  heartbeatUserSession: (userId, sessionId) => ipcRenderer.invoke('userSessions:heartbeat', userId, sessionId),
  getUserSessions: (userId, currentSessionId) => ipcRenderer.invoke('userSessions:getMine', userId, currentSessionId),
  getAllUserSessions: (userId, options) => ipcRenderer.invoke('userSessions:getAll', userId, options),
  endUserSession: (userId, sessionId) => ipcRenderer.invoke('userSessions:end', userId, sessionId),
  endOtherUserSessions: (userId, currentSessionId) => ipcRenderer.invoke('userSessions:endOthers', userId, currentSessionId),
  endAllUserSessions: (userId, currentSessionId) => ipcRenderer.invoke('userSessions:endAll', userId, currentSessionId),
  getDashboardStats: () => ipcRenderer.invoke('stats:getDashboard'),
  getAdminStatistics: (semesterId) => ipcRenderer.invoke('stats:getAdminStatistics', semesterId),
  createStudyYear: (data) => ipcRenderer.invoke('academic:createYear', data),
  createStudySemester: (data) => ipcRenderer.invoke('academic:createSemester', data),
  createStudyWeek: (data) => ipcRenderer.invoke('academic:createWeek', data),
  updateStudyYear: (id, data) => ipcRenderer.invoke('academic:updateYear', id, data),
  updateStudySemester: (id, data) => ipcRenderer.invoke('academic:updateSemester', id, data),
  updateStudyWeek: (id, data) => ipcRenderer.invoke('academic:updateWeek', id, data),
  generateStudyWeeks: (options) => ipcRenderer.invoke('academic:generateWeeks', options),
  deleteStudyYear: (id) => ipcRenderer.invoke('academic:deleteYear', id),
  deleteStudySemester: (id) => ipcRenderer.invoke('academic:deleteSemester', id),
  deleteStudyWeek: (id) => ipcRenderer.invoke('academic:deleteWeek', id),
  getStudyYears: () => ipcRenderer.invoke('academic:getYears'),
  getStudySemesters: (yearId) => ipcRenderer.invoke('academic:getSemesters', yearId),
  getStudyWeeks: (semesterId) => ipcRenderer.invoke('academic:getWeeks', semesterId),
  getMajors: () => ipcRenderer.invoke('academic:getMajors'),
  getMajorTeachers: () => ipcRenderer.invoke('academic:getMajorTeachers'),
  updateMajorTeachers: (majorId, teacherIds) => ipcRenderer.invoke('academic:updateMajorTeachers', majorId, teacherIds),
  getMajorsTaughtByTeacher: (personId) => ipcRenderer.invoke('academic:getMajorsTaughtByTeacher', personId),
  createMajor: (data) => ipcRenderer.invoke('academic:createMajor', data),
  updateMajor: (id, data) => ipcRenderer.invoke('academic:updateMajor', id, data),
  deleteMajor: (id) => ipcRenderer.invoke('academic:deleteMajor', id),
  getPromotions: () => ipcRenderer.invoke('academic:getPromotions'),
  createPromotion: (userId, data) => ipcRenderer.invoke('academic:createPromotion', userId, data),
  updatePromotion: (userId, id, data) => ipcRenderer.invoke('academic:updatePromotion', userId, id, data),
  deletePromotion: (userId, id) => ipcRenderer.invoke('academic:deletePromotion', userId, id),
  getMajorCategories: () => ipcRenderer.invoke('academic:getMajorCategories'),
  createMajorCategory: (data) => ipcRenderer.invoke('academic:createMajorCategory', data),
  updateMajorCategory: (id, data) => ipcRenderer.invoke('academic:updateMajorCategory', id, data),
  deleteMajorCategory: (id) => ipcRenderer.invoke('academic:deleteMajorCategory', id),
  getTeachingCategories: () => ipcRenderer.invoke('academic:getTeachingCategories'),
  createTeachingCategory: (data) => ipcRenderer.invoke('academic:createTeachingCategory', data),
  updateTeachingCategory: (id, data) => ipcRenderer.invoke('academic:updateTeachingCategory', id, data),
  deleteTeachingCategory: (id) => ipcRenderer.invoke('academic:deleteTeachingCategory', id),
  getSections: () => ipcRenderer.invoke('academic:getSections'),
  createSection: (data) => ipcRenderer.invoke('academic:createSection', data),
  updateSection: (id, data) => ipcRenderer.invoke('academic:updateSection', id, data),
  deleteSection: (id) => ipcRenderer.invoke('academic:deleteSection', id),
  getClassrooms: () => ipcRenderer.invoke('academic:getClassrooms'),
  createClassroom: (data) => ipcRenderer.invoke('academic:createClassroom', data),
  updateClassroom: (id, data) => ipcRenderer.invoke('academic:updateClassroom', id, data),
  deleteClassroom: (id) => ipcRenderer.invoke('academic:deleteClassroom', id),
  getClassroomSeats: (classroomId) => ipcRenderer.invoke('academic:getClassroomSeats', classroomId),
  addClassroomSeat: (classroomId, seatNumber) => ipcRenderer.invoke('academic:addClassroomSeat', classroomId, seatNumber),
  deleteClassroomSeat: (classroomId, seatNumber) => ipcRenderer.invoke('academic:deleteClassroomSeat', classroomId, seatNumber),
  generateClassroomSeats: (classroomId, count) => ipcRenderer.invoke('academic:generateClassroomSeats', classroomId, count),
  getClassroomCategories: () => ipcRenderer.invoke('academic:getClassroomCategories'),
  createClassroomCategory: (data) => ipcRenderer.invoke('academic:createClassroomCategory', data),
  updateClassroomCategory: (id, data) => ipcRenderer.invoke('academic:updateClassroomCategory', id, data),
  deleteClassroomCategory: (id) => ipcRenderer.invoke('academic:deleteClassroomCategory', id),
  getTeachingGroups: () => ipcRenderer.invoke('academic:getTeachingGroups'),
  createTeachingGroup: (userId, data) => ipcRenderer.invoke('academic:createTeachingGroup', userId, data),
  updateTeachingGroup: (id, data) => ipcRenderer.invoke('academic:updateTeachingGroup', id, data),
  deleteTeachingGroup: (id) => ipcRenderer.invoke('academic:deleteTeachingGroup', id),
  getStudySessionTypes: () => ipcRenderer.invoke('academic:getStudySessionTypes'),
  createStudySessionType: (data) => ipcRenderer.invoke('academic:createStudySessionType', data),
  updateStudySessionType: (id, data) => ipcRenderer.invoke('academic:updateStudySessionType', id, data),
  deleteStudySessionType: (id) => ipcRenderer.invoke('academic:deleteStudySessionType', id),
  getStudySessionTimeSlots: () => ipcRenderer.invoke('academic:getStudySessionTimeSlots'),
  createStudySessionTimeSlot: (data) => ipcRenderer.invoke('academic:createStudySessionTimeSlot', data),
  updateStudySessionTimeSlot: (id, data) => ipcRenderer.invoke('academic:updateStudySessionTimeSlot', id, data),
  deleteStudySessionTimeSlot: (id) => ipcRenderer.invoke('academic:deleteStudySessionTimeSlot', id),
  getTeachingGroupsByMajor: (majorId, semesterId) => ipcRenderer.invoke('academic:getTeachingGroupsByMajor', majorId, semesterId),
  getTeachingGroupsForSemester: (semesterId, yearId) => ipcRenderer.invoke('academic:getTeachingGroupsForSemester', semesterId, yearId),
  createStudentDynamicGroupByMajor: (data) => ipcRenderer.invoke('academic:createStudentDynamicGroupByMajor', data),
  getAcademicGrades: () => ipcRenderer.invoke('academic:getAcademicGrades'),
  getDepartments: () => ipcRenderer.invoke('academic:getDepartments'),
  getDirections: () => ipcRenderer.invoke('academic:getDirections'),
  createDirection: (data) => ipcRenderer.invoke('academic:createDirection', data),
  updateDirection: (id, data) => ipcRenderer.invoke('academic:updateDirection', id, data),
  deleteDirection: (id) => ipcRenderer.invoke('academic:deleteDirection', id),
  createDepartment: (data) => ipcRenderer.invoke('academic:createDepartment', data),
  updateDepartment: (id, data) => ipcRenderer.invoke('academic:updateDepartment', id, data),
  deleteDepartment: (id) => ipcRenderer.invoke('academic:deleteDepartment', id),
  createAcademicGrade: (data) => ipcRenderer.invoke('academic:createAcademicGrade', data),
  updateAcademicGrade: (id, data) => ipcRenderer.invoke('academic:updateAcademicGrade', id, data),
  deleteAcademicGrade: (id) => ipcRenderer.invoke('academic:deleteAcademicGrade', id),
  getGrades: () => ipcRenderer.invoke('academic:getGrades'),
  createGrade: (data) => ipcRenderer.invoke('academic:createGrade', data),
  updateGrade: (id, data) => ipcRenderer.invoke('academic:updateGrade', id, data),
  deleteGrade: (id) => ipcRenderer.invoke('academic:deleteGrade', id),
  getMajorHourlyVolumes: (majorId, semesterId) => ipcRenderer.invoke('academic:getMajorHourlyVolumes', majorId, semesterId),
  createMajorHourlyVolume: (data) => ipcRenderer.invoke('academic:createMajorHourlyVolume', data),
  updateMajorHourlyVolume: (majorId, semesterId, teachingGroupId, data) => ipcRenderer.invoke('academic:updateMajorHourlyVolume', majorId, semesterId, teachingGroupId, data),
  deleteMajorHourlyVolume: (majorId, semesterId, teachingGroupId) => ipcRenderer.invoke('academic:deleteMajorHourlyVolume', majorId, semesterId, teachingGroupId),
  getMajorHourlyProgress: (majorId, semesterId, teachingGroupId) => ipcRenderer.invoke('academic:getMajorHourlyProgress', majorId, semesterId, teachingGroupId),
  getMajorHourlyVolumesBySessionType: (majorId, semesterId) => ipcRenderer.invoke('academic:getMajorHourlyVolumesBySessionType', majorId, semesterId),
  createMajorHourlyVolumeBySessionType: (data) => ipcRenderer.invoke('academic:createMajorHourlyVolumeBySessionType', data),
  updateMajorHourlyVolumeBySessionType: (majorId, semesterId, sessionTypeId, teachingGroupId, data) => ipcRenderer.invoke('academic:updateMajorHourlyVolumeBySessionType', majorId, semesterId, sessionTypeId, teachingGroupId, data),
  deleteMajorHourlyVolumeBySessionType: (majorId, semesterId, sessionTypeId, teachingGroupId) => ipcRenderer.invoke('academic:deleteMajorHourlyVolumeBySessionType', majorId, semesterId, sessionTypeId, teachingGroupId),
  getTeachingSectionHourlyVolumes: (sectionId, majorId, semesterId) => ipcRenderer.invoke('academic:getTeachingSectionHourlyVolumes', sectionId, majorId, semesterId),
  createTeachingSectionHourlyVolume: (data) => ipcRenderer.invoke('academic:createTeachingSectionHourlyVolume', data),
  updateTeachingSectionHourlyVolume: (sectionId, majorId, semesterId, data) => ipcRenderer.invoke('academic:updateTeachingSectionHourlyVolume', sectionId, majorId, semesterId, data),
  deleteTeachingSectionHourlyVolume: (sectionId, majorId, semesterId) => ipcRenderer.invoke('academic:deleteTeachingSectionHourlyVolume', sectionId, majorId, semesterId),
  getTeachingGroupHourlyProgress: (teachingGroupId, majorId, semesterId) => ipcRenderer.invoke('academic:getTeachingGroupHourlyProgress', teachingGroupId, majorId, semesterId),
  getStudentSections: (userId, personId) => ipcRenderer.invoke('academic:getStudentSections', userId, personId),
  getSectionStudents: (sectionId) => ipcRenderer.invoke('academic:getSectionStudents', sectionId),
  getStudentSectionHistory: (userId, personId) => ipcRenderer.invoke('academic:getStudentSectionHistory', userId, personId),
  assignStudentToSection: (userId, personId, sectionId) => ipcRenderer.invoke('academic:assignStudentToSection', userId, personId, sectionId),
  removeStudentFromSection: (userId, personId, sectionId) => ipcRenderer.invoke('academic:removeStudentFromSection', userId, personId, sectionId),
  updateStudentSections: (userId, personId, sectionIds) => ipcRenderer.invoke('academic:updateStudentSections', userId, personId, sectionIds),
  getStudentsInTeachingGroup: (majorId, semesterId, teachingGroupId) => ipcRenderer.invoke('academic:getStudentsInTeachingGroup', majorId, semesterId, teachingGroupId),
  addStudentToTeachingGroup: (personId, majorId, semesterId, teachingGroupId) => ipcRenderer.invoke('academic:addStudentToTeachingGroup', personId, majorId, semesterId, teachingGroupId),
  removeStudentFromTeachingGroup: (personId, majorId, semesterId, teachingGroupId) => ipcRenderer.invoke('academic:removeStudentFromTeachingGroup', personId, majorId, semesterId, teachingGroupId),
  updateTeachingGroupRoster: (majorId, semesterId, teachingGroupId, personIds) => ipcRenderer.invoke('academic:updateTeachingGroupRoster', majorId, semesterId, teachingGroupId, personIds),
  getTeachingGroupsForStudent: (userId, personId) => ipcRenderer.invoke('academic:getTeachingGroupsForStudent', userId, personId),
  getExaminations: (userId, majorId) => ipcRenderer.invoke('academic:getExaminations', userId, majorId),
  getExaminationTypes: () => ipcRenderer.invoke('academic:getExaminationTypes'),
  createExaminationType: (data) => ipcRenderer.invoke('academic:createExaminationType', data),
  updateExaminationType: (id, data) => ipcRenderer.invoke('academic:updateExaminationType', id, data),
  deleteExaminationType: (id) => ipcRenderer.invoke('academic:deleteExaminationType', id),
  getExaminationById: (userId, id) => ipcRenderer.invoke('academic:getExaminationById', userId, id),
  createExamination: (data, guardPersonIds) => ipcRenderer.invoke('academic:createExamination', data, guardPersonIds),
  updateExamination: (id, data) => ipcRenderer.invoke('academic:updateExamination', id, data),
  deleteExamination: (id) => ipcRenderer.invoke('academic:deleteExamination', id),
  getExaminationGuards: (examinationId) => ipcRenderer.invoke('academic:getExaminationGuards', examinationId),
  getFreeGuards: (startDatetime, endDatetime) => ipcRenderer.invoke('academic:getFreeGuards', startDatetime, endDatetime),
  setExaminationGuards: (examinationId, personIds) => ipcRenderer.invoke('academic:setExaminationGuards', examinationId, personIds),
  getExaminationSeating: (userId, examinationId) => ipcRenderer.invoke('academic:getExaminationSeating', userId, examinationId),
  getFreeSeats: (examinationId) => ipcRenderer.invoke('academic:getFreeSeats', examinationId),
  saveExaminationSeating: (examinationId, groups, seating) => ipcRenderer.invoke('academic:saveExaminationSeating', examinationId, groups, seating),
  getTeacherExaminations: (userId, teacherPersonId, semesterId) => ipcRenderer.invoke('academic:getTeacherExaminations', userId, teacherPersonId, semesterId),
  getExaminationMarks: (userId, examinationId) => ipcRenderer.invoke('academic:getExaminationMarks', userId, examinationId),
  saveExaminationMarks: (userId, examinationId, marks, teacherPersonId) => ipcRenderer.invoke('academic:saveExaminationMarks', userId, examinationId, marks, teacherPersonId),
  getMajorSemesterFactors: (semesterId) => ipcRenderer.invoke('academic:getMajorSemesterFactors', semesterId),
  setMajorSemesterFactor: (majorId, semesterId, factor) => ipcRenderer.invoke('academic:setMajorSemesterFactor', majorId, semesterId, factor),
  getSemesterMarks: (userId, semesterId) => ipcRenderer.invoke('academic:getSemesterMarks', userId, semesterId),
  getStudentMarks: (personId, semesterId) => ipcRenderer.invoke('academic:getStudentMarks', personId, semesterId),
  getSettings: (userId) => ipcRenderer.invoke('settings:get', userId),
  // Legacy registry import (Admin and Developer): pick the dump, preview the
  // mapped plan, then import the tables the reviewer selects. A blocked table is
  // left out instead of stopping the others.
  pickLegacyDump: () => ipcRenderer.invoke('legacy:pickDump'),
  previewLegacyImport: (userId, filePath, selectedSteps, mode) => ipcRenderer.invoke('legacy:preview', userId, filePath, selectedSteps, mode),
  runLegacyImport: (userId, filePath, selectedSteps, mode) => ipcRenderer.invoke('legacy:run', userId, filePath, selectedSteps, mode),
  setSetting: (userId, key, value) => ipcRenderer.invoke('settings:set', userId, key, value),
  // Client version gate: whether this build is still allowed to use the server,
  // the automatic update from the LAN share, and the pushes fired while it is
  // downloading or when a later check finds the client outdated.
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openUpdateInstallerFolder: () => ipcRenderer.invoke('update:openInstallerFolder'),
  onUpdateProgress: (callback) => {
    const listener = (_event, percent) => callback(percent)
    ipcRenderer.on('update:progress', listener)
    return () => ipcRenderer.removeListener('update:progress', listener)
  },
  onUpdateRequired: (callback) => {
    const listener = (_event, status) => callback(status || {})
    ipcRenderer.on('update:required', listener)
    return () => ipcRenderer.removeListener('update:required', listener)
  },
  // Activity log (Admin and Developer): filtered, paged reading and CSV export.
  getAuditLog: (userId, filters) => ipcRenderer.invoke('audit:list', userId, filters),
  exportAuditLogCsv: (userId, filters) => ipcRenderer.invoke('audit:exportCsv', userId, filters),
  getBetaTesters: (userId) => ipcRenderer.invoke('settings:getBetaTesters', userId),
  setBetaTester: (userId, targetUserId, enabled) => ipcRenderer.invoke('settings:setBetaTester', userId, targetUserId, enabled),
  // Locked pages: readable by everyone (the sidebar marks them), writable by
  // Admins. A lock names the roles it closes the page for; none means all.
  getLockedPages: () => ipcRenderer.invoke('pageLock:list'),
  setPageLocked: (userId, route, locked) => ipcRenderer.invoke('pageLock:set', userId, route, locked),
  setPageLockRoles: (userId, route, roles) => ipcRenderer.invoke('pageLock:setRoles', userId, route, roles),
  getBetaTestVersions: (userId) => ipcRenderer.invoke('betaTest:getVersions', userId),
  saveBetaTestReport: (userId, changelogId, data) => ipcRenderer.invoke('betaTest:saveReport', userId, changelogId, data),
  getBetaTestAdminReports: (userId) => ipcRenderer.invoke('betaTest:getReports', userId),
  // Inbox (one-way messages from admins)
  getInbox: (userId) => ipcRenderer.invoke('inbox:get', userId),
  getInboxUnreadCount: (userId) => ipcRenderer.invoke('inbox:getUnreadCount', userId),
  markMessageSeen: (userId, messageId) => ipcRenderer.invoke('inbox:markSeen', userId, messageId),
  markAllMessagesSeen: (userId) => ipcRenderer.invoke('inbox:markAllSeen', userId),
  getMessageRoles: (userId) => ipcRenderer.invoke('inbox:getRoles', userId),
  getMessageAudience: (userId, roleCodes) => ipcRenderer.invoke('inbox:getAudience', userId, roleCodes),
  sendMessage: (userId, data) => ipcRenderer.invoke('inbox:send', userId, data),
  getSentMessages: (userId) => ipcRenderer.invoke('inbox:getSent', userId),
  getMessageRecipients: (userId, messageId) => ipcRenderer.invoke('inbox:getRecipients', userId, messageId),
  // Admin account tools
  searchUsersForPasswordReset: (userId, term) => ipcRenderer.invoke('adminUsers:search', userId, term),
  resetUserPassword: (userId, targetUserId, newPassword) => ipcRenderer.invoke('adminUsers:resetPassword', userId, targetUserId, newPassword),
  // Direct messages between users
  getMessagingRules: (userId) => ipcRenderer.invoke('messaging:getRules', userId),
  setMessagingRule: (userId, senderRoleCode, targetRoleCode, allowed) => ipcRenderer.invoke('messaging:setRule', userId, senderRoleCode, targetRoleCode, allowed),
  setMessagingScope: (userId, scope, roleCode, allowed) => ipcRenderer.invoke('messaging:setScope', userId, scope, roleCode, allowed),
  getContactableUsers: (userId) => ipcRenderer.invoke('messaging:getContacts', userId),
  getDirectConversations: (userId) => ipcRenderer.invoke('messaging:getConversations', userId),
  openDirectConversation: (userId, otherUserId) => ipcRenderer.invoke('messaging:openConversation', userId, otherUserId),
  getDirectConversation: (userId, conversationId) => ipcRenderer.invoke('messaging:getConversation', userId, conversationId),
  sendDirectMessage: (userId, conversationId, body) => ipcRenderer.invoke('messaging:send', userId, conversationId, body),
  getUnreadDirectCount: (userId) => ipcRenderer.invoke('messaging:getUnread', userId),
  touchLastSeen: (userId) => ipcRenderer.invoke('presence:heartbeat', userId),
  getAbsenceJustifications: () => ipcRenderer.invoke('absences:getJustifications'),
  getAbsencesForSession: (sessionId) => ipcRenderer.invoke('absences:getForSession', sessionId),
  getSessionStudentsForAbsence: (sessionId) => ipcRenderer.invoke('absences:getSessionStudents', sessionId),
  markStudentAbsent: (data) => ipcRenderer.invoke('absences:markAbsent', data),
  // `expectedAbsence` is the row the teacher saw, so the offline queue can tell
  // an ordinary send from an attempt to overwrite a colleague's change.
  markStudentPresent: (userId, studentId, sessionId, expectedAbsence) =>
    ipcRenderer.invoke('absences:markPresent', userId, studentId, sessionId, expectedAbsence),
  getTeacherActiveSession: (instructorId, currentDate, currentTime) => ipcRenderer.invoke('absences:getTeacherActiveSession', instructorId, currentDate, currentTime),
  getTeacherCurrentSession: (instructorId) => ipcRenderer.invoke('absences:getTeacherCurrentSession', instructorId),
  getTeacherSessionsForPeriod: (instructorId) => ipcRenderer.invoke('absences:getTeacherSessionsForPeriod', instructorId),
  getStudentAbsenceHistory: (personId, filters) => ipcRenderer.invoke('absences:getStudentHistory', personId, filters),
  getGlobalAbsenceHistory: (filters) => ipcRenderer.invoke('absences:getGlobalHistory', filters),
  getObservationMotifs: () => ipcRenderer.invoke('observations:getMotifs'),
  getObservationsForSession: (sessionId) => ipcRenderer.invoke('observations:getForSession', sessionId),
  createObservation: (data) => ipcRenderer.invoke('observations:create', data),
  deleteObservation: (data) => ipcRenderer.invoke('observations:delete', data),
  deleteStudentObservationsForSession: (studentId, sessionId) => ipcRenderer.invoke('observations:deleteStudentForSession', studentId, sessionId),
  getStudentObservationHistory: (personId, filters) => ipcRenderer.invoke('observations:getStudentHistory', personId, filters),
  getGlobalObservationHistory: (filters) => ipcRenderer.invoke('observations:getGlobalHistory', filters),

  // Student profile editor (secretary)
  getProfileLookups: () => ipcRenderer.invoke('profile:getLookups'),
  getProfileWilayas: (countryId) => ipcRenderer.invoke('profile:getWilayas', countryId),
  getProfileDairas: (wilayaId) => ipcRenderer.invoke('profile:getDairas', wilayaId),
  getProfileCommunes: (dairaId) => ipcRenderer.invoke('profile:getCommunes', dairaId),
  // Teaching-category responsibility: which categories a secretary manages.
  getMyTeachingScope: (userId) => ipcRenderer.invoke('scope:getMine', userId),
  setAccountCategories: (userId, accountUserId, categoryIds) => ipcRenderer.invoke('scope:setAccountCategories', userId, accountUserId, categoryIds),
  // Scheduler department responsibility: which departments' schedules an account manages.
  setAccountDepartments: (userId, accountUserId, departmentIds) => ipcRenderer.invoke('scope:setAccountDepartments', userId, accountUserId, departmentIds),
  // Secretary accounts page (Admin): the roster, the account fields and the
  // six rewards-and-punishments rights stored in secretary_detail, plus the
  // six global master switches stored in app_option.
  getAccounts: (userId) => ipcRenderer.invoke('accounts:getAll', userId),
  setAccountActive: (userId, targetUserId, active) => ipcRenderer.invoke('accounts:setActive', userId, targetUserId, active),
  updateAccount: (userId, targetUserId, data) => ipcRenderer.invoke('accounts:update', userId, targetUserId, data),
  // People an account may be created for, narrowed by name or person id, and
  // the creation itself (Admin/Developer, re-checked in the service).
  searchAccountCandidates: (userId, term) => ipcRenderer.invoke('accounts:searchCandidates', userId, term),
  createAccount: (userId, data) => ipcRenderer.invoke('accounts:create', userId, data),
  // Register a person and open their account in one step (Admin/Developer).
  createPersonWithAccount: (userId, data) => ipcRenderer.invoke('accounts:createWithPerson', userId, data),
  getSecretaries: (userId) => ipcRenderer.invoke('secretaries:get', userId),
  updateSecretaryAccount: (userId, secretaryUserId, data) => ipcRenderer.invoke('secretaries:updateAccount', userId, secretaryUserId, data),
  setSecretaryPermissions: (userId, secretaryUserId, permissions) => ipcRenderer.invoke('secretaries:setPermissions', userId, secretaryUserId, permissions),
  getConductGlobalRights: (userId) => ipcRenderer.invoke('secretaries:getConductGlobalRights', userId),
  setConductGlobalRights: (userId, rights) => ipcRenderer.invoke('secretaries:setConductGlobalRights', userId, rights),
  getStudentProfile: (userId, personId) => ipcRenderer.invoke('profile:getStudentProfile', userId, personId),
  getStudentRecordOptions: () => ipcRenderer.invoke('profile:getStudentRecordOptions'),
  createStudentProfile: (userId, data) => ipcRenderer.invoke('profile:createStudent', userId, data),
  // Printable student report (Director): asks for sections + language, then saves a PDF.
  generateStudentReportPdf: (userId, personId, options) => ipcRenderer.invoke('reports:studentPdf', userId, personId, options),
  updateStudentProfileDetail: (userId, personId, data) => ipcRenderer.invoke('profile:updateDetail', userId, personId, data),
  // Live uniqueness check while a student's identifiers are being typed.
  checkStudentIdentifiers: (userId, personId, data) => ipcRenderer.invoke('profile:checkIdentifiers', userId, personId, data),
  updateStudentProfileIdentity: (userId, personId, data) => ipcRenderer.invoke('profile:updateIdentity', userId, personId, data),
  updateStudentProfileParents: (userId, serial, data) => ipcRenderer.invoke('profile:updateParents', userId, serial, data),
  addStudentEmergencyContact: (userId, serial, data) => ipcRenderer.invoke('profile:addEmergencyContact', userId, serial, data),
  updateStudentEmergencyContact: (userId, contactId, data) => ipcRenderer.invoke('profile:updateEmergencyContact', userId, contactId, data),
  deleteStudentEmergencyContact: (userId, contactId) => ipcRenderer.invoke('profile:deleteEmergencyContact', userId, contactId),
  setStudentProfileHobbies: (userId, serial, hobbyIds) => ipcRenderer.invoke('profile:setHobbies', userId, serial, hobbyIds),
  updateStudentCombatOutfit: (userId, serial, data) => ipcRenderer.invoke('profile:updateCombatOutfit', userId, serial, data),
  updateStudentParadeUniform: (userId, serial, data) => ipcRenderer.invoke('profile:updateParadeUniform', userId, serial, data),
  // The sizes a student may be issued (Settings -> Registers -> Uniform sizes).
  // Reading is open to signed-in accounts; the last three are Admin-only and
  // re-check the role server-side.
  getUniformSizeOptions: () => ipcRenderer.invoke('uniformSizes:getOptions'),
  createUniformSizeOption: (userId, data) => ipcRenderer.invoke('uniformSizes:createOption', userId, data),
  updateUniformSizeOption: (userId, id, data) => ipcRenderer.invoke('uniformSizes:updateOption', userId, id, data),
  deleteUniformSizeOption: (userId, id) => ipcRenderer.invoke('uniformSizes:deleteOption', userId, id),
  updateStudentPersonalAddress: (userId, personId, data) => ipcRenderer.invoke('profile:updatePersonalAddress', userId, personId, data),
  // Display language for database labels (the interface language itself is
  // applied in the renderer from localStorage).
  setLanguage: (language) => ipcRenderer.invoke('i18n:setLanguage', language),
  // Custom title bar controls.
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowMaximized: (callback) => {
    const listener = (_event, maximized) => callback(maximized)
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
