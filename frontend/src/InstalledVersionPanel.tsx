import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  GetPackageVersions,
  SetPackageVersionLock,
  SwitchPackageVersion,
} from '../wailsjs/go/main/App'
import type { main } from '../wailsjs/go/models'
import { EventsOn } from '../wailsjs/runtime/runtime'
import SwitchVersionDialog from './SwitchVersionDialog'
import TableIconButton from './TableIconButton'

interface InstalledVersionPanelProps {
  packageName: string
  bucket?: string
  operationBusy: boolean
  isPackageInstalling: (ref: string) => boolean
  currentUninstallName: string | null
  onUninstallVersion: (packageName: string, version: string) => void
  onInspectManifest?: (packageName: string, version: string, bucket?: string) => void
  onChanged: () => void
  onMessage?: (message: string) => void
  onError?: (message: string) => void
}

function packageUninstallRef(name: string, version: string): string {
  return `${name}@${version}`
}

function uninstallPackageKey(ref: string): string {
  const trimmed = ref.trim()
  const slash = trimmed.lastIndexOf('/')
  let base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  const at = base.indexOf('@')
  if (at >= 0) base = base.slice(0, at)
  return base.toLowerCase()
}

function isVersionUninstalling(
  currentUninstallName: string | null,
  packageName: string,
  version: string,
): boolean {
  if (!currentUninstallName) return false
  if (currentUninstallName === packageUninstallRef(packageName, version)) return true
  // Whole-package operations (clean reinstall) mark every version row busy.
  return uninstallPackageKey(currentUninstallName) === packageName.toLowerCase()
}

export default function InstalledVersionPanel({
  packageName,
  bucket,
  operationBusy,
  isPackageInstalling,
  currentUninstallName,
  onUninstallVersion,
  onInspectManifest,
  onChanged,
  onMessage,
  onError,
}: InstalledVersionPanelProps) {
  const { t } = useTranslation()
  const [info, setInfo] = useState<main.PackageVersionsInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null)
  const installRef =
    bucket && bucket !== 'main' ? `${bucket}/${packageName}` : packageName
  const packageUpdating = isPackageInstalling(installRef)

  const loadVersions = useCallback(async () => {
    setLoading(true)
    try {
      const result = await GetPackageVersions(packageName)
      setInfo(result)
    } catch (err) {
      console.error('Failed to load package versions:', err)
      onError?.(t('installedExt.versions.loadFailed', { error: String(err) }))
      setInfo(null)
    } finally {
      setLoading(false)
    }
  }, [packageName, onError, t])

  useEffect(() => {
    void loadVersions()
  }, [loadVersions])

  useEffect(() => {
    const cancelComplete = EventsOn('uninstall:complete', (ref: string) => {
      if (ref === packageName || ref.startsWith(`${packageName}@`)) {
        void loadVersions()
      }
    })
    return () => {
      cancelComplete()
    }
  }, [packageName, loadVersions])

  const handleToggleLock = async () => {
    if (!info) return
    setBusy(true)
    try {
      const next = !info.versionLocked
      await SetPackageVersionLock(packageName, next)
      await loadVersions()
      onChanged()
      onMessage?.(
        next
          ? t('installedExt.versions.lockedOk', { name: packageName })
          : t('installedExt.versions.unlockedOk', { name: packageName }),
      )
    } catch (err) {
      onError?.(t('installedExt.versions.lockFailed', { error: String(err) }))
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmSwitch = async () => {
    if (!pendingSwitch) return
    setBusy(true)
    try {
      await SwitchPackageVersion(packageName, pendingSwitch)
      setPendingSwitch(null)
      await loadVersions()
      onChanged()
      onMessage?.(t('installedExt.versions.switchedOk', { name: packageName, version: pendingSwitch }))
    } catch (err) {
      onError?.(t('installedExt.versions.switchFailed', { error: String(err) }))
    } finally {
      setBusy(false)
    }
  }

  const versionCount = info?.versions.length ?? 0

  return (
    <div className="installed-version-panel">
      <div className="installed-version-header">
        <div>
          <h3 className="installed-version-title">{t('installedExt.versions.title')}</h3>
          <p className="installed-version-subtitle">{t('installedExt.versions.subtitle')}</p>
        </div>
        <button
          type="button"
          className="secondary installed-version-lock-btn"
          disabled={loading || busy || !info}
          onClick={() => void handleToggleLock()}
          title={t('installedExt.versions.lockTitle')}
        >
          {info?.versionLocked ? t('installedExt.versions.unlock') : t('installedExt.versions.lock')}
        </button>
      </div>

      {loading ? (
        <p className="installed-version-muted">{t('installedExt.versions.loading')}</p>
      ) : !info || versionCount === 0 ? (
        <p className="installed-version-muted">{t('installedExt.versions.empty')}</p>
      ) : (
        <ul className="installed-version-list">
          {info.versions.map((entry) => (
            <li
              key={entry.version}
              className={`installed-version-item${entry.active ? ' is-active' : ''}`}
            >
              <div className="installed-version-item-main">
                <span className="pill">{entry.version}</span>
                {entry.active ? <span className="pill success">{t('installedExt.versions.active')}</span> : null}
              </div>
              <div className="installed-version-item-actions">
                {!entry.active ? (
                  <>
                    <button
                      type="button"
                      className="secondary installed-version-switch-btn"
                      disabled={busy || operationBusy || packageUpdating}
                      onClick={() => setPendingSwitch(entry.version)}
                      title={t('installedExt.versions.switchTitle')}
                    >
                      {t('installedExt.versions.switch')}
                    </button>
                    <TableIconButton
                      icon="trash"
                      variant="danger"
                      title={
                        isVersionUninstalling(currentUninstallName, packageName, entry.version)
                          ? t('package.uninstalling')
                          : t('package.uninstall')
                      }
                      ariaLabel={
                        isVersionUninstalling(currentUninstallName, packageName, entry.version)
                          ? t('installedExt.versions.uninstallingVersionAria', {
                              name: packageName,
                              version: entry.version,
                            })
                          : t('installedExt.versions.uninstallVersionAria', {
                              name: packageName,
                              version: entry.version,
                            })
                      }
                      disabled={busy || operationBusy || packageUpdating}
                      busy={isVersionUninstalling(currentUninstallName, packageName, entry.version)}
                      onClick={(e) => {
                        e.stopPropagation()
                        onUninstallVersion(packageName, entry.version)
                      }}
                    />
                  </>
                ) : null}
                {onInspectManifest ? (
                  <TableIconButton
                    icon="manifest"
                    title={t('package.manifest.viewTitle')}
                    ariaLabel={t('installedExt.versions.manifestAria', {
                      name: packageName,
                      version: entry.version,
                    })}
                    disabled={busy || operationBusy || packageUpdating}
                    onClick={(e) => {
                      e.stopPropagation()
                      onInspectManifest(packageName, entry.version, bucket)
                    }}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {versionCount > 1 ? (
        <p className="installed-version-hint">
          <Trans i18nKey="installedExt.versions.hintMulti" components={{ code: <code /> }} />
        </p>
      ) : (
        <p className="installed-version-hint">{t('installedExt.versions.hintSingle')}</p>
      )}

      {pendingSwitch && (
        <SwitchVersionDialog
          packageName={packageName}
          version={pendingSwitch}
          busy={busy}
          onClose={() => setPendingSwitch(null)}
          onConfirm={() => void handleConfirmSwitch()}
        />
      )}
    </div>
  )
}
