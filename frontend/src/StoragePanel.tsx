import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  ListCachePackages,
  PurgeCachePackage,
  RunCacheGC,
} from '../wailsjs/go/main/App'
import type { main } from '../wailsjs/go/models'
import { EventsOn } from '../wailsjs/runtime/runtime'
import { getAppLocale } from './i18n'
import ModalCloseButton from './ModalCloseButton'
import ModalOverlay from './ModalOverlay'
import ListPagination from './ListPagination'
import PackageIcon from './PackageIcon'
import TableIconButton from './TableIconButton'
import { useCacheTasks } from './TabTopProgress'
import PackageDataTable, { type PackageDataTableColumn } from './PackageDataTable'
import './StoragePanel.css'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

interface StoragePanelProps {
  refreshKey: number
  pageSize: number
  listScrollRef?: RefObject<HTMLDivElement | null>
  onChanged?: (message: string) => void
  onStatusMessage?: (status: string | null) => void
}

export default function StoragePanel({
  refreshKey,
  pageSize,
  listScrollRef,
  onChanged,
  onStatusMessage,
}: StoragePanelProps) {
  const { t } = useTranslation()

  const formatCacheTime = useCallback(
    (raw: string) => {
      if (!raw) return t('common.dash')
      const d = new Date(raw)
      if (Number.isNaN(d.getTime())) return raw
      return d.toLocaleString(getAppLocale())
    },
    [t],
  )

  const formatSpaceResult = useCallback(
    (removedBlobs: number, freedBytes: number) => {
      if (removedBlobs <= 0) {
        return t('storageExt.noSpace')
      }
      return t('storageExt.freed', { removed: removedBlobs, freed: formatBytes(freedBytes) })
    },
    [t],
  )

  const [packages, setPackages] = useState<main.CachePackageInfo[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingPurge, setPendingPurge] = useState<main.CachePackageInfo | null>(null)
  const [showGcConfirm, setShowGcConfirm] = useState(false)
  const cacheTasks = useCacheTasks()
  const cacheRunning = cacheTasks.length > 0

  const loadData = useCallback(async (options?: { notify?: boolean }) => {
    const notify = options?.notify ?? false
    if (notify) {
      setRefreshing(true)
      onStatusMessage?.(t('storageExt.refreshing'))
    } else {
      setLoading(true)
    }
    setError(null)
    try {
      const list = await ListCachePackages()
      setPackages(list ?? [])
      if (notify) {
        const items = list ?? []
        const totalSize = items.reduce((sum, pkg) => sum + (pkg.size ?? 0), 0)
        onChanged?.(t('storageExt.refreshed', { count: items.length, size: formatBytes(totalSize) }))
      }
    } catch (err) {
      setError(t('storageExt.loadFailed', { error: String(err) }))
    } finally {
      if (notify) {
        setRefreshing(false)
        onStatusMessage?.(null)
      } else {
        setLoading(false)
      }
    }
  }, [onChanged, onStatusMessage, t])

  const handleRefresh = useCallback(() => {
    void loadData({ notify: true })
  }, [loadData])

  useEffect(() => {
    void loadData()
  }, [loadData, refreshKey])

  useEffect(() => {
    const onComplete = EventsOn(
      'cache:task:complete',
      (data: { kind?: string; name?: string; removedBlobs?: number; freedBytes?: number }) => {
        if (!data?.kind) return
        void loadData()
        const removed = typeof data.removedBlobs === 'number' ? data.removedBlobs : 0
        const freed = typeof data.freedBytes === 'number' ? data.freedBytes : 0
        if (data.kind === 'gc') {
          onChanged?.(formatSpaceResult(removed, freed))
          return
        }
        if (data.kind === 'purge' && data.name) {
          onChanged?.(
            t('storageExt.purged', {
              name: data.name,
              result: formatSpaceResult(removed, freed),
            }),
          )
        }
      },
    )
    const onError = EventsOn('cache:task:error', (data: { kind?: string; name?: string; error?: string }) => {
      if (!data?.kind) return
      if (data.kind === 'gc') {
        if (data.error) {
          setError(t('storageExt.gcFailed', { error: data.error }))
        }
        return
      }
      if (data.kind === 'purge' && data.error) {
        setError(t('storageExt.purgeFailed', { error: data.error }))
      }
    })
    return () => {
      onComplete()
      onError()
    }
  }, [formatSpaceResult, loadData, onChanged, t])

  const totalPages = Math.max(1, Math.ceil(packages.length / pageSize))
  const pageItems = packages.slice((page - 1) * pageSize, page * pageSize)
  const opsBusy = cacheRunning || refreshing

  const storageColumns = useMemo((): PackageDataTableColumn<main.CachePackageInfo>[] => [
    {
      id: 'name',
      header: t('common.name'),
      sortable: true,
      defaultWidth: 180,
      sortValue: (pkg) => pkg.name,
      renderCell: (pkg) => (
        <span className="package-name-cell">
          <PackageIcon packageName={pkg.name} />
          <strong>{pkg.name}</strong>
        </span>
      ),
    },
    {
      id: 'version',
      header: t('common.version'),
      headerClassName: 'col-badge',
      cellClassName: 'col-badge',
      sortable: true,
      defaultWidth: 120,
      sortValue: (pkg) => pkg.version,
      renderCell: (pkg) => (
        <span className="cell-badge">
          <span className="pill">{pkg.version || t('common.dash')}</span>
        </span>
      ),
    },
    {
      id: 'size',
      header: t('common.size'),
      headerClassName: 'col-size',
      cellClassName: 'col-size',
      sortable: true,
      defaultWidth: 96,
      sortValue: (pkg) => pkg.size,
      renderCell: (pkg) => formatBytes(pkg.size),
    },
    {
      id: 'updatedAt',
      header: t('common.updatedAt'),
      sortable: true,
      defaultWidth: 160,
      sortValue: (pkg) => pkg.installed,
      renderCell: (pkg) => formatCacheTime(pkg.installed),
    },
    {
      id: 'files',
      header: t('common.files'),
      headerClassName: 'col-num',
      cellClassName: 'col-num',
      sortable: true,
      defaultWidth: 72,
      sortValue: (pkg) => pkg.fileCount,
      renderCell: (pkg) => pkg.fileCount,
    },
    {
      id: 'actions',
      header: t('common.actions'),
      headerClassName: 'col-actions',
      cellClassName: 'col-actions',
      sortable: false,
      defaultWidth: 72,
      minWidth: 48,
      renderCell: (pkg) => (
        <TableIconButton
          variant="danger"
          icon="trash"
          title={t('storageExt.purgeTitle')}
          ariaLabel={t('storageExt.purgeAria', { name: pkg.name })}
          disabled={opsBusy}
          onClick={() => setPendingPurge(pkg)}
        />
      ),
    },
  ], [opsBusy, t])
  const canPrev = page > 1
  const canNext = page < totalPages

  useEffect(() => {
    setPage(1)
  }, [pageSize, packages.length])

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages))
  }, [totalPages])

  const handleConfirmPurge = () => {
    if (!pendingPurge) return
    const name = pendingPurge.name
    setError(null)
    setPendingPurge(null)
    void PurgeCachePackage(name).catch((err) => {
      setError(t('storageExt.purgeFailed', { error: String(err) }))
    })
  }

  const handleConfirmGc = () => {
    setError(null)
    setShowGcConfirm(false)
    void RunCacheGC().catch((err) => {
      setError(t('storageExt.gcFailed', { error: String(err) }))
    })
  }

  const gcRunning = cacheTasks.some((task) => task.kind === 'gc')

  return (
    <div className="storage-section">
      <div className="section-header">
        <div className="section-heading">
          <h2>{t('storage.title')}</h2>
          <p className="section-subtitle">{t('storageExt.subtitle')}</p>
        </div>
        <div className="storage-toolbar">
          <button
            type="button"
            className="secondary"
            disabled={loading || opsBusy}
            onClick={() => setShowGcConfirm(true)}
          >
            {gcRunning ? t('storage.gcRunning') : t('storage.gc')}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={loading || opsBusy}
            onClick={handleRefresh}
          >
            {refreshing ? t('app.refreshing') : t('app.refresh')}
          </button>
        </div>
      </div>

      {error && (
        <div className="storage-error" role="alert">
          {error}
          <button type="button" className="ghost" onClick={() => setError(null)} aria-label={t('common.dismiss')}>
            ×
          </button>
        </div>
      )}

      {loading && packages.length === 0 ? (
        <p className="empty-state">{t('app.loading')}</p>
      ) : packages.length === 0 ? (
        <div className="storage-empty">
          <p className="empty-state">{t('storageExt.empty')}</p>
          <p className="storage-empty-hint">{t('storageExt.emptyHint')}</p>
        </div>
      ) : (
        <>
          <div className="list-scroll" ref={listScrollRef as React.Ref<HTMLDivElement>}>
            <PackageDataTable
              tableId="storage"
              columns={storageColumns}
              rows={pageItems}
              rowKey={(pkg) => pkg.name}
            />
          </div>
          <ListPagination
            page={page}
            totalPages={totalPages}
            total={packages.length}
            totalUnit={t('common.unitPackages')}
            canPrev={canPrev}
            canNext={canNext}
            onPrev={() => setPage((p) => p - 1)}
            onNext={() => setPage((p) => p + 1)}
            disabled={loading || opsBusy}
          />
        </>
      )}

      {pendingPurge && (
        <ModalOverlay onClose={() => setPendingPurge(null)}>
          <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>{t('storageExt.purgeDialogTitle')}</h2>
              <ModalCloseButton onClick={() => setPendingPurge(null)} ariaLabel={t('app.cancel')} />
            </div>
            <div className="modal-body">
              <p>
                <Trans
                  i18nKey="storageExt.purgeDialogBody"
                  values={{
                    name: pendingPurge.name,
                    version: pendingPurge.version ? `@${pendingPurge.version}` : '',
                  }}
                  components={{ strong: <strong /> }}
                />
              </p>
              <p className="storage-confirm-note">{t('storageExt.purgeDialogNote')}</p>
            </div>
            <div className="confirm-dialog-footer">
              <button type="button" className="secondary" onClick={() => setPendingPurge(null)}>
                {t('app.cancel')}
              </button>
              <button type="button" className="primary danger" onClick={handleConfirmPurge}>
                {t('app.delete')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showGcConfirm && (
        <ModalOverlay onClose={() => setShowGcConfirm(false)}>
          <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>{t('storageExt.gcDialogTitle')}</h2>
              <ModalCloseButton onClick={() => setShowGcConfirm(false)} ariaLabel={t('common.dismiss')} />
            </div>
            <div className="modal-body">
              <p>{t('storageExt.gcDialogBody')}</p>
              <p className="storage-confirm-note">
                <Trans i18nKey="storageExt.gcDialogNote" components={{ code: <code /> }} />
              </p>
            </div>
            <div className="confirm-dialog-footer">
              <button type="button" className="secondary" onClick={() => setShowGcConfirm(false)}>
                {t('app.cancel')}
              </button>
              <button type="button" className="primary" onClick={handleConfirmGc}>
                {t('storageExt.gcStart')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
