import i18n from 'i18next'
import { getAppLocale } from './index'
import {
  installDisplayPhase,
  isStaleDownloadStatus,
  type InstallProgress,
} from '../installProgress'

export type MessageArgs = Record<string, unknown> | undefined

/**
 * Resolve a backend messageKey via locale resources.
 * Falls back to `message` — the English text engine already sets for CLI compatibility.
 */
export function formatKeyedMessage(
  messageKey: string | undefined,
  messageArgs: MessageArgs,
  fallbackMessage: string,
): string {
  if (messageKey && i18n.exists(messageKey)) {
    return i18n.t(messageKey, messageArgs as Record<string, string | number>)
  }
  if (fallbackMessage) {
    return fallbackMessage
  }
  if (messageKey && i18n.exists(messageKey)) {
    return i18n.t(messageKey, messageArgs as Record<string, string | number>)
  }
  return messageKey ?? ''
}

export function formatPhaseLabel(phase: string): string {
  for (const prefix of ['progress.phase', 'bucket.phase']) {
    const key = `${prefix}.${phase}`
    if (i18n.exists(key)) {
      return i18n.t(key)
    }
  }
  return phase
}

/**
 * Live install status line for dock / task center.
 * Avoids leaving "Downloading…" on screen after the UI phase has moved to
 * prepare-extract or extract.
 */
export function formatInstallStatusMessage(progress: InstallProgress): string {
  const displayPhase = installDisplayPhase(progress)
  if (isStaleDownloadStatus(progress)) {
    return formatPhaseLabel(displayPhase)
  }
  return formatKeyedMessage(progress.messageKey, progress.messageArgs, progress.message)
}

export function formatGCPhaseLabel(phase: string): string {
  return formatCachePhaseLabel(phase)
}

export function formatCachePhaseLabel(phase: string): string {
  for (const prefix of ['progress.gc.phase', 'progress.purge.phase', 'progress.cache.phase']) {
    const key = `${prefix}.${phase}`
    if (i18n.exists(key)) {
      return i18n.t(key)
    }
  }
  return phase
}

export function localeDateString(raw: string): string {
  if (!raw) return '-'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  return d.toLocaleString(getAppLocale())
}
