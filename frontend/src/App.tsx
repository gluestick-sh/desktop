import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  ListInstalled,
  ListInstalledQuick,
  Install,
  CancelInstall,
  PlanInstall,
  SwitchPackageVersion,
  GetPackageManifestInspect,
  GetInstalledManifestInspect,
  Uninstall,
  GetStats,
  GetActivityLogPage,
  IsEngineReady,
  IsSearchIndexReady,
  OpenGlueDataDir,
  GetAboutInfo,
  CheckDesktopUpdate,
  DismissDesktopUpdate,
  OpenDesktopUpdateURL,
  UpdateBuckets,
  GetBucketSyncConfig,
  SetBucketCheckInterval,
  SetBucketSyncMode,
  RecordCheckUpdatesResult,
  RunDoctor,
} from '../wailsjs/go/main/App'
import InstalledPackageSection, { type SelectedPackage } from './InstalledPackageSection'
import ActivityLogPanel from './ActivityLogPanel'
import BucketPanel from './BucketPanel'
import { BootstrapTabProgress, BucketTabProgress, StorageCacheTabProgress, useCacheTasks } from './TabTopProgress'
import TemplatePanel from './TemplatePanel'
import BrowsePanel from './BrowsePanel'
import StoragePanel from './StoragePanel'
import { EventsOn, EventsOnce, Quit } from '../wailsjs/runtime/runtime'
import AppMenuBar, { type MenuAction } from './AppMenuBar'
import AboutDialog from './AboutDialog'
import DesktopUpdateDialog from './DesktopUpdateDialog'
import HelpDialog from './HelpDialog'
import GitHubProxyDialog from './GitHubProxyDialog'
import DownloadWorkersDialog from './DownloadWorkersDialog'
import ModalCloseButton from './ModalCloseButton'
import ModalOverlay from './ModalOverlay'
import InstallPackageDialog, { type PendingInstallPlan } from './InstallPackageDialog'
import SwitchVersionDialog from './SwitchVersionDialog'
import PackageManifestDialog from './PackageManifestDialog'
import { countTemplates } from './templateStore'
import { loadHideDeprecated, saveHideDeprecated } from './browsePreferences'
import { packageInstallRef, packageNameFromInstallRef } from './templateLibrary'
import ThemePicker from './ThemePicker'
import {
  applyTheme,
  canUseTheme,
  loadCustomThemes,
  loadStoredThemeId,
  resolveTheme,
  sanitizeThemeIdOnLoad,
  saveCustomThemes,
  saveThemeId,
  type ThemeDefinition,
  type ThemeId,
} from './themes'
import NavIcon, { type NavIconName } from './NavIcon'
import { useListPageSize } from './listPageSize'
import type { main } from '../wailsjs/go/models'
import { GLUESTICK_HOME_URL, openExternalUrl } from './openExternalUrl'
import { Trans, useTranslation } from 'react-i18next'
import { formatKeyedMessage, formatPhaseLabel, localeDateString } from './i18n/formatMessage'
import i18n, { setAppLocale, getAppLocale, isAppLocale } from './i18n'
import {
  formatDoctorCheckLabel,
  formatDoctorDetail,
  formatDoctorHint,
} from './i18n/activityLog'
import {
  type InstallProgress,
  mergeInstallProgress,
  operationProgressDisplay,
} from './installProgress'
import './App.css'

function installProgressEqual(a: InstallProgress, b: InstallProgress): boolean {
  return (
    a.phase === b.phase &&
    a.status === b.status &&
    a.percentage === b.percentage &&
    a.message === b.message &&
    a.messageKey === b.messageKey &&
    a.bytesDown === b.bytesDown &&
    a.bytesTotal === b.bytesTotal
  )
}

/** Package name key for matching parallel install tasks (mirrors desktop installTaskKey). */
function installPackageKey(ref: string): string {
  const trimmed = ref.trim()
  const slash = trimmed.lastIndexOf('/')
  let base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  const at = base.indexOf('@')
  if (at >= 0) base = base.slice(0, at)
  return base.toLowerCase()
}

function isRefInstalling(ref: string, active: Record<string, InstallProgress>): boolean {
  const key = installPackageKey(ref)
  return Object.keys(active).some((name) => installPackageKey(name) === key)
}

const DOCTOR_STEP_IDS = ['glue_root', 'git', 'seven_zip', 'dark', 'innounp', 'shim_dir', 'github'] as const

interface DoctorCheckResult {
  id: string
  ok: boolean
  detailKey?: string
  detail: string
  hintKey?: string
  hint?: string
}

type DoctorCheckItem = DoctorCheckResult & {
  status: 'pending' | 'running' | 'done'
}

function makeInitialDoctorChecks(checkingLabel: string): DoctorCheckItem[] {
  return DOCTOR_STEP_IDS.map((id) => ({
    id,
    ok: false,
    detail: checkingLabel,
    status: 'running' as const,
  }))
}

function formatProgressMessage(progress: InstallProgress): string {
  return formatKeyedMessage(progress.messageKey, progress.messageArgs, progress.message)
}

function packageUninstallRef(name: string, version?: string): string {
  return version ? `${name}@${version}` : name
}

function formatPackageOpLabel(name: string, version?: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  if (version && !trimmed.includes('@')) {
    return `${trimmed}@${version}`
  }
  return trimmed
}

/** Extract error text from install/uninstall event payloads. */
function eventErrorMessage(data: unknown, fallback: string): string {
  if (data == null) return fallback
  if (typeof data === 'string') return data || fallback
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>
    for (const key of ['error', 'Error', 'message', 'Message']) {
      const v = obj[key]
      if (typeof v === 'string' && v.trim()) return v
    }
  }
  return fallback
}

/** Register before Install/Uninstall and wait for install:* completion for the given package. */
function waitForInstallOutcome(packageRef?: string): Promise<void> {
  const match = (name?: string) => {
    if (!packageRef) return true
    if (!name) return false
    return installPackageKey(name) === installPackageKey(packageRef)
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      offComplete()
      offError()
      fn()
    }
    const offComplete = EventsOn('install:complete', (data?: { name?: string }) => {
      if (!match(data?.name)) return
      settle(resolve)
    })
    const offError = EventsOn('install:error', (data?: unknown) => {
      const name =
        data && typeof data === 'object' && typeof (data as { name?: string }).name === 'string'
          ? (data as { name: string }).name
          : undefined
      if (!match(name)) return
      settle(() => reject(new Error(eventErrorMessage(data, i18n.t('appExt.installOutcomeFailed')))))
    })
  })
}

function waitForUninstallOutcome(): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      offComplete()
      offError()
      fn()
    }
    const offComplete = EventsOnce('uninstall:complete', () => settle(resolve))
    const offError = EventsOnce('uninstall:error', (data?: unknown) => {
      settle(() => reject(new Error(eventErrorMessage(data, i18n.t('appExt.uninstallOutcomeFailed')))))
    })
  })
}

const logPostOpMs = (label: string, startMs: number) => {
  console.log(`[post-op] ${label}: ${(performance.now() - startMs).toFixed(1)}ms`)
}

async function timedPostOp<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now()
  const result = await fn()
  logPostOpMs(label, t0)
  return result
}

function isPackageUpdatable(pkg: main.InstalledPackage): boolean {
  return pkg.updateAvailable && !!pkg.latestVersion && pkg.latestVersion !== pkg.version
}

/** ListInstalledQuick skips per-package update checks; keep upgradable flags only when version is unchanged and still behind known latest. */
function mergeInstalledUpdateStatus(
  next: main.InstalledPackage[],
  prev: main.InstalledPackage[],
): main.InstalledPackage[] {
  if (prev.length === 0) {
    return next
  }
  const prevByName = new Map(prev.map((p) => [p.name, p]))
  return next.map((pkg) => {
    const old = prevByName.get(pkg.name)
    if (!old?.updateAvailable || pkg.versionLocked || old.version !== pkg.version) {
      return pkg
    }
    const latest = old.latestVersion || pkg.latestVersion
    if (!latest || latest === pkg.version) {
      return pkg
    }
    return {
      ...pkg,
      updateAvailable: true,
      latestVersion: latest,
    }
  })
}

/** Full stats bar refresh interval (install/uninstall do not trigger; only periodic and explicit refresh). */
const STATS_REFRESH_MS = 10 * 60 * 1000
/** Delay before the first automatic Desktop self-update check after launch. */
const DESKTOP_UPDATE_AUTO_CHECK_MS = 30 * 1000
const INFO_BANNER_AUTO_HIDE_MS = 5000
const TASK_DOCK_NOTICE_AUTO_HIDE_MS = 5000

type TaskDockNoticeKind = 'success' | 'error' | 'info'

interface TaskDockNotice {
  kind: TaskDockNoticeKind
  message: string
  detail?: string
}

function splitTaskDockMessage(text: string): { message: string; detail?: string } {
  const lines = text.split('\n')
  const message = (lines[0] ?? text).trim() || text
  const detail = lines.slice(1).join('\n').trim()
  return detail ? { message, detail } : { message }
}

interface Stats {
  bucketCount: number
  bucketUpdatesCount: number
  installedCount: number
  updatesCount: number
  availablePackagesCount: number
  templateCount: number
  activityLogCount: number
  totalSize: number
}

type StatsLoadState = 'idle' | 'loading' | 'refreshing'

type TabType = 'buckets' | 'browse' | 'templates' | 'installed' | 'updates' | 'storage' | 'activity'
type StatAttention = 'installed' | 'buckets'
const ZOOM_STORAGE_KEY = 'gluestick-desktop-zoom'
const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.8
const ZOOM_MAX = 1.5
const DEFAULT_ZOOM = 1

function loadStoredZoom(): number {
  const stored = localStorage.getItem(ZOOM_STORAGE_KEY)
  if (!stored) return DEFAULT_ZOOM
  const value = parseFloat(stored)
  if (Number.isNaN(value)) return DEFAULT_ZOOM
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))
}

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 10) / 10))
}

function isVersionedInstallRef(ref: string): boolean {
  const at = ref.lastIndexOf('@')
  return at > 0 && at < ref.length - 1
}

function App() {
  const { t } = useTranslation()
  const TAB_ITEMS = useMemo(
    () =>
      ([
        { id: 'buckets' as TabType, label: t('nav.buckets'), icon: 'bucket' as NavIconName },
        { id: 'browse' as TabType, label: t('nav.browse'), icon: 'browse' as NavIconName },
        { id: 'templates' as TabType, label: t('nav.templates'), icon: 'templates' as NavIconName },
        { id: 'installed' as TabType, label: t('nav.installed'), icon: 'installed' as NavIconName },
        { id: 'updates' as TabType, label: t('nav.updates'), icon: 'updates' as NavIconName },
        { id: 'storage' as TabType, label: t('nav.storage'), icon: 'storage' as NavIconName },
        { id: 'activity' as TabType, label: t('nav.activity'), icon: 'activity' as NavIconName },
      ]),
    [t],
  )
  const [activeTab, setActiveTab] = useState<TabType>('installed')
  const [browseFocusToken, setBrowseFocusToken] = useState(0)
  const [hideDeprecated, setHideDeprecated] = useState(() => loadHideDeprecated())
  const [searchIndexReady, setSearchIndexReady] = useState(false)
  const [installedPackages, setInstalledPackages] = useState<main.InstalledPackage[]>([])
  const [installedPage, setInstalledPage] = useState(1)
  const [updatesPage, setUpdatesPage] = useState(1)
  const [flashUpdates, setFlashUpdates] = useState(false)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [statAttention, setStatAttention] = useState<StatAttention | null>(null)
  const statAttentionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [stats, setStats] = useState<Stats>({
    bucketCount: 0,
    bucketUpdatesCount: 0,
    installedCount: 0,
    updatesCount: 0,
    availablePackagesCount: 0,
    templateCount: 0,
    activityLogCount: 0,
    totalSize: 0,
  })
  const [statsLoadState, setStatsLoadState] = useState<StatsLoadState>('loading')
  const [statsEverLoaded, setStatsEverLoaded] = useState(false)
  const [statsSlowCached, setStatsSlowCached] = useState(false)
  const [footerLeftStatus, setFooterLeftStatus] = useState<string | null>(null)
  const [footerRightStatus, setFooterRightStatus] = useState<string | null>(null)
  const [bucketCheckFooterStatus, setBucketCheckFooterStatus] = useState<string | null>(null)
  const [bucketCheckInProgress, setBucketCheckInProgress] = useState(false)
  const [bucketSyncInProgress, setBucketSyncInProgress] = useState(false)
  const bucketCheckRemainingRef = useRef(0)
  const [bucketRefreshKey, setBucketRefreshKey] = useState(0)
  const [templateRefreshKey, setTemplateRefreshKey] = useState(0)
  const [storageRefreshKey, setStorageRefreshKey] = useState(0)
  const [bucketOpenAdd, setBucketOpenAdd] = useState(false)
  const [activeInstalls, setActiveInstalls] = useState<Record<string, InstallProgress>>({})
  const [installCancelling, setInstallCancelling] = useState<Record<string, boolean>>({})
  const installRefreshPendingRef = useRef(false)
  const activeInstallsRef = useRef(activeInstalls)
  activeInstallsRef.current = activeInstalls
  const pendingInstallProgressRef = useRef<Record<string, InstallProgress>>({})
  const installProgressRafRef = useRef<number | null>(null)
  const [currentUninstall, setCurrentUninstall] = useState<{name: string, progress: InstallProgress} | null>(null)
  const [activityRefreshKey, setActivityRefreshKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const [infoMessageCentered, setInfoMessageCentered] = useState(false)
  const infoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [taskDockNotice, setTaskDockNotice] = useState<TaskDockNotice | null>(null)
  const taskDockHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showProModal, setShowProModal] = useState(false)
  const [showAboutModal, setShowAboutModal] = useState(false)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [showDoctorModal, setShowDoctorModal] = useState(false)
  const [showGitHubProxyModal, setShowGitHubProxyModal] = useState(false)
  const [showDownloadWorkersModal, setShowDownloadWorkersModal] = useState(false)
  const [bucketCheckIntervalMinutes, setBucketCheckIntervalMinutes] = useState(15)
  const [bucketSyncMode, setBucketSyncMode] = useState<'auto' | 'manual'>('manual')
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheckItem[]>([])
  const [doctorOK, setDoctorOK] = useState<boolean | null>(null)
  const [doctorLoading, setDoctorLoading] = useState(false)
  const [aboutInfo, setAboutInfo] = useState<main.AboutInfo | null>(null)
  const [desktopUpdateInfo, setDesktopUpdateInfo] = useState<main.DesktopUpdateInfo | null>(null)
  const desktopUpdateAutoCheckedRef = useRef(false)
  const [selectedPackage, setSelectedPackage] = useState<SelectedPackage | null>(null)
  const [pendingUninstall, setPendingUninstall] = useState<main.InstalledPackage | null>(null)
  const [pendingUninstallInactiveOnly, setPendingUninstallInactiveOnly] = useState(false)
  const [pendingInstallPlan, setPendingInstallPlan] = useState<PendingInstallPlan | null>(null)
  const [pendingVersionSwitch, setPendingVersionSwitch] = useState<{
    packageName: string
    version: string
  } | null>(null)
  const [versionSwitchBusy, setVersionSwitchBusy] = useState(false)
  const [browseManifestPreview, setBrowseManifestPreview] = useState<{
    packageRef: string
    manifest: main.InstallManifestInfo
  } | null>(null)
  const [installedManifestDialog, setInstalledManifestDialog] = useState<{
    packageRef: string
    manifest: main.InstallManifestInfo
  } | null>(null)
  const [installSuggestions, setInstallSuggestions] = useState<Array<{ label: string; ref: string }>>([])
  const [installedListRefreshing, setInstalledListRefreshing] = useState(false)
  const [showQuitConfirm, setShowQuitConfirm] = useState(false)
  const listScrollRef = useRef<HTMLDivElement | null>(null)
  const [isPro] = useState(false)
  const [customThemes, setCustomThemes] = useState<ThemeDefinition[]>(loadCustomThemes)
  const [themeId, setThemeId] = useState<ThemeId>(() =>
    sanitizeThemeIdOnLoad(loadStoredThemeId(), loadCustomThemes(), false),
  )
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [zoom, setZoom] = useState(loadStoredZoom)
  const updatablePackages = useMemo(
    () => installedPackages.filter(isPackageUpdatable),
    [installedPackages],
  )
  const { pageSize, mode: pageSizeMode, autoSize, setPageSize, setAutoMode } = useListPageSize(
    listScrollRef,
    [
      activeTab,
      installedPackages.length,
      updatablePackages.length,
      bucketRefreshKey,
      templateRefreshKey,
      activityRefreshKey,
      zoom,
    ],
  )

  const applyStats = useCallback((raw: Record<string, unknown>) => {
    const s = raw as Record<string, number | boolean>
    setStats((prev) => ({
      bucketCount: Number(s.bucketCount ?? prev.bucketCount),
      bucketUpdatesCount: Number(s.bucketUpdatesCount ?? prev.bucketUpdatesCount),
      installedCount: Number(s.installedCount ?? prev.installedCount),
      updatesCount: Number(s.updatesCount ?? prev.updatesCount),
      availablePackagesCount: Number(s.availablePackagesCount ?? prev.availablePackagesCount),
      templateCount: Number(s.templateCount ?? prev.templateCount),
      activityLogCount: Number(s.activityLogCount ?? prev.activityLogCount),
      totalSize: Number(s.totalSize ?? prev.totalSize),
    }))
    setStatsSlowCached(Boolean(s.slowStatsCached))
  }, [])

  const applyPendingBucketUpdates = useCallback((pending: unknown) => {
    if (typeof pending !== 'number' || Number.isNaN(pending)) return
    setStats((prev) => ({ ...prev, bucketUpdatesCount: pending }))
  }, [])

  const loadStats = useCallback(async (trace = 'loadStats', forceRefresh = false): Promise<Stats | null> => {
    const total0 = performance.now()
    const isPeriodicRefresh = trace === 'periodic-refresh'
    setStatsLoadState(statsEverLoaded ? 'refreshing' : 'loading')
    if (isPeriodicRefresh) {
      setFooterLeftStatus(t('footer.statsRefreshing'))
    }
    try {
      const statsData = await timedPostOp(
        `${trace} → GetStats(force=${forceRefresh}, hideDeprecated=${hideDeprecated})`,
        () => GetStats({ forceRefresh, hideDeprecated }),
      )
      const raw = statsData as Record<string, unknown>
      applyStats(raw)
      setStatsEverLoaded(true)
      const s = raw as Record<string, number>
      const next: Stats = {
        bucketCount: Number(s.bucketCount ?? 0),
        bucketUpdatesCount: Number(s.bucketUpdatesCount ?? 0),
        installedCount: Number(s.installedCount ?? 0),
        updatesCount: Number(s.updatesCount ?? 0),
        availablePackagesCount: Number(s.availablePackagesCount ?? 0),
        templateCount: countTemplates(),
        activityLogCount: Number(s.activityLogCount ?? 0),
        totalSize: Number(s.totalSize ?? 0),
      }
      setStats((prev) => ({ ...prev, templateCount: next.templateCount }))
      logPostOpMs(`${trace} total`, total0)
      return next
    } catch (err) {
      console.error('Failed to load stats:', err)
      if (isPeriodicRefresh) {
        setFooterLeftStatus(t('footer.statsRefreshFailed'))
      } else {
        setError(t('appExt.loadStatsFailed', { error: String(err) }))
      }
      logPostOpMs(`${trace} failed`, total0)
      return null
    } finally {
      setStatsLoadState('idle')
      if (isPeriodicRefresh) {
        setFooterLeftStatus(null)
      }
    }
  }, [applyStats, hideDeprecated, statsEverLoaded, t])

  const loadInstalled = useCallback(async (options?: { quick?: boolean; trace?: string }) => {
    const quick = options?.quick ?? false
    const trace = options?.trace ?? (quick ? 'loadInstalled(quick)' : 'loadInstalled(full)')
    const total0 = performance.now()
    try {
      const installed = await timedPostOp(
        `${trace} → ${quick ? 'ListInstalledQuick' : 'ListInstalled'}`,
        () => (quick ? ListInstalledQuick() : ListInstalled()),
      )
      const list = installed || []
      setInstalledPackages((prev) => (quick ? mergeInstalledUpdateStatus(list, prev) : list))
      setStats((prev) => ({
        ...prev,
        installedCount: list.length,
        ...(!quick
          ? { updatesCount: list.filter(isPackageUpdatable).length }
          : null),
      }))
      logPostOpMs(`${trace} total`, total0)
      return list
    } catch (err) {
      console.error('Failed to load installed packages:', err)
      setError(t('appExt.loadInstalledFailed', { error: String(err) }))
      logPostOpMs(`${trace} failed`, total0)
      return null
    }
  }, [t])

  const loadData = useCallback(async (trace = 'loadData', forceStats = true) => {
    await Promise.all([
      loadInstalled({ trace }),
      loadStats(trace, forceStats),
    ])
  }, [loadInstalled, loadStats])

  const refreshAfterPackageOp = useCallback(async (op: 'install' | 'uninstall') => {
    const total0 = performance.now()
    console.log(`[post-op] ${op} engine returned; refreshing installed list and update stats…`)
    try {
      if (op === 'install') {
        await loadInstalled({ trace: `after ${op}` })
      } else {
        await loadInstalled({ quick: true, trace: `after ${op}` })
      }
      await loadStats(`after ${op}`, true)
      if (op === 'uninstall') setCurrentUninstall(null)
    } catch {
      if (op === 'uninstall') setCurrentUninstall(null)
    }
    logPostOpMs(`${op} list refresh total`, total0)
  }, [loadInstalled, loadStats])

  const clearStatAttention = useCallback(() => {
    if (statAttentionTimerRef.current) clearTimeout(statAttentionTimerRef.current)
    setStatAttention(null)
  }, [])

  const pulseStatAttention = useCallback((stat: StatAttention) => {
    clearStatAttention()
    requestAnimationFrame(() => {
      setStatAttention(stat)
      statAttentionTimerRef.current = setTimeout(() => setStatAttention(null), 6000)
    })
  }, [clearStatAttention])

  useEffect(() => {
    let bootstrapped = false
    let statsIntervalId: number | undefined

    const bootstrapData = () => {
      if (bootstrapped) return
      bootstrapped = true
      void loadData('startup', false)
      statsIntervalId = window.setInterval(() => void loadStats('periodic-refresh', false), STATS_REFRESH_MS)
    }

    const cancelEngineError = EventsOnce('engine-error', (msg: string) => {
      setError(t('appExt.engineInitFailed', { error: msg }))
    })
    const cancelEngineReady = EventsOnce('engine-ready', () => {
      bootstrapData()
      void GetBucketSyncConfig()
        .then((cfg) => {
          setBucketCheckIntervalMinutes(cfg.minutes)
          setBucketSyncMode(cfg.mode === 'auto' ? 'auto' : 'manual')
        })
        .catch((err) => console.error('Failed to load bucket sync config:', err))
    })
    void IsEngineReady().then((ready) => {
      if (ready) {
        bootstrapData()
        void GetBucketSyncConfig()
          .then((cfg) => {
            setBucketCheckIntervalMinutes(cfg.minutes)
            setBucketSyncMode(cfg.mode === 'auto' ? 'auto' : 'manual')
          })
          .catch((err) => console.error('Failed to load bucket sync config:', err))
      }
    })

    const cancelSearchIndex = EventsOnce('search-index-ready', () => {
      setSearchIndexReady(true)
      void loadStats('index-ready', true)
      setBucketRefreshKey((k) => k + 1)
      setTemplateRefreshKey((k) => k + 1)
    })
    void IsSearchIndexReady().then((ready) => {
      if (ready) {
        setSearchIndexReady(true)
        void loadStats('index-ready', true)
        setBucketRefreshKey((k) => k + 1)
        setTemplateRefreshKey((k) => k + 1)
      }
    })

    return () => {
      cancelEngineError()
      cancelEngineReady()
      cancelSearchIndex()
      if (statsIntervalId !== undefined) clearInterval(statsIntervalId)
    }
  }, [loadInstalled, loadStats, t])

  useEffect(() => {
    if (!searchIndexReady) return
    void loadStats('hide-deprecated', false)
  }, [hideDeprecated, loadStats, searchIndexReady])

  // stats and installed updatable flags may briefly diverge (e.g. after periodic stats refresh); reconcile when opening Updates tab
  useEffect(() => {
    if (activeTab !== 'updates') return
    if (stats.updatesCount <= 0) return
    if (updatablePackages.length > 0) return
    if (installedPackages.length === 0) return
    if (installedListRefreshing) return
    void loadInstalled({ trace: 'updates-tab-sync' })
  }, [
    activeTab,
    stats.updatesCount,
    updatablePackages.length,
    installedPackages.length,
    installedListRefreshing,
    loadInstalled,
  ])

  const installedByName = useMemo(() => {
    const map = new Map<string, main.InstalledPackage>()
    for (const pkg of installedPackages) {
      map.set(pkg.name, pkg)
    }
    return map
  }, [installedPackages])

  const isPackageInstalled = useCallback(
    (name: string) => installedByName.has(name),
    [installedByName],
  )

  useEffect(() => {
    setSelectedPackage((prev) => {
      if (!prev || prev.isInstalled) return prev
      const inst = installedByName.get(prev.name)
      if (!inst) return prev
      return {
        ...prev,
        isInstalled: true,
        version: inst.version,
        bucket: inst.bucket,
        description: inst.description || prev.description,
        homepage: inst.homepage || prev.homepage,
        installedAt: inst.installedAt,
      }
    })
  }, [installedByName])

  const applyThemeById = useCallback((id: ThemeId, themes = customThemes) => {
    const theme = resolveTheme(id, themes)
    if (!theme) return
    applyTheme(theme)
    setThemeId(id)
    saveThemeId(id)
  }, [customThemes])

  useEffect(() => {
    const theme = resolveTheme(themeId, customThemes)
    if (theme) applyTheme(theme)
    saveThemeId(themeId)
  }, [themeId, customThemes])

  const selectTheme = useCallback((id: ThemeId) => {
    if (!canUseTheme(id, isPro)) {
      setShowProModal(true)
      return
    }
    applyThemeById(id)
  }, [applyThemeById, isPro])

  const handleDeleteCustomTheme = useCallback((id: ThemeId) => {
    setCustomThemes((prev) => {
      const next = prev.filter((t) => t.id !== id)
      saveCustomThemes(next)
      return next
    })
    if (themeId === id) {
      applyThemeById('dark')
    }
  }, [applyThemeById, themeId])

  const openThemeEditor = useCallback((_theme: ThemeDefinition | null = null) => {
    setShowThemePicker(false)
    setShowProModal(true)
  }, [])

  useEffect(() => {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom))
  }, [zoom])

  const bumpActivityLog = useCallback(() => {
    setActivityRefreshKey((k) => k + 1)
  }, [])

  const refreshTemplateStat = useCallback(() => {
    setStats((prev) => ({ ...prev, templateCount: countTemplates() }))
  }, [])

  useEffect(() => {
    refreshTemplateStat()
  }, [templateRefreshKey, refreshTemplateStat])

  useEffect(() => {
    let cancelled = false
    void GetActivityLogPage({ timeRange: 'all', page: 1, pageSize: 1 })
      .then((result) => {
        if (!cancelled) {
          setStats((prev) => ({ ...prev, activityLogCount: result.total }))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activityRefreshKey])

  const clearInfoHideTimer = useCallback(() => {
    if (infoHideTimerRef.current != null) {
      window.clearTimeout(infoHideTimerRef.current)
      infoHideTimerRef.current = null
    }
  }, [])

  const dismissInfoMessage = useCallback(() => {
    clearInfoHideTimer()
    setInfoMessage(null)
    setInfoMessageCentered(false)
  }, [clearInfoHideTimer])

  const showInfoMessage = useCallback((
    message: string,
    options?: { centered?: boolean; autoHideMs?: number; persistent?: boolean },
  ) => {
    clearInfoHideTimer()
    setInfoMessage(message)
    setInfoMessageCentered(options?.centered ?? false)
    if (!options?.persistent) {
      const hideMs = options?.autoHideMs ?? INFO_BANNER_AUTO_HIDE_MS
      infoHideTimerRef.current = window.setTimeout(() => {
        setInfoMessage(null)
        setInfoMessageCentered(false)
        infoHideTimerRef.current = null
      }, hideMs)
    }
  }, [clearInfoHideTimer])

  const handleDesktopUpdateCheck = useCallback(async (manual: boolean) => {
    if (manual) {
      setFooterRightStatus(t('footer.checkingDesktopUpdate'))
    }
    try {
      const result = await CheckDesktopUpdate(manual)
      if (result.error) {
        if (manual) {
          setError(t('desktopUpdate.checkFailed', { error: result.error }))
        } else {
          console.warn('Desktop update check failed:', result.error)
        }
        return
      }
      if (result.updateAvailable) {
        setDesktopUpdateInfo(result)
        return
      }
      if (manual) {
        showInfoMessage(t('desktopUpdate.upToDate', { version: result.currentVersion }), {
          centered: true,
          autoHideMs: INFO_BANNER_AUTO_HIDE_MS,
        })
      }
    } finally {
      if (manual) {
        setFooterRightStatus(null)
      }
    }
  }, [showInfoMessage, t])

  useEffect(() => {
    if (desktopUpdateAutoCheckedRef.current) return
    desktopUpdateAutoCheckedRef.current = true
    const timerId = window.setTimeout(() => {
      void handleDesktopUpdateCheck(false)
    }, DESKTOP_UPDATE_AUTO_CHECK_MS)
    return () => window.clearTimeout(timerId)
  }, [handleDesktopUpdateCheck])

  const showCenteredInfo = useCallback((message: string) => {
    showInfoMessage(message, { centered: true, autoHideMs: INFO_BANNER_AUTO_HIDE_MS })
  }, [showInfoMessage])

  const clearTaskDockHideTimer = useCallback(() => {
    if (taskDockHideTimerRef.current != null) {
      window.clearTimeout(taskDockHideTimerRef.current)
      taskDockHideTimerRef.current = null
    }
  }, [])

  const dismissTaskDockNotice = useCallback(() => {
    clearTaskDockHideTimer()
    setTaskDockNotice(null)
  }, [clearTaskDockHideTimer])

  const showTaskDockNotice = useCallback((
    text: string,
    kind: TaskDockNoticeKind,
    options?: { detail?: string; autoHideMs?: number; persistent?: boolean },
  ) => {
    clearTaskDockHideTimer()
    const parsed = splitTaskDockMessage(text)
    setTaskDockNotice({
      kind,
      message: parsed.message,
      detail: options?.detail ?? parsed.detail,
    })
    if (!options?.persistent) {
      const hideMs = options?.autoHideMs ?? (kind === 'error' ? null : TASK_DOCK_NOTICE_AUTO_HIDE_MS)
      if (hideMs != null) {
        taskDockHideTimerRef.current = window.setTimeout(() => {
          setTaskDockNotice(null)
          taskDockHideTimerRef.current = null
        }, hideMs)
      }
    }
  }, [clearTaskDockHideTimer])

  const handleTemplateError = useCallback((message: string) => {
    showTaskDockNotice(message, 'error', { autoHideMs: INFO_BANNER_AUTO_HIDE_MS })
  }, [showTaskDockNotice])

  const handleRefreshInstalledList = useCallback(async (trace: string) => {
    if (installedListRefreshing) return
    setInstalledListRefreshing(true)
    setFooterRightStatus(t('footer.refreshingInstalled'))
    try {
      const list = await loadInstalled({ trace })
      const total = list?.length ?? 0
      const updatable = list?.filter(isPackageUpdatable).length ?? 0
      if (updatable > 0) {
        showInfoMessage(t('appExt.refreshInstalledSummary', { total, updatable }), {
          centered: true,
          autoHideMs: INFO_BANNER_AUTO_HIDE_MS,
        })
      } else {
        showInfoMessage(t('appExt.refreshInstalledSummaryAllLatest', { total }), {
          centered: true,
          autoHideMs: INFO_BANNER_AUTO_HIDE_MS,
        })
      }
    } finally {
      setInstalledListRefreshing(false)
      setFooterRightStatus(null)
    }
  }, [installedListRefreshing, loadInstalled, showInfoMessage, t])

  const handleRefreshUpdatesCenter = useCallback(async () => {
    if (installedListRefreshing) return
    setInstalledListRefreshing(true)
    setFooterRightStatus(t('footer.checkingUpdates'))
    try {
      const list = await loadInstalled({ trace: 'updates-tab-refresh' })
      const n = list?.filter(isPackageUpdatable).length ?? 0
      if (n > 0) {
        showInfoMessage(t('appExt.updatesFound', { count: n }), {
          centered: true,
          autoHideMs: INFO_BANNER_AUTO_HIDE_MS,
        })
      } else {
        showInfoMessage(t('appExt.allUpToDate'), {
          centered: true,
          autoHideMs: INFO_BANNER_AUTO_HIDE_MS,
        })
      }
    } finally {
      setInstalledListRefreshing(false)
      setFooterRightStatus(null)
    }
  }, [installedListRefreshing, loadInstalled, showInfoMessage, t])

  useEffect(() => () => clearInfoHideTimer(), [clearInfoHideTimer])

  useEffect(() => {
    const cancelActivityLog = EventsOn('activity:log-updated', () => {
      bumpActivityLog()
    })
    const cancelDoctorStart = EventsOn('doctor:start', () => {
      setDoctorChecks(makeInitialDoctorChecks(t('doctor.checking')))
      setDoctorOK(null)
      setDoctorLoading(true)
    })
    const cancelDoctorRunning = EventsOn('doctor:running', (data: { id?: string }) => {
      if (!data?.id) return
      setDoctorChecks((prev) =>
        prev.map((item) =>
          item.id === data.id && item.status !== 'done'
            ? { ...item, status: 'running', detail: t('doctor.checking') }
            : item,
        ),
      )
    })
    const cancelDoctorCheck = EventsOn('doctor:check', (check: DoctorCheckResult) => {
      if (!check?.id) return
      setDoctorChecks((prev) =>
        prev.map((item) =>
          item.id === check.id
            ? { ...item, ...check, status: 'done' }
            : item,
        ),
      )
    })
    const cancelDoctorComplete = EventsOn('doctor:complete', (data: { ok?: boolean }) => {
      setDoctorLoading(false)
      setDoctorOK(!!data?.ok)
      bumpActivityLog()
    })
    return () => {
      cancelActivityLog()
      cancelDoctorStart()
      cancelDoctorRunning()
      cancelDoctorCheck()
      cancelDoctorComplete()
    }
  }, [bumpActivityLog, t])

  const flushPendingInstallProgress = useCallback(() => {
    installProgressRafRef.current = null
    const pending = pendingInstallProgressRef.current
    const names = Object.keys(pending)
    if (names.length === 0) return
    pendingInstallProgressRef.current = {}
    setActiveInstalls((prev) => {
      let next: Record<string, InstallProgress> | null = null
      for (const name of names) {
        const data = pending[name]
        const cur = prev[name]
        if (!cur) continue
        const merged = mergeInstallProgress(cur, { ...data, name })
        if (installProgressEqual(cur, merged)) continue
        if (!next) next = { ...prev }
        next[name] = merged
      }
      return next ?? prev
    })
  }, [])

  const cancelPendingInstallProgress = useCallback((name?: string) => {
    if (name) {
      delete pendingInstallProgressRef.current[name]
    } else {
      pendingInstallProgressRef.current = {}
    }
    if (installProgressRafRef.current != null) {
      cancelAnimationFrame(installProgressRafRef.current)
      installProgressRafRef.current = null
    }
  }, [])

  const queueInstallProgress = useCallback(
    (data: InstallProgress) => {
      const name = data?.name
      if (!name || !activeInstallsRef.current[name]) return
      pendingInstallProgressRef.current[name] = { ...data, name }
      if (installProgressRafRef.current == null) {
        installProgressRafRef.current = requestAnimationFrame(flushPendingInstallProgress)
      }
    },
    [flushPendingInstallProgress],
  )

  const scheduleInstallListRefresh = useCallback(() => {
    if (installRefreshPendingRef.current) return
    installRefreshPendingRef.current = true
    queueMicrotask(() => {
      installRefreshPendingRef.current = false
      void refreshAfterPackageOp('install')
    })
  }, [refreshAfterPackageOp])

  const removeActiveInstall = useCallback((name: string) => {
    cancelPendingInstallProgress(name)
    setActiveInstalls((prev) => {
      const next = { ...prev }
      delete next[name]
      if (Object.keys(next).length === 0) {
        scheduleInstallListRefresh()
      }
      return next
    })
    setInstallCancelling((prev) => {
      if (!prev[name]) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
  }, [cancelPendingInstallProgress, scheduleInstallListRefresh])

  const installEventHandlersRef = useRef({
    removeActiveInstall,
    bumpActivityLog,
    dismissTaskDockNotice,
    showTaskDockNotice,
    pulseStatAttention,
    queueInstallProgress,
    flushPendingInstallProgress,
    t,
  })
  installEventHandlersRef.current = {
    removeActiveInstall,
    bumpActivityLog,
    dismissTaskDockNotice,
    showTaskDockNotice,
    pulseStatAttention,
    queueInstallProgress,
    flushPendingInstallProgress,
    t,
  }

  useEffect(() => {
    const h = () => installEventHandlersRef.current

    const cancelStart = EventsOn('install:start', (name: string) => {
      h().dismissTaskDockNotice()
      setInstallCancelling((prev) => ({ ...prev, [name]: false }))
      setActiveInstalls((prev) => {
        const next = {
          ...prev,
          [name]: {
            phase: 'Starting',
            status: '',
            percentage: 0,
            message: '',
            bytesDown: 0,
            bytesTotal: 0,
          },
        }
        activeInstallsRef.current = next
        return next
      })
    })
    const cancelProgress = EventsOn('install:progress', (data: InstallProgress) => {
      h().queueInstallProgress(data)
    })
    const cancelComplete = EventsOn(
      'install:complete',
      (data?: { name?: string; version?: string; suggestions?: Array<{ label: string; ref: string }> }) => {
        const handlers = h()
        handlers.flushPendingInstallProgress()
        const name = data?.name ?? ''
        if (name) handlers.removeActiveInstall(name)
        handlers.bumpActivityLog()
        const label = formatPackageOpLabel(String(data?.name ?? ''), data?.version)
        if (label) {
          handlers.showTaskDockNotice(handlers.t('appExt.installSuccess', { label }), 'success')
        }
        if (data?.suggestions?.length) {
          setInstallSuggestions(data.suggestions)
        }
        handlers.pulseStatAttention('installed')
      },
    )
    const cancelError = EventsOn('install:error', (data: unknown) => {
      const handlers = h()
      handlers.flushPendingInstallProgress()
      const errText = eventErrorMessage(data, handlers.t('progress.install.failed'))
      const name =
        data && typeof data === 'object' && typeof (data as { name?: string }).name === 'string'
          ? (data as { name: string }).name
          : ''
      if (name) handlers.removeActiveInstall(name)
      const label = name
        ? handlers.t('progress.install.failedNamed', { name, error: errText })
        : `${handlers.t('progress.install.failed')}: ${errText}`
      handlers.showTaskDockNotice(label, 'error', { persistent: true })
      handlers.bumpActivityLog()
    })
    const cancelCancelled = EventsOn('install:cancelled', (data?: { name?: string }) => {
      const handlers = h()
      handlers.flushPendingInstallProgress()
      const name = data?.name ?? ''
      if (name) handlers.removeActiveInstall(name)
      handlers.bumpActivityLog()
      const label = name ? formatPackageOpLabel(name, '') || name : ''
      handlers.showTaskDockNotice(
        label ? handlers.t('appExt.installCancelledNamed', { name: label }) : handlers.t('appExt.installCancelled'),
        'info',
      )
    })
    const cancelUninstallStart = EventsOn('uninstall:start', (name: string) => {
      h().dismissTaskDockNotice()
      setCurrentUninstall({
        name,
        progress: { phase: 'Starting', status: '', percentage: 0, message: '', bytesDown: 0, bytesTotal: 0 },
      })
    })
    const cancelUninstallProgress = EventsOn('uninstall:progress', (data: InstallProgress) => {
      setCurrentUninstall((prev) => (prev ? { ...prev, progress: data } : null))
    })
    const cancelUninstallComplete = EventsOn('uninstall:complete', () => {
      setCurrentUninstall(null)
      h().bumpActivityLog()
    })
    const cancelUninstallError = EventsOn('uninstall:error', (data: unknown) => {
      const handlers = h()
      const errText = eventErrorMessage(data, handlers.t('progress.uninstall.failed'))
      const name =
        data && typeof data === 'object' && typeof (data as { name?: string }).name === 'string'
          ? (data as { name: string }).name
          : ''
      const label = name
        ? handlers.t('progress.uninstall.failedNamed', { name, error: errText })
        : `${handlers.t('progress.uninstall.failed')}: ${errText}`
      handlers.showTaskDockNotice(label, 'error', { persistent: true })
      setCurrentUninstall(null)
      handlers.bumpActivityLog()
    })

    return () => {
      cancelStart()
      cancelProgress()
      cancelComplete()
      cancelError()
      cancelCancelled()
      cancelUninstallStart()
      cancelUninstallProgress()
      cancelUninstallComplete()
      cancelUninstallError()
      if (installProgressRafRef.current != null) {
        cancelAnimationFrame(installProgressRafRef.current)
        installProgressRafRef.current = null
      }
      pendingInstallProgressRef.current = {}
    }
  }, [])

  const handleMenuAction = useCallback((action: MenuAction) => {
    if (
      action.startsWith('theme:') &&
      action !== 'theme:custom-edit' &&
      action !== 'theme:browse'
    ) {
      selectTheme(action.slice('theme:'.length) as ThemeId)
      return
    }

    switch (action) {
      case 'check-updates':
        void (async () => {
          dismissInfoMessage()
          setFooterRightStatus(t('footer.checkingUpdates'))
          try {
            await loadInstalled({ trace: 'check-updates' })
            const refreshed = await loadStats('check-updates', true)
            const n = refreshed?.updatesCount ?? 0
            let summary: string
            if (n > 0) {
              summary = t('appExt.updatesFoundGoCenter', { count: n })
              showInfoMessage(summary, { centered: true, autoHideMs: INFO_BANNER_AUTO_HIDE_MS })
              setActiveTab('updates')
              setSelectedPackage(null)
              setUpdatesPage(1)
            } else {
              summary = t('appExt.allUpToDate')
              showInfoMessage(summary, { centered: true, autoHideMs: INFO_BANNER_AUTO_HIDE_MS })
            }
            await RecordCheckUpdatesResult(n, summary)
            bumpActivityLog()
          } catch (err) {
            setError(t('appExt.checkUpdatesFailed', { error: String(err) }))
          } finally {
            setFooterRightStatus(null)
          }
        })()
        break
      case 'tab:buckets':
        setActiveTab('buckets')
        setSelectedPackage(null)
        break
      case 'tab:browse':
        setActiveTab('browse')
        setSelectedPackage(null)
        break
      case 'tab:templates':
        setActiveTab('templates')
        setSelectedPackage(null)
        setTemplateRefreshKey((k) => k + 1)
        break
      case 'tab:installed':
        clearStatAttention()
        setActiveTab('installed')
        setSelectedPackage(null)
        break
      case 'tab:updates':
        setActiveTab('updates')
        setSelectedPackage(null)
        break
      case 'tab:storage':
        setActiveTab('storage')
        setSelectedPackage(null)
        break
      case 'tab:activity':
        setActiveTab('activity')
        setSelectedPackage(null)
        break
      case 'buckets:update-all':
        if (bucketCheckInProgress || bucketSyncInProgress) break
        setActiveTab('buckets')
        UpdateBuckets([]).catch((err) =>
          setError(t('appExt.updateBucketsFailed', { error: String(err) })),
        )
        break
      case 'buckets:add':
        setActiveTab('buckets')
        setBucketOpenAdd(true)
        break
      case 'search':
        setActiveTab('browse')
        setSelectedPackage(null)
        setBrowseFocusToken((token) => token + 1)
        break
      case 'pro':
        setShowProModal(true)
        break
      case 'zoom:in':
        setZoom((z) => clampZoom(z + ZOOM_STEP))
        break
      case 'zoom:out':
        setZoom((z) => clampZoom(z - ZOOM_STEP))
        break
      case 'zoom:reset':
        setZoom(DEFAULT_ZOOM)
        break
      case 'theme:browse':
        setShowThemePicker(true)
        break
      case 'theme:custom-edit':
        setShowProModal(true)
        break
      case 'page-size:auto':
        setAutoMode()
        break
      case 'page-size:10':
        setPageSize(10)
        break
      case 'page-size:15':
        setPageSize(15)
        break
      case 'page-size:20':
        setPageSize(20)
        break
      case 'page-size:30':
        setPageSize(30)
        break
      case 'page-size:50':
        setPageSize(50)
        break
      case 'deprecated:hide':
        setHideDeprecated(true)
        saveHideDeprecated(true)
        break
      case 'deprecated:show':
        setHideDeprecated(false)
        saveHideDeprecated(false)
        break
      case 'export-inventory':
      case 'template-definitions:export':
      case 'template-definitions:import':
        setShowProModal(true)
        break
      case 'open-root-dir':
        OpenGlueDataDir()
        break
      case 'about':
        GetAboutInfo().then((info) => {
          setAboutInfo(info)
          setShowAboutModal(true)
        })
        break
      case 'docs':
        setShowHelpModal(true)
        break
      case 'check-desktop-update':
        void handleDesktopUpdateCheck(true)
        break
      case 'doctor':
        setDoctorChecks(makeInitialDoctorChecks(t('doctor.checking')))
        setDoctorOK(null)
        setDoctorLoading(true)
        setShowDoctorModal(true)
        void RunDoctor().catch((err) => {
          setDoctorLoading(false)
          setError(t('doctor.failed', { error: String(err) }))
        })
        break
      case 'github-proxy':
        setShowGitHubProxyModal(true)
        break
      case 'download-workers':
        setShowDownloadWorkersModal(true)
        break
      case 'quit':
        setShowQuitConfirm(true)
        break
      default:
        if (action.startsWith('bucket-check-interval:')) {
          const minutes = parseInt(action.slice('bucket-check-interval:'.length), 10)
          if (minutes === 5 || minutes === 15 || minutes === 30) {
            void SetBucketCheckInterval(minutes)
              .then(() => {
                setBucketCheckIntervalMinutes(minutes)
                showInfoMessage(t('settings.bucketSyncIntervalSaved', { n: minutes }), {
                  autoHideMs: INFO_BANNER_AUTO_HIDE_MS,
                })
              })
              .catch((err) => setError(t('settings.bucketSyncIntervalSaveFailed', { error: String(err) })))
          }
          break
        }
        if (action === 'bucket-sync-mode:auto' || action === 'bucket-sync-mode:manual') {
          const mode = action === 'bucket-sync-mode:auto' ? 'auto' : 'manual'
          void SetBucketSyncMode(mode)
            .then(() => {
              setBucketSyncMode(mode)
              showInfoMessage(
                mode === 'auto'
                  ? t('settings.bucketSyncModeAutoSaved')
                  : t('settings.bucketSyncModeManualSaved'),
                { autoHideMs: INFO_BANNER_AUTO_HIDE_MS },
              )
            })
            .catch((err) => setError(t('settings.bucketSyncModeSaveFailed', { error: String(err) })))
          break
        }
        if (action.startsWith('locale:')) {
          const locale = action.slice('locale:'.length)
          if (isAppLocale(locale)) {
            setAppLocale(locale)
          }
        }
        break
    }
  }, [loadInstalled, loadStats, handleDesktopUpdateCheck, setAutoMode, setPageSize, isPro, customThemes, themeId, selectTheme, openThemeEditor, dismissInfoMessage, showInfoMessage, bumpActivityLog, bucketCheckInProgress, bucketSyncInProgress, clearStatAttention, t])

  useEffect(() => {
    const mod = (e: KeyboardEvent) => e.ctrlKey || e.metaKey
    const onKeyDown = (e: KeyboardEvent) => {
      if (mod(e) && e.key === 'q') {
        e.preventDefault()
        handleMenuAction('quit')
      } else if (mod(e) && e.key === 'f') {
        e.preventDefault()
        handleMenuAction('search')
      } else if (mod(e) && e.key === 'u') {
        e.preventDefault()
        handleMenuAction('check-updates')
      } else if (mod(e) && e.key === '1') {
        e.preventDefault()
        handleMenuAction('tab:buckets')
      } else if (mod(e) && e.key === '2') {
        e.preventDefault()
        handleMenuAction('tab:browse')
      } else if (mod(e) && e.key === '3') {
        e.preventDefault()
        handleMenuAction('tab:templates')
      } else if (mod(e) && e.key === '4') {
        e.preventDefault()
        handleMenuAction('tab:installed')
      } else if (mod(e) && e.key === '5') {
        e.preventDefault()
        handleMenuAction('tab:updates')
      } else if (mod(e) && e.key === '6') {
        e.preventDefault()
        handleMenuAction('tab:storage')
      } else if (mod(e) && e.key === '7') {
        e.preventDefault()
        handleMenuAction('tab:activity')
      } else if (mod(e) && e.shiftKey && (e.key === 'U' || e.key === 'u')) {
        e.preventDefault()
        handleMenuAction('buckets:update-all')
      } else if (mod(e) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        handleMenuAction('zoom:in')
      } else if (mod(e) && e.key === '-') {
        e.preventDefault()
        handleMenuAction('zoom:out')
      } else if (mod(e) && e.key === '0') {
        e.preventDefault()
        handleMenuAction('zoom:reset')
      } else if (mod(e) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault()
        handleMenuAction('pro')
      } else if (mod(e) && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
        e.preventDefault()
        handleMenuAction('export-inventory')
      } else if (mod(e) && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault()
        handleMenuAction('template-definitions:export')
      } else if (e.key === 'F1') {
        e.preventDefault()
        handleMenuAction('docs')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleMenuAction])

  useEffect(() => {
    setInstalledPage(1)
    setUpdatesPage(1)
  }, [pageSize])

  const handlePageSizeChange = useCallback(
    (size: number) => {
      setPageSize(size)
    },
    [setPageSize],
  )

  const handlePageSizeAuto = useCallback(() => {
    setAutoMode()
  }, [setAutoMode])

  const bumpBuckets = useCallback(() => {
    setBucketRefreshKey((k) => k + 1)
    setTemplateRefreshKey((k) => k + 1)
    void loadStats('bucket-changed', true)
    // After bucket updates, manifest versions may change; refresh installed list updatable status
    void loadInstalled({ trace: 'bucket-changed' })
  }, [loadStats, loadInstalled])

  // Global refresh when a bucket add/remove/update task completes (BucketPanel may be unmounted; browse/catalog must stay in sync)
  useEffect(() => {
    const cancelComplete = EventsOn('bucket:task:complete', () => {
      bumpBuckets()
    })
    return () => cancelComplete()
  }, [bumpBuckets])

  // Surface MinGit / 7-Zip / WiX bootstrap failures (progress UI alone clears the card on error)
  useEffect(() => {
    const toolLabel = (tool?: string) => {
      switch (tool) {
        case 'git':
          return t('appExt.bootstrapGitTaskTitle')
        case 'seven_zip':
          return t('appExt.bootstrapSevenZipTaskTitle')
        case 'wix':
          return t('appExt.bootstrapWixTaskTitle')
        case 'innounp':
          return t('appExt.bootstrapInnounpTaskTitle')
        default:
          return tool ? t('appExt.bootstrapTaskTitle', { tool }) : 'bootstrap'
      }
    }
    const onError = EventsOn('bootstrap:task:error', (data: { tool?: string; error?: string }) => {
      const err = (data?.error || '').trim() || 'unknown error'
      showTaskDockNotice(t('appExt.bootstrapFailed', { tool: toolLabel(data?.tool), error: err }), 'error', {
        persistent: true,
        detail: err,
      })
    })
    return () => onError()
  }, [showTaskDockNotice, t])

  // Update pending-bucket count as each bucket sync/check completes (do not wait for the bulk task to finish)
  useEffect(() => {
    const onPartialSynced = EventsOn('bucket:bucket-synced', (data: { pendingBucketUpdates?: number }) => {
      applyPendingBucketUpdates(data?.pendingBucketUpdates)
    })
    const onCheckResult = EventsOn('bucket:update-check:result', (data: { pendingBucketUpdates?: number }) => {
      applyPendingBucketUpdates(data?.pendingBucketUpdates)
    })
    return () => {
      onPartialSynced()
      onCheckResult()
    }
  }, [applyPendingBucketUpdates])

  useEffect(() => {
    const formatBucketCheckFooter = (remaining: number) => {
      if (remaining > 0) {
        return t('footer.checkingBuckets', { count: remaining })
      }
      return t('footer.checkingBucketsGeneric')
    }

    const onCheckStart = EventsOn('bucket:update-check:start', (data: { count?: number }) => {
      setBucketCheckInProgress(true)
      const total = typeof data?.count === 'number' ? data.count : 0
      bucketCheckRemainingRef.current = total
      setBucketCheckFooterStatus(formatBucketCheckFooter(total))
    })
    const onCheckResult = EventsOn('bucket:update-check:result', () => {
      bucketCheckRemainingRef.current = Math.max(0, bucketCheckRemainingRef.current - 1)
      const remaining = bucketCheckRemainingRef.current
      if (remaining > 0) {
        setBucketCheckFooterStatus(formatBucketCheckFooter(remaining))
      } else {
        setBucketCheckFooterStatus(t('footer.checkingBucketsGeneric'))
      }
    })
    const onCheckDone = EventsOn('bucket:update-check:done', (data: Record<string, unknown>) => {
      setBucketCheckInProgress(false)
      bucketCheckRemainingRef.current = 0
      setBucketCheckFooterStatus(null)
      if (data?.error) return
      void loadStats('bucket-update-check', true)
      const count = Number(data.withUpdates ?? 0)
      if (count <= 0) return
      const names = Array.isArray(data.names) ? (data.names as string[]).join(', ') : ''
      const autoSync = data.autoSync === true
      pulseStatAttention('buckets')
      if (autoSync) {
        showInfoMessage(t('bucket.autoSyncStarted', { count, names }), {
          centered: true,
          autoHideMs: INFO_BANNER_AUTO_HIDE_MS,
        })
        return
      }
      showInfoMessage(t('bucket.updatesFoundBanner', { count, names }), {
        centered: true,
        autoHideMs: INFO_BANNER_AUTO_HIDE_MS,
      })
    })
    return () => {
      onCheckStart()
      onCheckResult()
      onCheckDone()
    }
  }, [loadStats, pulseStatAttention, showInfoMessage, t])

  useEffect(() => {
    const activeUpdates = new Set<string>()
    const taskKey = (kind: string, name: string) => `${kind}:${name}`
    const syncState = () => setBucketSyncInProgress(activeUpdates.size > 0)

    const onStart = EventsOn('bucket:task:start', (data: { kind?: string; name?: string }) => {
      if (data?.kind !== 'update' || !data?.name) return
      activeUpdates.add(taskKey(data.kind, data.name))
      syncState()
    })
    const onComplete = EventsOn('bucket:task:complete', (data: { kind?: string; name?: string }) => {
      if (data?.kind !== 'update' || !data?.name) return
      activeUpdates.delete(taskKey(data.kind, data.name))
      syncState()
    })
    const onError = EventsOn('bucket:task:error', (data: { kind?: string; name?: string }) => {
      if (data?.kind !== 'update' || !data?.name) return
      activeUpdates.delete(taskKey(data.kind, data.name))
      syncState()
    })
    return () => {
      onStart()
      onComplete()
      onError()
    }
  }, [])

  const isMenuActionDisabled = useCallback(
    (action: MenuAction) =>
      action === 'buckets:update-all' && (bucketCheckInProgress || bucketSyncInProgress),
    [bucketCheckInProgress, bucketSyncInProgress],
  )

  const cacheTasks = useCacheTasks()
  const gcRunning = useMemo(() => cacheTasks.some((task) => task.kind === 'gc'), [cacheTasks])
  const hasActiveInstalls = Object.keys(activeInstalls).length > 0
  const isPackageInstalling = useCallback(
    (ref: string) => isRefInstalling(ref, activeInstalls),
    [activeInstalls],
  )
  const operationBusy = gcRunning || (!isPro && hasActiveInstalls) || !!currentUninstall

  const isPackageDetailExpanded = useCallback(
    (name: string) => selectedPackage?.name === name,
    [selectedPackage],
  )

  const runInstall = async (
    name: string,
    force = false,
    architecture = '',
    interactive = false,
    options?: { awaitOutcome?: boolean },
  ) => {
    const awaitOutcome = options?.awaitOutcome !== false
    const postOp0 = performance.now()
    const outcome = awaitOutcome ? waitForInstallOutcome(name) : null
    try {
      await Install(name, isPro, force, architecture, interactive)
      if (outcome) await outcome
    } catch (err) {
      console.error('Install failed:', err)
      showTaskDockNotice(t('appExt.installFailed', { error: String(err) }), 'error', { persistent: true })
    } finally {
      if (awaitOutcome) {
        await refreshAfterPackageOp('install')
        const log0 = performance.now()
        bumpActivityLog()
        logPostOpMs('install follow-up → bumpActivityLog', log0)
        logPostOpMs('install follow-up total (incl. quick refresh)', postOp0)
      }
    }
  }

  const beginInstall = async (name: string, intent: 'install' | 'upgrade' = 'install') => {
    if (gcRunning) return
    if (!isPro && (hasActiveInstalls || currentUninstall)) return
    if (isPackageInstalling(name)) return
    if (isVersionedInstallRef(name) && !isPro) {
      setShowProModal(true)
      showInfoMessage(t('appExt.versionInstallPro'))
      return
    }
    try {
      const plan = await PlanInstall(name)
      if (intent === 'upgrade' && plan.localActivateVersion) {
        setPendingVersionSwitch({
          packageName: packageNameFromInstallRef(name),
          version: plan.localActivateVersion,
        })
        return
      }
      const archs = plan.manifest?.availableArchitectures ?? []
      const selectedArchitecture =
        plan.manifest?.defaultArchitecture || plan.manifest?.architecture || archs[0] || ''
      setPendingInstallPlan({
        name,
        plan,
        force: false,
        selectedArchitecture,
        installMode: 'silent',
        intent,
      })
    } catch (err) {
      console.error('PlanInstall failed:', err)
      showTaskDockNotice(t('appExt.planInstallFailed', { error: String(err) }), 'error', { persistent: true })
    }
  }

  const handleInspectManifest = useCallback(async (packageRef: string) => {
    try {
      const manifest = await GetPackageManifestInspect(packageRef)
      setBrowseManifestPreview({ packageRef, manifest })
    } catch (err) {
      console.error('GetPackageManifestInspect failed:', err)
      setError(t('package.manifest.loadFailed', { error: String(err) }))
    }
  }, [t])

  const handleInspectInstalledManifest = useCallback(async (packageName: string, version: string, bucket?: string) => {
    try {
      const manifest = await GetInstalledManifestInspect(packageName, version)
      const base = bucket && bucket !== 'main' ? `${bucket}/${packageName}` : packageName
      setInstalledManifestDialog({ packageRef: `${base}@${version}`, manifest })
    } catch (err) {
      console.error('GetInstalledManifestInspect failed:', err)
      setError(t('package.manifest.loadFailed', { error: String(err) }))
    }
  }, [t])

  const handleCancelInstall = async (name: string) => {
    if (!activeInstalls[name] || installCancelling[name]) return
    setInstallCancelling((prev) => ({ ...prev, [name]: true }))
    try {
      await CancelInstall(name)
    } catch (err) {
      console.error('CancelInstall failed:', err)
      setInstallCancelling((prev) => ({ ...prev, [name]: false }))
      const errText = String(err)
      const message = errText.includes('no install in progress')
        ? t('appExt.cancelInstallNoTask')
        : t('appExt.cancelInstallFailed', { error: errText })
      showTaskDockNotice(message, 'error', { persistent: true })
    }
  }

  const handleRefreshManifestPreview = useCallback(async () => {
    if (!browseManifestPreview) return
    try {
      const manifest = await GetPackageManifestInspect(browseManifestPreview.packageRef)
      setBrowseManifestPreview({ packageRef: browseManifestPreview.packageRef, manifest })
    } catch (err) {
      console.error('GetPackageManifestInspect failed:', err)
      setError(t('package.manifest.loadFailed', { error: String(err) }))
    }
  }, [browseManifestPreview, t])

  const handleConfirmInstall = async () => {
    if (!pendingInstallPlan) return
    if (gcRunning) return
    if (!isPro && hasActiveInstalls) return
    const { name, force, selectedArchitecture, installMode } = pendingInstallPlan
    setPendingInstallPlan(null)
    await runInstall(name, force, selectedArchitecture, installMode === 'interactive')
  }

  const handleConfirmVersionSwitch = async () => {
    if (!pendingVersionSwitch || versionSwitchBusy) return
    if (gcRunning || operationBusy) return
    const { packageName, version } = pendingVersionSwitch
    setVersionSwitchBusy(true)
    try {
      await SwitchPackageVersion(packageName, version)
      setPendingVersionSwitch(null)
      await refreshAfterPackageOp('install')
      bumpActivityLog()
      showInfoMessage(t('installedExt.versions.switchedOk', { name: packageName, version }))
    } catch (err) {
      console.error('SwitchPackageVersion failed:', err)
      showTaskDockNotice(
        t('installedExt.versions.switchFailed', { error: String(err) }),
        'error',
        { persistent: true },
      )
    } finally {
      setVersionSwitchBusy(false)
    }
  }

  const handleInstallSuggestion = (ref: string) => {
    setInstallSuggestions((prev) => prev.filter((s) => s.ref !== ref))
    void beginInstall(ref)
  }

  const handleUninstallRequest = (pkg: main.InstalledPackage) => {
    if (operationBusy) return
    if (isPackageInstalling(packageInstallRef(pkg.name, pkg.bucket))) return
    setPendingUninstallInactiveOnly(false)
    setPendingUninstall(pkg)
  }

  const handleUninstallVersionRequest = (packageName: string, version: string) => {
    if (operationBusy) return
    const existing = installedPackages.find((p) => p.name === packageName)
    if (isPackageInstalling(packageInstallRef(packageName, existing?.bucket))) return
    setPendingUninstallInactiveOnly(true)
    setPendingUninstall(
      existing
        ? { ...existing, version }
        : ({
            name: packageName,
            version,
            bucket: '',
            description: '',
            homepage: '',
            installedAt: '',
            installSize: 0,
            updateAvailable: false,
            versionLocked: false,
          } as main.InstalledPackage),
    )
  }

  const handleConfirmUninstall = async () => {
    if (!pendingUninstall || currentUninstall) return
    const { name, version } = pendingUninstall
    const ref = packageUninstallRef(name, version)
    const inactiveOnly = pendingUninstallInactiveOnly
    setPendingUninstall(null)
    setPendingUninstallInactiveOnly(false)
    if (!inactiveOnly) {
      setSelectedPackage(null)
    }
    setCurrentUninstall({
      name: ref,
      progress: { phase: 'Starting', status: '', percentage: 0, message: '', bytesDown: 0, bytesTotal: 0 },
    })
    const postOp0 = performance.now()
    const outcome = waitForUninstallOutcome()
    try {
      await Uninstall(ref)
      await outcome
      showTaskDockNotice(t('appExt.uninstallSuccess', { label: ref }), 'success')
    } catch (err) {
      console.error('Uninstall failed:', err)
      showTaskDockNotice(t('appExt.uninstallFailed', { error: String(err) }), 'error', { persistent: true })
    } finally {
      await refreshAfterPackageOp('uninstall')
      const log0 = performance.now()
      bumpActivityLog()
      logPostOpMs('uninstall follow-up → bumpActivityLog', log0)
      logPostOpMs('uninstall follow-up total (incl. quick refresh)', postOp0)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const statsPending = statsLoadState === 'loading' && !statsEverLoaded
  const formatStatCount = (value: number) => (statsPending ? '—' : String(value))
  const formatStatSize = () => (statsPending ? '—' : formatBytes(stats.totalSize))
  const footerLeftDisplay = bucketCheckFooterStatus ?? footerLeftStatus
  const statsBusyHint =
    footerRightStatus ??
    footerLeftDisplay ??
    (statsSlowCached
      ? t('footer.statsCachedHint')
      : undefined)

  const toggleInstalledPackage = (pkg: main.InstalledPackage) => {
    if (isPackageDetailExpanded(pkg.name)) {
      setSelectedPackage(null)
      return
    }
    setSelectedPackage({
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      bucket: pkg.bucket,
      homepage: pkg.homepage,
      installedAt: pkg.installedAt,
      isInstalled: true,
    })
  }

  // Clear package selection when switching tabs
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    setSelectedPackage(null)
    if (tab === 'installed' || tab === 'buckets') {
      clearStatAttention()
    }
    if (tab === 'templates') {
      setTemplateRefreshKey((k) => k + 1)
    }
    if (tab === 'storage') {
      setStorageRefreshKey((k) => k + 1)
    }
  }

  // Clicking the updatable stat jumps to Updates and highlights updatable rows
  const handleShowUpdates = useCallback(() => {
    if (stats.updatesCount <= 0) return
    setActiveTab('updates')
    setSelectedPackage(null)
    setUpdatesPage(1)
    setFlashUpdates(false)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    requestAnimationFrame(() => {
      setFlashUpdates(true)
      flashTimerRef.current = setTimeout(() => setFlashUpdates(false), 2400)
    })
  }, [stats.updatesCount])

  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    if (statAttentionTimerRef.current) clearTimeout(statAttentionTimerRef.current)
  }, [])


  return (
    <div className="app">
      <AppMenuBar
        onAction={handleMenuAction}
        themeId={themeId}
        isPro={isPro}
        customThemes={customThemes}
        pageSizeMode={pageSizeMode}
        pageSize={pageSize}
        locale={getAppLocale()}
        bucketCheckIntervalMinutes={bucketCheckIntervalMinutes}
        bucketSyncMode={bucketSyncMode}
        hideDeprecated={hideDeprecated}
        isActionDisabled={isMenuActionDisabled}
      />
      <div className="app-body" style={{ zoom }}>
      <div
        className={`stats-bar ${statsLoadState !== 'idle' ? 'stats-bar-busy' : ''}`}
        title={statsBusyHint}
      >
        <button
          type="button"
          className={`stat stat-clickable ${activeTab === 'buckets' ? 'active' : ''}${statAttention === 'buckets' ? ' stat-attention' : ''}`}
          onClick={() => handleTabChange('buckets')}
          title={statAttention === 'buckets' ? t('stats.bucketsUpdatesHint') : t('stats.manageBuckets')}
        >
          <span className={`stat-value ${stats.bucketUpdatesCount > 0 ? 'warning' : ''} ${statsPending ? 'stat-value-pending' : ''}`}>
            {formatStatCount(stats.bucketCount)}
          </span>
          <span className="stat-label">
            {t('stats.buckets')}
            {!statsPending && stats.bucketUpdatesCount > 0
              ? ` · ${t('stats.bucketsPending', { count: stats.bucketUpdatesCount })}`
              : ''}
          </span>
        </button>
        <button
          type="button"
          className={`stat stat-clickable${activeTab === 'browse' ? ' active' : ''}`}
          onClick={() => handleTabChange('browse')}
          title={t('stats.browsePackages')}
        >
          <span className={`stat-value ${statsPending ? 'stat-value-pending' : ''}`}>
            {formatStatCount(stats.availablePackagesCount)}
          </span>
          <span className="stat-label">{t('stats.available')}</span>
        </button>
        <button
          type="button"
          className={`stat stat-clickable${activeTab === 'templates' ? ' active' : ''}`}
          onClick={() => handleTabChange('templates')}
          title={t('stats.templatesHint')}
        >
          <span className={`stat-value ${statsPending ? 'stat-value-pending' : ''}`}>
            {formatStatCount(stats.templateCount)}
          </span>
          <span className="stat-label">{t('stats.templates')}</span>
        </button>
        <button
          type="button"
          className={`stat stat-clickable ${activeTab === 'installed' ? 'active' : ''}${statAttention === 'installed' ? ' stat-attention' : ''}`}
          onClick={() => handleTabChange('installed')}
          title={statAttention === 'installed' ? t('stats.installedNewHint') : t('stats.viewInstalled')}
        >
          <span className={`stat-value ${statsPending ? 'stat-value-pending' : ''}`}>
            {installedPackages.length > 0 ? installedPackages.length : formatStatCount(stats.installedCount)}
          </span>
          <span className="stat-label">{t('stats.installed')}</span>
        </button>
        <button
          type="button"
          className={`stat ${stats.updatesCount > 0 ? 'stat-clickable' : 'stat-disabled'}${activeTab === 'updates' ? ' active' : ''}`}
          onClick={handleShowUpdates}
          disabled={stats.updatesCount <= 0}
          title={stats.updatesCount > 0 ? t('stats.openUpdates') : t('stats.noUpdates')}
        >
          <span className={`stat-value warning ${statsPending ? 'stat-value-pending' : ''}`}>
            {formatStatCount(stats.updatesCount)}
          </span>
          <span className="stat-label">{t('stats.updatable')}</span>
        </button>
        <button
          type="button"
          className={`stat stat-clickable ${activeTab === 'storage' ? 'active' : ''}`}
          onClick={() => handleTabChange('storage')}
          title={t('stats.storageHint')}
        >
          <span className={`stat-value ${statsPending ? 'stat-value-pending' : ''}`}>
            {formatStatSize()}
          </span>
          <span className="stat-label">{t('stats.storage')}</span>
        </button>
        <button
          type="button"
          className={`stat stat-clickable${activeTab === 'activity' ? ' active' : ''}`}
          onClick={() => handleTabChange('activity')}
          title={t('stats.activityHint')}
        >
          <span className={`stat-value ${statsPending ? 'stat-value-pending' : ''}`}>
            {formatStatCount(stats.activityLogCount)}
          </span>
          <span className="stat-label">{t('stats.activity')}</span>
        </button>
      </div>

      <nav className="tabs">
        {TAB_ITEMS.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => handleTabChange(tab.id)}
          >
            <span className="tab-icon-wrap" aria-hidden="true">
              <NavIcon name={tab.icon} className="tab-icon" />
            </span>
            <span>{tab.label}</span>
            {tab.id === 'buckets' && stats.bucketUpdatesCount > 0 && (
              <span className="tab-badge warning">{stats.bucketUpdatesCount}</span>
            )}
            {tab.id === 'updates' && stats.updatesCount > 0 && (
              <span className="tab-badge warning">{stats.updatesCount}</span>
            )}
          </button>
        ))}
      </nav>

      <main className={`content ${activeTab === 'activity' ? 'activity-full' : ''}`}>
        <div className={activeTab === 'buckets' ? 'tab-panel' : 'tab-panel tab-panel-hidden'} aria-hidden={activeTab !== 'buckets'}>
          <BucketPanel
            refreshKey={bucketRefreshKey}
            openAdd={bucketOpenAdd}
            onOpenAddConsumed={() => setBucketOpenAdd(false)}
            onBucketsChanged={bumpBuckets}
            pageSize={pageSize}
            pageSizeMode={pageSizeMode}
            autoPageSize={autoSize}
            onPageSizeChange={handlePageSizeChange}
            onPageSizeAuto={handlePageSizeAuto}
            listScrollRef={listScrollRef}
          />
        </div>

        {activeTab === 'templates' && (
          <TemplatePanel
            refreshKey={templateRefreshKey}
            indexReady={searchIndexReady}
            isPackageInstalled={isPackageInstalled}
            isPackageInstalling={isPackageInstalling}
            operationBusy={operationBusy}
            onInstall={(ref, intent) => void beginInstall(ref, intent ?? 'install')}
            onProRequired={() => setShowProModal(true)}
            onInspectManifest={(ref) => void handleInspectManifest(ref)}
            manifestPreview={browseManifestPreview}
            onCloseManifest={() => setBrowseManifestPreview(null)}
            onManifestUpdated={() => void handleRefreshManifestPreview()}
            onError={handleTemplateError}
            onInfo={showCenteredInfo}
          />
        )}

        <div className={activeTab === 'browse' ? 'tab-panel' : 'tab-panel tab-panel-hidden'} aria-hidden={activeTab !== 'browse'}>
          <BrowsePanel
            refreshKey={bucketRefreshKey}
            focusSearchToken={browseFocusToken}
            hideDeprecated={hideDeprecated}
            indexReady={searchIndexReady}
            pageSize={pageSize}
            pageSizeMode={pageSizeMode}
            autoPageSize={autoSize}
            onPageSizeChange={handlePageSizeChange}
            onPageSizeAuto={handlePageSizeAuto}
            listScrollRef={listScrollRef}
            isPackageInstalled={isPackageInstalled}
            operationBusy={operationBusy}
            isPackageInstalling={isPackageInstalling}
            onInstall={(ref, intent) => void beginInstall(ref, intent ?? 'install')}
            onInspectManifest={(ref) => void handleInspectManifest(ref)}
            manifestPreview={browseManifestPreview}
            onCloseManifest={() => setBrowseManifestPreview(null)}
            onManifestUpdated={() => void handleRefreshManifestPreview()}
            onError={setError}
            onInfo={showCenteredInfo}
          />
        </div>

        {activeTab === 'installed' && (
          <InstalledPackageSection
            title={t('installed.title')}
            subtitle={t('installed.subtitle')}
            packages={installedPackages}
            emptyState={t('installed.empty')}
            page={installedPage}
            onPageChange={setInstalledPage}
            pageSize={pageSize}
            pageSizeMode={pageSizeMode}
            autoPageSize={autoSize}
            onPageSizeChange={handlePageSizeChange}
            onPageSizeAuto={handlePageSizeAuto}
            loading={installedListRefreshing}
            listScrollRef={listScrollRef}
            onRefresh={() => void handleRefreshInstalledList('installed-tab-refresh')}
            selectedPackage={selectedPackage}
            onTogglePackage={toggleInstalledPackage}
            operationBusy={operationBusy}
            isPackageInstalling={isPackageInstalling}
            currentUninstallName={currentUninstall?.name ?? null}
            onInstall={(ref, intent) => void beginInstall(ref, intent ?? 'install')}
            onUninstall={handleUninstallRequest}
            onUninstallVersion={handleUninstallVersionRequest}
            onError={setError}
            isPro={isPro}
            onProRequired={() => setShowProModal(true)}
            onPackageChanged={() => void loadInstalled({ trace: 'version-manage' })}
            onMessage={showCenteredInfo}
            bumpActivityLog={bumpActivityLog}
            formatBytes={formatBytes}
            onInspectInstalledManifest={(name, version, bucket) =>
              void handleInspectInstalledManifest(name, version, bucket)
            }
            showFavorites
          />
        )}

        {activeTab === 'updates' && (
          <InstalledPackageSection
            title={t('updates.title')}
            subtitle={t('updates.subtitle')}
            packages={updatablePackages}
            emptyState={t('updates.empty')}
            page={updatesPage}
            onPageChange={setUpdatesPage}
            pageSize={pageSize}
            pageSizeMode={pageSizeMode}
            autoPageSize={autoSize}
            onPageSizeChange={handlePageSizeChange}
            onPageSizeAuto={handlePageSizeAuto}
            loading={installedListRefreshing}
            listScrollRef={listScrollRef}
            onRefresh={() => void handleRefreshUpdatesCenter()}
            selectedPackage={selectedPackage}
            onTogglePackage={toggleInstalledPackage}
            flashUpdates={flashUpdates}
            operationBusy={operationBusy}
            isPackageInstalling={isPackageInstalling}
            currentUninstallName={currentUninstall?.name ?? null}
            onInstall={(ref, intent) => void beginInstall(ref, intent ?? 'install')}
            onUninstall={handleUninstallRequest}
            onUninstallVersion={handleUninstallVersionRequest}
            onError={setError}
            isPro={isPro}
            onProRequired={() => setShowProModal(true)}
            onPackageChanged={() => void loadInstalled({ trace: 'version-manage' })}
            onMessage={showCenteredInfo}
            bumpActivityLog={bumpActivityLog}
            formatBytes={formatBytes}
            onInspectInstalledManifest={(name, version, bucket) =>
              void handleInspectInstalledManifest(name, version, bucket)
            }
          />
        )}

        {activeTab === 'storage' && (
          <StoragePanel
            refreshKey={storageRefreshKey}
            pageSize={pageSize}
            pageSizeMode={pageSizeMode}
            autoPageSize={autoSize}
            onPageSizeChange={handlePageSizeChange}
            onPageSizeAuto={handlePageSizeAuto}
            listScrollRef={listScrollRef}
            onStatusMessage={setFooterRightStatus}
            onChanged={(message) => {
              void loadStats('storageChanged', true)
              void loadInstalled({ quick: true, trace: 'storageChanged' })
              showCenteredInfo(message)
            }}
          />
        )}

        {activeTab === 'activity' && (
          <ActivityLogPanel
            refreshKey={activityRefreshKey}
            pageSize={pageSize}
            pageSizeMode={pageSizeMode}
            autoPageSize={autoSize}
            onPageSizeChange={handlePageSizeChange}
            onPageSizeAuto={handlePageSizeAuto}
            listScrollRef={listScrollRef}
            isPro={isPro}
            onProRequired={() => setShowProModal(true)}
            onCleared={(deleted) => {
              showInfoMessage(
                deleted > 0
                  ? t('activityExt.cleared', { count: deleted })
                  : t('activityExt.nothingToClear'),
              )
            }}
          />
        )}
      </main>

      <div className="task-progress-dock" aria-live="polite">
        {hasActiveInstalls && (
          <div className="install-progress-stack">
            {Object.entries(activeInstalls).map(([name, progress]) => {
              const isDownloading = progress.phase === 'download'
              const { barPct, indeterminate, showPercent } = operationProgressDisplay(progress)
              const showBytes = isDownloading && (progress.bytesDown > 0 || progress.bytesTotal > 0)
              const cancelling = !!installCancelling[name]
              return (
                <div key={name} className="card install-progress">
                  <div className="card-header">
                    <span>{t('appExt.installing', { name })}</span>
                    <div className="install-progress-header-actions">
                      <span className="pill info">{formatPhaseLabel(progress.phase)}</span>
                      <button
                        type="button"
                        className="ghost progress-cancel-btn"
                        disabled={cancelling}
                        aria-label={t('appExt.cancelInstallAria')}
                        onClick={() => void handleCancelInstall(name)}
                      >
                        {cancelling ? t('appExt.cancellingInstall') : t('app.cancel')}
                      </button>
                    </div>
                  </div>
                  <div className="card-body">
                    <div className={`progress-bar${indeterminate ? ' is-indeterminate' : ''}`}>
                      <div
                        className="progress-bar-fill"
                        style={indeterminate ? undefined : { width: `${Math.max(barPct, barPct > 0 ? 1 : 0)}%` }}
                      />
                    </div>
                    <div className="progress-info">
                      {showPercent && <span>{barPct.toFixed(0)}%</span>}
                      {progress.message && <span className="progress-status">{formatProgressMessage(progress)}</span>}
                    </div>
                    {showBytes && (
                      <div className="progress-bytes" aria-label={t('appExt.downloadProgressAria')}>
                        <span>{t('appExt.downloaded')}<strong>{formatBytes(progress.bytesDown)}</strong></span>
                        <span>
                          {t('appExt.fileSize')}
                          <strong>{progress.bytesTotal > 0 ? formatBytes(progress.bytesTotal) : t('appExt.calculating')}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {currentUninstall && (() => {
          const { progress } = currentUninstall
          const { barPct, indeterminate, showPercent } = operationProgressDisplay(progress)
          return (
            <div className="card install-progress uninstall-progress">
              <div className="card-header">
                <span>{t('appExt.uninstalling', { name: currentUninstall.name })}</span>
                <span className="pill info">{formatPhaseLabel(progress.phase)}</span>
              </div>
              <div className="card-body">
                <div className={`progress-bar${indeterminate ? ' is-indeterminate' : ''}`}>
                  <div
                    className="progress-bar-fill"
                    style={indeterminate ? undefined : { width: `${barPct}%` }}
                  />
                </div>
                <div className="progress-info">
                  {showPercent && <span>{barPct.toFixed(0)}%</span>}
                  {progress.message ? <span>{formatProgressMessage(progress)}</span> : null}
                </div>
              </div>
            </div>
          )
        })()}

        <BootstrapTabProgress />
        <BucketTabProgress />
        <StorageCacheTabProgress />

        {taskDockNotice && (
          <div
            className={`task-dock-notice task-dock-notice--${taskDockNotice.kind}`}
            role={taskDockNotice.kind === 'error' ? 'alert' : 'status'}
          >
            <div className="task-dock-notice-body">
              <span className="task-dock-notice-text">{taskDockNotice.message}</span>
              {taskDockNotice.detail && (
                <details className="task-dock-notice-details">
                  <summary>{t('appExt.viewDetails')}</summary>
                  <pre>{taskDockNotice.detail}</pre>
                </details>
              )}
            </div>
            <button
              type="button"
              className="ghost task-dock-notice-close"
              onClick={dismissTaskDockNotice}
              aria-label={t('app.close')}
            >
              ×
            </button>
          </div>
        )}

        {infoMessage && (
          <div className={`info-banner info-banner-dock${infoMessageCentered ? ' is-centered' : ''}`} role="status">
            <div className="info-banner-body">
              <span className="info-banner-text">{infoMessage}</span>
            </div>
            <button type="button" className="ghost info-banner-close" onClick={dismissInfoMessage} aria-label={t('app.close')}>
              ×
            </button>
          </div>
        )}

        {installSuggestions.length > 0 && (
          <div className="info-banner info-banner-dock is-centered" role="status">
            <div className="info-banner-body info-banner-body-stacked">
              <span className="info-banner-text">{t('appExt.suggestInstall')}</span>
              <div className="info-banner-actions">
                {installSuggestions.map((s) => (
                  <button
                    key={s.ref}
                    type="button"
                    className="ghost info-banner-suggestion"
                    onClick={() => handleInstallSuggestion(s.ref)}
                  >
                    {s.label || s.ref}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="ghost info-banner-close"
              onClick={() => setInstallSuggestions([])}
              aria-label={t('app.close')}
            >
              ×
            </button>
          </div>
        )}

        {error && (() => {
          const lines = error.split('\n')
          const summary = lines[0]
          const detail = lines.slice(1).join('\n').trim()
          return (
            <div className="task-dock-notice task-dock-notice--error" role="alert">
              <div className="task-dock-notice-body">
                <span className="task-dock-notice-text">{summary}</span>
                {detail && (
                  <details className="task-dock-notice-details">
                    <summary>{t('appExt.viewDetails')}</summary>
                    <pre>{detail}</pre>
                  </details>
                )}
              </div>
              <button
                type="button"
                className="ghost task-dock-notice-close"
                onClick={() => setError(null)}
                aria-label={t('app.close')}
              >
                ×
              </button>
            </div>
          )
        })()}
      </div>

      {showQuitConfirm && (
        <ModalOverlay onClose={() => setShowQuitConfirm(false)}>
          <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>{t('appExt.quitTitle')}</h2>
              <ModalCloseButton onClick={() => setShowQuitConfirm(false)} ariaLabel={t('app.cancel')} />
            </div>
            <div className="modal-body">
              <p>{t('app.quitConfirm')}</p>
            </div>
            <div className="confirm-dialog-footer">
              <button type="button" className="secondary" onClick={() => setShowQuitConfirm(false)}>
                {t('app.cancel')}
              </button>
              <button type="button" className="primary" onClick={() => Quit()}>
                {t('app.quit')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {pendingVersionSwitch && (
        <SwitchVersionDialog
          packageName={pendingVersionSwitch.packageName}
          version={pendingVersionSwitch.version}
          busy={versionSwitchBusy}
          onClose={() => {
            if (!versionSwitchBusy) setPendingVersionSwitch(null)
          }}
          onConfirm={() => void handleConfirmVersionSwitch()}
        />
      )}

      {pendingInstallPlan && (
        <InstallPackageDialog
          pending={pendingInstallPlan}
          onClose={() => setPendingInstallPlan(null)}
          onConfirm={() => void handleConfirmInstall()}
          onArchitectureChange={(arch) =>
            setPendingInstallPlan((prev) => (prev ? { ...prev, selectedArchitecture: arch } : prev))
          }
          onInstallModeChange={(mode) =>
            setPendingInstallPlan((prev) => (prev ? { ...prev, installMode: mode } : prev))
          }
          onForceChange={(force) =>
            setPendingInstallPlan((prev) => (prev ? { ...prev, force } : prev))
          }
        />
      )}

      {installedManifestDialog && (
        <PackageManifestDialog
          packageRef={installedManifestDialog.packageRef}
          manifest={installedManifestDialog.manifest}
          onClose={() => setInstalledManifestDialog(null)}
        />
      )}

      {pendingUninstall && (
        <ModalOverlay
          onClose={() => {
            setPendingUninstall(null)
            setPendingUninstallInactiveOnly(false)
          }}
        >
          <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>{pendingUninstallInactiveOnly ? t('appExt.uninstallDialog.oldVersionTitle') : t('appExt.uninstallDialog.title')}</h2>
              <ModalCloseButton
                onClick={() => { setPendingUninstall(null); setPendingUninstallInactiveOnly(false) }}
                ariaLabel={t('app.cancel')}
              />
            </div>
            <div className="modal-body">
              {pendingUninstallInactiveOnly ? (
                <>
                  <p>
                    <Trans
                      i18nKey="appExt.uninstallDialog.confirmInactive"
                      values={{ name: pendingUninstall.name, version: pendingUninstall.version }}
                      components={{ strong: <strong /> }}
                    />
                  </p>
                  <p className="confirm-dialog-summary installed-version-uninstall-note">
                    {t('appExt.uninstallDialog.inactiveNote')}
                  </p>
                </>
              ) : (
                <>
                  <p>{t('appExt.uninstallDialog.confirmPackage')}</p>
                  <p className="confirm-dialog-summary">
                    <strong>{pendingUninstall.name}</strong>
                    {' · '}
                    {pendingUninstall.version}
                    {pendingUninstall.bucket ? ` · ${pendingUninstall.bucket}` : ''}
                    {pendingUninstall.installedAt ? ` · ${localeDateString(pendingUninstall.installedAt)}` : ''}
                  </p>
                </>
              )}
            </div>
            <div className="confirm-dialog-footer">
              <button type="button" className="secondary" onClick={() => { setPendingUninstall(null); setPendingUninstallInactiveOnly(false) }}>
                {t('app.cancel')}
              </button>
              <button type="button" className="primary" onClick={handleConfirmUninstall}>
                {t('appExt.uninstallDialog.confirm')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      <footer className="footer">
        <span
          className={`footer-left ${footerLeftDisplay ? 'footer-left-busy' : ''}`}
          aria-live="polite"
        >
          {footerLeftDisplay}
        </span>
        <span className="footer-center">
          <button
            type="button"
            className="text-link"
            title={t('footer.siteTitle')}
            onClick={(e) => openExternalUrl(GLUESTICK_HOME_URL, e)}
          >
           {t('footer.tagline')}
          </button>
        </span>
        <span
          className={`footer-right ${footerRightStatus ? 'footer-right-busy' : ''}`}
          aria-live="polite"
        >
          {footerRightStatus}
        </span>
      </footer>

      {showAboutModal && aboutInfo && (
        <AboutDialog
          info={aboutInfo}
          onClose={() => {
            setShowAboutModal(false)
            setAboutInfo(null)
          }}
        />
      )}

      {desktopUpdateInfo?.updateAvailable && (
        <DesktopUpdateDialog
          info={desktopUpdateInfo}
          onDownload={() => {
            const url = desktopUpdateInfo.downloadURL || desktopUpdateInfo.releaseURL
            OpenDesktopUpdateURL(url)
          }}
          onRemindLater={() => {
            void DismissDesktopUpdate('remind_later', desktopUpdateInfo.latestVersion)
              .catch((err) => console.error('Dismiss desktop update:', err))
              .finally(() => setDesktopUpdateInfo(null))
          }}
          onSkip={() => {
            void DismissDesktopUpdate('skip', desktopUpdateInfo.latestVersion)
              .catch((err) => console.error('Dismiss desktop update:', err))
              .finally(() => setDesktopUpdateInfo(null))
          }}
          onClose={() => setDesktopUpdateInfo(null)}
        />
      )}

      {showHelpModal && <HelpDialog onClose={() => setShowHelpModal(false)} />}

      {showGitHubProxyModal && (
        <GitHubProxyDialog
          onClose={() => setShowGitHubProxyModal(false)}
          onSaved={(message) => showInfoMessage(message, { autoHideMs: INFO_BANNER_AUTO_HIDE_MS })}
          onError={(message) => setError(message)}
        />
      )}

      {showDownloadWorkersModal && (
        <DownloadWorkersDialog
          onClose={() => setShowDownloadWorkersModal(false)}
          onSaved={(message) => showInfoMessage(message, { autoHideMs: INFO_BANNER_AUTO_HIDE_MS })}
          onError={(message) => setError(message)}
        />
      )}

      {showDoctorModal && (
        <ModalOverlay
          onClose={() => setShowDoctorModal(false)}
          disabled={doctorLoading}
        >
          <div className="modal doctor-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>{t('doctor.title')}</h2>
              <ModalCloseButton
                disabled={doctorLoading}
                onClick={() => setShowDoctorModal(false)}
                ariaLabel={t('app.close')}
              />
            </div>
            <div className="modal-body">
              {doctorLoading && doctorOK === null && (
                <p className="doctor-running-hint">{t('doctor.running')}</p>
              )}
              {!doctorLoading && doctorOK !== null && (
                <p className={`doctor-summary ${doctorOK ? 'is-ok' : 'is-warn'}`}>
                  {doctorOK ? t('doctor.summaryOk') : t('doctor.summaryFail')}
                </p>
              )}
              {doctorChecks.length > 0 && (
                <ul className="doctor-check-list">
                  {doctorChecks.map((check) => (
                    <li
                      key={check.id}
                      className={
                        check.status === 'pending'
                          ? 'doctor-check-pending'
                          : check.status === 'running'
                            ? 'doctor-check-running'
                            : check.ok
                              ? 'doctor-check-ok'
                              : 'doctor-check-fail'
                      }
                    >
                      <div className="doctor-check-head">
                        <span className="doctor-check-mark">
                          {check.status === 'pending' ? '○' : check.status === 'running' ? '…' : check.ok ? '✓' : '✗'}
                        </span>
                        <strong>{formatDoctorCheckLabel(check.id, t)}</strong>
                        <span className="doctor-check-detail">{formatDoctorDetail(check, t)}</span>
                      </div>
                      {check.status === 'done' && !check.ok && (check.hint || check.hintKey) && (
                        <p className="doctor-check-hint">→ {formatDoctorHint(check, t)}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="primary" disabled={doctorLoading} onClick={() => setShowDoctorModal(false)}>
                {t('app.close')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showThemePicker && (
        <ThemePicker
          themeId={themeId}
          isPro={isPro}
          customThemes={customThemes}
          onSelect={(id) => {
            selectTheme(id)
            setShowThemePicker(false)
          }}
          onEditCustom={() => openThemeEditor(null)}
          onDeleteCustom={handleDeleteCustomTheme}
          onCreateCustom={() => openThemeEditor(null)}
          onUpgrade={() => {
            setShowThemePicker(false)
            setShowProModal(true)
          }}
          onClose={() => setShowThemePicker(false)}
        />
      )}

      {showProModal && (
        <ModalOverlay onClose={() => setShowProModal(false)}>
          <div className="modal modal-pro" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('pro.title')}</h2>
              <ModalCloseButton onClick={() => setShowProModal(false)} ariaLabel={t('app.close')} />
            </div>
            <div className="modal-body">
              <p className="modal-intro">{t('pro.intro')}</p>
              <div className="pro-features">
                <div className="pro-feature">
                  <div className="pro-feature-icon">📦</div>
                  <div className="pro-feature-content">
                    <h4>{t('pro.feature.envTemplate.title')}</h4>
                    <p>{t('pro.feature.envTemplate.desc')}</p>
                  </div>
                </div>
                <div className="pro-feature">
                  <div className="pro-feature-icon">🚀</div>
                  <div className="pro-feature-content">
                    <h4>{t('pro.feature.batchQueue.title')}</h4>
                    <p>{t('pro.feature.batchQueue.desc')}</p>
                  </div>
                </div>
                <div className="pro-feature">
                  <div className="pro-feature-icon">⏪</div>
                  <div className="pro-feature-content">
                    <h4>{t('pro.feature.versionRollback.title')}</h4>
                    <p>{t('pro.feature.versionRollback.desc')}</p>
                  </div>
                </div>
                <div className="pro-feature">
                  <div className="pro-feature-icon">📊</div>
                  <div className="pro-feature-content">
                    <h4>{t('pro.feature.exportReport.title')}</h4>
                    <p>{t('pro.feature.exportReport.desc')}</p>
                  </div>
                </div>
                <div className="pro-feature">
                  <div className="pro-feature-icon">🧹</div>
                  <div className="pro-feature-content">
                    <h4>{t('pro.feature.logCleanup.title')}</h4>
                    <p>{t('pro.feature.logCleanup.desc')}</p>
                  </div>
                </div>
                <div className="pro-feature">
                  <div className="pro-feature-icon">🎨</div>
                  <div className="pro-feature-content">
                    <h4>{t('pro.feature.themes.title')}</h4>
                    <p>{t('pro.feature.themes.desc')}</p>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="primary"
                  onClick={() => setShowProModal(false)}
                >
                  {t('pro.later')}
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
      </div>
    </div>
  )
}

export default App
