import React, { useState, useEffect, useCallback } from 'react'
import { Database, RefreshCw, Play, CheckCircle2, XCircle, Loader2, Table2, Server, User } from 'lucide-react'
import { PageIntro } from './ui/PageHeader'
import DataTable from './ui/DataTable'
import { tr } from '../i18n'

const DatabasePage = ({ user }) => {
  // Route + server allow the Admin and Developer roles; this is a courtesy
  // flag so the config panel does not query when it may not.
  const canAccess = !!user && (user.roles?.includes('ADMIN') || user.roles?.includes('DEVELOPER'))
  const [config, setConfig] = useState(null)
  const [status, setStatus] = useState({ checking: true, connected: false, source: '', error: '' })
  const [tables, setTables] = useState([])
  const [sql, setSql] = useState('SELECT * FROM major_category LIMIT 20')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const checkConnection = useCallback(async () => {
    setStatus(prev => ({ ...prev, checking: true, error: '' }))
    try {
      const res = await window.api.dbStatus()
      setStatus({ checking: false, connected: res.connected, source: res.source || '', error: res.error || '' })
    } catch (err) {
      setStatus({ checking: false, connected: false, source: '', error: err.message || tr('Connection failed') })
    }
  }, [])

  const loadConfig = useCallback(async () => {
    if (!canAccess) return
    try {
      const cfg = await window.api.getDbConfig(user.id)
      setConfig(cfg)
    } catch (err) {
      console.error('Failed to load DB config', err)
    }
  }, [canAccess, user?.id])

  const loadTables = useCallback(async () => {
    if (!canAccess) return
    try {
      const res = await window.api.query(
        user.id,
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
      )
      setTables(res.data || [])
    } catch (err) {
      console.error('Failed to load tables', err)
    }
  }, [canAccess, user?.id])

  useEffect(() => {
    checkConnection()
    loadConfig()
    loadTables()
  }, [checkConnection, loadConfig, loadTables])

  const handleRunQuery = async () => {
    if (!sql.trim()) return
    setRunning(true)
    setError('')
    setResult(null)
    try {
      const res = await window.api.query(user.id, sql)
      setResult({ source: res.source, data: res.data || [], rowCount: res.rowCount })
    } catch (err) {
      setError(err.message || tr('Query failed'))
    }
    setRunning(false)
  }

  const columns = result?.data?.length > 0 ? Object.keys(result.data[0]) : []

  return (
    <div className="space-y-6">
      <PageIntro
        kicker={tr('System')}
        title={tr('Database')}
        actions={
          <button
            onClick={() => { checkConnection(); loadTables() }}
            className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
          >
            <RefreshCw size={12} /> {tr('Refresh')}
          </button>
        }
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">{tr('Connection status and SQL query console')}</p>
      </PageIntro>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Connection status */}
        <div className="bg-white rounded-md border border-line p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Database className="text-blue-600" size={20} />
            <h2 className="text-lg font-semibold">{tr("Connection Status")}</h2>
          </div>

          {status.checking ? (
            <div className="flex items-center text-ink-3 text-[12.5px]">
              <Loader2 size={16} className="mr-2 animate-spin" />{' '}{tr("Checking...")}</div>
          ) : status.connected ? (
            <div className="space-y-3">
              <div className="flex items-center text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md px-3 py-2 text-[12.5px] font-semibold">
                <CheckCircle2 size={16} className="mr-2 text-emerald-500" />{' '}{tr("Connected")}</div>
              <div className="text-[11px] text-ink-3">{tr("Source:")}{' '}<span className="font-medium text-ink-2">{status.source}</span></div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2 text-[12.5px] font-semibold">
                <XCircle size={16} className="mr-2 text-red-500" />{' '}{tr("Not connected")}</div>
              <div className="text-[11px] text-red-600 break-words">{status.error}</div>
            </div>
          )}
        </div>

        {/* Saved config */}
        <div className="bg-white rounded-md border border-line p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Server className="text-blue-600" size={20} />
            <h2 className="text-lg font-semibold">{tr("Connection Config")}</h2>
          </div>
          {config ? (
            <div className="space-y-2.5 text-[12.5px]">
              <div className="flex justify-between">
                <span className="text-ink-3">{tr("Host")}</span>
                <span className="font-medium text-ink-2">{config.host}:{config.port}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-3">{tr("User")}</span>
                <span className="font-medium text-ink-2 flex items-center"><User size={13} className="mr-1" />{config.user}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-3">{tr("Database")}</span>
                <span className="font-medium text-ink-2">{config.database}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-3">{tr("Password")}</span>
                <span className="font-medium text-ink-2">{config.password ? '••••••' : tr('(none)')}</span>
              </div>
            </div>
          ) : (
            <div className="text-[12.5px] text-ink-3">{tr("No saved config.")}</div>
          )}
        </div>

        {/* Tables */}
        <div className="bg-white rounded-md border border-line p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Table2 className="text-blue-600" size={20} />
            <h2 className="text-lg font-semibold">{tr("Tables")}</h2>
            <span className="ml-auto text-[11px] text-ink-3 bg-surface-muted rounded-full px-2 py-0.5">{tables.length}</span>
          </div>
          <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
            {tables.length === 0 ? (
              <div className="text-[12.5px] text-ink-3 italic">{tr("No tables found.")}</div>
            ) : (
              tables.map((t, i) => (
                <button
                  key={t.TABLE_NAME || i}
                  onClick={() => setSql(`SELECT * FROM ${t.TABLE_NAME} LIMIT 50`)}
                  className="w-full text-left px-3 py-1.5 rounded-md text-[12.5px] text-ink-2 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                >
                  {t.TABLE_NAME}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Query console */}
      <div className="bg-white rounded-md border border-line overflow-hidden">
        <div className="p-4 border-b border-line bg-surface-muted">
          <h2 className="kicker">{tr("Query Console")}</h2>
        </div>
        <div className="p-4 space-y-4">
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            rows={4}
            spellCheck={false}
            className="w-full p-3 border rounded-md mono text-[12.5px] bg-surface-muted focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            placeholder={tr("Enter SQL query...")}
          />
          <div className="flex items-center justify-between">
            <button
              onClick={handleRunQuery}
              disabled={running || !sql.trim()}
              className="flex items-center px-5 py-2.5 bg-jade-solid text-on-jade text-[12.5px] font-semibold rounded-md hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {running ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Play size={16} className="mr-2" />}{' '}{tr("Run Query")}</button>
            {result && (
              <span className="text-[11px] text-ink-3">
                {columns.length > 0
                  ? `${result.data.length} row${result.data.length === 1 ? '' : 's'} returned`
                  : `${result.rowCount ?? 0} row(s) affected`}
              </span>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-[12.5px] mono break-words">
              {error}
            </div>
          )}

          {columns.length > 0 && (
            <div className="overflow-x-auto border rounded-md">
              <DataTable
                bodyClassName="divide-y divide-line"
                className="w-full text-left border-collapse"
                head={<><tr className="bg-surface-muted text-ink-2 text-[11px] uppercase tracking-wider">
                    {columns.map(col => (
                      <th scope="col" key={col} className="px-4 py-2.5 font-semibold whitespace-nowrap">{col}</th>
                    ))}
                  </tr></>}
              >
                  {result.data.slice(0, 100).map((row, i) => (
                    <tr key={i} className="hover:bg-surface-muted">
                      {columns.map(col => (
                        <td key={col} className="px-4 py-2 text-[12.5px] text-ink-2 whitespace-nowrap">
                          {String(row[col] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
              </DataTable>
              {result.data.length > 100 && (
                <div className="px-4 py-2 text-[11px] text-ink-3 border-t border-line">{tr("Showing first 100 of")}{' '}{result.data.length}{' '}{tr("rows")}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default DatabasePage