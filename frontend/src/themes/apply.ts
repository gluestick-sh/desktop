import {
  WindowSetBackgroundColour,
  WindowSetDarkTheme,
  WindowSetLightTheme,
} from '../../wailsjs/runtime/runtime'
import { SetWindowChromeColors } from '../../wailsjs/go/main/App'
import type { ThemeDefinition, ThemeTokens } from './types'
import { THEME_TOKEN_KEYS } from './types'

const DERIVED_TOKEN_KEYS = [
  'row-hover',
  'ghost-hover-bg',
  'pill-bg',
  'tab-hover-bg',
] as const

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().replace(/^#/, '')
  if (normalized.length === 3) {
    return {
      r: parseInt(normalized[0] + normalized[0], 16),
      g: parseInt(normalized[1] + normalized[1], 16),
      b: parseInt(normalized[2] + normalized[2], 16),
    }
  }
  if (normalized.length === 6) {
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16),
    }
  }
  return null
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const channels = [rgb.r, rgb.g, rgb.b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function isLightTheme(tokens: ThemeTokens): boolean {
  return relativeLuminance(tokens['bg-primary']) > 0.5
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Sync native window chrome (title bar / border / webview fill) with the active theme. */
export function syncWindowChrome(tokens: ThemeTokens): void {
  try {
    if (isLightTheme(tokens)) {
      WindowSetLightTheme()
    } else {
      WindowSetDarkTheme()
    }
  } catch {
    // Ignore outside Wails (e.g. vite dev)
  }

  const bg = parseHex(tokens['bg-primary'])
  if (bg) {
    try {
      WindowSetBackgroundColour(bg.r, bg.g, bg.b, 255)
    } catch {
      // Ignore outside Wails
    }
  }

  // Match title bar to the menubar (bg-secondary) so the chrome doesn't stay system-black.
  const titleBar = tokens['bg-secondary']
  const titleText = tokens['text-primary']
  const border = tokens.border
  void SetWindowChromeColors(titleBar, titleText, border).catch(() => {
    // Window may not exist yet during very early boot; theme re-apply will retry.
  })
}

function deriveInteractiveTokens(tokens: ThemeTokens): Record<string, string> {
  const light = isLightTheme(tokens)
  const base = light ? '0, 0, 0' : '255, 255, 255'
  return {
    'row-hover': `rgba(${base}, ${light ? 0.04 : 0.02})`,
    'ghost-hover-bg': `rgba(${base}, 0.05)`,
    'pill-bg': `rgba(${base}, ${light ? 0.06 : 0.1})`,
    'tab-hover-bg': `rgba(${base}, 0.05)`,
  }
}

export function applyTheme(theme: ThemeDefinition): void {
  const root = document.documentElement
  const datasetId = theme.id.startsWith('custom:') ? 'custom' : theme.id
  root.dataset.theme = datasetId

  for (const key of THEME_TOKEN_KEYS) {
    root.style.setProperty(`--${key}`, theme.tokens[key])
  }

  const derived = deriveInteractiveTokens(theme.tokens)
  for (const key of DERIVED_TOKEN_KEYS) {
    root.style.setProperty(`--${key}`, derived[key])
  }

  syncWindowChrome(theme.tokens)
}

export function createThemeFromTokens(
  id: ThemeDefinition['id'],
  name: string,
  tier: ThemeDefinition['tier'],
  tokens: ThemeTokens,
): ThemeDefinition {
  return { id, name, tier, tokens }
}

export function cloneTokens(tokens: ThemeTokens): ThemeTokens {
  const copy = {} as ThemeTokens
  for (const key of THEME_TOKEN_KEYS) {
    copy[key] = tokens[key]
  }
  return copy
}

export function isValidThemeTokens(value: unknown): value is ThemeTokens {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return THEME_TOKEN_KEYS.every((key) => typeof record[key] === 'string' && record[key].length > 0)
}

export function parseImportedTheme(json: string): { name: string; tokens: ThemeTokens } | null {
  try {
    const data = JSON.parse(json) as { name?: string; tokens?: unknown }
    if (!data.name || !isValidThemeTokens(data.tokens)) return null
    return { name: data.name, tokens: data.tokens }
  } catch {
    return null
  }
}

export function exportThemeJson(name: string, tokens: ThemeTokens): string {
  return JSON.stringify({ version: 1, name, tokens }, null, 2)
}

export function generateCustomThemeId(): `custom:${string}` {
  const suffix = Math.random().toString(36).slice(2, 10)
  return `custom:${suffix}`
}
