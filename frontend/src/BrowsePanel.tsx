import { type RefObject } from 'react'
import type { main } from '../wailsjs/go/models'
import BrowseManifestPanel from './BrowseManifestPanel'
import BucketBrowsePanel from './BucketBrowsePanel'
import './BrowsePanel.css'

interface BrowsePanelProps {
  refreshKey: number
  focusSearchToken: number
  hideDeprecated: boolean
  indexReady: boolean
  pageSize: number
  listScrollRef?: RefObject<HTMLDivElement | null>
  isPackageInstalled: (name: string) => boolean
  operationBusy: boolean
  isPackageInstalling: (ref: string) => boolean
  onInstall: (ref: string, intent?: 'install' | 'upgrade') => void
  onInspectManifest: (ref: string) => void
  manifestPreview?: { packageRef: string; manifest: main.InstallManifestInfo } | null
  onCloseManifest?: () => void
  onManifestUpdated?: () => void | Promise<void>
  onError: (message: string) => void
  onInfo: (message: string) => void
}

export default function BrowsePanel({
  refreshKey,
  focusSearchToken,
  hideDeprecated,
  indexReady,
  pageSize,
  listScrollRef,
  isPackageInstalled,
  operationBusy,
  isPackageInstalling,
  onInstall,
  onInspectManifest,
  manifestPreview,
  onCloseManifest,
  onManifestUpdated,
  onError,
  onInfo,
}: BrowsePanelProps) {
  return (
    <div className="browse-section">
      <BucketBrowsePanel
        refreshKey={refreshKey}
        focusSearchToken={focusSearchToken}
        hideDeprecated={hideDeprecated}
        indexReady={indexReady}
        pageSize={pageSize}
        listScrollRef={listScrollRef}
        isPackageInstalled={isPackageInstalled}
        operationBusy={operationBusy}
        isPackageInstalling={isPackageInstalling}
        onInstall={onInstall}
        onInspectManifest={onInspectManifest}
        onError={onError}
        onInfo={onInfo}
      />

      {manifestPreview && onCloseManifest ? (
        <BrowseManifestPanel
          packageRef={manifestPreview.packageRef}
          manifest={manifestPreview.manifest}
          onClose={onCloseManifest}
          onManifestUpdated={onManifestUpdated}
        />
      ) : null}
    </div>
  )
}
