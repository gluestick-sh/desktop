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
