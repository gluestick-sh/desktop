import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  AddBucket,
  IsEngineReady,
  ListBuckets,
  ListKnownBuckets,
  RemoveBucket,
  SetBucketDescription,
  StartBucketUpdateCheck,
  StartBucketUpdateCheckIfStale,
  UpdateBuckets,
} from '../wailsjs/go/main/App'
import type { main } from '../wailsjs/go/models'
import { EventsOn, EventsOnce } from '../wailsjs/runtime/runtime'
import { displayBucketDescription, editableBucketDescription } from './i18n/bucketDescription'
import ModalCloseButton from './ModalCloseButton'
import ModalOverlay from './ModalOverlay'
import ListPagination from './ListPagination'
import TableIconButton from './TableIconButton'
import PackageDataTable, { type PackageDataTableColumn } from './PackageDataTable'
import './BucketPanel.css'

function shortSha(sha: string) {
  return sha ? sha.slice(0, 7) : ''
}

function formatBucketCheckTime(raw: string | undefined, checking: boolean, locale: string, checkingLabel: string, dash: string): string {
  if (checking) return checkingLabel
  if (!raw) return dash
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  return d.toLocaleString(locale)
}

type BucketTask = {
  kind: string
  name: string
  phase: string
  message: string
  messageKey?: string
  messageArgs?: Record<string, unknown>
  percentage: number
}

function bucketTaskKey(kind: string, name: string) {
  return `${kind}:${name}`
}

function bulkUpdateCurrentBucket(tasks: BucketTask[]): string | null {
  const task = tasks.find((t) => t.kind === 'update' && t.name === '*')
  if (!task) return null
  const nameArg = task.messageArgs?.name
  if (typeof nameArg === 'string' && nameArg) {
    return nameArg
  }
  const match = task.message.match(/Updating (\S+)/)
  return match?.[1] ?? null
}

interface BucketPanelProps {
  refreshKey: number
  openAdd?: boolean
  onOpenAddConsumed?: () => void
  onBucketsChanged: () => void
  pageSize: number
  listScrollRef?: RefObject<HTMLDivElement | null>
}

export default function BucketPanel({
  refreshKey,
  openAdd,
  onOpenAddConsumed,
  onBucketsChanged,
  pageSize,
  listScrollRef,
}: BucketPanelProps) {
  const { t, i18n } = useTranslation()

  const formatBucketCommitHint = useCallback(
    (b: main.BucketInfo): { text: string; title: string } | null => {
      if (b.hasUpdates && b.localCommit && b.remoteCommit) {
        return {
          text: `${shortSha(b.localCommit)} → ${shortSha(b.remoteCommit)}`,
          title: t('bucket.commitCurrentRemote', { local: b.localCommit, remote: b.remoteCommit }),
        }
      }
      if (b.localCommit && b.updatesKnown && !b.checkFailed) {
        return {
          text: shortSha(b.localCommit),
          title: b.localCommit,
        }
      }
      return null
    },
    [t],
  )

  const [buckets, setBuckets] = useState<main.BucketInfo[]>([])
  const [known, setKnown] = useState<main.KnownBucketInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addURL, setAddURL] = useState('')
  const [pendingRemove, setPendingRemove] = useState<main.BucketInfo | null>(null)
  const [editingDescription, setEditingDescription] = useState<main.BucketInfo | null>(null)
  const [editDescriptionText, setEditDescriptionText] = useState('')
  const [savingDescription, setSavingDescription] = useState(false)
  const [page, setPage] = useState(1)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [checkingNames, setCheckingNames] = useState<Set<string>>(() => new Set())
  const [listRefreshing, setListRefreshing] = useState(false)
  const [bucketTasks, setBucketTasks] = useState<BucketTask[]>([])
  const [engineReady, setEngineReady] = useState(false)
  const bucketsRef = useRef<main.BucketInfo[]>([])
  const bucketTasksRef = useRef<BucketTask[]>([])
  const loadInFlightRef = useRef(false)

  useEffect(() => {
    bucketsRef.current = buckets
  }, [buckets])

  useEffect(() => {
    bucketTasksRef.current = bucketTasks
  }, [bucketTasks])

  const isBucketSyncRunning = useCallback(
    () => bucketTasksRef.current.some((t) => t.kind === 'update'),
    [],
  )

  const beginUpdateCheck = useCallback((force = false) => {
    if (isBucketSyncRunning()) return
    if (force) {
      StartBucketUpdateCheck()
    } else {
      StartBucketUpdateCheckIfStale()
    }
  }, [isBucketSyncRunning])

  const loadBuckets = useCallback(async (opts?: { forceRecheck?: boolean; skipRecheck?: boolean }) => {
    const forceRecheck = opts?.forceRecheck ?? false
    const skipRecheck = opts?.skipRecheck ?? false
    if (loadInFlightRef.current) return
    if (forceRecheck && isBucketSyncRunning()) return

    loadInFlightRef.current = true
    setListRefreshing(true)
    setError(null)
    if (bucketsRef.current.length === 0) {
      setLoading(true)
    }
    try {
      const list = await ListBuckets()
      const items = list || []
      setBuckets(items)
      if (forceRecheck) {
        setCheckingUpdates(true)
        setCheckingNames(new Set(items.map((b) => b.name)))
        beginUpdateCheck(true)
      } else if (!skipRecheck) {
        beginUpdateCheck(false)
      }
    } catch (err) {
      console.error('Failed to load buckets:', err)
      setError(t('bucket.loadFailed', { error: String(err) }))
      setBuckets([])
    } finally {
      setLoading(false)
      loadInFlightRef.current = false
      setListRefreshing(false)
    }

    void ListKnownBuckets()
      .then((knownList) => setKnown(knownList || []))
      .catch((err) => console.error('Failed to load known buckets:', err))
  }, [beginUpdateCheck, isBucketSyncRunning, t])

  useEffect(() => {
    const cancelReady = EventsOnce('engine-ready', () => setEngineReady(true))
    void IsEngineReady().then((ready) => {
      if (ready) setEngineReady(true)
    })
    return () => cancelReady()
  }, [])

  useEffect(() => {
    if (!engineReady) return
    loadBuckets()
  }, [engineReady, loadBuckets, refreshKey])

  useEffect(() => {
    const onCheckStart = EventsOn('bucket:update-check:start', () => {
      setCheckingUpdates(true)
      setCheckingNames(new Set(bucketsRef.current.map((b) => b.name)))
    })
    const onCheckResult = EventsOn('bucket:update-check:result', (data: Record<string, unknown>) => {
      const name = String(data.name ?? '')
      if (!name) return
      setBuckets((prev) =>
        prev.map((b) => (b.name === name ? applyBucketUpdateResult(b, data) : b)),
      )
      setCheckingNames((prev) => {
        if (!prev.has(name)) return prev
        const next = new Set(prev)
        next.delete(name)
        return next
      })
    })
    const onCheckDone = EventsOn('bucket:update-check:done', () => {
      setCheckingUpdates(false)
      setCheckingNames(new Set())
      onBucketsChanged()
    })
    const onPackageCount = EventsOn('bucket:package-count', (data: { name?: string; count?: number }) => {
      if (!data?.name || typeof data.count !== 'number') return
      setBuckets((prev) =>
        prev.map((b) => (b.name === data.name ? { ...b, packageCount: data.count! } : b)),
      )
    })
    return () => {
      onCheckStart()
      onCheckResult()
      onCheckDone()
      onPackageCount()
    }
  }, [onBucketsChanged])

  useEffect(() => {
    const onStart = EventsOn('bucket:task:start', (data: { kind?: string; name?: string }) => {
      if (!data?.kind || !data?.name) return
      const key = bucketTaskKey(data.kind, data.name)
      setBucketTasks((prev) => {
        if (prev.some((t) => bucketTaskKey(t.kind, t.name) === key)) return prev
        return [...prev, { kind: data.kind!, name: data.name!, phase: 'start', message: '', percentage: 0 }]
      })
    })
    const onProgress = EventsOn(
      'bucket:task:progress',
      (data: {
        kind?: string
        name?: string
        phase?: string
        message?: string
        messageKey?: string
        messageArgs?: Record<string, unknown>
        percentage?: number
      }) => {
        if (!data?.kind || !data?.name) return
        const key = bucketTaskKey(data.kind, data.name)
        setBucketTasks((prev) =>
          prev.map((task) =>
            bucketTaskKey(task.kind, task.name) === key
              ? {
                  ...task,
                  phase: data.phase ?? task.phase,
                  message: data.message ?? task.message,
                  messageKey: data.messageKey ?? task.messageKey,
                  messageArgs: data.messageArgs ?? task.messageArgs,
                  percentage: typeof data.percentage === 'number' ? data.percentage : task.percentage,
                }
              : task,
          ),
        )
      },
    )
    const onPartialSynced = EventsOn('bucket:bucket-synced', (data: { name?: string }) => {
      const name = String(data?.name ?? '')
      if (!name) return
      setBuckets((prev) => prev.map((b) => (b.name === name ? applySyncedBucketState(b) : b)))
    })
    const onComplete = EventsOn(
      'bucket:task:complete',
      (data: { kind?: string; name?: string; syncedNames?: string[] }) => {
        if (!data?.kind || !data?.name) return
        const key = bucketTaskKey(data.kind, data.name)

        if (data.kind === 'update') {
          const syncedNames = resolveSyncedBucketNames(data)
          if (syncedNames.length > 0) {
            setBuckets((prev) =>
              prev.map((b) => (syncedNames.includes(b.name) ? applySyncedBucketState(b) : b)),
            )
          }
        }

        setBucketTasks((prev) => prev.filter((t) => bucketTaskKey(t.kind, t.name) !== key))
        void loadBuckets({ skipRecheck: data.kind === 'update' ? true : false })
        onBucketsChanged()
      },
    )
    const onError = EventsOn('bucket:task:error', (data: { kind?: string; name?: string; error?: string }) => {
      if (!data?.kind || !data?.name) return
      const key = bucketTaskKey(data.kind, data.name)
      setBucketTasks((prev) => prev.filter((t) => bucketTaskKey(t.kind, t.name) !== key))
      if (data.error) {
        const action =
          data.kind === 'add'
            ? t('bucket.actionAdd')
            : data.kind === 'remove'
              ? t('bucket.actionRemove')
              : t('bucket.actionUpdate')
        setError(t('bucket.taskFailed', { action, name: data.name, error: data.error }))
      }
    })
    return () => {
      onStart()
      onProgress()
      onPartialSynced()
      onComplete()
      onError()
    }
  }, [loadBuckets, onBucketsChanged, t])

  useEffect(() => {
    if (openAdd) {
      setShowAdd(true)
      onOpenAddConsumed?.()
    }
  }, [openAdd, onOpenAddConsumed])

  const handleSelectKnown = (name: string) => {
    setAddName(name)
    const item = known.find((k) => k.name === name)
    setAddURL(item?.repoURL ?? '')
  }

  const handleAdd = async () => {
    const name = addName.trim()
    if (!name) return
    const url = addURL.trim()
    setError(null)
    setShowAdd(false)
    setAddName('')
    setAddURL('')
    try {
      await AddBucket(name, url)
    } catch (err) {
      setError(t('bucket.addFailed', { error: String(err) }))
    }
  }

  const handleQuickAdd = async (name: string) => {
    setError(null)
    try {
      await AddBucket(name, '')
    } catch (err) {
      setError(t('bucket.addNamedFailed', { name, error: String(err) }))
    }
  }

  const handleConfirmRemove = async () => {
    if (!pendingRemove) return
    const name = pendingRemove.name
    setError(null)
    setPendingRemove(null)
    try {
      await RemoveBucket(name)
    } catch (err) {
      setError(t('bucket.removeFailed', { error: String(err) }))
    }
  }

  const handleUpdate = async (names: string[]) => {
    if (bucketCheckRunning) return
    setError(null)
    try {
      await UpdateBuckets(names)
    } catch (err) {
      setError(t('bucket.updateFailed', { error: String(err) }))
    }
  }

  const openDescriptionEditor = (bucket: main.BucketInfo) => {
    setEditingDescription(bucket)
    setEditDescriptionText(editableBucketDescription(bucket))
  }

  const handleSaveDescription = async () => {
    if (!editingDescription) return
    setSavingDescription(true)
    setError(null)
    try {
      await SetBucketDescription(editingDescription.name, editDescriptionText.trim())
      setEditingDescription(null)
      setEditDescriptionText('')
      await loadBuckets({ skipRecheck: true })
    } catch (err) {
      setError(t('bucket.descriptionSaveFailed', { error: String(err) }))
    } finally {
      setSavingDescription(false)
    }
  }

  const handleResetDescription = async () => {
    if (!editingDescription) return
    setSavingDescription(true)
    setError(null)
    try {
      await SetBucketDescription(editingDescription.name, '')
      setEditingDescription(null)
      setEditDescriptionText('')
      await loadBuckets({ skipRecheck: true })
    } catch (err) {
      setError(t('bucket.descriptionSaveFailed', { error: String(err) }))
    } finally {
      setSavingDescription(false)
    }
  }

  const isBucketTaskRunning = useCallback(
    (kind: string, name: string) => bucketTasks.some((t) => t.kind === kind && t.name === name),
    [bucketTasks],
  )

  const notInstalledKnown = known.filter((k) => !k.installed)
  const bucketOpsBusy = bucketTasks.length > 0
  const bucketSyncRunning = bucketTasks.some((task) => task.kind === 'update')
  const bucketCheckRunning = checkingUpdates || checkingNames.size > 0
  const bucketsWithUpdates = buckets.filter((b) => b.updatesKnown && !b.checkFailed && b.hasUpdates)
  const refreshBusy = listRefreshing || bucketCheckRunning
  const refreshDisabled = refreshBusy || bucketSyncRunning
  const syncDisabled =
    bucketOpsBusy || bucketCheckRunning || loading || bucketsWithUpdates.length === 0
  const bulkUpdatingBucket = bulkUpdateCurrentBucket(bucketTasks)
  const totalPages = Math.max(1, Math.ceil(buckets.length / pageSize))
  const pageBuckets = buckets.slice((page - 1) * pageSize, page * pageSize)
  const canPrev = page > 1
  const canNext = page < totalPages

  useEffect(() => {
    setPage(1)
  }, [pageSize])

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages))
  }, [totalPages])

  const bucketColumns = useMemo((): PackageDataTableColumn<main.BucketInfo>[] => [
    {
      id: 'name',
      header: t('common.name'),
      sortable: true,
      defaultWidth: 140,
      sortValue: (b) => b.name,
      renderCell: (b) => <strong>{b.name}</strong>,
    },
    {
      id: 'description',
      header: t('common.description'),
      sortable: true,
      defaultWidth: 200,
      cellClassName: 'bucket-desc-cell',
      sortValue: (b) => displayBucketDescription(b),
      renderCell: (b) => displayBucketDescription(b) || t('common.dash'),
    },
    {
      id: 'status',
      header: t('common.status'),
      headerClassName: 'bucket-status-cell',
      cellClassName: 'bucket-status-cell',
      sortable: true,
      defaultWidth: 160,
      sortValue: (b) => (b.hasUpdates ? 1 : b.checkFailed ? 2 : 0),
      renderCell: (b) => {
        const isUpdating = isBucketTaskRunning('update', b.name) || bulkUpdatingBucket === b.name
        const isRemoving = isBucketTaskRunning('remove', b.name)
        const isChecking = checkingNames.has(b.name)
        const statusPending = isChecking || (!b.updatesKnown && checkingUpdates)
        const rowBusy = isUpdating || isRemoving
        const commitHint = !statusPending && !rowBusy && !b.checkFailed ? formatBucketCommitHint(b) : null
        return (
          <div className="bucket-status">
            {isUpdating ? (
              <span className="pill info">{t('bucket.statusSyncing')}</span>
            ) : isRemoving ? (
              <span className="pill info">{t('bucket.statusRemoving')}</span>
            ) : statusPending ? (
              <span className="pill info">{t('bucket.statusChecking')}</span>
            ) : b.checkFailed ? (
              <span className="pill danger" title={b.checkError || undefined}>{t('bucket.statusCheckFailed')}</span>
            ) : b.hasUpdates ? (
              <span className="pill warning">{t('bucket.statusHasUpdates')}</span>
            ) : (
              <span className="pill success">{t('bucket.statusSynced')}</span>
            )}
            {commitHint && (
              <code className="bucket-commit-hint" title={commitHint.title}>
                {commitHint.text}
              </code>
            )}
          </div>
        )
      },
    },
    {
      id: 'lastChecked',
      header: t('common.lastChecked'),
      headerClassName: 'col-checked-at',
      cellClassName: 'col-checked-at',
      sortable: true,
      defaultWidth: 160,
      sortValue: (b) => b.lastCheckedAt || '',
      renderCell: (b) => {
        const isUpdating = isBucketTaskRunning('update', b.name) || bulkUpdatingBucket === b.name
        const isRemoving = isBucketTaskRunning('remove', b.name)
        const isChecking = checkingNames.has(b.name)
        return (
          <span title={b.lastCheckedAt || undefined}>
            {formatBucketCheckTime(
              b.lastCheckedAt,
              isChecking || isUpdating || isRemoving,
              i18n.language,
              isUpdating
                ? t('bucket.statusSyncing')
                : isRemoving
                  ? t('bucket.statusRemoving')
                  : t('bucket.statusChecking'),
              t('common.dash'),
            )}
          </span>
        )
      },
    },
    {
      id: 'repo',
      header: t('common.repo'),
      sortable: true,
      defaultWidth: 180,
      sortValue: (b) => b.repoURL || '',
      renderCell: (b) => (
        <span className="bucket-repo-cell" title={b.repoURL}>
          {b.repoURL || t('common.dash')}
        </span>
      ),
    },
    {
      id: 'packageCount',
      header: t('common.packageCount'),
      headerClassName: 'col-num',
      cellClassName: 'col-num',
      sortable: true,
      defaultWidth: 80,
      sortValue: (b) => b.packageCount,
      renderCell: (b) => (b.packageCount >= 0 ? String(b.packageCount) : t('common.none')),
    },
    {
      id: 'actions',
      header: t('common.actions'),
      headerClassName: 'col-actions',
      cellClassName: 'col-actions',
      sortable: false,
      defaultWidth: 120,
      minWidth: 108,
      renderCell: (b) => {
        const isUpdating = isBucketTaskRunning('update', b.name) || bulkUpdatingBucket === b.name
        const isRemoving = isBucketTaskRunning('remove', b.name)
        const isChecking = checkingNames.has(b.name)
        const statusPending = isChecking || (!b.updatesKnown && checkingUpdates)
        const canUpdate = !statusPending && b.updatesKnown && !b.checkFailed && b.hasUpdates
        const rowBusy = isRemoving || isUpdating
        return (
          <span className="cell-actions">
            <TableIconButton
              icon="edit"
              title={t('bucket.editDescriptionTitle')}
              ariaLabel={t('bucket.editDescriptionAria', { name: b.name })}
              disabled={rowBusy}
              onClick={() => openDescriptionEditor(b)}
            />
            <TableIconButton
              icon="refresh"
              variant={canUpdate ? 'accent' : 'default'}
              title={
                isRemoving
                  ? t('bucket.statusRemoving')
                  : isUpdating
                    ? t('bucket.updatingTitle')
                    : canUpdate
                      ? t('bucket.updateTitle')
                      : t('bucket.syncedTitle')
              }
              ariaLabel={
                isUpdating
                  ? t('bucket.updatingAria', { name: b.name })
                  : canUpdate
                    ? t('bucket.updateAria', { name: b.name })
                    : t('bucket.syncedAria', { name: b.name })
              }
              disabled={isRemoving || isUpdating || bucketCheckRunning || (!canUpdate && !isUpdating)}
              busy={isUpdating}
              onClick={() => handleUpdate([b.name])}
            />
            <TableIconButton
              icon="trash"
              variant="danger"
              title={isUpdating ? t('bucket.removeDisabledSyncing') : t('bucket.removeTitle')}
              ariaLabel={
                isUpdating
                  ? t('bucket.removeDisabledSyncingAria', { name: b.name })
                  : t('bucket.removeAria', { name: b.name })
              }
              disabled={isRemoving || isUpdating}
              onClick={() => setPendingRemove(b)}
            />
          </span>
        )
      },
    },
  ], [
    t,
    i18n.language,
    checkingNames,
    checkingUpdates,
    bulkUpdatingBucket,
    bucketCheckRunning,
    formatBucketCommitHint,
    isBucketTaskRunning,
    handleUpdate,
  ])

  return (
    <div className="bucket-section">
      <div className="section-header">
        <div className="section-heading">
          <h2>{t('nav.buckets')}</h2>
          <p className="section-subtitle">{t('bucket.subtitle')}</p>
        </div>
        <div className="bucket-toolbar">
          <button
            type="button"
            className="secondary"
            disabled={syncDisabled}
            title={
              bucketsWithUpdates.length === 0 ? t('bucket.updateAllNone') : t('bucket.updateAllTitle')
            }
            onClick={() => void handleUpdate([])}
          >
            {isBucketTaskRunning('update', '*') ? t('bucket.syncingAll') : t('bucket.updateAll')}
          </button>
          <button type="button" className="primary" disabled={bucketOpsBusy} onClick={() => setShowAdd(true)}>
            {t('bucket.add')}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={refreshDisabled}
            title={bucketSyncRunning && !refreshBusy ? t('bucket.refreshDisabledSyncing') : undefined}
            onClick={() => void loadBuckets({ forceRecheck: true })}
          >
            {refreshBusy ? t('app.refreshing') : t('app.refresh')}
          </button>
        </div>
      </div>

      {error && (
        <div className="bucket-error" role="alert">
          {error}
          <button type="button" className="ghost" onClick={() => setError(null)} aria-label={t('common.dismiss')}>
            ×
          </button>
        </div>
      )}

      {loading && buckets.length === 0 ? (
        <p className="empty-state">{t('app.loading')}</p>
      ) : buckets.length === 0 ? (
        <div className="bucket-empty">
          <p className="empty-state">{t('bucket.empty')}</p>
          <p className="bucket-empty-hint">
            <Trans i18nKey="bucket.emptyHint" components={{ strong: <strong /> }} />
          </p>
          {notInstalledKnown.length > 0 && (
            <div className="bucket-quick-add">
              {notInstalledKnown.slice(0, 4).map((k) => (
                <button
                  key={k.name}
                  type="button"
                  className="secondary"
                  disabled={isBucketTaskRunning('add', k.name)}
                  onClick={() => void handleQuickAdd(k.name)}
                >
                  {isBucketTaskRunning('add', k.name) ? t('common.adding') : t('bucket.quickAdd', { name: k.name })}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="list-scroll" ref={listScrollRef as React.Ref<HTMLDivElement>}>
            <PackageDataTable
              tableId="buckets"
              columns={bucketColumns}
              rows={pageBuckets}
              rowKey={(b) => b.name}
            />
          </div>
          <ListPagination
            page={page}
            totalPages={totalPages}
            total={buckets.length}
            totalUnit={t('common.unitPackages')}
            canPrev={canPrev}
            canNext={canNext}
            onPrev={() => setPage((p) => p - 1)}
            onNext={() => setPage((p) => p + 1)}
            disabled={loading}
          />
        </>
      )}

      {showAdd && (
        <ModalOverlay onClose={() => setShowAdd(false)}>
          <div className="modal bucket-add-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>{t('bucket.addDialogTitle')}</h2>
              <ModalCloseButton onClick={() => setShowAdd(false)} ariaLabel={t('common.dismiss')} />
            </div>
            <div className="modal-body">
              {notInstalledKnown.length > 0 && (
                <label className="bucket-form-field">
                  <span className="detail-label">{t('bucket.knownBucket')}</span>
                  <select
                    className="bucket-known-select"
                    value={addName}
                    onChange={(e) => handleSelectKnown(e.target.value)}
                  >
                    <option value="">{t('bucket.selectOrManual')}</option>
                    {notInstalledKnown.map((k) => (
                      <option key={k.name} value={k.name}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="bucket-form-field">
                <span className="detail-label">{t('bucket.nameLabel')}</span>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder={t('bucket.namePlaceholder')}
                />
              </label>
              <label className="bucket-form-field">
                <span className="detail-label">{t('bucket.repoOptional')}</span>
                <input
                  type="text"
                  value={addURL}
                  onChange={(e) => setAddURL(e.target.value)}
                  placeholder={t('bucket.repoPlaceholder')}
                />
              </label>
            </div>
            <div className="confirm-dialog-footer">
              <button type="button" className="secondary" onClick={() => setShowAdd(false)}>
                {t('app.cancel')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={!addName.trim()}
                onClick={() => void handleAdd()}
              >
                {t('bucket.actionAdd')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {pendingRemove && (
        <ModalOverlay onClose={() => setPendingRemove(null)}>
          <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>{t('bucket.removeDialogTitle')}</h2>
              <ModalCloseButton onClick={() => setPendingRemove(null)} ariaLabel={t('common.dismiss')} />
            </div>
            <div className="modal-body">
              <p>
                <Trans
                  i18nKey="bucket.removeDialogConfirm"
                  values={{ name: pendingRemove.name }}
                  components={{ strong: <strong /> }}
                />
              </p>
              <p className="confirm-dialog-summary">{t('bucket.removeDialogNote')}</p>
            </div>
            <div className="confirm-dialog-footer">
              <button type="button" className="secondary" onClick={() => setPendingRemove(null)}>
                {t('app.cancel')}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void handleConfirmRemove()}
              >
                {t('common.remove')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {editingDescription && (
        <ModalOverlay onClose={() => !savingDescription && setEditingDescription(null)}>
          <div className="modal bucket-add-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>{t('bucket.editDescriptionDialogTitle', { name: editingDescription.name })}</h2>
              <ModalCloseButton
                onClick={() => setEditingDescription(null)}
                ariaLabel={t('common.dismiss')}
                disabled={savingDescription}
              />
            </div>
            <div className="modal-body">
              <label className="bucket-form-field">
                <span className="detail-label">{t('common.description')}</span>
                <textarea
                  rows={4}
                  value={editDescriptionText}
                  onChange={(e) => setEditDescriptionText(e.target.value)}
                  placeholder={t('bucket.editDescriptionPlaceholder')}
                  disabled={savingDescription}
                />
              </label>
              <p className="bucket-add-hint">{t('bucket.editDescriptionHint')}</p>
            </div>
            <div className="confirm-dialog-footer">
              {editingDescription.descriptionCustom ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={savingDescription}
                  onClick={() => void handleResetDescription()}
                >
                  {t('bucket.resetDescription')}
                </button>
              ) : null}
              <button
                type="button"
                className="secondary"
                disabled={savingDescription}
                onClick={() => setEditingDescription(null)}
              >
                {t('app.cancel')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={savingDescription || !editDescriptionText.trim()}
                onClick={() => void handleSaveDescription()}
              >
                {savingDescription ? t('common.updating') : t('bucket.saveDescription')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}

function resolveSyncedBucketNames(data: { name?: string; syncedNames?: string[] }): string[] {
  if (Array.isArray(data.syncedNames) && data.syncedNames.length > 0) {
    return data.syncedNames
  }
  const name = String(data.name ?? '')
  if (!name || name === '*') return []
  if (name.includes(',')) {
    return name.split(',').map((part) => part.trim()).filter(Boolean)
  }
  return [name]
}

function applySyncedBucketState(b: main.BucketInfo): main.BucketInfo {
  const commit = b.remoteCommit || b.localCommit
  return {
    ...b,
    hasUpdates: false,
    updatesKnown: true,
    checkFailed: false,
    checkError: '',
    statusStale: false,
    localCommit: commit,
    remoteCommit: commit || b.remoteCommit,
    lastCheckedAt: new Date().toISOString(),
  }
}

function applyBucketUpdateResult(
  b: main.BucketInfo,
  data: Record<string, unknown>,
): main.BucketInfo {
  return {
    ...b,
    hasUpdates: Boolean(data.hasUpdates),
    localCommit: String(data.localCommit ?? b.localCommit ?? ''),
    remoteCommit: String(data.remoteCommit ?? b.remoteCommit ?? ''),
    updatesKnown: true,
    checkFailed: Boolean(data.checkFailed),
    checkError: String(data.checkError ?? ''),
    statusStale: false,
    lastCheckedAt: String(data.lastCheckedAt ?? b.lastCheckedAt ?? ''),
  }
}
