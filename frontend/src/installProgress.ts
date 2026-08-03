export interface InstallProgress {
  name?: string
  phase: string
  status: string
  percentage: number
  message: string
  messageKey?: string
  messageArgs?: Record<string, unknown>
  bytesDown: number
  bytesTotal: number
}

export interface DownloadTransferStats {
  bytesPerSec: number
  etaSeconds: number | null
}

const PHASE_RANK: Record<string, number> = {
  Starting: 0,
  resolve: 10,
  bootstrap: 20,
  download: 30,
  extract: 40,
  link: 50,
  shim: 60,
  index: 70,
  complete: 80,
  error: 90,
}

function phaseRank(phase: string): number {
  return PHASE_RANK[phase] ?? -1
}

/** Network download finished; engine may still hash/store the archive before extract. */
export function isDownloadPhaseComplete(progress: InstallProgress): boolean {
  return progress.phase === 'download' && progress.status === 'success'
}

/** Still transferring bytes over the network. */
export function isActivelyDownloading(progress: InstallProgress): boolean {
  return progress.phase === 'download' && !isDownloadPhaseComplete(progress)
}

/**
 * Phase key for UI labels. After download success the backend keeps phase=download
 * while it hashes the zip into the store — show "prepare extract" instead of "download".
 */
export function installDisplayPhase(progress: InstallProgress): string {
  if (isDownloadPhaseComplete(progress)) {
    return 'prepare_extract'
  }
  return progress.phase
}

/** True when status text is still a download message but UI phase has moved on. */
export function isStaleDownloadStatus(progress: InstallProgress): boolean {
  const key = progress.messageKey ?? ''
  if (!key.startsWith('progress.download.')) return false
  return installDisplayPhase(progress) !== 'download'
}

/** Drop stale phase regressions and clear download byte counters after leaving download. */
export function mergeInstallProgress(
  prev: InstallProgress | undefined,
  incoming: InstallProgress,
): InstallProgress {
  const next: InstallProgress = { ...incoming }
  if (!prev) {
    return sanitizeProgressBytes(next)
  }
  if (
    incoming.phase === 'error' ||
    incoming.status === 'failed' ||
    incoming.status === 'cancelled'
  ) {
    return next
  }
  const prevRank = phaseRank(prev.phase)
  const nextRank = phaseRank(next.phase)
  if (prevRank >= 0 && nextRank >= 0 && nextRank < prevRank) {
    return {
      ...prev,
      percentage: Math.max(prev.percentage, incoming.percentage),
    }
  }
  return sanitizeProgressBytes(next, prev)
}

function sanitizeProgressBytes(
  progress: InstallProgress,
  prev?: InstallProgress,
): InstallProgress {
  if (progress.phase !== 'download' || isDownloadPhaseComplete(progress)) {
    return { ...progress, bytesDown: 0, bytesTotal: 0 }
  }
  if (prev && (prev.phase !== 'download' || isDownloadPhaseComplete(prev))) {
    return { ...progress, bytesDown: 0, bytesTotal: 0 }
  }
  return progress
}

export function operationProgressDisplay(progress: InstallProgress): {
  barPct: number
  indeterminate: boolean
  showPercent: boolean
} {
  if (isActivelyDownloading(progress)) {
    if (progress.bytesTotal > 0) {
      const pct = Math.min(100, (progress.bytesDown / progress.bytesTotal) * 100)
      return { barPct: pct, indeterminate: false, showPercent: true }
    }
    return { barPct: 0, indeterminate: true, showPercent: false }
  }
  // Post-download store ingest has no byte events; avoid a stuck 100% bar.
  if (isDownloadPhaseComplete(progress)) {
    return { barPct: 0, indeterminate: true, showPercent: false }
  }
  if (progress.phase === 'complete' && progress.status === 'success') {
    return { barPct: 100, indeterminate: false, showPercent: true }
  }
  if (progress.phase === 'extract') {
    if (progress.percentage > 0) {
      return {
        barPct: Math.min(100, progress.percentage),
        indeterminate: false,
        showPercent: true,
      }
    }
    return { barPct: 0, indeterminate: true, showPercent: false }
  }
  if (progress.percentage > 0) {
    return {
      barPct: Math.min(100, progress.percentage),
      indeterminate: false,
      showPercent: true,
    }
  }
  return { barPct: 0, indeterminate: true, showPercent: false }
}

type RateSample = { t: number; bytes: number }

const downloadRateTrackers = new Map<string, RateSample[]>()

/** Reset rate samples (e.g. when an install leaves the download phase). */
export function clearDownloadRateTracker(id: string): void {
  downloadRateTrackers.delete(id)
}

/**
 * Rolling download speed / ETA from byte progress samples.
 * Call on each progress update (and on a 1s tick) while actively downloading.
 */
export function sampleDownloadTransferStats(
  id: string,
  progress: InstallProgress,
  now = Date.now(),
): DownloadTransferStats | null {
  if (!isActivelyDownloading(progress) || progress.bytesTotal <= 0) {
    downloadRateTrackers.delete(id)
    return null
  }

  const samples = downloadRateTrackers.get(id) ?? []
  const last = samples[samples.length - 1]
  if (!last || last.bytes !== progress.bytesDown || now - last.t >= 250) {
    samples.push({ t: now, bytes: progress.bytesDown })
  }
  const cutoff = now - 5000
  const trimmed = samples.filter((s) => s.t >= cutoff)
  downloadRateTrackers.set(id, trimmed)

  if (trimmed.length < 2) {
    return { bytesPerSec: 0, etaSeconds: null }
  }
  const first = trimmed[0]
  const end = trimmed[trimmed.length - 1]
  const dt = (end.t - first.t) / 1000
  if (dt <= 0.2) {
    return { bytesPerSec: 0, etaSeconds: null }
  }
  const bytesPerSec = Math.max(0, (end.bytes - first.bytes) / dt)
  const remaining = Math.max(0, progress.bytesTotal - progress.bytesDown)
  const etaSeconds = bytesPerSec > 256 ? remaining / bytesPerSec : null
  return { bytesPerSec, etaSeconds }
}

export function formatTransferSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytesPerSec
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}/s`
}

/** Compact remaining time, e.g. 45s / 3m 20s / 1h 05m */
export function formatEtaDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total}s`
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m`
  }
  if (m >= 10) {
    return `${m}m`
  }
  return `${m}m ${String(s).padStart(2, '0')}s`
}
