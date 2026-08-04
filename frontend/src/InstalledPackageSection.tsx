import { Fragment, useEffect, useMemo, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { main } from '../wailsjs/go/models'
import { getAppLocale } from './i18n'
import InstalledVersionPanel from './InstalledVersionPanel'
import ListPagination from './ListPagination'
import PackageInstallButton from './PackageInstallButton'
import PackageIcon from './PackageIcon'
import PackageOpenButton from './PackageOpenButton'
import TableIconButton from './TableIconButton'
import { openExternalUrl } from './openExternalUrl'
import PackageDataTable, { type PackageDataTableColumn } from './PackageDataTable'
import {
  isInstalledFavorite,
  loadInstalledFavorites,
  toggleInstalledFavorite,
} from './installedFavoritesStore'

export interface SelectedPackage {
  name: string
  version: string
  description?: string
  bucket?: string
  homepage?: string
  license?: string
  installedAt?: string
  isInstalled: boolean
}

function uninstallPackageKey(ref: string): string {
  const trimmed = ref.trim()
  const slash = trimmed.lastIndexOf('/')
  let base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  const at = base.indexOf('@')
  if (at >= 0) base = base.slice(0, at)
  return base.toLowerCase()
}

function isPackageUninstalling(
  currentUninstallName: string | null,
  packageName: string,
  _version?: string,
): boolean {
  if (!currentUninstallName) return false
  return uninstallPackageKey(currentUninstallName) === packageName.toLowerCase()
}

import { packageInstallRef } from './templateLibrary'
export function PackageDetailInline({ pkg }: { pkg: SelectedPackage }) {
  const { t } = useTranslation()
  return (
    <div className="package-detail-inline" onClick={(e) => e.stopPropagation()}>
      <div className="detail-col-group">
        <div className="detail-col detail-col-desc">
          <span className="detail-label">{t('package.detail.description')}</span>
          <p className="detail-value detail-text-wrap">{pkg.description || t('common.dash')}</p>
        </div>
        <div className="detail-col detail-col-homepage">
          <span className="detail-label">{t('package.detail.homepage')}</span>
          {pkg.homepage ? (
            <button
              type="button"
              className="detail-value detail-text-wrap link detail-external-link"
              onClick={(e) => openExternalUrl(pkg.homepage!, e)}
            >
              {pkg.homepage}
            </button>
          ) : (
            <span className="detail-value">{t('common.dash')}</span>
          )}
        </div>
      </div>
    </div>
  )
}

interface InstalledPackageSectionProps {
  title: string
  subtitle: string
  packages: main.InstalledPackage[]
  emptyState: string
  page: number
  onPageChange: (page: number | ((prev: number) => number)) => void
  pageSize: number
  loading: boolean
  listScrollRef?: RefObject<HTMLDivElement | null>
  onRefresh: () => void
  selectedPackage: SelectedPackage | null
  onTogglePackage: (pkg: main.InstalledPackage) => void
  flashUpdates?: boolean
  operationBusy: boolean
  isPackageInstalling: (ref: string) => boolean
  currentUninstallName: string | null
  onInstall: (ref: string, intent?: 'install' | 'upgrade') => void
  onUninstall: (pkg: main.InstalledPackage) => void
  onUninstallVersion: (packageName: string, version: string) => void
  onCleanReinstall: (pkg: main.InstalledPackage) => void
  onError: (message: string) => void
  onPackageChanged: () => void
  onMessage: (message: string) => void
  bumpActivityLog: () => void
  formatBytes: (bytes: number) => string
  onInspectInstalledManifest?: (packageName: string, version: string, bucket?: string) => void
  showFavorites?: boolean
}

export default function InstalledPackageSection({
  title,
  subtitle,
  packages,
  emptyState,
  page,
  onPageChange,
  pageSize,
  loading,
  listScrollRef,
  onRefresh,
  selectedPackage,
  onTogglePackage,
  flashUpdates = false,
  operationBusy,
  isPackageInstalling,
  currentUninstallName,
  onInstall,
  onUninstall,
  onUninstallVersion,
  onCleanReinstall,
  onError,
  onPackageChanged,
  onMessage,
  bumpActivityLog,
  formatBytes,
  onInspectInstalledManifest,
  showFavorites = false,
}: InstalledPackageSectionProps) {
  const { t } = useTranslation()
  const [favorites, setFavorites] = useState(() => loadInstalledFavorites())
  const [favoritesOnly, setFavoritesOnly] = useState(false)

  const formatDateTime = (raw: string) => {
    if (!raw) return t('common.dash')
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return raw
    return d.toLocaleString(getAppLocale())
  }

  const visiblePackages = useMemo(() => {
    if (!showFavorites || !favoritesOnly) return packages
    return packages.filter((pkg) => isInstalledFavorite(favorites, pkg.name))
  }, [packages, showFavorites, favoritesOnly, favorites])

  const favoriteCount = useMemo(
    () => packages.filter((pkg) => isInstalledFavorite(favorites, pkg.name)).length,
    [packages, favorites],
  )

  const totalPages = Math.max(1, Math.ceil(visiblePackages.length / pageSize))
  const pagePackages = visiblePackages.slice((page - 1) * pageSize, page * pageSize)
  const canPrev = page > 1
  const canNext = page < totalPages

  useEffect(() => {
    onPageChange((current) => Math.min(current, totalPages))
  }, [totalPages, onPageChange])

  useEffect(() => {
    if (!showFavorites || favoriteCount > 0) return
    setFavoritesOnly(false)
  }, [showFavorites, favoriteCount])

  const handleToggleFavorite = (packageName: string) => {
    setFavorites((prev) => toggleInstalledFavorite(prev, packageName))
  }

  const isPackageDetailExpanded = (name: string) => selectedPackage?.name === name

  const installedColumns = useMemo((): PackageDataTableColumn<main.InstalledPackage>[] => [
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
      defaultWidth: 140,
      sortValue: (pkg) => pkg.version,
      renderCell: (pkg) => (
        <span className="cell-badge">
          <span className="pill">{pkg.version}</span>
          {pkg.updateAvailable && pkg.latestVersion && pkg.latestVersion !== pkg.version && (
            <span className="pill version-arrow" title={t('package.latestInBucket')}>
              → {pkg.latestVersion}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('common.status'),
      sortable: true,
      defaultWidth: 100,
      sortValue: (pkg) => (pkg.versionLocked ? 0 : pkg.updateAvailable ? 1 : 2),
      renderCell: (pkg) =>
        pkg.versionLocked ? (
          <span className="pill info" title={t('installed.lockedHint')}>{t('installed.locked')}</span>
        ) : pkg.updateAvailable && pkg.latestVersion !== pkg.version ? (
          <span className="pill warning">{t('installed.updatable')}</span>
        ) : (
          <span className="pill success">{t('installed.latest')}</span>
        ),
    },
    {
      id: 'size',
      header: <span title={t('installedExt.sizeTitle')}>{t('installedExt.sizeColumn')}</span>,
      headerClassName: 'col-size',
      cellClassName: 'col-size',
      sortable: true,
      defaultWidth: 88,
      sortValue: (pkg) => pkg.installSize,
      renderCell: (pkg) => (pkg.installSize > 0 ? formatBytes(pkg.installSize) : t('common.dash')),
    },
    {
      id: 'installedAt',
      header: t('common.installedAt'),
      sortable: true,
      defaultWidth: 160,
      sortValue: (pkg) => pkg.installedAt,
      renderCell: (pkg) => formatDateTime(pkg.installedAt),
    },
    {
      id: 'bucket',
      header: t('common.bucket'),
      sortable: true,
      defaultWidth: 100,
      sortValue: (pkg) => pkg.bucket,
      renderCell: (pkg) => <span className="pill">{pkg.bucket || t('common.dash')}</span>,
    },
    {
      id: 'actions',
      header: t('common.actions'),
      headerClassName: 'col-actions',
      cellClassName: 'col-actions',
      sortable: false,
      defaultWidth: showFavorites ? 152 : 120,
      minWidth: 72,
      renderCell: (pkg) => (
        <span className="cell-actions">
          {showFavorites ? (
            <TableIconButton
              icon="favorite"
              active={isInstalledFavorite(favorites, pkg.name)}
              title={
                isInstalledFavorite(favorites, pkg.name)
                  ? t('installedExt.favoriteRemove')
                  : t('installedExt.favoriteAdd')
              }
              ariaLabel={
                isInstalledFavorite(favorites, pkg.name)
                  ? t('installedExt.favoriteRemoveAria', { name: pkg.name })
                  : t('installedExt.favoriteAddAria', { name: pkg.name })
              }
              onClick={(e) => {
                e.stopPropagation()
                handleToggleFavorite(pkg.name)
              }}
            />
          ) : null}
          <PackageOpenButton
            packageName={pkg.name}
            disabled={isPackageUninstalling(currentUninstallName, pkg.name, pkg.version)}
            onError={onError}
          />
          {pkg.updateAvailable && !pkg.versionLocked && pkg.latestVersion !== pkg.version && (
            <PackageInstallButton
              packageName={pkg.name}
              mode="upgrade"
              title={
                isPackageInstalling(packageInstallRef(pkg.name, pkg.bucket))
                  ? t('package.install.upgrading')
                  : pkg.latestVersion
                    ? t('package.upgradeTo', { version: pkg.latestVersion })
                    : t('package.upgradeToLatest')
              }
              busy={isPackageInstalling(packageInstallRef(pkg.name, pkg.bucket))}
              disabled={operationBusy || isPackageInstalling(packageInstallRef(pkg.name, pkg.bucket))}
              onInstall={() => onInstall(packageInstallRef(pkg.name, pkg.bucket), 'upgrade')}
            />
          )}
          <TableIconButton
            icon="refresh"
            title={
              isPackageInstalling(packageInstallRef(pkg.name, pkg.bucket)) ||
              isPackageUninstalling(currentUninstallName, pkg.name, pkg.version)
                ? t('package.cleanReinstallBusy')
                : t('package.cleanReinstall')
            }
            ariaLabel={t('package.cleanReinstallAria', { name: pkg.name })}
            disabled={
              operationBusy ||
              isPackageInstalling(packageInstallRef(pkg.name, pkg.bucket)) ||
              isPackageUninstalling(currentUninstallName, pkg.name, pkg.version)
            }
            onClick={(e) => {
              e.stopPropagation()
              onCleanReinstall(pkg)
            }}
          />
          <TableIconButton
            icon="trash"
            variant="danger"
            title={
              isPackageUninstalling(currentUninstallName, pkg.name, pkg.version)
                ? t('package.uninstalling')
                : t('package.uninstall')
            }
            ariaLabel={
              isPackageUninstalling(currentUninstallName, pkg.name, pkg.version)
                ? t('package.uninstallingAria', { name: pkg.name })
                : t('package.uninstallAria', { name: pkg.name })
            }
            disabled={
              operationBusy || isPackageInstalling(packageInstallRef(pkg.name, pkg.bucket))
            }
            busy={isPackageUninstalling(currentUninstallName, pkg.name, pkg.version)}
            onClick={(e) => {
              e.stopPropagation()
              onUninstall(pkg)
            }}
          />
        </span>
      ),
    },
  ], [
    t,
    formatBytes,
    formatDateTime,
    operationBusy,
    isPackageInstalling,
    currentUninstallName,
    onError,
    onInstall,
    onUninstall,
    onCleanReinstall,
    showFavorites,
    favorites,
  ])

  return (
    <div className="installed-section">
      <div className="section-header">
        <div className="section-heading">
          <h2>{title}</h2>
          <p className="section-subtitle">{subtitle}</p>
        </div>
        <div className="installed-toolbar-actions">
          {showFavorites ? (
            <button
              type="button"
              className={`secondary installed-favorites-filter${favoritesOnly ? ' active' : ''}`}
              onClick={() => {
                setFavoritesOnly((prev) => !prev)
                onPageChange(1)
              }}
              disabled={favoriteCount === 0 && !favoritesOnly}
              title={
                favoritesOnly
                  ? t('installedExt.favoritesFilterActive')
                  : t('installedExt.favoritesFilter')
              }
            >
              <span className="installed-favorites-filter-icon" aria-hidden="true">★</span>
              {t('installedExt.favoritesFilter')}
              {favoriteCount > 0 ? (
                <span className="installed-favorites-filter-count">{favoriteCount}</span>
              ) : null}
            </button>
          ) : null}
          <button className="secondary" onClick={onRefresh} disabled={loading}>
            {loading ? t('app.refreshing') : t('app.refresh')}
          </button>
        </div>
      </div>
      {packages.length === 0 ? (
        <p className="empty-state">{emptyState}</p>
      ) : visiblePackages.length === 0 ? (
        <p className="empty-state">{t('installedExt.favoritesEmpty')}</p>
      ) : (
        <>
          <div className="list-scroll" ref={listScrollRef}>
            <PackageDataTable
              tableId="installed"
              columns={installedColumns}
              rows={pagePackages}
              rowKey={(pkg) => pkg.name}
              renderRow={(pkg) => {
                const expanded = isPackageDetailExpanded(pkg.name)
                return (
                  <Fragment key={pkg.name}>
                    <tr
                      className={`${expanded ? 'selected row-expanded' : ''}${flashUpdates && pkg.updateAvailable ? ' row-update-flash' : ''}`}
                      onClick={() => onTogglePackage(pkg)}
                    >
                      {installedColumns.map((column) => (
                        <td key={column.id} className={column.cellClassName}>
                          {column.renderCell(pkg)}
                        </td>
                      ))}
                    </tr>
                    {expanded && selectedPackage ? (
                      <tr className="package-detail-row">
                        <td colSpan={installedColumns.length}>
                          <div className="installed-detail-stack" onClick={(e) => e.stopPropagation()}>
                            <PackageDetailInline pkg={selectedPackage} />
                            <InstalledVersionPanel
                              packageName={pkg.name}
                              bucket={pkg.bucket}
                              operationBusy={operationBusy}
                              isPackageInstalling={isPackageInstalling}
                              currentUninstallName={currentUninstallName}
                              onUninstallVersion={onUninstallVersion}
                              onInspectManifest={onInspectInstalledManifest}
                              onChanged={() => {
                                onPackageChanged()
                                bumpActivityLog()
                              }}
                              onMessage={onMessage}
                              onError={onError}
                            />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              }}
            />
          </div>
          <ListPagination
            page={page}
            totalPages={totalPages}
            total={visiblePackages.length}
            totalUnit={t('common.unitPackages')}
            canPrev={canPrev}
            canNext={canNext}
            onPrev={() => onPageChange((p) => p - 1)}
            onNext={() => onPageChange((p) => p + 1)}
            disabled={loading}
          />
        </>
      )}
    </div>
  )
}
