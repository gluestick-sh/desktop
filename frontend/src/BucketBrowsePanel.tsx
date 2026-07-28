import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { GetCatalogBuckets, HideCatalogPackage, ListCatalogPackages } from '../wailsjs/go/main/App'
import { EventsOn } from '../wailsjs/runtime/runtime'
import type { main } from '../wailsjs/go/models'
import PackageInstallButton from './PackageInstallButton'
import ListPagination from './ListPagination'
import PackageOpenButton from './PackageOpenButton'
import TableIconButton from './TableIconButton'
import AnchoredFlipMenu from './AnchoredFlipMenu'
import {
  OFFICIAL_TEMPLATES,
  bucketDisplayLabel,
  packageInstallRef,
} from './templateLibrary'
import { addPackageToTemplate } from './templateStore'
import { knownBucketDescription } from './i18n/bucketDescription'
import {
  addRecentSearch,
  catalogSearchHasResults,
  loadRecentSearches,
  removeRecentSearch,
} from './searchHistory'
import PackageDataTable, { type PackageDataTableColumn } from './PackageDataTable'
import './BrowsePanel.css'

/** Empty string means "all buckets". */
const ALL_BUCKETS = ''

interface BucketBrowsePanelProps {
  refreshKey: number
  focusSearchToken?: number
  hideDeprecated: boolean
  indexReady: boolean
  pageSize: number
  listScrollRef?: RefObject<HTMLDivElement>
  isPackageInstalled: (name: string) => boolean
  operationBusy: boolean
  isPackageInstalling: (ref: string) => boolean
  onInstall: (ref: string, intent?: 'install' | 'upgrade') => void
  onInspectManifest: (ref: string) => void
  onError: (message: string) => void
  onInfo?: (message: string) => void
}

function packageInstallRefFromInfo(pkg: main.CatalogPackageInfo): string {
  return packageInstallRef(pkg.name, pkg.bucket)
}

export default function BucketBrowsePanel({
  refreshKey,
  focusSearchToken = 0,
  hideDeprecated,
  indexReady,
  pageSize,
  listScrollRef,
  isPackageInstalled,
  operationBusy,
  isPackageInstalling,
  onInstall,
  onInspectManifest,
  onError,
  onInfo,
}: BucketBrowsePanelProps) {
  const { t } = useTranslation()
  const [buckets, setBuckets] = useState<main.CatalogBucketInfo[]>([])
  const [selectedBucket, setSelectedBucket] = useState(ALL_BUCKETS)
  const [bucketQuery, setBucketQuery] = useState('')
  /** Query keyword used for list requests (debounced, or synced immediately from recent search). */
  const [activeQuery, setActiveQuery] = useState('')
  const [bucketPage, setBucketPage] = useState(1)
  const [bucketData, setBucketData] = useState<main.CatalogPackagePage | null>(null)
  const [loadingPackages, setLoadingPackages] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [templateMenuFor, setTemplateMenuFor] = useState<string | null>(null)
  const [recentSearches, setRecentSearches] = useState(() => loadRecentSearches())
  const searchInputRef = useRef<HTMLInputElement>(null)
  const activeTemplateWrapRef = useRef<HTMLSpanElement>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const isAllBuckets = selectedBucket === ALL_BUCKETS

  useEffect(() => {
    debounceTimerRef.current = window.setTimeout(() => setActiveQuery(bucketQuery), 300)
    return () => window.clearTimeout(debounceTimerRef.current)
  }, [bucketQuery])

  const syncActiveQuery = useCallback((query: string) => {
    window.clearTimeout(debounceTimerRef.current)
    setActiveQuery(query)
  }, [])

  useEffect(() => {
    if (focusSearchToken === 0) return
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }, [focusSearchToken])

  const loadBuckets = useCallback(async () => {
    setError(null)
    try {
      const result = await GetCatalogBuckets({ hideDeprecated })
      setBuckets(result ?? [])
      setSelectedBucket((prev) => {
        if (prev === ALL_BUCKETS || (prev && result?.some((b) => b.name === prev))) {
          return prev
        }
        return ALL_BUCKETS
      })
    } catch (err) {
      console.error('Failed to load catalog buckets:', err)
      setError(t('browse.loadBucketsFailed', { error: String(err) }))
      setBuckets([])
    }
  }, [t, hideDeprecated])

  const loadBucketPackages = useCallback(async (targetPage: number) => {
    if (!indexReady) {
      setBucketData(null)
      return
    }
    if (selectedBucket === ALL_BUCKETS && !activeQuery.trim()) {
      setBucketData(null)
      setBucketPage(1)
      return
    }
    setLoadingPackages(true)
    setError(null)
    const querySnapshot = activeQuery.trim()
    try {
      const result = await ListCatalogPackages({
        bucket: selectedBucket,
        query: querySnapshot,
        page: targetPage,
        pageSize,
        hideDeprecated,
      })
      setBucketData(result)
      setBucketPage(targetPage)
      if (
        targetPage === 1 &&
        querySnapshot &&
        querySnapshot === activeQuery.trim() &&
        catalogSearchHasResults(result)
      ) {
        setRecentSearches(addRecentSearch(querySnapshot))
      }
    } catch (err) {
      console.error('Failed to load catalog packages:', err)
      setError(t('browse.loadPackagesFailed', { error: String(err) }))
      setBucketData(null)
    } finally {
      setLoadingPackages(false)
    }
  }, [indexReady, selectedBucket, activeQuery, pageSize, hideDeprecated, t])

  useEffect(() => {
    if (!indexReady) return
    void loadBuckets()
  }, [indexReady, refreshKey, hideDeprecated, loadBuckets])

  useEffect(() => {
    if (!indexReady) return
    const cancel = EventsOn('bucket:task:complete', () => {
      void loadBuckets()
    })
    return () => cancel()
  }, [indexReady, loadBuckets])

  useEffect(() => {
    if (!indexReady) return
    void loadBucketPackages(1)
  }, [indexReady, selectedBucket, activeQuery, pageSize, hideDeprecated, refreshKey, loadBucketPackages])

  useEffect(() => {
    setBucketPage(1)
  }, [pageSize, selectedBucket, activeQuery])

  useEffect(() => {
    if (!templateMenuFor) return
    const close = () => setTemplateMenuFor(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [templateMenuFor])

  const totalPackageCount = useMemo(
    () => buckets.reduce((sum, bucket) => sum + bucket.packageCount, 0),
    [buckets],
  )

  const selectedBucketInfo = useMemo(
    () => buckets.find((b) => b.name === selectedBucket) ?? null,
    [buckets, selectedBucket],
  )

  const bucketTotalPages = bucketData ? Math.max(1, Math.ceil(bucketData.total / pageSize)) : 1

  const searchPlaceholder = isAllBuckets
    ? t('browse.searchGlobal')
    : t('browse.searchInBucket', { bucket: selectedBucket })

  const scopeHint = isAllBuckets
    ? t('browse.scopeAll')
    : selectedBucketInfo
      ? bucketDisplayLabel(
          selectedBucketInfo.name,
          knownBucketDescription(selectedBucketInfo.name, selectedBucketInfo.description),
        )
      : t('browse.scopeSelect')

  const browseHeader = (
    <div className="section-header browse-section-header">
      <div className="section-heading">
        <h2>{t('browse.title')}</h2>
        <p className="section-subtitle">{t('browse.subtitle')}</p>
      </div>
      {indexReady && buckets.length > 0 ? (
        <div className="browse-toolbar">
          <select
            className="browse-bucket-select"
            value={selectedBucket}
            onChange={(e) => setSelectedBucket(e.target.value)}
            aria-label={t('browse.bucketFilterAria')}
            title={scopeHint}
          >
            <option value={ALL_BUCKETS}>
              {t('browse.all')} ({totalPackageCount})
            </option>
            {buckets.map((bucket) => (
              <option key={bucket.name} value={bucket.name}>
                {bucket.name} ({bucket.packageCount})
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  )

  const handleAddToTemplate = (templateId: string, pkg: main.CatalogPackageInfo) => {
    const template = OFFICIAL_TEMPLATES.find((item) => item.id === templateId)
    if (!template) return
    const added = addPackageToTemplate(templateId, {
      name: pkg.name,
      bucket: pkg.bucket,
      label: pkg.name,
    })
    setTemplateMenuFor(null)
    if (added) {
      onInfo?.(t('browse.addedToRecipe', { name: pkg.name, title: t(`officialRecipes.items.${template.id}.title`) }))
    } else {
      onError(t('browse.alreadyInRecipe'))
    }
  }

  const handleHideDeprecated = useCallback(
    async (pkg: main.CatalogPackageInfo) => {
      const installRef = packageInstallRefFromInfo(pkg)
      try {
        await HideCatalogPackage(installRef)
        onInfo?.(t('browse.removedDeprecated', { name: pkg.name }))
        await loadBuckets()
        await loadBucketPackages(bucketPage)
      } catch (err) {
        console.error('HideCatalogPackage failed:', err)
        onError(t('browse.removeDeprecatedFailed', { error: String(err) }))
      }
    },
    [bucketPage, loadBucketPackages, loadBuckets, onError, onInfo, t],
  )

  const browseColumns = useMemo((): PackageDataTableColumn<main.CatalogPackageInfo>[] => {
    const cols: PackageDataTableColumn<main.CatalogPackageInfo>[] = [
      {
        id: 'name',
        header: t('common.name'),
        sortable: true,
        defaultWidth: 160,
        sortValue: (pkg) => pkg.name,
        renderCell: (pkg) => (
          <span className="browse-name-cell">
            <strong>{pkg.name}</strong>
            {pkg.deprecated ? (
              <span className="pill pill-deprecated" title={t('browse.deprecatedBadgeHint')}>
                {t('browse.deprecatedBadge')}
              </span>
            ) : null}
          </span>
        ),
      },
    ]
    if (isAllBuckets) {
      cols.push({
        id: 'bucket',
        header: t('common.bucket'),
        sortable: true,
        defaultWidth: 120,
        sortValue: (pkg) => pkg.bucket,
        renderCell: (pkg) => <span className="pill">{pkg.bucket}</span>,
      })
    }
    cols.push(
      {
        id: 'version',
        header: t('common.version'),
        headerClassName: 'col-badge',
        cellClassName: 'col-badge',
        sortable: true,
        defaultWidth: 120,
        sortValue: (pkg) => pkg.version,
        renderCell: (pkg) => <span className="pill">{pkg.version || t('common.dash')}</span>,
      },
      {
        id: 'description',
        header: t('common.description'),
        sortable: true,
        defaultWidth: 280,
        sortValue: (pkg) => pkg.description,
        renderCell: (pkg) => pkg.description || t('common.dash'),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        headerClassName: 'col-actions',
        cellClassName: 'col-actions',
        sortable: false,
        defaultWidth: 140,
        minWidth: 96,
        renderCell: (pkg) => {
          const installRef = packageInstallRefFromInfo(pkg)
          const installed = isPackageInstalled(pkg.name)
          const menuKey = `${pkg.bucket}-${pkg.name}`
          return (
            <span className="cell-actions">
              <span
                className="bucket-template-menu-wrap"
                ref={templateMenuFor === menuKey ? activeTemplateWrapRef : undefined}
              >
                <TableIconButton
                  icon="template"
                  variant="accent"
                  hasMenu
                  title={t('browse.addToRecipe')}
                  ariaLabel={t('browse.addToRecipeAria', { name: pkg.name })}
                  onClick={(e) => {
                    e.stopPropagation()
                    setTemplateMenuFor((prev) => (prev === menuKey ? null : menuKey))
                  }}
                />
                {templateMenuFor === menuKey ? (
                  <AnchoredFlipMenu
                    open
                    anchorRef={activeTemplateWrapRef}
                    onClose={() => setTemplateMenuFor(null)}
                    zIndex={20}
                    className="bucket-template-menu"
                    role="menu"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {OFFICIAL_TEMPLATES.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        role="menuitem"
                        onClick={() => handleAddToTemplate(template.id, pkg)}
                      >
                        {template.icon} {t(`officialRecipes.items.${template.id}.title`)}
                      </button>
                    ))}
                  </AnchoredFlipMenu>
                ) : null}
              </span>
              {installed ? (
                <>
                  <span className="browse-installed-label">{t('browse.installed')}</span>
                  <PackageOpenButton packageName={pkg.name} onError={onError} />
                </>
              ) : (
                <>
                  {pkg.deprecated ? (
                    <TableIconButton
                      icon="trash"
                      variant="danger"
                      title={t('browse.removeDeprecated')}
                      ariaLabel={t('browse.removeDeprecatedAria', { name: pkg.name })}
                      disabled={operationBusy}
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleHideDeprecated(pkg)
                      }}
                    />
                  ) : null}
                  <TableIconButton
                    icon="manifest"
                    title={t('package.manifest.viewTitle')}
                    ariaLabel={t('package.manifest.viewAria', { name: installRef })}
                    onClick={(e) => {
                      e.stopPropagation()
                      onInspectManifest(installRef)
                    }}
                  />
                  <PackageInstallButton
                    packageName={pkg.name}
                    title={isPackageInstalling(installRef) ? t('package.install.installing') : t('package.install.install')}
                    busy={isPackageInstalling(installRef)}
                    disabled={operationBusy}
                    onInstall={() => onInstall(installRef)}
                  />
                </>
              )}
            </span>
          )
        },
      },
    )
    return cols
  }, [
    t,
    isAllBuckets,
    templateMenuFor,
    isPackageInstalled,
    isPackageInstalling,
    operationBusy,
    handleHideDeprecated,
    onError,
    onInspectManifest,
    onInstall,
  ])

  const handleRecentSearch = (term: string) => {
    setBucketQuery(term)
    syncActiveQuery(term)
    searchInputRef.current?.focus()
  }

  const handleRemoveRecentSearch = (term: string) => {
    setRecentSearches(removeRecentSearch(term))
  }

  const handleClearSearch = () => {
    setBucketQuery('')
    syncActiveQuery('')
    searchInputRef.current?.focus()
  }

  return (
    <div className="bucket-browse-panel">
      {browseHeader}

      {!indexReady ? (
        <p className="catalog-index-pending">{t('browse.indexPending')}</p>
      ) : (
        <>
          {error ? <p className="error-banner">{error}</p> : null}

          {buckets.length === 0 ? (
            <div className="catalog-empty-buckets">
              {t('browse.noBuckets')}
            </div>
          ) : (
            <>
              <div className="catalog-search-bar">
                <input
                  ref={searchInputRef}
                  type="search"
                  placeholder={searchPlaceholder}
                  value={bucketQuery}
                  onChange={(e) => setBucketQuery(e.target.value)}
                  onFocus={() => setRecentSearches(loadRecentSearches())}
                />
                {bucketQuery ? (
                  <button type="button" className="secondary" onClick={handleClearSearch}>
                    {t('browse.clear')}
                  </button>
                ) : null}
                {loadingPackages && bucketQuery !== activeQuery ? (
                  <span className="catalog-search-pending">{t('browse.searching')}</span>
                ) : null}
              </div>

              {recentSearches.length > 0 ? (
                <div className="search-recent" aria-label={t('browse.recentSearchesAria')}>
                  <span className="search-recent-label">{t('browse.recentSearches')}</span>
                  <ul className="search-recent-list">
                    {recentSearches.map((term) => (
                      <li key={term} className="search-recent-item">
                        <button
                          type="button"
                          className="search-recent-chip"
                          onClick={() => handleRecentSearch(term)}
                          title={t('browse.searchTerm', { term })}
                        >
                          {term}
                        </button>
                        <button
                          type="button"
                          className="search-recent-remove"
                          onClick={() => handleRemoveRecentSearch(term)}
                          aria-label={t('browse.removeRecentAria', { term })}
                          title={t('browse.removeRecent')}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!loadingPackages && isAllBuckets && !activeQuery.trim() ? (
                <p className="empty-state">
                  {t('browse.emptySearchHint')}
                </p>
              ) : !loadingPackages && bucketData && bucketData.total === 0 ? (
                <p className="empty-state">
                  {activeQuery.trim()
                    ? t('browse.noResults')
                    : t('browse.emptyBucket')}
                </p>
              ) : (
                <>
                  {bucketData && activeQuery.trim() ? (
                    <p className="browse-result-summary">{t('browse.resultSummary', { total: bucketData.total })}</p>
                  ) : null}
                  <div className="list-scroll" ref={listScrollRef}>
                    <PackageDataTable
                      tableId={isAllBuckets ? 'browse-all' : 'browse-bucket'}
                      columns={browseColumns}
                      rows={bucketData?.items ?? []}
                      rowKey={(pkg) => `${pkg.bucket}-${pkg.name}`}
                    />
                  </div>
                  <ListPagination
                    page={bucketPage}
                    totalPages={bucketTotalPages}
                    total={bucketData?.total ?? 0}
                    totalUnit={t('pagination.unit.packages')}
                    canPrev={bucketPage > 1}
                    canNext={bucketPage < bucketTotalPages}
                    onPrev={() => void loadBucketPackages(bucketPage - 1)}
                    onNext={() => void loadBucketPackages(bucketPage + 1)}
                    disabled={loadingPackages}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
