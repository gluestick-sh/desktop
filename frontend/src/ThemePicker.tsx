import { useTranslation } from 'react-i18next'
import ModalCloseButton from './ModalCloseButton'
import ModalOverlay from './ModalOverlay'
import {
  BUILTIN_THEMES,
  formatThemeLabel,
  type ThemeDefinition,
  type ThemeId,
} from './themes'
import './ThemePicker.css'

interface ThemePickerProps {
  themeId: ThemeId
  customThemes: ThemeDefinition[]
  onSelect: (id: ThemeId) => void
  onEditCustom: (theme: ThemeDefinition) => void
  onDeleteCustom: (id: ThemeId) => void
  onCreateCustom: () => void
  onClose: () => void
}

function ThemeSwatch({ theme }: { theme: ThemeDefinition }) {
  const { tokens } = theme
  return (
    <div className="theme-swatch" aria-hidden="true">
      <span className="theme-swatch-titlebar" style={{ background: tokens['bg-secondary'] }} />
      <span style={{ background: tokens['bg-primary'] }} />
      <span style={{ background: tokens.accent }} />
      <span style={{ background: tokens['text-primary'] }} />
    </div>
  )
}

function ThemeCard({
  theme,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: {
  theme: ThemeDefinition
  selected: boolean
  onSelect: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  const isCustom = theme.id.startsWith('custom:')
  const label = formatThemeLabel(theme, t)

  return (
    <div className={`theme-card${selected ? ' selected' : ''}`}>
      <button
        type="button"
        className="theme-card-main"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={label}
      >
        <ThemeSwatch theme={theme} />
        <span className="theme-card-name">{label}</span>
        {selected && <span className="theme-card-check" aria-hidden="true">✓</span>}
      </button>
      {isCustom && (onEdit || onDelete) && (
        <div className="theme-card-actions">
          {onEdit && (
            <button type="button" className="ghost" onClick={onEdit}>{t('theme.picker.edit')}</button>
          )}
          {onDelete && (
            <button type="button" className="ghost theme-card-delete" onClick={onDelete}>{t('theme.picker.delete')}</button>
          )}
        </div>
      )}
    </div>
  )
}

export default function ThemePicker({
  themeId,
  customThemes,
  onSelect,
  onEditCustom,
  onDeleteCustom,
  onCreateCustom,
  onClose,
}: ThemePickerProps) {
  const { t } = useTranslation()

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="modal theme-picker-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="theme-picker-title"
        aria-modal="true"
      >
        <div className="modal-header">
          <h2 id="theme-picker-title">{t('theme.picker.title')}</h2>
          <ModalCloseButton onClick={onClose} ariaLabel={t('app.close')} />
        </div>
        <div className="modal-body theme-picker-body">
          <section className="theme-picker-section">
            <div className="theme-picker-grid">
              {BUILTIN_THEMES.map((theme) => (
                <ThemeCard
                  key={theme.id}
                  theme={theme}
                  selected={themeId === theme.id}
                  onSelect={() => onSelect(theme.id)}
                />
              ))}
            </div>
          </section>

          <section className="theme-picker-section">
            <h3>{t('theme.picker.custom')}</h3>
            {customThemes.length === 0 ? (
              <p className="theme-picker-empty">{t('theme.picker.empty')}</p>
            ) : (
              <div className="theme-picker-grid">
                {customThemes.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    theme={theme}
                    selected={themeId === theme.id}
                    onSelect={() => onSelect(theme.id)}
                    onEdit={() => onEditCustom(theme)}
                    onDelete={() => onDeleteCustom(theme.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
        <div className="modal-footer">
          <button type="button" className="primary" onClick={onCreateCustom}>
            {t('theme.picker.createCustom')}
          </button>
          <button type="button" className="secondary" onClick={onClose}>{t('theme.picker.close')}</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
