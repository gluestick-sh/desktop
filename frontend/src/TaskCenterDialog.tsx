import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ModalCloseButton from './ModalCloseButton'
import ModalOverlay from './ModalOverlay'
import {
  TASK_CENTER_INTERRUPTED_ERROR,
  taskCenterCounts,
  type TaskCenterItem,
  type TaskCenterStatus,
} from './taskCenter'
import type { InstallProgress } from './installProgress'
import { formatInstallStatusMessage } from './i18n/formatMessage'
import {
  formatEtaDuration,
  formatTransferSpeed,
  isActivelyDownloading,
  operationProgressDisplay,
  sampleDownloadTransferStats,
} from './installProgress'
import { parseHashMismatch } from './hashMismatch'
import './TaskCenterDialog.css'

interface TaskCenterDialogProps {
  tasks: TaskCenterItem[]
  /** Live install progress keyed by installTaskId (install:<pkg>). */
  liveInstallProgress?: Record<string, InstallProgress>
  cancellingTaskIds?: Record<string, boolean>
  /** When true, show "Show on main window" to restore the bottom install dock. */
  canShowOnMainWindow?: boolean
  onClose: () => void
  onClearFinished: () => void
  onShowOnMainWindow?: () => void
  onCancelTask?: (task: TaskCenterItem) => void
  onRetryTask?: (task: TaskCenterItem, options?: { force?: boolean; acceptHash?: boolean }) => void
  onRetryFailed?: (options?: { force?: boolean }) => void
}

type TaskFilter = 'running' | 'completed' | 'failed' | 'all'

function statusLabel(status: TaskCenterStatus, t: (key: string) => string) {
  switch (status) {
    case 'queued':
      return t('taskCenter.statusQueued')
    case 'running':
      return t('taskCenter.statusRunning')
    case 'completed':
      return t('taskCenter.statusCompleted')
    case 'failed':
      return t('taskCenter.statusFailed')
  }
}

export default function TaskCenterDialog({
  tasks,
  liveInstallProgress,
  cancellingTaskIds,
  canShowOnMainWindow = false,
  onClose,
  onClearFinished,
  onShowOnMainWindow,
  onCancelTask,
  onRetryTask,
  onRetryFailed,
}: TaskCenterDialogProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<TaskFilter>('running')
  const [rateTick, setRateTick] = useState(0)
  const counts = useMemo(() => taskCenterCounts(tasks), [tasks])

  const hasActiveDownload = useMemo(() => {
    if (!liveInstallProgress) return false
    return Object.values(liveInstallProgress).some((p) => isActivelyDownloading(p))
  }, [liveInstallProgress])

  useEffect(() => {
    if (!hasActiveDownload) return
    const id = window.setInterval(() => setRateTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [hasActiveDownload])

  const filtered = useMemo(() => {
    const list =
      filter === 'all'
        ? tasks
        : filter === 'running'
          ? tasks.filter((item) => item.status === 'running' || item.status === 'queued')
          : tasks.filter((item) => item.status === filter)
    return [...list].sort((a, b) => {
      const rank = (s: TaskCenterStatus) =>
        s === 'running' ? 0 : s === 'queued' ? 1 : s === 'failed' ? 2 : 3
      const rankDiff = rank(a.status) - rank(b.status)
      if (rankDiff !== 0) return rankDiff
      const aTime = a.finishedAt || a.startedAt
      const bTime = b.finishedAt || b.startedAt
      return bTime - aTime
    })
  }, [filter, tasks])

  const filters: { id: TaskFilter; label: string; count: number }[] = [
    {
      id: 'running',
      label: t('taskCenter.tabRunning'),
      count: counts.running + counts.queued,
    },
    { id: 'completed', label: t('taskCenter.tabCompleted'), count: counts.completed },
    { id: 'failed', label: t('taskCenter.tabFailed'), count: counts.failed },
    { id: 'all', label: t('taskCenter.tabAll'), count: tasks.length },
  ]

  const hasFinished = counts.completed + counts.failed > 0
  const failedInstallCount = useMemo(
    () => tasks.filter((item) => item.status === 'failed' && item.kind === 'install').length,
    [tasks],
  )

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="modal task-center-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="task-center-title"
        aria-modal="true"
      >
        <div className="modal-header">
          <h2 id="task-center-title">{t('taskCenter.title')}</h2>
          <ModalCloseButton onClick={onClose} ariaLabel={t('app.close')} />
        </div>

        <div className="modal-body">
          <div className="task-center-hints">
            <p className="task-center-intro">{t('taskCenter.intro', { max: 4 })}</p>
            <p className="task-center-muted">{t('taskCenter.forceNote')}</p>
          </div>

          <div className="task-center-tabs" role="tablist" aria-label={t('taskCenter.tabsAria')}>
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`task-center-tab${filter === item.id ? ' is-active' : ''}`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
                <span className="task-center-tab-count">{item.count}</span>
              </button>
            ))}
          </div>

          <div className="task-center-content">
            {filtered.length === 0 ? (
              <p className="task-center-muted task-center-empty">
                {filter === 'running' ? t('taskCenter.emptyRunning') : t('taskCenter.empty')}
              </p>
            ) : (
              <ul className="task-center-list">
                {filtered.map((item) => {
                  const live = liveInstallProgress?.[item.id]
                  const detail = live ? formatInstallStatusMessage(live) : item.detail
                  const liveDisplay = live ? operationProgressDisplay(live) : null
                  const pct =
                    liveDisplay && liveDisplay.showPercent
                      ? Math.round(liveDisplay.barPct)
                      : typeof item.progress === 'number'
                        ? Math.round(item.progress)
                        : null
                  void rateTick
                  const transfer =
                    live && item.status === 'running'
                      ? sampleDownloadTransferStats(item.id, live)
                      : null
                  const canCancel =
                    !!onCancelTask &&
                    item.kind === 'install' &&
                    (item.status === 'running' || item.status === 'queued')
                  const canRetry =
                    !!onRetryTask && item.kind === 'install' && item.status === 'failed'
                  const hashMismatch = canRetry ? parseHashMismatch(item.error || '') : null
                  const cancelling = !!cancellingTaskIds?.[item.id]
                  return (
                    <li key={item.id} className={`task-center-item is-${item.status}`}>
                      <div className="task-center-item-head">
                        <strong>{item.title}</strong>
                        <div className="task-center-item-head-actions">
                          <span className={`task-center-status is-${item.status}`}>
                            {statusLabel(item.status, t)}
                          </span>
                          {canCancel ? (
                            <button
                              type="button"
                              className="secondary task-center-cancel-btn"
                              disabled={cancelling}
                              onClick={() => onCancelTask(item)}
                            >
                              {cancelling ? t('appExt.cancellingInstall') : t('app.cancel')}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {detail ? <p className="task-center-item-detail">{detail}</p> : null}
                      {item.status === 'running' && (pct != null || transfer) ? (
                        <p className="task-center-item-current">
                          <span className="task-center-item-speed">
                            {transfer ? (
                              <>
                                {t('taskCenter.downloadSpeed', {
                                  speed: formatTransferSpeed(transfer.bytesPerSec),
                                })}
                                <span aria-hidden="true"> · </span>
                                {t('taskCenter.etaRemaining', {
                                  time: formatEtaDuration(transfer.etaSeconds),
                                })}
                              </>
                            ) : null}
                          </span>
                          {pct != null ? (
                            <span className="task-center-item-pct">{pct}%</span>
                          ) : null}
                        </p>
                      ) : null}
                      {item.status === 'running' && (liveDisplay || pct != null) ? (
                        <div className="task-center-progress" aria-hidden="true">
                          <div
                            className={`task-center-progress-fill${liveDisplay?.indeterminate ? ' is-indeterminate' : ''}`}
                            style={
                              liveDisplay?.indeterminate
                                ? undefined
                                : { width: `${Math.max(pct ?? 0, 1)}%` }
                            }
                          />
                        </div>
                      ) : null}
                      {item.error ? (
                        <p className="task-center-item-error">
                          {item.error === TASK_CENTER_INTERRUPTED_ERROR
                            ? t('taskCenter.interruptedByRestart')
                            : item.error}
                        </p>
                      ) : null}
                      {canRetry ? (
                        <div className="task-center-item-actions">
                          <button
                            type="button"
                            className="secondary task-center-cancel-btn"
                            onClick={() => onRetryTask(item)}
                          >
                            {t('taskCenter.retry')}
                          </button>
                          <button
                            type="button"
                            className="secondary task-center-cancel-btn"
                            onClick={() => onRetryTask(item, { force: true })}
                          >
                            {t('taskCenter.forceRetry')}
                          </button>
                          {hashMismatch ? (
                            <button
                              type="button"
                              className="primary task-center-cancel-btn"
                              title={t('taskCenter.acceptHashHint')}
                              onClick={() => onRetryTask(item, { acceptHash: true })}
                            >
                              {t('taskCenter.acceptHashRetry')}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="modal-footer task-center-footer">
          {failedInstallCount > 0 && onRetryFailed ? (
            <>
              <button type="button" className="secondary" onClick={() => onRetryFailed()}>
                {t('taskCenter.retryAllFailed', { count: failedInstallCount })}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => onRetryFailed({ force: true })}
              >
                {t('taskCenter.forceRetryAllFailed', { count: failedInstallCount })}
              </button>
            </>
          ) : null}
          {onShowOnMainWindow ? (
            <button
              type="button"
              className="secondary"
              disabled={!canShowOnMainWindow}
              onClick={onShowOnMainWindow}
            >
              {t('taskCenter.showOnMainWindow')}
            </button>
          ) : null}
          {filter === 'all' || filter === 'completed' ? (
            <button
              type="button"
              className="secondary"
              disabled={!hasFinished}
              onClick={onClearFinished}
            >
              {t('taskCenter.clearFinished')}
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={onClose}>
            {t('app.close')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
