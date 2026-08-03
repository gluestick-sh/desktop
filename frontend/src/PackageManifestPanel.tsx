import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ClearManifestDownloadOverride,
  ClearManifestJSONOverride,
  SetManifestDownloadOverride,
  SetManifestJSONOverride,
} from '../wailsjs/go/main/App'
import type { main } from '../wailsjs/go/models'
import { openExternalUrl } from './openExternalUrl'
import { resolveManifestForArchitecture } from './installManifestUtils'
import TableIconButton from './TableIconButton'
import './PackageManifestPanel.css'

interface PackageManifestPanelProps {
  manifest: main.InstallManifestInfo
  packageRef?: string
  defaultExpanded?: boolean
  /** Dialog mode: always show content, no collapse toggle. */
  alwaysExpanded?: boolean
  /** When set, URLs/hashes/architecture reflect this manifest block. */
  architectureOverride?: string
  /** Hide version/architecture summary cards (e.g. when shown elsewhere). */
  hideMeta?: boolean
  /** Allow editing download URLs (bucket catalog manifests). */
  editable?: boolean
  onManifestUpdated?: () => void | Promise<void>
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
}

export default function PackageManifestPanel({
  manifest,
  packageRef,
  defaultExpanded = false,
  alwaysExpanded = false,
  architectureOverride,
  hideMeta = false,
  editable = false,
  onManifestUpdated,
}: PackageManifestPanelProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(defaultExpanded || alwaysExpanded)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [draftURL, setDraftURL] = useState('')
  const [editingJson, setEditingJson] = useState(false)
  const [draftJson, setDraftJson] = useState('')
  const [savingJson, setSavingJson] = useState(false)
  const [savingURL, setSavingURL] = useState(false)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const displayManifest = useMemo(
    () => resolveManifestForArchitecture(manifest, architectureOverride),
    [manifest, architectureOverride],
  )
  const downloadUrls = displayManifest.downloadUrls ?? []
  const bucketUrls = displayManifest.bucketDownloadUrls ?? []
  const singleDownloadUrl = downloadUrls.length === 1 ? downloadUrls[0] : null
  const canEditURL =
    editable && !!packageRef && downloadUrls.length > 0 && !displayManifest.jsonOverrideActive
  const canEditJSON = editable && !!packageRef && !!displayManifest.manifestJSON
  const bucketManifestJSON =
    displayManifest.bucketManifestJSON?.trim() || displayManifest.manifestJSON || ''

  const flashCopied = useCallback((key: string) => {
    setCopiedKey(key)
    window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500)
  }, [])

  const handleCopy = useCallback(
    async (key: string, text: string) => {
      try {
        await copyText(text)
        flashCopied(key)
      } catch (err) {
        console.error('Copy failed:', err)
      }
    },
    [flashCopied],
  )

  const copyLabel = (key: string) =>
    copiedKey === key ? t('package.manifest.copied') : t('package.manifest.copy')

  const beginEditURL = useCallback(
    (index: number) => {
      setEditingIndex(index)
      setDraftURL(downloadUrls[index] ?? '')
    },
    [downloadUrls],
  )

  const cancelEditURL = useCallback(() => {
    setEditingIndex(null)
    setDraftURL('')
  }, [])

  const saveEditURL = useCallback(async () => {
    if (!packageRef || editingIndex === null || savingURL) return
    const trimmed = draftURL.trim()
    const bucketURL = (bucketUrls[editingIndex] ?? bucketUrls[0] ?? '').trim()
    setSavingURL(true)
    try {
      if (trimmed === '' || trimmed === bucketURL) {
        await ClearManifestDownloadOverride(packageRef)
      } else {
        await SetManifestDownloadOverride(packageRef, trimmed)
      }
      setEditingIndex(null)
      setDraftURL('')
      await onManifestUpdated?.()
    } catch (err) {
      console.error('SetManifestDownloadOverride failed:', err)
    } finally {
      setSavingURL(false)
    }
  }, [packageRef, editingIndex, savingURL, draftURL, bucketUrls, onManifestUpdated])

  const beginEditJson = useCallback(() => {
    setJsonError(null)
    setEditingJson(true)
    setDraftJson(displayManifest.manifestJSON ?? '')
  }, [displayManifest.manifestJSON])

  const cancelEditJson = useCallback(() => {
    setEditingJson(false)
    setDraftJson('')
    setJsonError(null)
  }, [])

  const saveEditJson = useCallback(async () => {
    if (!packageRef || savingJson) return
    const trimmed = draftJson.trim()
    if (trimmed === '') {
      setJsonError(t('package.manifest.jsonEmpty'))
      return
    }
    try {
      JSON.parse(trimmed)
    } catch {
      setJsonError(t('package.manifest.jsonInvalid'))
      return
    }
    setSavingJson(true)
    setJsonError(null)
    try {
      if (trimmed === bucketManifestJSON.trim()) {
        await ClearManifestJSONOverride(packageRef)
      } else {
        await SetManifestJSONOverride(packageRef, trimmed)
      }
      setEditingJson(false)
      setDraftJson('')
      await onManifestUpdated?.()
    } catch (err) {
      console.error('SetManifestJSONOverride failed:', err)
      setJsonError(t('package.manifest.jsonSaveFailed', { error: String(err) }))
    } finally {
      setSavingJson(false)
    }
  }, [packageRef, savingJson, draftJson, bucketManifestJSON, onManifestUpdated, t])

  const clearStaleJsonOverride = useCallback(async () => {
    if (!packageRef || savingJson) return
    setSavingJson(true)
    try {
      await ClearManifestJSONOverride(packageRef)
      setEditingJson(false)
      setDraftJson('')
      setJsonError(null)
      await onManifestUpdated?.()
    } catch (err) {
      console.error('ClearManifestJSONOverride failed:', err)
      setJsonError(t('package.manifest.jsonSaveFailed', { error: String(err) }))
    } finally {
      setSavingJson(false)
    }
  }, [packageRef, savingJson, onManifestUpdated, t])

  const clearStaleUrlOverride = useCallback(async () => {
    if (!packageRef || savingURL) return
    setSavingURL(true)
    try {
      await ClearManifestDownloadOverride(packageRef)
      setEditingIndex(null)
      setDraftURL('')
      await onManifestUpdated?.()
    } catch (err) {
      console.error('ClearManifestDownloadOverride failed:', err)
    } finally {
      setSavingURL(false)
    }
  }, [packageRef, savingURL, onManifestUpdated])

  const renderUrlActions = (index: number, url: string) => (
    <span className="package-manifest-url-actions">
      {canEditURL ? (
        <TableIconButton
          icon="edit"
          title={t('package.manifest.editUrl')}
          ariaLabel={t('package.manifest.editUrlAria')}
          disabled={savingURL || editingIndex !== null}
          onClick={(e) => {
            e.stopPropagation()
            beginEditURL(index)
          }}
        />
      ) : null}
      <button
        type="button"
        className="ghost package-manifest-copy"
        onClick={() => void handleCopy(`url:${index}`, url)}
      >
        {copyLabel(`url:${index}`)}
      </button>
    </span>
  )

  const renderUrlBody = (index: number, url: string) => {
    if (editingIndex === index) {
      return (
        <div className="package-manifest-url-edit">
          <input
            type="url"
            className="package-manifest-url-input"
            value={draftURL}
            onChange={(e) => setDraftURL(e.target.value)}
            spellCheck={false}
            autoFocus
          />
          <div className="package-manifest-url-edit-actions">
            <button type="button" className="secondary" onClick={cancelEditURL} disabled={savingURL}>
              {t('app.cancel')}
            </button>
            <button type="button" className="primary" onClick={() => void saveEditURL()} disabled={savingURL}>
              {t('package.manifest.saveUrl')}
            </button>
          </div>
        </div>
      )
    }
    return (
      <button
        type="button"
        className="text-link package-manifest-url"
        onClick={(e) => openExternalUrl(url, e)}
        title={url}
      >
        {url}
      </button>
    )
  }

  const showBody = alwaysExpanded || expanded
  const title = packageRef || displayManifest.version
  const urlOverrideActive = displayManifest.urlOverrideActive
  const urlOverrideStale = displayManifest.urlOverrideStale
  const jsonOverrideActive = displayManifest.jsonOverrideActive
  const jsonOverrideStale = displayManifest.jsonOverrideStale

  return (
    <div className={`package-manifest-panel${alwaysExpanded ? ' package-manifest-panel-dialog' : ''}`}>
      {!alwaysExpanded && (
        <button
          type="button"
          className="package-manifest-toggle text-link"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? t('package.manifest.toggleHide') : t('package.manifest.toggleShow')}
        </button>
      )}
      {showBody && (
        <div className="package-manifest-body">
          {(displayManifest.version || displayManifest.architecture) && !alwaysExpanded && !hideMeta && (
            <div className="package-manifest-meta">
              <div className="package-manifest-meta-item">
                <span className="package-manifest-label">{t('package.manifest.version')}</span>
                <span className="package-manifest-value">{displayManifest.version || t('common.dash')}</span>
              </div>
              {displayManifest.architecture && (
                <div className="package-manifest-meta-item">
                  <span className="package-manifest-label">{t('package.manifest.architecture')}</span>
                  <span className="package-manifest-value">{displayManifest.architecture}</span>
                </div>
              )}
            </div>
          )}

          {displayManifest.manifestPath && (
            <section className="package-manifest-section">
              <div className="package-manifest-section-head">
                <span className="package-manifest-label">{t('package.manifest.path')}</span>
                <button
                  type="button"
                  className="ghost package-manifest-copy"
                  onClick={() => void handleCopy('path', displayManifest.manifestPath)}
                >
                  {copyLabel('path')}
                </button>
              </div>
              <code className="package-manifest-code-block">{displayManifest.manifestPath}</code>
            </section>
          )}

          {downloadUrls.length > 0 && (
            <section className="package-manifest-section">
              <div className="package-manifest-section-head">
                <span className="package-manifest-label">{t('package.manifest.downloadUrls')}</span>
                {singleDownloadUrl && editingIndex === null ? renderUrlActions(0, singleDownloadUrl) : null}
              </div>
              {urlOverrideActive ? (
                <p className="package-manifest-url-hint">{t('package.manifest.urlOverrideHint')}</p>
              ) : null}
              {urlOverrideStale ? (
                <div className="package-manifest-stale">
                  <p className="package-manifest-url-hint">{t('package.manifest.urlOverrideStale')}</p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void clearStaleUrlOverride()}
                    disabled={savingURL}
                  >
                    {t('package.manifest.clearUrlOverride')}
                  </button>
                </div>
              ) : null}
              {singleDownloadUrl ? (
                <div className="package-manifest-url-single">
                  {renderUrlBody(0, singleDownloadUrl)}
                </div>
              ) : (
                <ul className="package-manifest-url-list">
                  {downloadUrls.map((url, index) => (
                    <li key={`${url}-${index}`} className="package-manifest-url-row">
                      <span className="package-manifest-url-index" aria-hidden="true">
                        {index + 1}
                      </span>
                      <div className="package-manifest-url-main">
                        {renderUrlBody(index, url)}
                      </div>
                      {editingIndex === null ? renderUrlActions(index, url) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {displayManifest.hashes?.length > 0 && (
            <section className="package-manifest-section">
              <span className="package-manifest-label">{t('package.manifest.hashes')}</span>
              <ul className="package-manifest-hash-list">
                {displayManifest.hashes.map((hash) => (
                  <li key={hash}>
                    <code className="package-manifest-hash">{hash}</code>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {displayManifest.manifestJSON && (
            <section className="package-manifest-section">
              <div className="package-manifest-section-head">
                <span className="package-manifest-label">{t('package.manifest.json')}</span>
                {!editingJson ? (
                  <span className="package-manifest-url-actions">
                    {canEditJSON ? (
                      <TableIconButton
                        icon="edit"
                        title={t('package.manifest.editJson')}
                        ariaLabel={t('package.manifest.editJsonAria')}
                        disabled={savingJson || editingIndex !== null}
                        onClick={(e) => {
                          e.stopPropagation()
                          beginEditJson()
                        }}
                      />
                    ) : null}
                    <button
                      type="button"
                      className="ghost package-manifest-copy"
                      onClick={() => void handleCopy('json', displayManifest.manifestJSON)}
                    >
                      {copyLabel('json')}
                    </button>
                  </span>
                ) : null}
              </div>
              {jsonOverrideActive ? (
                <p className="package-manifest-url-hint">{t('package.manifest.jsonOverrideHint')}</p>
              ) : null}
              {jsonOverrideStale ? (
                <div className="package-manifest-json-stale">
                  <p className="package-manifest-url-hint">{t('package.manifest.jsonOverrideStale')}</p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void clearStaleJsonOverride()}
                    disabled={savingJson}
                  >
                    {t('package.manifest.clearJsonOverride')}
                  </button>
                </div>
              ) : null}
              {editingJson ? (
                <div className="package-manifest-json-edit">
                  <textarea
                    className="package-manifest-json-textarea"
                    value={draftJson}
                    onChange={(e) => setDraftJson(e.target.value)}
                    spellCheck={false}
                    autoFocus
                  />
                  {jsonError ? <p className="package-manifest-json-error">{jsonError}</p> : null}
                  <div className="package-manifest-url-edit-actions">
                    <button type="button" className="secondary" onClick={cancelEditJson} disabled={savingJson}>
                      {t('app.cancel')}
                    </button>
                    <button type="button" className="primary" onClick={() => void saveEditJson()} disabled={savingJson}>
                      {t('package.manifest.saveJson')}
                    </button>
                  </div>
                </div>
              ) : (
                <pre className="package-manifest-json">{displayManifest.manifestJSON}</pre>
              )}
            </section>
          )}

          {!displayManifest.manifestJSON && !downloadUrls.length && (
            <p className="package-manifest-empty">{title}</p>
          )}
        </div>
      )}
    </div>
  )
}
