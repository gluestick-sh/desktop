import { describe, expect, it } from 'vitest'
import {
  clearDownloadRateTracker,
  formatEtaDuration,
  formatTransferSpeed,
  installDisplayPhase,
  isStaleDownloadStatus,
  sampleDownloadTransferStats,
  type InstallProgress,
} from './installProgress'

function progress(partial: Partial<InstallProgress>): InstallProgress {
  return {
    phase: 'download',
    status: 'running',
    percentage: 0,
    message: '',
    bytesDown: 0,
    bytesTotal: 0,
    ...partial,
  }
}

describe('installDisplayPhase', () => {
  it('maps download success to prepare_extract', () => {
    expect(
      installDisplayPhase(progress({ status: 'success', percentage: 100 })),
    ).toBe('prepare_extract')
  })

  it('keeps extract phase', () => {
    expect(installDisplayPhase(progress({ phase: 'extract', percentage: 40 }))).toBe('extract')
  })
})

describe('isStaleDownloadStatus', () => {
  it('flags download copy after download success', () => {
    expect(
      isStaleDownloadStatus(
        progress({
          status: 'success',
          messageKey: 'progress.download.active',
          message: 'Downloading…',
        }),
      ),
    ).toBe(true)
  })

  it('flags download copy during extract', () => {
    expect(
      isStaleDownloadStatus(
        progress({
          phase: 'extract',
          messageKey: 'progress.download.complete',
          message: 'Downloaded 10 MB',
        }),
      ),
    ).toBe(true)
  })

  it('allows download copy while actively downloading', () => {
    expect(
      isStaleDownloadStatus(
        progress({
          messageKey: 'progress.download.active',
          message: 'Downloading…',
          bytesDown: 1,
          bytesTotal: 10,
        }),
      ),
    ).toBe(false)
  })
})

describe('sampleDownloadTransferStats', () => {
  it('computes speed and eta from samples', () => {
    clearDownloadRateTracker('pkg')
    const base = progress({ bytesDown: 0, bytesTotal: 10_000_000 })
    sampleDownloadTransferStats('pkg', base, 1_000)
    const stats = sampleDownloadTransferStats(
      'pkg',
      { ...base, bytesDown: 2_000_000 },
      2_000,
    )
    expect(stats).not.toBeNull()
    expect(stats!.bytesPerSec).toBeGreaterThan(1_000_000)
    expect(stats!.etaSeconds).toBeGreaterThan(0)
    clearDownloadRateTracker('pkg')
  })

  it('clears when not downloading', () => {
    clearDownloadRateTracker('pkg')
    sampleDownloadTransferStats(
      'pkg',
      progress({ bytesDown: 100, bytesTotal: 1000 }),
      1_000,
    )
    expect(
      sampleDownloadTransferStats(
        'pkg',
        progress({ phase: 'extract', percentage: 10 }),
        2_000,
      ),
    ).toBeNull()
  })
})

describe('format helpers', () => {
  it('formats speed and eta', () => {
    expect(formatTransferSpeed(0)).toBe('—')
    expect(formatTransferSpeed(1536)).toMatch(/KB\/s$/)
    expect(formatEtaDuration(null)).toBe('—')
    expect(formatEtaDuration(45)).toBe('45s')
    expect(formatEtaDuration(200)).toMatch(/^3m/)
  })
})
