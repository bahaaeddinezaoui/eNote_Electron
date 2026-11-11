import React, { useState } from 'react'
import { Bug, ListChecks } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageIntro } from './ui/PageHeader'
import { tr } from '../i18n'
import ReportBugDialog from './ReportBugDialog'
import { MyBugReportList } from './MyBugReports'

const ReportBug = ({ user }) => {
  const [composeOpen, setComposeOpen] = useState(false)
  // Bumped on every submission so the list below reloads with the new report.
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-3xl">
      <PageIntro
        kicker={tr('Support')}
        title={tr('Report a Bug')}
        actions={
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-jade-solid px-3 text-[11.5px] font-semibold text-on-jade hover:brightness-110"
            style={{ color: 'var(--color-on-jade)' }}
          >
            <Bug size={13} /> {tr('Report a bug')}
          </button>
        }
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {tr('Found something broken? Describe it below and the team will take a look.')}
        </p>
      </PageIntro>

      <ReportBugDialog
        user={user}
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSubmitted={() => setRefreshKey((value) => value + 1)}
      />

      <div className="flex justify-end">
        <Link
          to="/my-bug-reports"
          className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-jade-600 hover:text-jade-700"
        >
          <ListChecks size={13} /> {tr('My bug reports')}
        </Link>
      </div>

      {/* What happened to the reports this account submitted */}
      <MyBugReportList user={user} refreshKey={refreshKey} />
    </div>
  )
}

export default ReportBug
