import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GetCatalogBuckets, ResolveCatalogPackages } from '../wailsjs/go/main/App'
import type { main } from '../wailsjs/go/models'
import PackageInstallButton from './PackageInstallButton'
import PackageOpenButton from './PackageOpenButton'
import BrowseManifestPanel from './BrowseManifestPanel'
import TableIconButton from './TableIconButton'
import {
  TEMPLATE_CATEGORY_IDS,
  OFFICIAL_TEMPLATES,
  packageInstallRef,
  type TemplateCategoryId,
  type Template,
  type TemplateCategory,
  type TemplatePackage,
} from './templateLibrary'
import {
  addPackageToTemplate,
  getEffectiveTemplatePackages,
  isTemplateCustomized,
  remapPackageInTemplate,
  removePackageFromTemplate,
  resetTemplateOverride,
} from './templateStore'
import { exportTemplate } from './templates/io'
import TemplateRepairDialog, { type TemplateRepairTarget } from './TemplateRepairDialog'
import './TemplatePanel.css'

interface ResolvedTemplatePackage extends main.CatalogPackageInfo {
  templateLabel: string
  missing: boolean
}

interface EffectiveTemplate extends Template {
  customized: boolean
}

interface TemplatePanelProps {
  refreshKey: number
  indexReady: boolean
  isPackageInstalled: (name: string) => boolean
  operationBusy: boolean
  isPackageInstalling: (ref: string) => boolean
  onInstall: (ref: string, intent?: 'install' | 'upgrade') => void
  onInstallParallel: (refs: string[], options?: { force?: boolean }) => void
  onInspectManifest: (ref: string) => void
  manifestPreview?: { packageRef: string; manifest: main.InstallManifestInfo } | null
  onCloseManifest?: () => void
  onManifestUpdated?: () => void | Promise<void>
  onError: (message: string) => void
  onInfo?: (message: string) => void
}

function packageInstallRefFromInfo(pkg: main.CatalogPackageInfo): string {
  return packageInstallRef(pkg.name, pkg.bucket)
}

export default function TemplatePanel({
  refreshKey,
  indexReady,
  isPackageInstalled,
  operationBusy,
  isPackageInstalling,
  onInstall,
  onInstallParallel,
  onInspectManifest,
  manifestPreview,
  onCloseManifest,
  onManifestUpdated,
  onError,
  onInfo,
}: TemplatePanelProps) {
  const { t } = useTranslation()

  const renderManifestPreview = () => {
    if (!manifestPreview || !onCloseManifest) return null
    return (
      <BrowseManifestPanel
        packageRef={manifestPreview.packageRef}
        manifest={manifestPreview.manifest}
        onClose={onCloseManifest}
        onManifestUpdated={onManifestUpdated}
      />
    )
  }

  const templateTitle = useCallback((id: string) => t(`officialRecipes.items.${id}.title`), [t])
  const templateSummary = useCallback((id: string) => t(`officialRecipes.items.${id}.summary`), [t])
  const templateDescription = useCallback((id: string) => t(`officialRecipes.items.${id}.description`), [t])

  const renderTemplateDescription = useCallback((template: EffectiveTemplate) => {
    const base = templateDescription(template.id)
    if (!template.customized) {
      return base
    }
    if (template.packages.length === 0) {
      return t('officialRecipes.packagesEmpty')
    }
    return t('officialRecipes.customizedHint', { description: base, count: template.packages.length })
  }, [templateDescription, t])
  const categoryLabel = useCallback(
    (category: TemplateCategory | 'all') => t(`officialRecipes.categories.${category}`),
    [t],
  )

  const [categoryFilter, setCategoryFilter] = useState<TemplateCategory | 'all'>('all')
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [templateRevision, setTemplateRevision] = useState(0)
  const [templatePackages, setTemplatePackages] = useState<Record<string, ResolvedTemplatePackage[]>>({})
  const [buckets, setBuckets] = useState<main.CatalogBucketInfo[]>([])
  const [addForm, setAddForm] = useState({ name: '', bucket: '' })
  const [addingPackage, setAddingPackage] = useState(false)
  const [repairTarget, setRepairTarget] = useState<TemplateRepairTarget | null>(null)

  const bumpTemplates = useCallback(() => {
    setTemplateRevision((value) => value + 1)
  }, [])

  const templates = useMemo<EffectiveTemplate[]>(() => {
    return OFFICIAL_TEMPLATES.map((template) => ({
      ...template,
      packages: getEffectiveTemplatePackages(template),
      customized: isTemplateCustomized(template.id),
    }))
  }, [templateRevision])

  const visibleTemplates = useMemo(() => {
    if (categoryFilter === 'all') return templates
    return templates.filter((template) => template.category === categoryFilter)
  }, [templates, categoryFilter])

  const categoryPackageCounts = useMemo(() => {
    const counts = Object.fromEntries(TEMPLATE_CATEGORY_IDS.map((id) => [id, 0])) as Record<
      TemplateCategoryId,
      number
    >
    for (const template of templates) {
      const packageCount = template.packages.length
      counts[template.category] += packageCount
      counts.all += packageCount
    }
    return counts
  }, [templates])

  const categoryFilterLabel = useCallback(
    (id: TemplateCategory | 'all') =>
      t('officialRecipes.categoryWithCount', {
        label: categoryLabel(id),
        count: categoryPackageCounts[id],
      }),
    [t, categoryLabel, categoryPackageCounts],
  )

  const activeTemplate = useMemo(
    () => (activeTemplateId ? templates.find((item) => item.id === activeTemplateId) ?? null : null),
    [activeTemplateId, templates],
  )

  const templatePackageKey = useCallback((packages: TemplatePackage[]) => {
    return packages.map((pkg) => `${pkg.bucket ?? ''}:${pkg.name.toLowerCase()}`).join('|')
  }, [])

  const syncResolvedPackages = useCallback((
    prev: Record<string, ResolvedTemplatePackage[]>,
    template: EffectiveTemplate,
  ): ResolvedTemplatePackage[] => {
    const existing = new Map(
      (prev[template.id] ?? []).map((pkg) => [pkg.name.toLowerCase(), pkg]),
    )
    return template.packages.map((pkg) => {
      const hit = existing.get(pkg.name.toLowerCase())
      if (hit) {
        return { ...hit, templateLabel: pkg.label ?? hit.templateLabel }
      }
      return {
        name: pkg.name,
        version: '',
        description: '',
        bucket: pkg.bucket ?? '',
        homepage: '',
        deprecated: false,
        templateLabel: pkg.label ?? pkg.name,
        missing: true,
      }
    })
  }, [])

  const resolveTemplateItems = useCallback((template: EffectiveTemplate): ResolvedTemplatePackage[] => {
    return syncResolvedPackages(templatePackages, template)
  }, [templatePackages, syncResolvedPackages])

  const loadTemplatePackages = useCallback(async (templateId: string, requestKey: string) => {
    const official = OFFICIAL_TEMPLATES.find((item) => item.id === templateId)
    if (!official) return

    const packages = getEffectiveTemplatePackages(official)
    if (packages.length === 0) {
      setTemplatePackages((prev) => ({ ...prev, [templateId]: [] }))
      return
    }
    try {
      const resolved = await ResolveCatalogPackages(
        packages.map((pkg) => ({ name: pkg.name, bucket: pkg.bucket ?? '' })),
      )
      const currentPackages = getEffectiveTemplatePackages(official)
      const currentKey = templatePackageKey(currentPackages)
      if (currentKey !== requestKey) {
        return
      }
      const resolvedByName = new Map(resolved.map((pkg) => [pkg.name.toLowerCase(), pkg]))
      const items: ResolvedTemplatePackage[] = currentPackages.map((pkg) => {
        const hit = resolvedByName.get(pkg.name.toLowerCase())
        if (!hit) {
          return {
            name: pkg.name,
            version: '',
            description: t('officialRecipes.missingDescription'),
            bucket: pkg.bucket ?? '',
            homepage: '',
            deprecated: false,
            templateLabel: pkg.label ?? pkg.name,
            missing: true,
          }
        }
        return {
          ...hit,
          templateLabel: pkg.label ?? hit.name,
          missing: false,
        }
      })
      setTemplatePackages((prev) => ({ ...prev, [templateId]: items }))
    } catch (err) {
      onError(t('officialRecipes.loadFailed', { error: String(err) }))
    }
  }, [onError, t, templatePackageKey])

  useEffect(() => {
    if (!indexReady) return
    void GetCatalogBuckets({ hideDeprecated: false })
      .then((result) => setBuckets(result ?? []))
      .catch(() => setBuckets([]))
  }, [indexReady, refreshKey])

  useEffect(() => {
    setAddForm((prev) => {
      if (!prev.bucket || buckets.some((bucket) => bucket.name === prev.bucket)) {
        return prev
      }
      return { ...prev, bucket: buckets[0]?.name ?? '' }
    })
  }, [buckets])

  useEffect(() => {
    if (!indexReady) return
    setTemplatePackages((prev) => {
      const next = { ...prev }
      for (const template of templates) {
        next[template.id] = syncResolvedPackages(prev, template)
      }
      return next
    })
    for (const template of templates) {
      const requestKey = templatePackageKey(template.packages)
      void loadTemplatePackages(template.id, requestKey)
    }
  }, [indexReady, refreshKey, templates, loadTemplatePackages, syncResolvedPackages, templatePackageKey])

  const closeDetail = () => {
    setActiveTemplateId(null)
    setEditingTemplateId(null)
    setAddForm({ name: '', bucket: '' })
  }

  const openDetail = (template: EffectiveTemplate, edit = false) => {
    setActiveTemplateId(template.id)
    if (edit) {
      setEditingTemplateId(template.id)
      setAddForm({ name: '', bucket: buckets[0]?.name ?? '' })
    } else {
      setEditingTemplateId(null)
    }
  }

  const startEditing = (template: EffectiveTemplate) => {
    setEditingTemplateId(template.id)
    setAddForm({ name: '', bucket: buckets[0]?.name ?? '' })
  }

  const stopEditing = () => {
    setEditingTemplateId(null)
    setAddForm({ name: '', bucket: '' })
  }

  const handleRemovePackage = (templateId: string, packageName: string) => {
    removePackageFromTemplate(templateId, packageName)
    setTemplatePackages((prev) => {
      const key = packageName.toLowerCase()
      const items = (prev[templateId] ?? []).filter((pkg) => pkg.name.toLowerCase() !== key)
      return { ...prev, [templateId]: items }
    })
    bumpTemplates()
    onInfo?.(t('officialRecipes.removedFromRecipe', { name: packageName }))
  }

  const handleResetTemplate = (templateId: string) => {
    resetTemplateOverride(templateId)
    bumpTemplates()
    onInfo?.(t('officialRecipes.resetRecipeOk'))
  }

  const handleExportTemplate = (template: EffectiveTemplate) => {
    try {
      exportTemplate(template.id, templateTitle(template.id))
      onInfo?.(t('officialRecipes.exportOk', { title: templateTitle(template.id) }))
    } catch (err) {
      onError(t('officialRecipes.exportFailed', { error: String(err) }))
    }
  }

  const handleRepairPackage = (templateId: string, pkg: ResolvedTemplatePackage) => {
    setRepairTarget({
      templateId,
      name: pkg.name,
      bucket: pkg.bucket,
      label: pkg.templateLabel,
    })
  }

  const handleRepairConfirm = (replacement: main.CatalogPackageInfo) => {
    if (!repairTarget) return
    const target = repairTarget
    const ok = remapPackageInTemplate(
      target.templateId,
      target.name,
      { name: replacement.name, bucket: replacement.bucket },
      target.label,
    )
    setRepairTarget(null)
    if (!ok) {
      onError(t('officialRecipes.repairAlreadyInRecipe'))
      return
    }
    bumpTemplates()
    onInfo?.(
      t('officialRecipes.repairOk', {
        label: target.label,
        ref: packageInstallRef(replacement.name, replacement.bucket),
      }),
    )
  }

  const handleAddPackage = async (template: EffectiveTemplate) => {
    const name = addForm.name.trim()
    if (!name) {
      onError(t('officialRecipes.enterPackageName'))
      return
    }
    setAddingPackage(true)
    try {
      const resolved = await ResolveCatalogPackages([
        { name, bucket: addForm.bucket.trim() },
      ])
      const hit = resolved?.[0]
      if (!hit?.name) {
        onError(t('officialRecipes.packageNotFound'))
        return
      }
      const pkg: TemplatePackage = {
        name: hit.name,
        bucket: hit.bucket,
        label: hit.name,
      }
      const added = addPackageToTemplate(template.id, pkg)
      if (!added) {
        onError(t('officialRecipes.alreadyInRecipe'))
        return
      }
      bumpTemplates()
      setAddForm((prev) => ({ ...prev, name: '' }))
      onInfo?.(t('officialRecipes.addedToRecipe', { name: hit.name, title: templateTitle(template.id) }))
    } catch (err) {
      onError(t('officialRecipes.addFailed', { error: String(err) }))
    } finally {
      setAddingPackage(false)
    }
  }

  const installTemplate = (template: EffectiveTemplate, options?: { force?: boolean }) => {
    const items = resolveTemplateItems(template)
    const pending = items.filter((pkg) => !pkg.missing && !isPackageInstalled(pkg.name))
    if (pending.length === 0 || operationBusy) return
    const refs = pending.map((pkg) => packageInstallRefFromInfo(pkg))
    if (refs.length > 1 || options?.force) {
      onInstallParallel(refs, options)
      return
    }
    onInstall(refs[0])
  }

  const renderTemplateSummary = (template: EffectiveTemplate) => {
    const items = resolveTemplateItems(template)
    const available = items.filter((pkg) => !pkg.missing)
    const installedCount = available.filter((pkg) => isPackageInstalled(pkg.name)).length
    const pendingCount = available.length - installedCount

    return { items, available, installedCount, pendingCount }
  }

  const installButtonLabel = (pendingCount: number, installedCount: number) => {
    if (pendingCount > 0) return t('officialRecipes.installPending', { count: pendingCount })
    if (installedCount > 0) return t('officialRecipes.allInstalled')
    return t('officialRecipes.unavailable')
  }

  const installButtonDisabled = (pendingCount: number) => pendingCount <= 0 || operationBusy

  const renderPackageChips = (
    template: EffectiveTemplate,
    items: ResolvedTemplatePackage[],
    editing: boolean,
  ) => (
    <div className="template-packages">
      {items.length === 0 && template.packages.length === 0 ? (
        <span className="template-package is-empty">{t('officialRecipes.packagesEmpty')}</span>
      ) : (
        items.map((pkg) => (
          <span
            key={`${template.id}-${pkg.name}`}
            className={`template-package${pkg.missing ? ' is-missing' : isPackageInstalled(pkg.name) ? ' is-installed' : ''}`}
            title={pkg.description}
          >
            {pkg.templateLabel}
            {editing ? (
              <button
                type="button"
                className="template-package-remove"
                aria-label={t('officialRecipes.removeFromRecipeAria', { name: pkg.templateLabel })}
                title={t('officialRecipes.removeFromRecipe')}
                onClick={() => handleRemovePackage(template.id, pkg.name)}
              >
                ?
              </button>
            ) : null}
          </span>
        ))
      )}
    </div>
  )

  const renderDetailList = (template: EffectiveTemplate, items: ResolvedTemplatePackage[], editing: boolean) => (
    <div className="template-detail">
      {items.length === 0 ? (
        <p className="template-detail-empty">{t('officialRecipes.detailEmpty')}</p>
      ) : (
        items.map((pkg) => (
          <div key={`${template.id}-detail-${pkg.name}`} className="template-detail-item">
            <div className="template-detail-main">
              <div className="template-detail-name">
                {pkg.templateLabel}
                {!pkg.missing ? (
                  <span className="pill" style={{ marginLeft: 8 }}>{pkg.bucket}</span>
                ) : null}
              </div>
              <div className="template-detail-desc">{pkg.description || t('common.dash')}</div>
            </div>
            <span className="cell-actions">
              {editing ? (
                <button
                  type="button"
                  className="secondary template-detail-remove"
                  onClick={() => handleRemovePackage(template.id, pkg.name)}
                >
                  {t('common.remove')}
                </button>
              ) : !pkg.missing ? (
                isPackageInstalled(pkg.name) ? (
                  <>
                    <span className="pill success">{t('browse.installed')}</span>
                    <PackageOpenButton
                      packageName={pkg.name}
                      onError={onError}
                    />
                  </>
                ) : (
                  <>
                    <TableIconButton
                      icon="manifest"
                      title={t('package.manifest.viewTitle')}
                      ariaLabel={t('package.manifest.viewAria', { name: packageInstallRefFromInfo(pkg) })}
                      onClick={(e) => {
                        e.stopPropagation()
                        onInspectManifest(packageInstallRefFromInfo(pkg))
                      }}
                    />
                    <PackageInstallButton
                      packageName={pkg.name}
                      title={
                        isPackageInstalling(packageInstallRefFromInfo(pkg))
                          ? t('package.install.installing')
                          : t('package.install.install')
                      }
                      busy={isPackageInstalling(packageInstallRefFromInfo(pkg))}
                      disabled={operationBusy}
                      onInstall={() => onInstall(packageInstallRefFromInfo(pkg))}
                    />
                  </>
                )
              ) : (
                <>
                  <span className="pill">{t('officialRecipes.notIndexed')}</span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => handleRepairPackage(template.id, pkg)}
                  >
                    {t('officialRecipes.repair')}
                  </button>
                </>
              )}
            </span>
          </div>
        ))
      )}
      {editing ? (
        <div className="template-add-form">
          <p className="template-add-label">{t('officialRecipes.addPackage')}</p>
          <div className="template-add-row">
            <input
              type="text"
              placeholder={t('officialRecipes.addPackagePlaceholder')}
              value={addForm.name}
              onChange={(e) => setAddForm((prev) => ({ ...prev, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleAddPackage(template)
                }
              }}
            />
            <select
              value={addForm.bucket}
              onChange={(e) => setAddForm((prev) => ({ ...prev, bucket: e.target.value }))}
              aria-label={t('common.bucket')}
            >
              <option value="">{t('officialRecipes.autoMatch')}</option>
              {buckets.map((bucket) => (
                <option key={bucket.name} value={bucket.name}>
                  {bucket.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="primary"
              disabled={addingPackage || !addForm.name.trim()}
              onClick={() => void handleAddPackage(template)}
            >
              {addingPackage ? t('common.adding') : t('officialRecipes.addPackage')}
            </button>
          </div>
          <p className="template-add-hint">{t('officialRecipes.addHint')}</p>
        </div>
      ) : null}
    </div>
  )

  if (!indexReady) {
    return (
      <div className="template-section">
        <div className="section-header">
          <div className="section-heading">
            <h2>{t('officialRecipes.title')}</h2>
            <p className="section-subtitle">{t('officialRecipes.indexPendingSubtitle')}</p>
          </div>
        </div>
        <div className="template-scroll-body">
          <p className="template-index-pending">{t('officialRecipes.indexPending')}</p>
        </div>
      </div>
    )
  }

  if (activeTemplate) {
    const editing = editingTemplateId === activeTemplate.id
    const { items, installedCount, pendingCount } = renderTemplateSummary(activeTemplate)

    return (
      <div className="template-section template-detail-view">
        <div className="template-detail-toolbar">
          <button type="button" className="secondary template-back-btn" onClick={closeDetail}>
            {t('officialRecipes.back')}
          </button>
          <div className="template-detail-toolbar-actions">
            {editing ? (
              <>
                <button type="button" className="primary" onClick={stopEditing}>
                  {t('officialRecipes.finishEdit')}
                </button>
                {activeTemplate.customized ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => handleResetTemplate(activeTemplate.id)}
                  >
                    {t('officialRecipes.resetDefault')}
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <button type="button" className="secondary" onClick={() => startEditing(activeTemplate)}>
                  {t('officialRecipes.edit')}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => handleExportTemplate(activeTemplate)}
                >
                  {t('officialRecipes.export')}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={installButtonDisabled(pendingCount)}
                  onClick={() => installTemplate(activeTemplate)}
                >
                  {installButtonLabel(pendingCount, installedCount)}
                </button>
                {pendingCount > 0 ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={installButtonDisabled(pendingCount)}
                    title={t('officialRecipes.forceInstallHint')}
                    onClick={() => installTemplate(activeTemplate, { force: true })}
                  >
                    {t('officialRecipes.forceInstallPending', { count: pendingCount })}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="template-scroll-body">
          <article className={`template-detail-panel${editing ? ' is-editing' : ''}`}>
            <div className="template-head">
              <div className="template-icon" aria-hidden="true">
                {activeTemplate.icon}
              </div>
              <div className="template-heading">
                <div className="template-title-row">
                  <h4 className="template-title">{templateTitle(activeTemplate.id)}</h4>
                  <span className="template-category">{categoryLabel(activeTemplate.category)}</span>
                  {activeTemplate.customized ? (
                    <span className="template-customized">{t('officialRecipes.customized')}</span>
                  ) : null}
                </div>
                <p className="template-summary">{templateSummary(activeTemplate.id)}</p>
              </div>
            </div>
            <p className="template-desc">{renderTemplateDescription(activeTemplate)}</p>
            {renderPackageChips(activeTemplate, items, editing)}
            {renderDetailList(activeTemplate, items, editing)}
          </article>
          {renderManifestPreview()}
        </div>
        {repairTarget ? (
          <TemplateRepairDialog
            target={repairTarget}
            buckets={buckets}
            onClose={() => setRepairTarget(null)}
            onConfirm={handleRepairConfirm}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="template-section">
      <div className="section-header">
        <div className="section-heading">
          <h2>{t('officialRecipes.title')}</h2>
          <p className="section-subtitle">{t('officialRecipes.subtitle')}</p>
        </div>
        <div className="template-filter-group" role="group" aria-label={t('officialRecipes.filterAria')}>
          {TEMPLATE_CATEGORY_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`template-filter-btn${categoryFilter === id ? ' active' : ''}`}
              onClick={() => setCategoryFilter(id)}
              aria-label={categoryFilterLabel(id)}
            >
              {categoryFilterLabel(id)}
            </button>
          ))}
        </div>
      </div>

      <div className="template-scroll-body">
        {visibleTemplates.length === 0 ? (
          <p className="empty-state">{t('officialRecipes.emptyCategory')}</p>
        ) : (
          <div className="template-grid">
            {visibleTemplates.map((template) => {
              const { items, installedCount, pendingCount } = renderTemplateSummary(template)
              return (
                <article key={template.id} className="template-card">
                  <div className="template-head">
                    <div className="template-icon" aria-hidden="true">{template.icon}</div>
                    <div className="template-heading">
                      <div className="template-title-row">
                        <h4 className="template-title">{templateTitle(template.id)}</h4>
                        <span className="template-category">{categoryLabel(template.category)}</span>
                        {template.customized ? (
                          <span className="template-customized">{t('officialRecipes.customized')}</span>
                        ) : null}
                      </div>
                      <p className="template-summary">{templateSummary(template.id)}</p>
                    </div>
                  </div>
                  <p className="template-desc">{renderTemplateDescription(template)}</p>
                  {renderPackageChips(template, items, false)}
                  <div className="template-actions">
                    <button type="button" className="secondary" onClick={() => openDetail(template, false)}>
                      {t('officialRecipes.viewDetails')}
                    </button>
                    <button type="button" className="secondary" onClick={() => openDetail(template, true)}>
                      {t('officialRecipes.edit')}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={installButtonDisabled(pendingCount)}
                      onClick={() => installTemplate(template)}
                    >
                      {installButtonLabel(pendingCount, installedCount)}
                    </button>
                    {pendingCount > 0 ? (
                      <button
                        type="button"
                        className="secondary"
                        disabled={installButtonDisabled(pendingCount)}
                        title={t('officialRecipes.forceInstallHint')}
                        onClick={() => installTemplate(template, { force: true })}
                      >
                        {t('officialRecipes.forceInstallPending', { count: pendingCount })}
                      </button>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        )}
        {renderManifestPreview()}
        {repairTarget ? (
          <TemplateRepairDialog
            target={repairTarget}
            buckets={buckets}
            onClose={() => setRepairTarget(null)}
            onConfirm={handleRepairConfirm}
          />
        ) : null}
      </div>
    </div>
  )
}
