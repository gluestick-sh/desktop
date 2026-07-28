import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ClearActivityLogByTimeRange,
  DeleteActivityLog,
  GetActivityLogPage,
} from '../wailsjs/go/main/App'
import type { main } from '../wailsjs/go/models'
import ModalCloseButton from './ModalCloseButton'
import ModalOverlay from './ModalOverlay'
import ListPagination from './ListPagination'
import TableIconButton from './TableIconButton'
import { logStatusClassName } from './logStatus'
import {
  formatActivityErrorDetail,
  formatActivityOperation,
  formatActivityStatus,
  formatActivitySubject,
} from './i18n/activityLog'
import PackageDataTable, { type PackageDataTableColumn } from './PackageDataTable'
import './ActivityLogPanel.css'

export type ActivityTimeRange = 'all' | 'today' | 'week' | 'month'

type ClearScope = 'filter' | 'all'

function formatLogTime(raw: string, locale: string, dash: string): string {
  if (!raw) return dash
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  return d.toLocaleString(locale)
}

interface ActivityLogPanelProps {
  refreshKey: number
  pageSize: number
  listScrollRef?: RefObject<HTMLDivElement | null>
  onCleared?: (deleted: number) => void
}

export default function ActivityLogPanel({
  refreshKey,
  pageSize,
  listScrollRef,
  onCleared,
}: ActivityLogPanelProps) {
  const { t, i18n } = useTranslation()
  const timeFilters = useMemo(
    () =>
      ([
        { value: 'all', label: t('activity.timeAll') },
        { value: 'today', label: t('activity.timeToday') },
        { value: 'week', label: t('activity.timeWeek') },
        { value: 'month', label: t('activity.timeMonth') },
      ] as const),
    [t],
  )
  const timeRangeLabel = (range: ActivityTimeRange) =>
    timeFilters.find((f) => f.value === range)?.label ?? range
  const [timeRange, setTimeRange] = useState<ActivityTimeRange>('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<main.ActivityLogPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<main.ActivityLogEntry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [clearScope, setClearScope] = useState<ClearScope>('filter')
  const [allLogTotal, setAllLogTotal] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)

  const loadPageAt = useCallback(async (targetPage: number) => {
    setLoading(true)
    setError(null)
    try {
      const result = await GetActivityLogPage({
        timeRange,
        page: targetPage,
        pageSize,
      })
      setData(result)
      setPage(targetPage)
    } catch (err) {
      console.error('Failed to load activity log:', err)
      setError(t('activityExt.loadFailed', { error: String(err) }))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [timeRange, pageSize, t])

  const loadPage = useCallback(async () => {
    await loadPageAt(page)
  }, [loadPageAt, page])

  useEffect(() => {
    void loadPage()
  }, [loadPage])

  useEffect(() => {
    if (refreshKey === 0) return
    void loadPageAt(1)
  }, [refreshKey, loadPageAt])

  useEffect(() => {
    setPage(1)
  }, [pageSize])

  useEffect(() => {
    if (!showClearDialog) {
      setAllLogTotal(null)
      setClearScope('filter')
      return
    }
    if (timeRange === 'all') {
      setAllLogTotal(data?.total ?? null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await GetActivityLogPage({ timeRange: 'all', page: 1, pageSize: 1 })
        if (!cancelled) setAllLogTotal(result.total)
      } catch {
        if (!cancelled) setAllLogTotal(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showClearDialog, timeRange, data?.total])

  const handleTimeRangeChange = (range: ActivityTimeRange) => {
    setTimeRange(range)
    setPage(1)
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const canPrev = page > 1
  const canNext = data ? page < totalPages : false

  const handleOpenClearDialog = () => {
    setShowClearDialog(true)
  }

  const handleConfirmClear = async () => {
    const targetRange: ActivityTimeRange = clearScope === 'all' ? 'all' : timeRange
    const deleteCount = clearScope === 'all' ? allLogTotal : data?.total
    if (deleteCount === 0) {
      setShowClearDialog(false)
      return
    }

    setClearing(true)
    setError(null)
    try {
      const deleted = await ClearActivityLogByTimeRange(targetRange)
      setShowClearDialog(false)
      setPage(1)
      await loadPage()
      onCleared?.(deleted)
    } catch (err) {
      console.error('Failed to clear activity log:', err)
      setError(t('activityExt.clearFailed', { error: String(err) }))
    } finally {
      setClearing(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete?.id) return
    setDeleting(true)
    setError(null)
    try {
      await DeleteActivityLog(pendingDelete.id)
      setPendingDelete(null)
      const isLastOnPage = data?.items.length === 1
      if (isLastOnPage && page > 1) {
        setPage((p) => p - 1)
      } else {
        await loadPage()
      }
    } catch (err) {
      console.error('Failed to delete activity log:', err)
      setError(t('activityExt.deleteFailed', { error: String(err) }))
    } finally {
      setDeleting(false)
    }
  }

  const filterDeleteCount = data?.total ?? 0
  const allDeleteCount = allLogTotal ?? (timeRange === 'all' ? filterDeleteCount : null)
  const selectedDeleteCount = clearScope === 'all' ? allDeleteCount : filterDeleteCount

  const activityColumns = useMemo((): PackageDataTableColumn<main.ActivityLogEntry>[] => [
    {
      id: 'time',
      header: t('common.time'),
      colClassName: 'activity-col-time',
      sortable: true,
      defaultWidth: 160,
      sortValue: (log) => log.time,
      renderCell: (log) => formatLogTime(log.time, i18n.language, t('common.dash')),
    },
    {
      id: 'category',
      header: t('common.category'),
      colClassName: 'activity-col-category',
      cellClassName: 'activity-col-category',
      sortable: true,
      defaultWidth: 120,
      sortValue: (log) => log.operation || log.action || '',
      renderCell: (log) => (
        <span className="activity-col-clip">
          {formatActivityOperation(log.operation || log.action || '', t)}
        </span>
      ),
    },
    {
      id: 'content',
      header: t('common.description'),
      colClassName: 'activity-col-content',
      cellClassName: 'activity-col-content',
      sortable: true,
      defaultWidth: 320,
      sortValue: (log) => formatActivitySubject(log, t) || log.name || '',
      renderCell: (log) => (
        <div className="activity-col-content-inner">
          <span className="activity-col-subject">
            {formatActivitySubject(log, t) || log.name || t('common.dash')}
          </span>
          {(formatActivityErrorDetail(log, t) || log.errorDetail) && (
            <div className="activity-error-detail" tabIndex={0}>
              {formatActivityErrorDetail(log, t) || log.errorDetail}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'status',
      header: t('common.status'),
      colClassName: 'activity-col-status',
      sortable: true,
      defaultWidth: 100,
      sortValue: (log) => log.status,
      renderCell: (log) => (
        <span className={logStatusClassName(log.status)}>
          {formatActivityStatus(log.status, t)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('common.actions'),
      colClassName: 'activity-col-actions',
      headerClassName: 'col-actions activity-col-actions',
      cellClassName: 'col-actions activity-col-actions',
      sortable: false,
      defaultWidth: 56,
      minWidth: 48,
      renderCell: (log) => (
        <span className="cell-actions">
          <TableIconButton
            icon="close"
            title={t('activityExt.deleteTitle')}
            ariaLabel={t('activityExt.deleteAria', { name: log.name })}
            disabled={loading || deleting || clearing}
            onClick={(e) => {
              e.stopPropagation()
              setPendingDelete(log)
            }}
          />
        </span>
      ),
    },
  ], [t, i18n.language, loading, deleting, clearing])

  return (
    <div className="activity-section">
      <div className="section-header">
        <div className="section-heading">
          <h2>{t('activity.title')}</h2>
          <p className="section-subtitle">{t('activityExt.subtitle')}</p>
        </div>
        <div className="activity-toolbar-actions">
          <div className="activity-filter-group" role="group" aria-label={t('activityExt.timeFilterAria')}>
            {timeFilters.map((f) => (
              <button
                key={f.value}
                type="button"
                className={`activity-filter-btn ${timeRange === f.value ? 'active' : ''}`}
                onClick={() => handleTimeRangeChange(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="secondary"
            onClick={handleOpenClearDialog}
            disabled={loading || clearing || deleting}
            title={t('activityExt.clearDialogTitle')}
          >
            {t('activityExt.clearLogs')}
          </button>
        </div>
      </div>

      {error && <p className="activity-error">{error}</p>}

      {!loading && data && data.items.length === 0 ? (
        <p className="empty-state">{t('activityExt.empty')}</p>
      ) : (
        <div className="list-scroll activity-list-scroll" ref={listScrollRef as React.Ref<HTMLDivElement>}>
          <PackageDataTable
            tableId="activity"
            className="activity-table"
            columns={activityColumns}
            rows={data?.items ?? []}
            rowKey={(log) => String(log.id)}
          />
        </div>
      )}

      {pendingDelete && (
        <ModalOverlay
          onClose={() => setPendingDelete(null)}
          disabled={deleting}
        >
          <div className="modal activity-delete-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>{t('activityExt.deleteDialogTitle')}</h2>
              <ModalCloseButton
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                ariaLabel={t('app.cancel')}
              />
            </div>
            <div className="modal-body">
              <p>{t('activityExt.deleteConfirm')}</p>
              <p className="activity-delete-summary">
                {formatLogTime(pendingDelete.time, i18n.language, t('common.dash'))} ·{' '}
                {formatActivityOperation(pendingDelete.operation || pendingDelete.action || '', t)} ·{' '}
                <strong>{formatActivitySubject(pendingDelete, t) || pendingDelete.name || t('common.dash')}</strong> ·{' '}
                {formatActivityStatus(pendingDelete.status, t)}
              </p>
            </div>
            <div className="activity-delete-dialog-footer">
              <button type="button" className="secondary" disabled={deleting} onClick={() => setPendingDelete(null)}>
                {t('app.cancel')}
              </button>
              <button type="button" className="primary" disabled={deleting} onClick={handleConfirmDelete}>
                {deleting ? t('app.deleting') : t('app.delete')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showClearDialog && (
        <ModalOverlay
          onClose={() => setShowClearDialog(false)}
          disabled={clearing}
        >
          <div
            className="modal activity-clear-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h2>{t('activityExt.clearDialogTitle')}</h2>
              <ModalCloseButton
                disabled={clearing}
                onClick={() => setShowClearDialog(false)}
                ariaLabel={t('app.cancel')}
              />
            </div>
            <div className="modal-body">
              <p className="activity-clear-intro">{t('activityExt.clearIntro')}</p>
              <div className="activity-clear-options" role="radiogroup" aria-label={t('activityExt.clearScopeAria')}>
                <label className={`activity-clear-option${clearScope === 'filter' ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="clear-scope"
                    value="filter"
                    checked={clearScope === 'filter'}
                    disabled={clearing}
                    onChange={() => setClearScope('filter')}
                  />
                  <span className="activity-clear-option-text">
                    <strong>{t('activityExt.clearFilter', { label: timeRangeLabel(timeRange) })}</strong>
                    <span className="activity-clear-option-meta">
                      {filterDeleteCount > 0
                        ? t('activityExt.clearFilterCount', { count: filterDeleteCount })
                        : t('activityExt.clearFilterEmpty')}
                    </span>
                  </span>
                </label>
                <label className={`activity-clear-option${clearScope === 'all' ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="clear-scope"
                    value="all"
                    checked={clearScope === 'all'}
                    disabled={clearing}
                    onChange={() => setClearScope('all')}
                  />
                  <span className="activity-clear-option-text">
                    <strong>{t('activityExt.clearAll')}</strong>
                    <span className="activity-clear-option-meta">
                      {allDeleteCount == null
                        ? t('activityExt.clearAllCounting')
                        : allDeleteCount > 0
                          ? t('activityExt.clearFilterCount', { count: allDeleteCount })
                          : t('activityExt.clearFilterEmpty')}
                    </span>
                  </span>
                </label>
              </div>
            </div>
            <div className="activity-delete-dialog-footer">
              <button
                type="button"
                className="secondary"
                disabled={clearing}
                onClick={() => setShowClearDialog(false)}
              >
                {t('app.cancel')}
              </button>
              <button
                type="button"
                className="primary danger"
                disabled={clearing || !selectedDeleteCount}
                onClick={handleConfirmClear}
              >
                {clearing ? t('activityExt.clearing') : t('activityExt.clearConfirm')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      <ListPagination
        page={page}
        totalPages={totalPages}
        total={data?.total ?? 0}
        canPrev={canPrev}
        canNext={canNext}
        onPrev={() => setPage((p) => p - 1)}
        onNext={() => setPage((p) => p + 1)}
        disabled={loading || deleting || clearing}
      />
    </div>
  )
}
