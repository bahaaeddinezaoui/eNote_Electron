import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { tr } from './i18n'
import Layout from './components/Layout'
import Login from './components/Login'
import ErrorBoundary from './components/ErrorBoundary'
import Landing from './components/Landing'
import UpdateRequired from './components/UpdateRequired'

// Page modules load on first visit: each route is its own chunk, so the shell
// paints from a small bundle instead of the whole application. A route chunk
// arrives after the first paint, so the placeholder holds the page's shape and
// says once, to a screen reader, that the page is coming.
const Dashboard = lazy(() => import('./components/Dashboard'))
const Teachers = lazy(() => import('./components/Teachers'))
const Schedule = lazy(() => import('./components/Schedule'))
const TeacherSchedule = lazy(() => import('./components/TeacherSchedule'))
const StudentSchedule = lazy(() => import('./components/StudentSchedule'))
const StudentMarks = lazy(() => import('./components/StudentMarks'))
const Lessons = lazy(() => import('./components/Lessons'))
const Library = lazy(() => import('./components/Library'))
const Academic = lazy(() => import('./components/Academic'))
const Majors = lazy(() => import('./components/Majors'))
const Sections = lazy(() => import('./components/Sections'))
const Promotions = lazy(() => import('./components/Promotions'))
const Absences = lazy(() => import('./components/Absences'))
const Observations = lazy(() => import('./components/Observations'))
const ConsultRecords = lazy(() => import('./components/ConsultRecords'))
const SessionRecords = lazy(() => import('./components/SessionRecords'))
const TeacherAttendance = lazy(() => import('./components/TeacherAttendance'))
const StudentHistory = lazy(() => import('./components/StudentHistory'))
const GlobalHistory = lazy(() => import('./components/GlobalHistory'))
const StudentProfile = lazy(() => import('./components/StudentProfile'))
const Examinations = lazy(() => import('./components/Examinations'))
const ExamMarks = lazy(() => import('./components/ExamMarks'))
const AdminStatistics = lazy(() => import('./components/AdminStatistics'))
const DatabasePage = lazy(() => import('./components/DatabasePage'))
const SettingsPage = lazy(() => import('./components/SettingsPage'))
const Secretaries = lazy(() => import('./components/Secretaries'))
const ReportBug = lazy(() => import('./components/ReportBug'))
const MyBugReports = lazy(() => import('./components/MyBugReports'))
const BugReports = lazy(() => import('./components/BugReports'))
const Changelog = lazy(() => import('./components/Changelog'))
const Profile = lazy(() => import('./components/Profile'))
const RewardsPunishments = lazy(() => import('./components/RewardsPunishments'))
const InboxPage = lazy(() => import('./components/Inbox'))
const DirectMessages = lazy(() => import('./components/DirectMessages'))
const Notifications = lazy(() => import('./components/Notifications'))
const BetaTestReports = lazy(() => import('./components/BetaTestReports'))
const BetaTestAdmin = lazy(() => import('./components/BetaTestAdmin'))
const Accounts = lazy(() => import('./components/Accounts'))
const SuspendedAccounts = lazy(() => import('./components/SuspendedAccounts'))
const UserSessions = lazy(() => import('./components/UserSessions'))
const AuditLog = lazy(() => import('./components/AuditLog'))

function RouteLoading() {
  return (
    <div role="status" aria-live="polite" className="px-5 py-6">
      <span className="sr-only">{tr('Loading...')}</span>
      <div aria-hidden="true" className="space-y-2">
        {[92, 64, 80, 70, 88].map((width, index) => (
          <div
            key={index}
            className="h-[var(--row-h)] rounded-[2px] border border-line bg-surface-muted"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(null)
  // `checked` separates "not asked yet" from "asked, and the server is away":
  // the offline strip must not flash while the first check is still running.
  const [dbStatus, setDbStatus] = useState({ connected: false, checked: false, source: 'Checking...' })
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [isLoading, setIsLoading] = useState(true)
  // Set when the shared database requires a newer client than this one is
  // running; then the whole application is replaced by the update screen.
  const [updateStatus, setUpdateStatus] = useState(null)
  // Read by the poll below, which runs outside the render that created it.
  const userRef = useRef(user)
  const wasConnected = useRef(null)
  useEffect(() => {
    userRef.current = user
  }, [user])

  // Reachability is a question for the database, not for the browser: on a LAN
  // `navigator.onLine` says whether the internet is reachable, which has
  // nothing to do with whether the server answers. The reply also carries what
  // this computer has saved and when, which is the "as of" time shown offline.
  const checkDb = async () => {
    try {
      const result = await window.api.dbStatus()
      const connected = !!result.connected
      setDbStatus({
        connected,
        checked: true,
        source: result.source || `Error: ${result.error}`,
        lastSyncAt: result.lastSyncAt || null,
        cache: result.cache || null
      })

      // Back from an outage: re-read the account, so a role or a name changed
      // while this window was reading saved records takes effect immediately.
      if (wasConnected.current === false && connected && userRef.current) {
        refreshSession(userRef.current)
      }
      wasConnected.current = connected
    } catch (error) {
      setDbStatus({ connected: false, checked: true, source: `Error: ${error.message}` })
      wasConnected.current = false
    }
  }

  // A check that fails (the database is briefly unreachable) leaves the client
  // running: an outage must never be reported as "update required".
  const checkUpdate = async () => {
    try {
      const status = await window.api.getUpdateStatus()
      setUpdateStatus(status?.required ? status : null)
    } catch {
      setUpdateStatus(null)
    }
  }

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    checkDb()
    checkUpdate()
    // A release published while the application stays open reaches every
    // window through this push, checked on a timer in the main process.
    const unsubscribeUpdate = window.api.onUpdateRequired?.((status) => {
      setUpdateStatus(status?.required ? status : null)
    })

    // The stored session is re-checked before any page renders: a page opened
    // against a session whose roles or account are out of date fires calls the
    // account no longer allows, and shows their errors.
    const restoreSession = async () => {
      const savedUser = localStorage.getItem('user')
      if (savedUser) {
        try {
          const stored = JSON.parse(savedUser)
          // A session stored by an older build carries the merged role list.
          // Navigation reads `roles`, so narrow it to the account role before
          // the first render; refreshSession then replaces it from the database.
          const session = stored.accountRole ? { ...stored, roles: [stored.accountRole] } : stored

          // A stored window is a claim like the stored account is: it may have
          // been ended from another session while this one was closed. Ask the
          // database before letting it back in. A database that cannot answer
          // is an outage, not a sign-out, so only an explicit "ended" refuses.
          if (session?.id) {
            if (session.sessionId) {
              const pulse = await window.api
                .heartbeatUserSession(session.id, session.sessionId)
                .catch(() => null)
              if (pulse && pulse.active === false) {
                localStorage.removeItem('user')
                setIsLoading(false)
                return
              }
            } else {
              // A session stored before user sessions existed: adopt it into a
              // new row so the page and the heartbeat have something to read.
              try {
                const started = await window.api.startUserSession(session.id)
                if (started?.sessionId) {
                  session.sessionId = started.sessionId
                  localStorage.setItem('user', JSON.stringify(session))
                }
              } catch {
                // Session tracking is optional for a restored local session.
              }
            }
          }

          setUser(session)
          await refreshSession(session)
        } catch {
          // Unreadable session payload: nothing to restore from it.
          localStorage.removeItem('user')
        }
      }
      setIsLoading(false)
    }
    restoreSession()

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      if (typeof unsubscribeUpdate === 'function') unsubscribeUpdate()
    }
  }, [])

  // A steady check while the window is open, plus one whenever it regains
  // focus: that is how the offline strip appears and disappears without asking
  // the user to refresh, and how a reconnected server is noticed.
  useEffect(() => {
    const timer = window.setInterval(checkDb, 20000)
    const onFocus = () => checkDb()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // A stored session is a claim, not a fact: the account behind it can be gone
  // (the database restored from a dump, the account deleted). Pages that
  // re-check the account — the inbox, notifications, the profile — would then
  // fail with "User not found." one by one. Re-validate here instead, and take
  // the fresh roles from the database so a revoked role stops being assumed.
  const refreshSession = async (stored) => {
    try {
      const result = await window.api.getMyProfile(stored.id)
      const profile = result?.profile
      if (!profile) return
      const next = {
        ...stored,
        id: profile.userId ?? stored.id,
        personId: profile.personId ?? stored.personId,
        username: profile.username ?? stored.username,
        email: profile.email ?? stored.email,
        // The chrome names the account by these two, so a session restored from
        // the stored copy is completed here as well.
        firstName: profile.firstName ?? stored.firstName,
        lastName: profile.lastName ?? stored.lastName,
        // The database is the authority on the account role, so a revoked role
        // is dropped here rather than kept from the stored copy.
        accountRole: profile.accountRole ?? stored.accountRole ?? null,
        roles: Array.isArray(profile.roles) ? profile.roles : (stored.roles || []),
        // Descriptive only; no route or nav decision reads these.
        personRoles: profile.personRoles ?? stored.personRoles ?? [],
        isTeacher: profile.isTeacher ?? stored.isTeacher ?? false,
        isStudent: profile.isStudent ?? stored.isStudent ?? false
      }
      setUser(next)
      localStorage.setItem('user', JSON.stringify(next))
    } catch (error) {
      // Only a missing account invalidates the session. A database that is
      // briefly unreachable must not sign anybody out.
      if (/user not found/i.test(error?.message || '')) {
        setUser(null)
        localStorage.removeItem('user')
      }
    }
  }

  // The signed-in window tells the server it is still here. An explicit end —
  // from this page or from an administrator's list — comes back as active:false,
  // and that window signs itself out. A failed pulse is an outage, not an end,
  // so the local session is kept.
  useEffect(() => {
    if (!user?.id || !user?.sessionId) return undefined

    let cancelled = false
    const beat = async () => {
      try {
        const pulse = await window.api.heartbeatUserSession(user.id, user.sessionId)
        if (!cancelled && pulse && pulse.active === false) {
          setUser(null)
          localStorage.removeItem('user')
        }
      } catch {
        // The database could not be reached: keep the local session.
      }
    }
    const timer = setInterval(beat, 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [user?.id, user?.sessionId])

  const handleLogin = (userData) => {
    setUser(userData)
    localStorage.setItem('user', JSON.stringify(userData))
  }

  const handleLogout = () => {
    const current = user
    // Clear the window first: signing out must never wait for the database.
    setUser(null)
    localStorage.removeItem('user')
    if (current?.id && current?.sessionId) {
      window.api.endUserSession(current.id, current.sessionId).catch(() => {})
    }
  }

  if (isLoading) {
    return null
  }

  // The gate sits above the router, so an outdated client never reaches the
  // sign-in screen or any page: it must be replaced first.
  if (updateStatus?.required) {
    return <UpdateRequired status={updateStatus} onRecheck={checkUpdate} />
  }

  return (
    <Router>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
        {/* Public landing page: the first screen before sign-in. */}
        <Route
          path="/welcome"
          element={user ? <Navigate to="/" /> : <Landing />}
        />

        <Route 
          path="/login" 
          element={user ? <Navigate to="/" /> : <Login onLogin={handleLogin} />} 
        />
        
        <Route 
          path="/" 
          element={
            user ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <Dashboard
                  user={user}
                  isOnline={dbStatus.checked ? dbStatus.connected : isOnline}
                  dbStatus={dbStatus}
                />
              </Layout>
            ) : (
              <Navigate to="/welcome" />
            )
          } 
        />

        <Route 
          path="/students" 
          element={<Navigate to="/student-records" replace />} 
        />

        <Route 
          path="/teachers" 
          element={
            user && user.roles.includes('ADMIN') ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <Teachers user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        <Route 
          path="/schedule" 
          element={
            user && (
              user.roles.includes('ADMIN') || user.roles.includes('SCHEDULER')
            ) ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <Schedule user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        <Route 
          path="/teacher-schedule" 
          element={
            user && user.roles.includes('TEACHER') ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <TeacherSchedule user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        <Route 
          path="/absences" 
          element={
            user && user.roles.includes('TEACHER') ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <Absences user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        <Route 
          path="/observations" 
          element={
            user && user.roles.includes('TEACHER') ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <Observations user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        <Route
          path="/notifications"
          element={
            // Notifications are per person now: an absence for a director, a
            // missed class for its teacher, inbox mail or a direct message for
            // any account. Every signed-in account can open the page.
            user ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <Notifications user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route 
          path="/records" 
          element={
            user && (user.roles.includes('DIRECTOR') || user.roles.includes('ADMIN')) ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <ConsultRecords user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        {/* Study sessions with their absences and observations: the oversight
            view shared by Admin and Director. */}
        <Route
          path="/session-records"
          element={
            user && (user.roles.includes('ADMIN') || user.roles.includes('DIRECTOR')) ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <SessionRecords user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/teacher-attendance"
          element={
            user && (user.roles.includes('ADMIN') || user.roles.includes('DIRECTOR')) ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <TeacherAttendance user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/report-bug"
          element={
            user ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <ReportBug user={user} />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        {/* The reporter's own queue: what this account sent and where each
            report stands. Every signed-in account has it, whatever its role. */}
        <Route
          path="/my-bug-reports"
          element={
            user ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <MyBugReports user={user} />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        <Route
          path="/bug-reports"
          element={
            user && (
              user.roles.includes('ADMIN') || user.roles.includes('DEVELOPER')
            ) ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <BugReports user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/changelog"
          element={
            user ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <Changelog user={user} />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        <Route
          path="/profile"
          element={
            user ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <Profile user={user} />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        <Route
          path="/rewards-punishments"
          element={
            user && (
              user.roles.includes('SECRETARY') || user.roles.includes('ADMIN')
            ) ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <RewardsPunishments user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/student-records"
          element={
            user && (
              user.roles.includes('ADMIN') ||
              user.roles.includes('SECRETARY') ||
              user.roles.includes('TEACHER') ||
              user.roles.includes('DIRECTOR')
            ) ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <StudentProfile user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/messages"
          element={
            user ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <DirectMessages user={user} />
              </Layout>
            ) : (
              <Navigate to="/welcome" />
            )
          }
        />

        <Route
          path="/inbox"
          element={
            user ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <InboxPage user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/beta-tests"
          element={
            user && user.isBetaTester ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <BetaTestReports user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/accounts"
          element={
            user && (user.roles.includes('ADMIN') || user.roles.includes('DEVELOPER')) ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <Accounts user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/suspended-accounts"
          element={
            user && user.roles.includes('ADMIN') ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <SuspendedAccounts user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/beta-test-reports"
          element={
            user && (user.roles.includes('ADMIN') || user.roles.includes('DEVELOPER')) ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <BetaTestAdmin user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/student-history"
          element={
            user && (user.roles.includes('DIRECTOR') || user.roles.includes('ADMIN')) ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <StudentHistory user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/global-history"
          element={
            user && (user.roles.includes('DIRECTOR') || user.roles.includes('ADMIN')) ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <GlobalHistory />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />


        <Route
          path="/statistics"
          element={
            user && user.roles.includes('ADMIN') ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <ErrorBoundary>
                  <AdminStatistics user={user} />
                </ErrorBoundary>
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route 
          path="/student-schedule" 
          element={
            user && user.roles.includes('STUDENT') ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <StudentSchedule user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        <Route 
          path="/student-marks" 
          element={
            user && user.roles.includes('STUDENT') ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <StudentMarks user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        <Route 
          path="/lessons" 
          element={
            user && (
              user.roles.includes('ADMIN') ||
              user.roles.includes('TEACHER') ||
              user.roles.includes('STUDENT')
            ) ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <Lessons user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        {/* The page was called Documents before it grew videos: keep the old
            link working for bookmarks and any window still pointing at it. */}
        <Route path="/documents" element={<Navigate to="/lessons" replace />} />

        <Route
          path="/library"
          element={
            user && (
              user.roles.includes('ADMIN') ||
              user.roles.includes('TEACHER') ||
              user.roles.includes('STUDENT') ||
              user.roles.includes('DIRECTOR') ||
              user.roles.includes('DEVELOPER')
            ) ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <Library user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/academic"
          element={
            user && user.roles.includes('ADMIN') ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <ErrorBoundary>
                  <Academic />
                </ErrorBoundary>
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route 
          path="/majors" 
          element={
            user && user.roles.includes('ADMIN') ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <Majors />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        <Route 
          path="/promotions" 
          element={
            user && user.roles.includes('ADMIN') ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <Promotions />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        <Route 
          path="/sections" 
          element={
            user && user.roles.includes('ADMIN') ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <Sections user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        <Route 
          path="/teaching-categories" 
          element={
            user && user.roles.includes('ADMIN') ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <Navigate to="/settings" replace />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        <Route 
          path="/classrooms" 
          element={
            user && user.roles.includes('ADMIN') ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <Navigate to="/settings" replace />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        <Route 
          path="/session-types" 
          element={
            user && user.roles.includes('ADMIN') ? (
              <Layout 
                user={user} 
                onLogout={handleLogout} 
                isOnline={isOnline} 
                dbStatus={dbStatus}
              >
                <Navigate to="/settings" replace />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          } 
        />

        <Route
          path="/academic-grades"
          element={
            user && user.roles.includes('ADMIN') ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <Navigate to="/settings" replace />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/grades"
          element={
            user && user.roles.includes('ADMIN') ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <Navigate to="/settings" replace />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/exam-marks"
          element={
            user && (user.roles.includes('TEACHER') || user.roles.includes('ADMIN')) ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <ExamMarks user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/exams"
          element={
            user && user.roles.includes('ADMIN') ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <Examinations user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/exam-types"
          element={
            user && user.roles.includes('ADMIN') ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <Navigate to="/settings" replace />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/database"
          element={
            user && (user.roles.includes('ADMIN') || user.roles.includes('DEVELOPER')) ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <DatabasePage user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/secretaries"
          element={
            user ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <Secretaries user={user} />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        <Route
          path="/audit-log"
          element={
            user && (user.roles.includes('ADMIN') || user.roles.includes('DEVELOPER')) ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <AuditLog user={user} />
              </Layout>
            ) : (
              <Navigate to="/" />
            )
          }
        />

        <Route
          path="/sessions"
          element={
            user ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <UserSessions user={user} onLogout={handleLogout} />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        <Route
          path="/settings"
          element={
            user ? (
              <Layout
                user={user}
                onLogout={handleLogout}
                isOnline={isOnline}
                dbStatus={dbStatus}
              >
                <SettingsPage user={user} />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        </Routes>
      </Suspense>
    </Router>
  )
}

export default App
