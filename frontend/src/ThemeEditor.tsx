import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import ModalCloseButton from './ModalCloseButton'
import ModalOverlay from './ModalOverlay'
import {
  THEME_TOKEN_KEYS,
  MAX_CUSTOM_THEMES,
  type ThemeDefinition,
  type ThemeTokens,
  cloneTokens,
  contrastRatio,
  exportThemeJson,
  parseImportedTheme,
  generateCustomThemeId,
  createThemeFromTokens,
  isLightTheme,
  getBuiltinTheme,
} from './themes'
import './ThemeEditor.css'

interface ThemeEditorProps {
  initialTheme: ThemeDefinition | null
  customThemeCount: number
  copyFromTokens?: ThemeTokens
  onSave: (theme: ThemeDefinition) => void
  onApply: (tokens: ThemeTokens) => void
  onDelete?: (id: ThemeDefinition['id']) => void
  onClose: () => void
}

function ThemePreview({ tokens }: { tokens: ThemeTokens }) {
  const { t } = useTranslation()
  return (
    <div
      className="theme-preview"
      style={{
        background: tokens['bg-primary'],
        color: tokens['text-primary'],
        borderColor: tokens.border,
      }}
    >
      <div
        className="theme-preview-titlebar"
        style={{
          background: tokens['bg-secondary'],
          color: tokens['text-primary'],
          borderColor: tokens.border,
        }}
      >
        <span>Gluestick Desktop</span>
        <span className="theme-preview-titlebar-dots" aria-hidden="true">
          <i style={{ background: tokens['text-tertiary'] }} />
          <i style={{ background: tokens['text-tertiary'] }} />
          <i style={{ background: tokens.danger }} />
        </span>
      </div>
      <div className="theme-preview-header" style={{ background: tokens['bg-secondary'], borderColor: tokens.border }}>
        <span style={{ color: tokens['text-secondary'] }}>{t('theme.editor.previewMenu')}</span>
        <span className="theme-preview-accent" style={{ background: tokens.accent }} />
      </div>
      <div className="theme-preview-body" style={{ background: tokens['bg-card'], borderColor: tokens.border }}>
        <div className="theme-preview-row" style={{ color: tokens['text-primary'] }}>nodejs</div>
        <div className="theme-preview-row" style={{ color: tokens['text-secondary'] }}>v22.0.0</div>
        <div className="theme-preview-pills">
          <span style={{ background: tokens.accent, color: '#fff' }}>{t('theme.editor.previewInstall')}</span>
          <span style={{ background: `color-mix(in srgb, ${tokens.success} 20%, transparent)`, color: tokens.success }}>
            {t('theme.editor.previewSuccess')}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function ThemeEditor({
  initialTheme,
  customThemeCount,
  copyFromTokens,
  onSave,
  onApply,
  onDelete,
  onClose,
}: ThemeEditorProps) {
  const { t } = useTranslation()
  const defaultTokens = initialTheme?.tokens ?? getBuiltinTheme('dark').tokens
  const [name, setName] = useState(initialTheme?.name ?? t('theme.editor.defaultName'))
  const [tokens, setTokens] = useState<ThemeTokens>(() => cloneTokens(defaultTokens))
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isEditing = !!initialTheme
  const atLimit = !isEditing && customThemeCount >= MAX_CUSTOM_THEMES
  const textContrast = contrastRatio(tokens['text-primary'], tokens['bg-primary'])
  const lowContrast = textContrast < 4.5

  const updateToken = (key: keyof ThemeTokens, value: string) => {
    const next = { ...tokens, [key]: value }
    setTokens(next)
    onApply(next)
  }

  const handleReset = () => {
    const reset = cloneTokens(defaultTokens)
    setTokens(reset)
    onApply(reset)
    setError(null)
  }

  const handleCopyFromCurrent = () => {
    if (!copyFromTokens) return
    const copied = cloneTokens(copyFromTokens)
    setTokens(copied)
    onApply(copied)
    setError(null)
  }

  const handleDelete = () => {
    if (!initialTheme || !onDelete) return
    if (!window.confirm(t('theme.editor.deleteConfirm', { name: initialTheme.name }))) return
    onDelete(initialTheme.id)
    onClose()
  }

  const handleImport = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseImportedTheme(String(reader.result))
      if (!parsed) {
        setError(t('theme.editor.importError'))
        return
      }
      setName(parsed.name)
      setTokens(parsed.tokens)
      onApply(parsed.tokens)
      setError(null)
    }
    reader.readAsText(file)
  }

  const handleExport = () => {
    const defaultName = t('theme.editor.defaultName')
    const json = exportThemeJson(name.trim() || defaultName, tokens)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name.trim() || 'theme'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSave = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('theme.editor.nameRequired'))
      return
    }
    if (atLimit) {
      setError(t('theme.editor.maxCustom', { max: MAX_CUSTOM_THEMES }))
      return
    }
    const id = initialTheme?.id ?? generateCustomThemeId()
    const theme = createThemeFromTokens(id, trimmed, 'free', cloneTokens(tokens))
    onSave(theme)
    onClose()
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="modal theme-editor-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="theme-editor-title"
        aria-modal="true"
      >
        <div className="modal-header">
          <h2 id="theme-editor-title">{isEditing ? t('theme.editor.editTitle') : t('theme.editor.createTitle')}</h2>
          <ModalCloseButton onClick={onClose} ariaLabel={t('app.close')} />
        </div>
        <div className="modal-body theme-editor-body">
          <div className="theme-editor-layout">
            <div className="theme-editor-preview-col">
              <ThemePreview tokens={tokens} />
              <p className="theme-editor-hint">
                {isLightTheme(tokens) ? t('theme.editor.light') : t('theme.editor.dark')}
                {lowContrast && (
                  <span className="theme-editor-warn">{t('theme.editor.lowContrast', { ratio: textContrast.toFixed(1) })}</span>
                )}
              </p>
            </div>
            <div className="theme-editor-form-col">
              <label className="theme-editor-field">
                <span>{t('theme.editor.nameLabel')}</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('theme.editor.namePlaceholder')}
                />
              </label>
              <div className="theme-editor-tokens">
                {THEME_TOKEN_KEYS.map((key) => (
                  <label key={key} className="theme-editor-token-row">
                    <span className="theme-editor-token-label">{t(`theme.token.${key}`)}</span>
                    <input
                      type="color"
                      value={tokens[key]}
                      onChange={(e) => updateToken(key, e.target.value)}
                      aria-label={t(`theme.token.${key}`)}
                    />
                    <input
                      type="text"
                      className="theme-editor-token-hex"
                      value={tokens[key]}
                      onChange={(e) => {
                        const v = e.target.value
                        if (/^#[0-9a-fA-F]{0,6}$/.test(v)) updateToken(key, v)
                      }}
                      spellCheck={false}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
          {error && <p className="theme-editor-error">{error}</p>}
          <div className="theme-editor-toolbar">
            {copyFromTokens && (
              <button type="button" className="secondary" onClick={handleCopyFromCurrent}>
                {t('theme.editor.copyFromCurrent')}
              </button>
            )}
            <button type="button" className="secondary" onClick={handleReset}>{t('theme.editor.reset')}</button>
            <button type="button" className="secondary" onClick={() => fileInputRef.current?.click()}>
              {t('theme.editor.import')}
            </button>
            <button type="button" className="secondary" onClick={handleExport}>{t('theme.editor.export')}</button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleImport(file)
                e.target.value = ''
              }}
            />
          </div>
        </div>
        <div className="modal-footer">
          {isEditing && onDelete && (
            <button type="button" className="secondary theme-editor-delete-btn" onClick={handleDelete}>
              {t('theme.editor.delete')}
            </button>
          )}
          <button type="button" className="primary" onClick={handleSave} disabled={atLimit}>
            {t('theme.editor.saveApply')}
          </button>
          <button type="button" className="secondary" onClick={onClose}>{t('app.cancel')}</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
