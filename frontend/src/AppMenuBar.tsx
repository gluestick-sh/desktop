import { useState, useEffect, useRef, useMemo } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import NavIcon, { type NavIconName } from './NavIcon'
import type { PageSizeMode } from './listPageSize'
import {
  buildThemeMenuEntries,
  type ThemeDefinition,
  type ThemeId,
} from './themes'
import { APP_LOCALES, LOCALE_NATIVE_NAMES, type AppLocale } from './i18n/locales'
import './AppMenuBar.css'

export type ThemeMenuAction = `theme:${string}`
export type LocaleMenuAction = `locale:${AppLocale}`

export type MenuAction =
  | 'open-root-dir'
  | 'quit'
  | 'tab:buckets'
  | 'tab:browse'
  | 'tab:templates'
  | 'tab:installed'
  | 'tab:updates'
  | 'tab:storage'
  | 'tab:activity'
  | 'buckets:update-all'
  | 'buckets:add'
  | 'zoom:in'
  | 'zoom:out'
  | 'zoom:reset'
  | ThemeMenuAction
  | 'page-size:auto'
  | 'page-size:10'
  | 'page-size:15'
  | 'page-size:20'
  | 'page-size:30'
  | 'page-size:50'
  | 'deprecated:hide'
  | 'deprecated:show'
  | 'pro'
  | 'export-inventory'
  | 'template-definitions:export'
  | 'template-definitions:import'
  | 'search'
  | 'check-updates'
  | 'docs'
  | 'check-desktop-update'
  | 'doctor'
  | 'github-proxy'
  | 'download-workers'
  | 'bucket-check-interval:5'
  | 'bucket-check-interval:15'
  | 'bucket-check-interval:30'
  | 'bucket-sync-mode:auto'
  | 'bucket-sync-mode:manual'
  | LocaleMenuAction
  | 'about'

type MenuGroupId = 'file' | 'view' | 'packages' | 'tools' | 'help'

type MenuEntry =
  | { type: 'separator' }
  | { label: string; action: MenuAction; shortcut?: string; icon?: NavIconName; locked?: boolean }
  | { label: string; submenu: MenuEntry[] }

type MenuGroup = {
  id: MenuGroupId
  label: string
  accessKey?: string
  items: MenuEntry[]
}

function buildMenuGroups(t: TFunction, customThemes: ThemeDefinition[], isPro: boolean): MenuGroup[] {
  const themeSubmenu: MenuEntry[] = buildThemeMenuEntries(t, customThemes, isPro).map((entry) => {
    if (entry.action === 'separator') return { type: 'separator' as const }
    return {
      label: entry.label,
      action: entry.action as MenuAction,
      locked: entry.locked,
    }
  })

  const pageSizeSubmenu: MenuEntry[] = [
    { label: t('menu.pageSizeAuto'), action: 'page-size:auto' },
    { type: 'separator' },
    ...([10, 15, 20, 30, 50] as const).map((n) => ({
      label: t('menu.pageSizeN', { n }),
      action: `page-size:${n}` as MenuAction,
    })),
  ]

  const deprecatedSubmenu: MenuEntry[] = [
    { label: t('menu.deprecatedHide'), action: 'deprecated:hide' },
    { label: t('menu.deprecatedShow'), action: 'deprecated:show' },
  ]

  const bucketSyncSubmenu: MenuEntry[] = [
    ...([5, 15, 30] as const).map((n) => ({
      label: t('menu.bucketSyncIntervalMin', { n }),
      action: `bucket-check-interval:${n}` as MenuAction,
    })),
    { type: 'separator' },
    { label: t('menu.bucketSyncAuto'), action: 'bucket-sync-mode:auto' },
    { label: t('menu.bucketSyncManual'), action: 'bucket-sync-mode:manual' },
  ]

  const templateDefinitionsSubmenu: MenuEntry[] = [
    {
      label: t('menu.templateDefinitionsExport'),
      action: 'template-definitions:export',
      shortcut: 'Ctrl+Shift+T',
      icon: 'pro',
      locked: !isPro,
    },
    {
      label: t('menu.templateDefinitionsImport'),
      action: 'template-definitions:import',
      icon: 'pro',
      locked: !isPro,
    },
  ]

  return [
    {
      id: 'file',
      label: t('menu.file'),
      accessKey: 'F',
      items: [
        {
          label: t('menu.exportInventory'),
          action: 'export-inventory',
          shortcut: 'Ctrl+Shift+E',
          icon: 'pro',
          locked: !isPro,
        },
        {
          label: t('menu.templateDefinitions'),
          submenu: templateDefinitionsSubmenu,
        },
        { type: 'separator' },
        { label: t('menu.openRootDir'), action: 'open-root-dir' },
        { type: 'separator' },
        { label: t('menu.quit'), action: 'quit', shortcut: 'Ctrl+Q' },
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      accessKey: 'V',
      items: [
        { label: t('nav.buckets'), action: 'tab:buckets', shortcut: 'Ctrl+1', icon: 'bucket' },
        { label: t('nav.browse'), action: 'tab:browse', shortcut: 'Ctrl+2', icon: 'browse' },
        { label: t('nav.templates'), action: 'tab:templates', shortcut: 'Ctrl+3', icon: 'templates' },
        { label: t('nav.installed'), action: 'tab:installed', shortcut: 'Ctrl+4', icon: 'installed' },
        { label: t('nav.updates'), action: 'tab:updates', shortcut: 'Ctrl+5', icon: 'updates' },
        { label: t('nav.storage'), action: 'tab:storage', shortcut: 'Ctrl+6', icon: 'storage' },
        { label: t('nav.activity'), action: 'tab:activity', shortcut: 'Ctrl+7', icon: 'activity' },
        { type: 'separator' },
        { label: t('menu.zoomIn'), action: 'zoom:in', shortcut: 'Ctrl+=' },
        { label: t('menu.zoomOut'), action: 'zoom:out', shortcut: 'Ctrl+-' },
        { label: t('menu.zoomReset'), action: 'zoom:reset', shortcut: 'Ctrl+0' },
        { type: 'separator' },
        { label: t('menu.theme'), submenu: themeSubmenu },
        { label: t('menu.pageSize'), submenu: pageSizeSubmenu },
        { label: t('menu.deprecatedPackages'), submenu: deprecatedSubmenu },
      ],
    },
    {
      id: 'packages',
      label: t('menu.packages'),
      accessKey: 'P',
      items: [
        { label: t('menu.manageBuckets'), action: 'tab:buckets', shortcut: 'Ctrl+1', icon: 'bucket' },
        { label: t('menu.addBucket'), action: 'buckets:add' },
        { label: t('menu.updateAllBuckets'), action: 'buckets:update-all', shortcut: 'Ctrl+Shift+U' },
        { type: 'separator' },
        { label: t('menu.searchPackages'), action: 'search', shortcut: 'Ctrl+F', icon: 'browse' },
        { type: 'separator' },
        { label: t('menu.checkUpdates'), action: 'check-updates', shortcut: 'Ctrl+U' },
      ],
    },
    {
      id: 'tools',
      label: t('menu.tools'),
      accessKey: 'T',
      items: [
        { label: t('menu.doctor'), action: 'doctor' },
        { label: t('menu.githubProxy'), action: 'github-proxy' },
        { label: t('menu.downloadWorkers'), action: 'download-workers' },
        { label: t('menu.bucketSync'), submenu: bucketSyncSubmenu },
        { type: 'separator' },
        {
          label: t('menu.language'),
          submenu: APP_LOCALES.map((code) => ({
            label: LOCALE_NATIVE_NAMES[code],
            action: `locale:${code}` as LocaleMenuAction,
          })),
        },
      ],
    },
    {
      id: 'help',
      label: t('menu.help'),
      accessKey: 'H',
      items: [
        { label: t('menu.docs'), action: 'docs', shortcut: 'F1' },
        { label: t('menu.checkDesktopUpdate'), action: 'check-desktop-update' },
        { type: 'separator' },
        { label: t('menu.upgradePro'), action: 'pro', shortcut: 'Ctrl+Shift+P', icon: 'pro' },
        { type: 'separator' },
        { label: t('menu.about'), action: 'about' },
      ],
    },
  ]
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function MenuTriggerLabel({ label, accessKey }: { label: string; accessKey?: string }) {
  if (!accessKey) return <>{label}</>
  return (
    <>
      {label}
      <span className="menubar-access-key">({accessKey})</span>
    </>
  )
}

function isSeparator(entry: MenuEntry): entry is { type: 'separator' } {
  return 'type' in entry && entry.type === 'separator'
}

function hasSubmenu(entry: MenuEntry): entry is { label: string; submenu: MenuEntry[] } {
  return 'submenu' in entry
}

function isThemeSelected(action: MenuAction, themeId: ThemeId): boolean {
  return action === `theme:${themeId}`
}

function isPageSizeSelected(action: MenuAction, mode: PageSizeMode, pageSize: number): boolean {
  if (action === 'page-size:auto') return mode === 'auto'
  const match = action.match(/^page-size:(\d+)$/)
  if (!match) return false
  return mode === 'custom' && pageSize === parseInt(match[1], 10)
}

function isLocaleSelected(action: MenuAction, locale: AppLocale): boolean {
  return action === `locale:${locale}`
}

function isBucketCheckIntervalSelected(action: MenuAction, minutes: number): boolean {
  return action === `bucket-check-interval:${minutes}`
}

function isBucketSyncModeSelected(action: MenuAction, mode: string): boolean {
  if (action === 'bucket-sync-mode:auto') return mode === 'auto'
  if (action === 'bucket-sync-mode:manual') return mode === 'manual'
  return false
}

function isDeprecatedHiddenSelected(action: MenuAction, hideDeprecated: boolean): boolean {
  if (action === 'deprecated:hide') return hideDeprecated
  if (action === 'deprecated:show') return !hideDeprecated
  return false
}

function isSubmenuItemChecked(
  action: MenuAction,
  themeId: ThemeId,
  pageSizeMode: PageSizeMode,
  pageSize: number,
  locale: AppLocale,
  bucketCheckIntervalMinutes: number,
  bucketSyncMode: string,
  hideDeprecated: boolean,
): boolean {
  return (
    isThemeSelected(action, themeId) ||
    isPageSizeSelected(action, pageSizeMode, pageSize) ||
    isLocaleSelected(action, locale) ||
    isBucketCheckIntervalSelected(action, bucketCheckIntervalMinutes) ||
    isBucketSyncModeSelected(action, bucketSyncMode) ||
    isDeprecatedHiddenSelected(action, hideDeprecated)
  )
}

function menuItemsHaveIcon(items: MenuEntry[]): boolean {
  return items.some((entry) => {
    if (isSeparator(entry)) return false
    if (hasSubmenu(entry)) return menuItemsHaveIcon(entry.submenu)
    return !!entry.icon
  })
}

function menuItemsHaveTrailing(items: MenuEntry[]): boolean {
  return items.some((entry) => {
    if (isSeparator(entry)) return false
    if (hasSubmenu(entry)) return true
    return !!entry.shortcut || !!('locked' in entry && entry.locked)
  })
}

function submenuUsesCheckMarks(submenu: MenuEntry[]): boolean {
  return submenu.some((entry) => {
    if (isSeparator(entry) || hasSubmenu(entry)) return false
    const action = entry.action
    return (
      action.startsWith('theme:') ||
      action.startsWith('page-size:') ||
      action.startsWith('locale:') ||
      action.startsWith('bucket-check-interval:') ||
      action.startsWith('bucket-sync-mode:') ||
      action === 'deprecated:hide' ||
      action === 'deprecated:show'
    )
  })
}

function leafMenuEntry(
  entry: MenuEntry,
): entry is { label: string; action: MenuAction; shortcut?: string; icon?: NavIconName; locked?: boolean } {
  return !hasSubmenu(entry) && !isSeparator(entry)
}

function MenuRowContent({
  label,
  shortcut,
  icon,
  checked = false,
  locked = false,
  reserveCheck = false,
  reserveIcon = false,
  reserveTrailing = false,
  submenuArrow = false,
}: {
  label: string
  shortcut?: string
  icon?: NavIconName
  checked?: boolean
  locked?: boolean
  reserveCheck?: boolean
  reserveIcon?: boolean
  reserveTrailing?: boolean
  submenuArrow?: boolean
}) {
  const hasCheckSlot = checked || reserveCheck
  const hasIconSlot = !!icon || reserveIcon
  const hasTrailingSlot = !!shortcut || submenuArrow || reserveTrailing || locked

  return (
    <div
      className={[
        'menubar-row',
        hasCheckSlot ? 'has-check' : '',
        hasIconSlot ? 'has-icon' : '',
        hasTrailingSlot ? 'has-trailing' : '',
        locked ? 'is-locked' : '',
      ].filter(Boolean).join(' ')}
    >
      {hasCheckSlot && (
        <span className="menubar-item-check" aria-hidden={!checked}>
          {checked ? '✓' : ''}
        </span>
      )}
      {hasIconSlot && (
        <span className={`menubar-item-icon${icon === 'pro' ? ' is-pro' : ''}`} aria-hidden="true">
          {icon ? <NavIcon name={icon} className={icon === 'pro' ? 'nav-icon-pro' : undefined} /> : null}
        </span>
      )}
      <span className="menubar-item-label">{label}</span>
      {hasTrailingSlot && (
        <span className="menubar-item-trailing">
          {shortcut ? <span className="menubar-shortcut">{shortcut}</span> : null}
          {locked ? <span className="menubar-pro-lock" aria-hidden="true">🔒</span> : null}
          {submenuArrow ? (
            <span className="menubar-submenu-arrow" aria-hidden="true">
              ▸
            </span>
          ) : null}
        </span>
      )}
    </div>
  )
}

function DropdownItems({
  items,
  themeId,
  pageSizeMode,
  pageSize,
  locale,
  bucketCheckIntervalMinutes,
  bucketSyncMode,
  hideDeprecated,
  isActionDisabled,
  onSelect,
}: {
  items: MenuEntry[]
  themeId: ThemeId
  pageSizeMode: PageSizeMode
  pageSize: number
  locale: AppLocale
  bucketCheckIntervalMinutes: number
  bucketSyncMode: string
  hideDeprecated: boolean
  isActionDisabled?: (action: MenuAction) => boolean
  onSelect: (action: MenuAction) => void
}) {
  const reserveIcon = menuItemsHaveIcon(items)
  const reserveTrailing = menuItemsHaveTrailing(items)

  return (
    <ul className="menubar-dropdown-list">
      {items.map((entry, i) => {
        if (isSeparator(entry)) {
          return <li key={`sep-${i}`} className="menubar-separator" role="separator" />
        }
        if (hasSubmenu(entry)) {
          return (
            <li key={entry.label} className="menubar-dropdown-item has-submenu">
              <button type="button" className="menubar-dropdown-btn" aria-haspopup="true">
                <MenuRowContent
                  label={entry.label}
                  submenuArrow
                  reserveIcon={reserveIcon}
                  reserveTrailing={reserveTrailing}
                />
              </button>
              <ul className="menubar-submenu">
                {(() => {
                  const subReserveCheck = submenuUsesCheckMarks(entry.submenu)
                  const subReserveIcon = menuItemsHaveIcon(entry.submenu)
                  const subReserveTrailing = menuItemsHaveTrailing(entry.submenu)
                  return entry.submenu.map((sub, j) => {
                  if (isSeparator(sub)) {
                    return <li key={`sub-sep-${j}`} className="menubar-separator" role="separator" />
                  }
                  if (hasSubmenu(sub)) return null
                  if (!leafMenuEntry(sub)) return null
                  const locked = !!sub.locked
                  const disabled = !locked && isActionDisabled?.(sub.action) === true
                  return (
                    <li key={sub.label}>
                      <button
                        type="button"
                        className={[
                          'menubar-dropdown-btn',
                          locked ? 'is-locked-item' : '',
                          disabled ? 'is-disabled-item' : '',
                        ].filter(Boolean).join(' ')}
                        disabled={disabled}
                        onClick={() => onSelect(locked ? 'pro' : sub.action)}
                        role="menuitemradio"
                        aria-checked={!locked && isSubmenuItemChecked(sub.action, themeId, pageSizeMode, pageSize, locale, bucketCheckIntervalMinutes, bucketSyncMode, hideDeprecated)}
                      >
                        <MenuRowContent
                          label={sub.label}
                          shortcut={sub.shortcut}
                          icon={sub.icon}
                          checked={!locked && isSubmenuItemChecked(sub.action, themeId, pageSizeMode, pageSize, locale, bucketCheckIntervalMinutes, bucketSyncMode, hideDeprecated)}
                          locked={locked}
                          reserveCheck={subReserveCheck}
                          reserveIcon={subReserveIcon}
                          reserveTrailing={subReserveTrailing}
                        />
                      </button>
                    </li>
                  )
                  })
                })()}
              </ul>
            </li>
          )
        }
        const locked = 'locked' in entry && entry.locked
        const disabled = !locked && isActionDisabled?.(entry.action) === true
        return (
          <li key={entry.label}>
            <button
              type="button"
              className={[
                'menubar-dropdown-btn',
                locked ? 'is-locked-item' : '',
                disabled ? 'is-disabled-item' : '',
              ].filter(Boolean).join(' ')}
              disabled={disabled}
              onClick={() => onSelect(locked ? 'pro' : entry.action)}
            >
              <MenuRowContent
                label={entry.label}
                shortcut={entry.shortcut}
                icon={entry.icon}
                locked={locked}
                reserveIcon={reserveIcon}
                reserveTrailing={reserveTrailing}
              />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

interface AppMenuBarProps {
  onAction: (action: MenuAction) => void
  themeId: ThemeId
  isPro: boolean
  customThemes: ThemeDefinition[]
  pageSizeMode: PageSizeMode
  pageSize: number
  locale: AppLocale
  bucketCheckIntervalMinutes: number
  bucketSyncMode: string
  hideDeprecated: boolean
  isActionDisabled?: (action: MenuAction) => boolean
}

export default function AppMenuBar({
  onAction,
  themeId,
  isPro,
  customThemes,
  pageSizeMode,
  pageSize,
  locale,
  bucketCheckIntervalMinutes,
  bucketSyncMode,
  hideDeprecated,
  isActionDisabled,
}: AppMenuBarProps) {
  const { t } = useTranslation()
  const [openMenu, setOpenMenu] = useState<MenuGroupId | null>(null)
  const barRef = useRef<HTMLElement>(null)
  const menuGroups = useMemo(
    () => buildMenuGroups(t, customThemes, isPro),
    [t, customThemes, isPro],
  )

  const closeMenu = () => {
    setOpenMenu(null)
    const active = document.activeElement
    if (active instanceof HTMLElement && barRef.current?.contains(active)) {
      active.blur()
    }
  }

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        closeMenu()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMenu()
        return
      }
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (isEditableTarget(e.target)) return
      if (e.key.length !== 1) return

      const group = menuGroups.find(
        (item) => item.accessKey?.toLowerCase() === e.key.toLowerCase(),
      )
      if (!group) return

      e.preventDefault()
      setOpenMenu(group.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [menuGroups])

  const handleSelect = (action: MenuAction) => {
    closeMenu()
    onAction(action)
  }

  return (
    <nav className="app-menubar" ref={barRef} aria-label={t('menu.ariaLabel')}>
      {menuGroups.map((group) => (
        <div key={group.id} className="menubar-group">
          <button
            type="button"
            className={`menubar-trigger ${openMenu === group.id ? 'open' : ''}`}
            onClick={() => {
              if (openMenu === group.id) {
                closeMenu()
              } else {
                setOpenMenu(group.id)
              }
            }}
            aria-expanded={openMenu === group.id}
            aria-haspopup="true"
            aria-keyshortcuts={group.accessKey ? `Alt+${group.accessKey}` : undefined}
          >
            <MenuTriggerLabel label={group.label} accessKey={group.accessKey} />
          </button>
          {openMenu === group.id && (
            <div className="menubar-dropdown" role="menu">
              <DropdownItems
                items={group.items}
                themeId={themeId}
                pageSizeMode={pageSizeMode}
                pageSize={pageSize}
                locale={locale}
                bucketCheckIntervalMinutes={bucketCheckIntervalMinutes}
                bucketSyncMode={bucketSyncMode}
                hideDeprecated={hideDeprecated}
                isActionDisabled={isActionDisabled}
                onSelect={handleSelect}
              />
            </div>
          )}
        </div>
      ))}
    </nav>
  )
}
