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
  CleanReinstall,
  GetStats,
  GetActivityLogPage,
  IsEngineReady,
  IsSearchIndexReady,
  OpenGlueDataDir,
  GetAboutInfo,
  CheckDesktopUpdate,
  DismissDesktopUpdate,
  OpenDesktopUpdateURL,
  DownloadAndRunDesktopUpdate,
  UpdateBuckets,
  GetBucketSyncConfig,
  SetBucketCheckInterval,
  SetBucketSyncMode,
  RecordCheckUpdatesResult,
  PurgeCachePackage,
  ClearManifestDownloadOverride,
  InstallWithDownloadOverride,
  RunDoctor,
  IsProActive,
  GetTaskCenterHistory,
  SaveTaskCenterHistory,
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
import TaskCenterDialog from './TaskCenterDialog'
import {
  installTaskId,
  taskCenterItemFromDTO,
  taskCenterItemToDTO,
  upsertTaskCenterItem,
  type TaskCenterItem,
} from './taskCenter'
import { formatOverrideHash, normalizeHashDigest, parseHashMismatch } from './hashMismatch'
import HelpDialog from './HelpDialog'
import GitHubProxyDialog from './GitHubProxyDialog'
import DownloadWorkersDialog from './DownloadWorkersDialog'
import EnvironmentDialog, { type DoctorCheckItem } from './EnvironmentDialog'
import ModalCloseButton from './ModalCloseButton'
import ModalOverlay from './ModalOverlay'
import InstallPackageDialog, { type PendingInstallPlan } from './InstallPackageDialog'
import SwitchVersionDialog from './SwitchVersionDialog'
import PackageManifestDialog from './PackageManifestDialog'
import { countTemplates } from './templateStore'
import { loadHideDeprecated, saveHideDeprecated } from './browsePreferences'
import { packageInstallRef, packageNameFromInstallRef } from './templateLibrary'
import ThemePicker from './ThemePicker'
import ThemeEditor from './ThemeEditor'
import {
  applyTheme,
  cloneTokens,
  createThemeFromTokens,
  loadCustomThemes,
  loadStoredThemeId,
  resolveTheme,
  sanitizeThemeIdOnLoad,
  saveCustomThemes,
  saveThemeId,
  type ThemeDefinition,
  type ThemeId,
  type ThemeTokens,
} from './themes'
import NavIcon, { type NavIconName } from './NavIcon'
import { useListPageSize } from './listPageSize'
import type { main } from '../wailsjs/go/models'
import { GLUESTICK_HOME_URL, openExternalUrl } from './openExternalUrl'
import { Trans, useTranslation } from 'react-i18next'
import { formatInstallStatusMessage, formatPhaseLabel, localeDateString } from './i18n/formatMessage'
import i18n, { setAppLocale, getAppLocale, isAppLocale } from './i18n'
import {
  type InstallProgress,
  formatEtaDuration,
  formatTransferSpeed,
  isActivelyDownloading,
  mergeInstallProgress,
  operationProgressDisplay,
  sampleDownloadTransferStats,
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

/** Keep in sync with MaxParallelInstalls in app.go. */
const MAX_PARALLEL_INSTALLS = 4

function isRefInstalling(ref: string, active: Record<string, InstallProgress>): boolean {
  const key = installPackageKey(ref)
  return Object.keys(active).some((name) => installPackageKey(name) === key)
}

/** Slots used by queue pump + any direct Install (search / dialog / clean reinstall). */
function countOccupiedInstallSlots(
  inFlight: Set<string>,
  active: Record<string, InstallProgress>,
): number {
  const keys = new Set(inFlight)
  for (const name of Object.keys(active)) {
    keys.add(installPackageKey(name))
  }
  return keys.size
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

type DoctorCheckItemLocal = DoctorCheckItem

function makeInitialDoctorChecks(checkingLabel: string): DoctorCheckItemLocal[] {
  return DOCTOR_STEP_IDS.map((id) => ({
    id,
    ok: false,
    detail: checkingLabel,
    status: 'running' as const,
  }))
}

function formatProgressMessage(progress: InstallProgress): string {
  return formatInstallStatusMessage(progress)
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
  actionLabel?: string
  onAction?: () => void
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

function App() {
  const { t } = useTranslation()
  const TAB_ITEMS = useMemo(
    () =>
      ([
        { id: 'buckets' as TabType, label: t('nav.buckets'), icon: 'bucket' as NavIconName },
        { id: 'browse' as TabType, label: t('nav.browse'), icon: 'browse' as NavIconName },
        { id: 'templates' as TabType, label: t('nav.recipes'), icon: 'templates' as NavIconName },
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
  const installQueueRef = useRef<
    { ref: string; force: boolean; downloadURL?: string; downloadHash?: string }[]
  >([])
  const installInFlightKeysRef = useRef(new Set<string>())
  const [installQueueVersion, setInstallQueueVersion] = useState(0)
  const installPumpRunningRef = useRef(false)
  const installPumpScheduledRef = useRef(false)
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
  const [showTaskCenterModal, setShowTaskCenterModal] = useState(false)
  const [backgroundTasks, setBackgroundTasks] = useState<TaskCenterItem[]>([])
  /** Once dismissed, bottom install cards stay hidden for this session; use Tasks dialog. */
  const [installDockHidden, setInstallDockHidden] = useState(false)
  const taskCenterPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persistTaskCenterHistory = useCallback((tasks: TaskCenterItem[], immediate = false) => {
    const payload = tasks
      .filter((item) => item.kind === 'install')
      .map(taskCenterItemToDTO)
    const save = () => {
      void SaveTaskCenterHistory(payload).catch((err) =>
        console.error('SaveTaskCenterHistory failed:', err),
      )
    }
    if (taskCenterPersistTimerRef.current) {
      clearTimeout(taskCenterPersistTimerRef.current)
      taskCenterPersistTimerRef.current = null
    }
    if (immediate) {
      save()
      return
    }
    taskCenterPersistTimerRef.current = setTimeout(save, 400)
  }, [])

  useEffect(() => {
    void GetTaskCenterHistory()
      .then((rows) => {
        const loaded: TaskCenterItem[] = []
        for (const row of rows || []) {
          const item = taskCenterItemFromDTO(row)
          if (item) loaded.push(item)
        }
        if (loaded.length > 0) {
          setBackgroundTasks(loaded)
        }
      })
      .catch((err) => console.error('GetTaskCenterHistory failed:', err))
    return () => {
      if (taskCenterPersistTimerRef.current) {
        clearTimeout(taskCenterPersistTimerRef.current)
      }
    }
  }, [])

  const [showAboutModal, setShowAboutModal] = useState(false)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [showEnvironmentModal, setShowEnvironmentModal] = useState(false)
  const [showGitHubProxyModal, setShowGitHubProxyModal] = useState(false)
  const [showDownloadWorkersModal, setShowDownloadWorkersModal] = useState(false)
  const [bucketCheckIntervalMinutes, setBucketCheckIntervalMinutes] = useState(15)
  const [bucketSyncMode, setBucketSyncMode] = useState<'auto' | 'manual'>('manual')
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheckItemLocal[]>([])
  const [doctorOK, setDoctorOK] = useState<boolean | null>(null)
  const [doctorLoading, setDoctorLoading] = useState(false)
  const [aboutInfo, setAboutInfo] = useState<main.AboutInfo | null>(null)
  const [desktopUpdateInfo, setDesktopUpdateInfo] = useState<main.DesktopUpdateInfo | null>(null)
  const desktopUpdateAutoCheckedRef = useRef(false)
  const [selectedPackage, setSelectedPackage] = useState<SelectedPackage | null>(null)
  const [pendingUninstall, setPendingUninstall] = useState<main.InstalledPackage | null>(null)
  const [pendingUninstallInactiveOnly, setPendingUninstallInactiveOnly] = useState(false)
  const [pendingCleanReinstall, setPendingCleanReinstall] = useState<main.InstalledPackage | null>(null)
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
  const [isPro, setIsPro] = useState(false)
  const [customThemes, setCustomThemes] = useState<ThemeDefinition[]>(loadCustomThemes)
  const [themeId, setThemeId] = useState<ThemeId>(() =>
    sanitizeThemeIdOnLoad(loadStoredThemeId(), loadCustomThemes(), false),
  )
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [showThemeEditor, setShowThemeEditor] = useState(false)
  const [editingTheme, setEditingTheme] = useState<ThemeDefinition | null>(null)
  const [zoom, setZoom] = useState(loadStoredZoom)
  const updatablePackages = useMemo(
    () => installedPackages.filter(isPackageUpdatable),
    [installedPackages],
  )
  const { pageSize, mode: pageSizeMode, setPageSize, setAutoMode } = useListPageSize(
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

  useEffect(() => {
    void IsProActive().then(setIsPro).catch(() => setIsPro(false))
  }, [])

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
    applyThemeById(id)
  }, [applyThemeById])

  const handleSaveCustomTheme = useCallback((theme: ThemeDefinition) => {
    setCustomThemes((prev) => {
      const existing = prev.findIndex((t) => t.id === theme.id)
      const next = existing >= 0
        ? prev.map((t, i) => (i === existing ? theme : t))
        : [...prev, theme]
      saveCustomThemes(next)
      applyThemeById(theme.id, next)
      return next
    })
  }, [applyThemeById])

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

  const openThemeEditor = useCallback((theme: ThemeDefinition | null = null) => {
    setEditingTheme(theme)
    setShowThemeEditor(true)
    setShowThemePicker(false)
  }, [])

  const handleThemeEditorPreview = useCallback((tokens: ThemeTokens) => {
    const preview = createThemeFromTokens(
      editingTheme?.id ?? 'custom:preview',
      editingTheme?.name ?? t('theme.preview'),
      'free',
      cloneTokens(tokens),
    )
    applyTheme(preview)
  }, [editingTheme, t])

  useEffect(() => {
    const sanitized = sanitizeThemeIdOnLoad(loadStoredThemeId(), customThemes)
    if (sanitized !== themeId) {
      applyThemeById(sanitized)
    }
  }, [customThemes, applyThemeById, themeId])

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
    options?: {
      detail?: string
      autoHideMs?: number
      persistent?: boolean
      actionLabel?: string
      onAction?: () => void
    },
  ) => {
    clearTaskDockHideTimer()
    const parsed = splitTaskDockMessage(text)
    setTaskDockNotice({
      kind,
      message: parsed.message,
      detail: options?.detail ?? parsed.detail,
      actionLabel: options?.actionLabel,
      onAction: options?.onAction,
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
    const keys = Object.keys(pending)
    if (keys.length === 0) return
    pendingInstallProgressRef.current = {}
    setActiveInstalls((prev) => {
      let next: Record<string, InstallProgress> | null = null
      for (const key of keys) {
        const data = pending[key]
        const cur = prev[key]
        if (!cur) continue
        const merged = mergeInstallProgress(cur, { ...data, name: data.name || cur.name || key })
        if (installProgressEqual(cur, merged)) continue
        if (!next) next = { ...prev }
        next[key] = merged
      }
      if (next) activeInstallsRef.current = next
      return next ?? prev
    })
  }, [])

  const cancelPendingInstallProgress = useCallback((name?: string) => {
    if (name) {
      delete pendingInstallProgressRef.current[installPackageKey(name)]
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
      if (!name) return
      // Always index by package key so parallel installs cannot overwrite each other.
      const key = installPackageKey(name)
      if (!activeInstallsRef.current[key]) return
      pendingInstallProgressRef.current[key] = { ...data, name }
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
    const key = installPackageKey(name)
    installInFlightKeysRef.current.delete(key)
    cancelPendingInstallProgress(name)
    // Update the ref synchronously so pumpInstallQueue sees the freed slot
    // immediately (React setState updaters may run later for Wails events).
    const next: Record<string, InstallProgress> = {}
    for (const [n, prog] of Object.entries(activeInstallsRef.current)) {
      if (installPackageKey(n) !== key) {
        next[n] = prog
      } else {
        cancelPendingInstallProgress(n)
      }
    }
    activeInstallsRef.current = next
    setActiveInstalls(next)
    setInstallCancelling((prev) => {
      let changed = false
      const nextCancel = { ...prev }
      for (const n of Object.keys(nextCancel)) {
        if (installPackageKey(n) === key) {
          delete nextCancel[n]
          changed = true
        }
      }
      return changed ? nextCancel : prev
    })
    if (Object.keys(next).length === 0) {
      scheduleInstallListRefresh()
    }
  }, [cancelPendingInstallProgress, scheduleInstallListRefresh])

  const upsertBackgroundTask = useCallback(
    (task: TaskCenterItem) => {
      if (task.kind !== 'install') return
      setBackgroundTasks((prev) => {
        const next = upsertTaskCenterItem(prev, task)
        persistTaskCenterHistory(next)
        return next
      })
    },
    [persistTaskCenterHistory],
  )

  const bumpInstallQueue = useCallback(() => {
    setInstallQueueVersion((v) => v + 1)
  }, [])

  const pumpInstallQueueRef = useRef<() => void>(() => {})

  const pumpInstallQueue = useCallback(() => {
    if (installPumpRunningRef.current) {
      // A slot may have freed while this pump is mid-flight; run again when done.
      installPumpScheduledRef.current = true
      return
    }
    installPumpRunningRef.current = true
    installPumpScheduledRef.current = false
    void (async () => {
      try {
        while (true) {
          if (
            countOccupiedInstallSlots(
              installInFlightKeysRef.current,
              activeInstallsRef.current,
            ) >= MAX_PARALLEL_INSTALLS
          ) {
            break
          }
          const queued = installQueueRef.current.shift()
          if (!queued) break
          bumpInstallQueue()

          const name = queued.ref
          const force = queued.force
          const downloadURL = queued.downloadURL || ''
          const downloadHash = queued.downloadHash || ''
          const key = installPackageKey(name)
          if (
            installInFlightKeysRef.current.has(key) ||
            isRefInstalling(name, activeInstallsRef.current)
          ) {
            continue
          }

          installInFlightKeysRef.current.add(key)
          upsertBackgroundTask({
            id: installTaskId(key),
            kind: 'install',
            title: t('taskCenter.installTitle', { name }),
            status: 'running',
            progress: 0,
            detail: force ? t('taskCenter.forceDetail') : undefined,
            startedAt: Date.now(),
            items: [name],
          })

          try {
            if (downloadURL) {
              await InstallWithDownloadOverride(
                name,
                force,
                '',
                false,
                downloadURL,
                downloadHash,
              )
            } else {
              await Install(name, isPro, force, '', false)
            }
          } catch (err) {
            console.error('Install failed:', err)
            installInFlightKeysRef.current.delete(key)
            const errText = String(err)
            // Backend concurrency race: put back in queue and wait for a free slot.
            if (/too many installs|already being installed/i.test(errText)) {
              if (!installQueueRef.current.some((q) => installPackageKey(q.ref) === key)) {
                installQueueRef.current.unshift({
                  ref: name,
                  force,
                  downloadURL: downloadURL || undefined,
                  downloadHash: downloadHash || undefined,
                })
                bumpInstallQueue()
              }
              upsertBackgroundTask({
                id: installTaskId(key),
                kind: 'install',
                title: t('taskCenter.installTitle', { name }),
                status: 'queued',
                detail: t('taskCenter.queuedDetail'),
                startedAt: Date.now(),
                items: [name],
              })
              break
            }
            removeActiveInstall(name)
            upsertBackgroundTask({
              id: installTaskId(key),
              kind: 'install',
              title: t('taskCenter.installTitle', { name }),
              status: 'failed',
              error: errText,
              startedAt: Date.now(),
              finishedAt: Date.now(),
              items: [name],
            })
            showTaskDockNotice(t('appExt.installFailed', { error: errText }), 'error', {
              persistent: true,
            })
          }
        }
      } finally {
        installPumpRunningRef.current = false
        const shouldRepump =
          installPumpScheduledRef.current ||
          (installQueueRef.current.length > 0 &&
            countOccupiedInstallSlots(
              installInFlightKeysRef.current,
              activeInstallsRef.current,
            ) < MAX_PARALLEL_INSTALLS)
        installPumpScheduledRef.current = false
        if (shouldRepump) {
          pumpInstallQueueRef.current()
        }
      }
    })()
  }, [bumpInstallQueue, isPro, removeActiveInstall, showTaskDockNotice, t, upsertBackgroundTask])

  pumpInstallQueueRef.current = pumpInstallQueue

  const retryInstallTasksRef = useRef<
    (tasks: TaskCenterItem[], options?: { force?: boolean; acceptHash?: boolean }) => Promise<void>
  >(async () => {})

  const installEventHandlersRef = useRef({
    removeActiveInstall,
    bumpActivityLog,
    dismissTaskDockNotice,
    showTaskDockNotice,
    pulseStatAttention,
    queueInstallProgress,
    flushPendingInstallProgress,
    upsertBackgroundTask,
    pumpInstallQueue,
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
    upsertBackgroundTask,
    pumpInstallQueue,
    t,
  }

  useEffect(() => {
    const h = () => installEventHandlersRef.current

    const cancelStart = EventsOn('install:start', (name: string) => {
      h().dismissTaskDockNotice()
      const key = installPackageKey(name)
      setInstallCancelling((prev) => {
        const next = { ...prev }
        for (const n of Object.keys(next)) {
          if (installPackageKey(n) === key) delete next[n]
        }
        next[key] = false
        return next
      })
      const nextActive: Record<string, InstallProgress> = {}
      for (const [n, prog] of Object.entries(activeInstallsRef.current)) {
        if (installPackageKey(n) !== key) nextActive[n] = prog
      }
      nextActive[key] = {
        name,
        phase: 'Starting',
        status: '',
        percentage: 0,
        message: '',
        bytesDown: 0,
        bytesTotal: 0,
      }
      activeInstallsRef.current = nextActive
      setActiveInstalls(nextActive)
      h().upsertBackgroundTask({
        id: installTaskId(key),
        kind: 'install',
        title: h().t('taskCenter.installTitle', { name }),
        status: 'running',
        progress: 0,
        currentItem: name,
        startedAt: Date.now(),
        items: [name],
      })
    })
    const cancelProgress = EventsOn('install:progress', (data: InstallProgress) => {
      // Progress is keyed strictly by package name in activeInstalls; Task Center
      // binds live progress per task id so rows never show another install's %.
      h().queueInstallProgress(data)
    })
    const cancelComplete = EventsOn(
      'install:complete',
      (data?: { name?: string; version?: string; suggestions?: Array<{ label: string; ref: string }> }) => {
        const handlers = h()
        handlers.flushPendingInstallProgress()
        const name = data?.name ?? ''
        if (name) handlers.removeActiveInstall(name)
        if (name) {
          handlers.upsertBackgroundTask({
            id: installTaskId(installPackageKey(name)),
            kind: 'install',
            title: handlers.t('taskCenter.installTitle', { name }),
            status: 'completed',
            progress: 100,
            startedAt: Date.now(),
            finishedAt: Date.now(),
            items: [name],
          })
        }
        handlers.bumpActivityLog()
        const label = formatPackageOpLabel(String(data?.name ?? ''), data?.version)
        if (label) {
          handlers.showTaskDockNotice(handlers.t('appExt.installSuccess', { label }), 'success')
        }
        if (data?.suggestions?.length) {
          setInstallSuggestions(data.suggestions)
        }
        handlers.pulseStatAttention('installed')
        handlers.pumpInstallQueue()
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
      const failedTask: TaskCenterItem | null = name
        ? {
            id: installTaskId(installPackageKey(name)),
            kind: 'install',
            title: handlers.t('taskCenter.installTitle', { name }),
            status: 'failed',
            error: errText,
            startedAt: Date.now(),
            finishedAt: Date.now(),
            items: [name],
          }
        : null
      if (failedTask) handlers.upsertBackgroundTask(failedTask)
      const label = name
        ? handlers.t('progress.install.failedNamed', { name, error: errText })
        : `${handlers.t('progress.install.failed')}: ${errText}`
      const hashMismatch = parseHashMismatch(errText)
      if (hashMismatch && failedTask) {
        handlers.showTaskDockNotice(handlers.t('taskCenter.hashMismatchHint', { name }), 'error', {
          persistent: true,
          detail: errText,
          actionLabel: handlers.t('taskCenter.acceptHashRetry'),
          onAction: () => {
            handlers.dismissTaskDockNotice()
            void retryInstallTasksRef.current([failedTask], { acceptHash: true })
          },
        })
        setShowTaskCenterModal(true)
      } else {
        handlers.showTaskDockNotice(label, 'error', { persistent: true })
      }
      handlers.bumpActivityLog()
      handlers.pumpInstallQueue()
    })
    const cancelCancelled = EventsOn('install:cancelled', (data?: { name?: string }) => {
      const handlers = h()
      handlers.flushPendingInstallProgress()
      const name = data?.name ?? ''
      if (name) handlers.removeActiveInstall(name)
      if (name) {
        handlers.upsertBackgroundTask({
          id: installTaskId(installPackageKey(name)),
          kind: 'install',
          title: handlers.t('taskCenter.installTitle', { name }),
          status: 'failed',
          error: handlers.t('appExt.installCancelled'),
          startedAt: Date.now(),
          finishedAt: Date.now(),
          items: [name],
        })
      }
      handlers.bumpActivityLog()
      const label = name ? formatPackageOpLabel(name, '') || name : ''
      handlers.showTaskDockNotice(
        label ? handlers.t('appExt.installCancelledNamed', { name: label }) : handlers.t('appExt.installCancelled'),
        'info',
      )
      handlers.pumpInstallQueue()
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
    const cancelUninstallComplete = EventsOn('uninstall:complete', (_data?: { name?: string }) => {
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

  const openEnvironment = useCallback((runDoctor = false) => {
    setShowEnvironmentModal(true)
    if (runDoctor) {
      setDoctorChecks(makeInitialDoctorChecks(t('doctor.checking')))
      setDoctorOK(null)
      setDoctorLoading(true)
      void RunDoctor().catch((err) => {
        setDoctorLoading(false)
        setError(t('doctor.failed', { error: String(err) }))
      })
    }
  }, [t])

  const rerunDoctor = useCallback(() => {
    setDoctorChecks(makeInitialDoctorChecks(t('doctor.checking')))
    setDoctorOK(null)
    setDoctorLoading(true)
    void RunDoctor().catch((err) => {
      setDoctorLoading(false)
      setError(t('doctor.failed', { error: String(err) }))
    })
  }, [t])

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
      case 'task-center':
        setShowTaskCenterModal(true)
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
        openThemeEditor(
          themeId.startsWith('custom:')
            ? customThemes.find((t) => t.id === themeId) ?? null
            : null,
        )
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
      case 'environment':
      case 'doctor':
        openEnvironment(true)
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
  }, [loadInstalled, loadStats, handleDesktopUpdateCheck, setAutoMode, setPageSize, isPro, customThemes, themeId, selectTheme, openThemeEditor, dismissInfoMessage, showInfoMessage, bumpActivityLog, bucketCheckInProgress, bucketSyncInProgress, clearStatAttention, refreshTemplateStat, openEnvironment, t])

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
  const installTaskActiveCount = useMemo(
    () =>
      backgroundTasks.filter(
        (item) =>
          item.kind === 'install' &&
          (item.status === 'running' || item.status === 'queued'),
      ).length,
    [backgroundTasks],
  )
  const showInstallRunningHint =
    installDockHidden && !showTaskCenterModal && installTaskActiveCount > 0
  const isPackageInstalling = useCallback(
    (ref: string) => {
      if (isRefInstalling(ref, activeInstalls)) return true
      // installQueueVersion keeps this callback fresh when the queue changes.
      void installQueueVersion
      return installQueueRef.current.some((q) => installPackageKey(q.ref) === installPackageKey(ref))
    },
    [activeInstalls, installQueueVersion],
  )
  const operationBusy = gcRunning || !!currentUninstall

  const enqueueInstalls = useCallback(
    (
      refs: string[],
      options?: {
        force?: boolean
        downloadOverrides?: Record<string, { url: string; hash: string }>
      },
    ) => {
      if (gcRunning || currentUninstall) return
      const force = !!options?.force
      const downloadOverrides = options?.downloadOverrides || {}
      let added = 0
      for (const ref of refs) {
        const trimmed = ref.trim()
        if (!trimmed) continue
        if (isRefInstalling(trimmed, activeInstallsRef.current)) continue
        const key = installPackageKey(trimmed)
        const override = downloadOverrides[trimmed] || downloadOverrides[key]
        const existing = installQueueRef.current.find((q) => installPackageKey(q.ref) === key)
        if (existing) {
          if (force && !existing.force) existing.force = true
          if (override?.url) {
            existing.downloadURL = override.url
            existing.downloadHash = override.hash
          }
          continue
        }
        installQueueRef.current.push({
          ref: trimmed,
          force,
          downloadURL: override?.url,
          downloadHash: override?.hash,
        })
        added += 1
        upsertBackgroundTask({
          id: installTaskId(key),
          kind: 'install',
          title: t('taskCenter.installTitle', { name: trimmed }),
          status: 'queued',
          detail: force ? t('taskCenter.forceQueuedDetail') : t('taskCenter.queuedDetail'),
          startedAt: Date.now(),
          items: [trimmed],
        })
      }
      bumpInstallQueue()
      if (added > 0) {
        showInfoMessage(
          force
            ? t('taskCenter.batchForceQueued', { count: added, max: MAX_PARALLEL_INSTALLS })
            : t('taskCenter.batchQueued', { count: added, max: MAX_PARALLEL_INSTALLS }),
          { autoHideMs: 8000 },
        )
        setShowTaskCenterModal(true)
        // Defer pump so React can flush state; also clears any stale in-flight locks.
        queueMicrotask(() => pumpInstallQueue())
      }
    },
    [
      bumpInstallQueue,
      currentUninstall,
      gcRunning,
      pumpInstallQueue,
      showInfoMessage,
      t,
      upsertBackgroundTask,
    ],
  )
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
    const key = installPackageKey(name)
    if (
      installInFlightKeysRef.current.has(key) ||
      isRefInstalling(name, activeInstallsRef.current)
    ) {
      return
    }
    if (
      countOccupiedInstallSlots(installInFlightKeysRef.current, activeInstallsRef.current) >=
      MAX_PARALLEL_INSTALLS
    ) {
      return
    }
    // Reserve a parallel slot before Install() so recipe queue pump sees this job.
    installInFlightKeysRef.current.add(key)
    upsertBackgroundTask({
      id: installTaskId(key),
      kind: 'install',
      title: t('taskCenter.installTitle', { name }),
      status: 'running',
      progress: 0,
      detail: force ? t('taskCenter.forceDetail') : undefined,
      startedAt: Date.now(),
      items: [name],
    })
    const outcome = awaitOutcome ? waitForInstallOutcome(name) : null
    try {
      await Install(name, isPro, force, architecture, interactive)
      if (outcome) await outcome
    } catch (err) {
      console.error('Install failed:', err)
      installInFlightKeysRef.current.delete(key)
      removeActiveInstall(name)
      showTaskDockNotice(t('appExt.installFailed', { error: String(err) }), 'error', { persistent: true })
      pumpInstallQueue()
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
    if (currentUninstall) return
    if (isPackageInstalling(name)) return
    if (
      countOccupiedInstallSlots(installInFlightKeysRef.current, activeInstallsRef.current) >=
      MAX_PARALLEL_INSTALLS
    ) {
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

  const handleCancelInstall = useCallback(async (name: string) => {
    const key = installPackageKey(name)
    const activeKey =
      Object.keys(activeInstallsRef.current).find((n) => installPackageKey(n) === key) ??
      (activeInstallsRef.current[key] ? key : '')
    if (!activeKey) return
    if (installCancelling[activeKey] || installCancelling[key]) return
    setInstallCancelling((prev) => ({ ...prev, [activeKey]: true, [key]: true }))
    try {
      await CancelInstall(name)
    } catch (err) {
      console.error('CancelInstall failed:', err)
      setInstallCancelling((prev) => ({ ...prev, [activeKey]: false, [key]: false }))
      const errText = String(err)
      const message = errText.includes('no install in progress')
        ? t('appExt.cancelInstallNoTask')
        : t('appExt.cancelInstallFailed', { error: errText })
      showTaskDockNotice(message, 'error', { persistent: true })
    }
  }, [installCancelling, showTaskDockNotice, t])

  const handleCancelTask = useCallback(
    (task: TaskCenterItem) => {
      if (task.kind !== 'install') return
      const ref = task.items?.[0] || task.currentItem || ''
      if (!ref) return
      const key = installPackageKey(ref)

      if (task.status === 'queued') {
        installQueueRef.current = installQueueRef.current.filter(
          (q) => installPackageKey(q.ref) !== key,
        )
        bumpInstallQueue()
        installInFlightKeysRef.current.delete(key)
        upsertBackgroundTask({
          id: installTaskId(key),
          kind: 'install',
          title: task.title,
          status: 'failed',
          error: t('appExt.installCancelled'),
          startedAt: task.startedAt,
          finishedAt: Date.now(),
          items: task.items,
        })
        return
      }

      if (task.status === 'running') {
        const live = activeInstallsRef.current[key]
        void handleCancelInstall(live?.name || ref)
      }
    },
    [bumpInstallQueue, handleCancelInstall, t, upsertBackgroundTask],
  )

  const retryInstallTasks = useCallback(
    async (
      tasks: TaskCenterItem[],
      options?: { force?: boolean; acceptHash?: boolean },
    ) => {
      const force = !!options?.force || !!options?.acceptHash
      const refs: string[] = []
      const downloadOverrides: Record<string, { url: string; hash: string }> = {}
      for (const task of tasks) {
        if (task.kind !== 'install' || task.status !== 'failed') continue
        const ref = (task.items?.[0] || task.currentItem || '').trim()
        if (!ref) continue
        const key = installPackageKey(ref)

        // Always drop sticky config overrides before retry so bucket hashes win next time.
        try {
          await ClearManifestDownloadOverride(ref)
        } catch (err) {
          console.warn('ClearManifestDownloadOverride before retry:', err)
        }

        if (options?.acceptHash) {
          const mismatch = parseHashMismatch(task.error || '')
          if (!mismatch) {
            showTaskDockNotice(t('taskCenter.acceptHashUnavailable'), 'error', { persistent: true })
            continue
          }
          try {
            const plan = await PlanInstall(ref)
            const url = plan?.manifest?.downloadUrls?.[0]?.trim() || ''
            if (!url) {
              showTaskDockNotice(t('taskCenter.acceptHashNoUrl', { name: ref }), 'error', {
                persistent: true,
              })
              continue
            }
            const bucketDigest = normalizeHashDigest(plan?.manifest?.hashes?.[0] || '')
            // Only one-shot override when downloaded bytes still differ from the bucket.
            if (bucketDigest && bucketDigest === mismatch.got) {
              // File already matches bucket; plain force reinstall is enough.
            } else {
              downloadOverrides[ref] = {
                url,
                hash: formatOverrideHash(mismatch.algo, mismatch.got),
              }
            }
          } catch (err) {
            console.error('accept hash prepare failed:', err)
            showTaskDockNotice(
              t('taskCenter.acceptHashFailed', { error: String(err) }),
              'error',
              { persistent: true },
            )
            continue
          }
        }

        if (force) {
          try {
            await PurgeCachePackage(key)
          } catch (err) {
            // Best-effort: missing cache entry is fine.
            console.warn('PurgeCachePackage before force retry:', err)
          }
        }

        refs.push(ref)
      }
      if (refs.length === 0) return
      enqueueInstalls(refs, {
        force,
        downloadOverrides:
          Object.keys(downloadOverrides).length > 0 ? downloadOverrides : undefined,
      })
    },
    [enqueueInstalls, showTaskDockNotice, t],
  )
  retryInstallTasksRef.current = retryInstallTasks

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
    if (
      countOccupiedInstallSlots(installInFlightKeysRef.current, activeInstallsRef.current) >=
      MAX_PARALLEL_INSTALLS
    ) {
      return
    }
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

  const handleCleanReinstallRequest = (pkg: main.InstalledPackage) => {
    if (operationBusy) return
    if (currentUninstall) return
    if (isPackageInstalling(packageInstallRef(pkg.name, pkg.bucket))) return
    setPendingCleanReinstall(pkg)
  }

  const handleConfirmCleanReinstall = async () => {
    if (!pendingCleanReinstall || currentUninstall) return
    const pkg = pendingCleanReinstall
    const ref = packageInstallRef(pkg.name, pkg.bucket)
    setPendingCleanReinstall(null)
    setSelectedPackage(null)
    installInFlightKeysRef.current.add(installPackageKey(ref))
    const outcome = waitForInstallOutcome(ref)
    try {
      await CleanReinstall(ref, '')
      await outcome
      showTaskDockNotice(t('appExt.cleanReinstallSuccess', { name: pkg.name }), 'success')
    } catch (err) {
      console.error('CleanReinstall failed:', err)
      showTaskDockNotice(t('appExt.cleanReinstallFailed', { error: String(err) }), 'error', {
        persistent: true,
      })
    } finally {
      installInFlightKeysRef.current.delete(installPackageKey(ref))
      await refreshAfterPackageOp('install')
      bumpActivityLog()
    }
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
          title={t('stats.recipesHint')}
        >
          <span className={`stat-value ${statsPending ? 'stat-value-pending' : ''}`}>
            {formatStatCount(stats.templateCount)}
          </span>
          <span className="stat-label">{t('stats.recipes')}</span>
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

      <main
        className={`content ${
          activeTab === 'activity' ||
          activeTab === 'browse' ||
          activeTab === 'installed' ||
          activeTab === 'updates' ||
          activeTab === 'buckets' ||
          activeTab === 'storage'
            ? 'list-full'
            : ''
        }`}
      >
        <div className={activeTab === 'buckets' ? 'tab-panel' : 'tab-panel tab-panel-hidden'} aria-hidden={activeTab !== 'buckets'}>
          <BucketPanel
            refreshKey={bucketRefreshKey}
            openAdd={bucketOpenAdd}
            onOpenAddConsumed={() => setBucketOpenAdd(false)}
            onBucketsChanged={bumpBuckets}
            pageSize={pageSize}
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
            onInstallParallel={(refs, options) => enqueueInstalls(refs, options)}
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
            onCleanReinstall={handleCleanReinstallRequest}
            onError={setError}
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
            onCleanReinstall={handleCleanReinstallRequest}
            onError={setError}
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
            listScrollRef={listScrollRef}
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
        {hasActiveInstalls && !installDockHidden && (
          <div className="install-progress-stack">
            <div className="install-progress-stack-toolbar">
              <span className="install-progress-stack-title">
                {t('appExt.installDockTitle', { count: Object.keys(activeInstalls).length })}
              </span>
              <button
                type="button"
                className="ghost progress-cancel-btn install-dock-dismiss-btn"
                aria-label={t('appExt.dismissInstallDockAria')}
                title={t('appExt.dismissInstallDockAria')}
                onClick={() => {
                  setInstallDockHidden(true)
                  setShowTaskCenterModal(true)
                }}
              >
                {t('app.close')}
              </button>
            </div>
            {Object.entries(activeInstalls).map(([key, progress]) => {
              const displayName = progress.name?.trim() || key
              const isDownloading = isActivelyDownloading(progress)
              const { barPct, indeterminate, showPercent } = operationProgressDisplay(progress)
              const showBytes = isDownloading && (progress.bytesDown > 0 || progress.bytesTotal > 0)
              const cancelling = !!installCancelling[key]
              const transfer = isDownloading
                ? sampleDownloadTransferStats(installTaskId(key), progress)
                : null
              return (
                <div key={key} className="card install-progress">
                  <div className="card-header">
                    <span>{displayName}</span>
                    <div className="install-progress-header-actions">
                      <button
                        type="button"
                        className="ghost progress-cancel-btn"
                        disabled={cancelling}
                        aria-label={t('appExt.cancelInstallAria')}
                        onClick={() => void handleCancelInstall(displayName)}
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
                      <span className="progress-info-speed">
                        {transfer ? (
                          <>
                            {t('taskCenter.downloadSpeed', {
                              speed: formatTransferSpeed(transfer.bytesPerSec),
                            })}
                            <span aria-hidden="true"> · </span>
                            {t('taskCenter.etaRemaining', {
                              time: formatEtaDuration(transfer.etaSeconds),
                            })}
                          </>
                        ) : (
                          formatProgressMessage(progress) || null
                        )}
                      </span>
                      {showPercent ? (
                        <span className="progress-info-pct">{barPct.toFixed(0)}%</span>
                      ) : null}
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
              {taskDockNotice.actionLabel && taskDockNotice.onAction ? (
                <button
                  type="button"
                  className="secondary task-dock-notice-action"
                  onClick={() => taskDockNotice.onAction?.()}
                >
                  {taskDockNotice.actionLabel}
                </button>
              ) : null}
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

      {pendingCleanReinstall && (
        <ModalOverlay onClose={() => setPendingCleanReinstall(null)}>
          <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>{t('appExt.cleanReinstallDialog.title')}</h2>
              <ModalCloseButton onClick={() => setPendingCleanReinstall(null)} ariaLabel={t('app.cancel')} />
            </div>
            <div className="modal-body">
              <p>
                <Trans
                  i18nKey="appExt.cleanReinstallDialog.confirm"
                  values={{ name: pendingCleanReinstall.name }}
                  components={{ strong: <strong /> }}
                />
              </p>
              <p className="confirm-dialog-summary">
                <strong>{pendingCleanReinstall.name}</strong>
                {' · '}
                {pendingCleanReinstall.version}
                {pendingCleanReinstall.bucket ? ` · ${pendingCleanReinstall.bucket}` : ''}
              </p>
              <p className="confirm-dialog-summary installed-version-uninstall-note">
                {t('appExt.cleanReinstallDialog.note')}
              </p>
            </div>
            <div className="confirm-dialog-footer">
              <button type="button" className="secondary" onClick={() => setPendingCleanReinstall(null)}>
                {t('app.cancel')}
              </button>
              <button type="button" className="primary danger" onClick={() => void handleConfirmCleanReinstall()}>
                {t('appExt.cleanReinstallDialog.confirmButton')}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      <footer className="footer">
        {showInstallRunningHint ? (
          <button
            type="button"
            className="footer-left footer-left-action"
            aria-live="polite"
            onClick={() => setShowTaskCenterModal(true)}
          >
            {t('footer.installsRunning', { count: installTaskActiveCount })}
          </button>
        ) : (
          <span
            className={`footer-left ${footerLeftDisplay ? 'footer-left-busy' : ''}`}
            aria-live="polite"
          >
            {footerLeftDisplay}
          </span>
        )}
        <span className="footer-center">
          <button
            type="button"
            className="text-link footer-app-name"
            title={t('footer.siteTitle')}
            onClick={(e) => openExternalUrl(GLUESTICK_HOME_URL, e)}
          >
            {t('app.title')}
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
          directInstall={/\.exe(\?|#|$)/i.test(desktopUpdateInfo.downloadURL || '')}
          onDownload={() => {
            const installer = desktopUpdateInfo.downloadURL || ''
            if (/\.exe(\?|#|$)/i.test(installer)) {
              void DownloadAndRunDesktopUpdate(installer)
              return
            }
            const url = desktopUpdateInfo.downloadURL || desktopUpdateInfo.releaseURL
            if (url) {
              void OpenDesktopUpdateURL(url)
            }
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

      {showEnvironmentModal && (
        <EnvironmentDialog
          onClose={() => setShowEnvironmentModal(false)}
          doctorChecks={doctorChecks}
          doctorOK={doctorOK}
          doctorLoading={doctorLoading}
          onRunDoctor={rerunDoctor}
        />
      )}

      {showThemePicker && (
        <ThemePicker
          themeId={themeId}
          customThemes={customThemes}
          onSelect={(id) => {
            selectTheme(id)
            setShowThemePicker(false)
          }}
          onEditCustom={(theme) => openThemeEditor(theme)}
          onDeleteCustom={handleDeleteCustomTheme}
          onCreateCustom={() => openThemeEditor(null)}
          onClose={() => setShowThemePicker(false)}
        />
      )}

      {showThemeEditor && (
        <ThemeEditor
          initialTheme={editingTheme}
          customThemeCount={customThemes.length}
          copyFromTokens={resolveTheme(themeId, customThemes)?.tokens}
          onSave={handleSaveCustomTheme}
          onApply={handleThemeEditorPreview}
          onDelete={editingTheme ? handleDeleteCustomTheme : undefined}
          onClose={() => {
            setShowThemeEditor(false)
            setEditingTheme(null)
            applyThemeById(themeId)
          }}
        />
      )}

      {showTaskCenterModal && (
        <TaskCenterDialog
          tasks={backgroundTasks.filter((item) => item.kind === 'install')}
          liveInstallProgress={Object.fromEntries(
            Object.entries(activeInstalls).map(([key, progress]) => [
              installTaskId(key),
              progress,
            ]),
          )}
          cancellingTaskIds={Object.fromEntries(
            Object.entries(installCancelling)
              .filter(([, cancelling]) => cancelling)
              .map(([key]) => [installTaskId(key), true]),
          )}
          onCancelTask={handleCancelTask}
          onRetryTask={(task, options) => void retryInstallTasks([task], options)}
          onRetryFailed={(options) =>
            void retryInstallTasks(
              backgroundTasks.filter((item) => item.status === 'failed' && item.kind === 'install'),
              options,
            )
          }
          onClose={() => setShowTaskCenterModal(false)}
          canShowOnMainWindow={installDockHidden && hasActiveInstalls}
          onShowOnMainWindow={() => {
            setInstallDockHidden(false)
            setShowTaskCenterModal(false)
          }}
          onClearFinished={() => {
            setBackgroundTasks((prev) => {
              const next = prev.filter(
                (item) =>
                  item.kind !== 'install' ||
                  item.status === 'running' ||
                  item.status === 'queued',
              )
              persistTaskCenterHistory(next, true)
              return next
            })
          }}
        />
      )}

      {showProModal && (
        <ModalOverlay onClose={() => setShowProModal(false)}>
          <div className="modal modal-pro" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>{t('pro.title')}</h2>
              <ModalCloseButton onClick={() => setShowProModal(false)} ariaLabel={t('app.close')} />
            </div>
            <div className="modal-body">
              <p className="modal-intro">{t('pro.intro')}</p>
              <div className="pro-features">
                <button
                  type="button"
                  className="pro-feature pro-feature-action is-pro-locked"
                  onClick={() => setShowProModal(false)}
                  aria-disabled="true"
                  title={t('pro.locked')}
                >
                  <div className="pro-feature-icon" aria-hidden="true">📊</div>
                  <div className="pro-feature-content">
                    <h4>
                      {t('pro.feature.envHealth.title')}
                      <span className="pro-inline-badge">{t('pro.badge')}</span>
                    </h4>
                    <p>{t('pro.feature.envHealth.desc')}</p>
                  </div>
                </button>
                <button
                  type="button"
                  className="pro-feature pro-feature-action is-pro-locked"
                  onClick={() => setShowProModal(false)}
                  aria-disabled="true"
                  title={t('pro.locked')}
                >
                  <div className="pro-feature-icon" aria-hidden="true">💾</div>
                  <div className="pro-feature-content">
                    <h4>
                      {t('pro.feature.snapshot.title')}
                      <span className="pro-inline-badge">{t('pro.badge')}</span>
                    </h4>
                    <p>{t('pro.feature.snapshot.desc')}</p>
                  </div>
                </button>
                <button
                  type="button"
                  className="pro-feature pro-feature-action is-pro-locked"
                  onClick={() => setShowProModal(false)}
                  aria-disabled="true"
                  title={t('pro.locked')}
                >
                  <div className="pro-feature-icon" aria-hidden="true">🔄</div>
                  <div className="pro-feature-content">
                    <h4>
                      {t('pro.feature.deviceSync.title')}
                      <span className="pro-inline-badge">{t('pro.badge')}</span>
                    </h4>
                    <p>{t('pro.feature.deviceSync.desc')}</p>
                  </div>
                </button>
                <button
                  type="button"
                  className="pro-feature pro-feature-action is-teams-locked"
                  onClick={() => setShowProModal(false)}
                  aria-disabled="true"
                  title={t('teams.lockedHint')}
                >
                  <div className="pro-feature-icon" aria-hidden="true">🛡️</div>
                  <div className="pro-feature-content">
                    <h4>
                      {t('teams.feature.complianceAudit.title')}
                      <span className="teams-inline-badge">{t('teams.badge')}</span>
                    </h4>
                    <p>{t('teams.feature.complianceAudit.desc')}</p>
                  </div>
                </button>
                <button
                  type="button"
                  className="pro-feature pro-feature-action is-teams-locked"
                  onClick={() => setShowProModal(false)}
                  aria-disabled="true"
                  title={t('teams.lockedHint')}
                >
                  <div className="pro-feature-icon" aria-hidden="true">🧰</div>
                  <div className="pro-feature-content">
                    <h4>
                      {t('teams.feature.customConfig.title')}
                      <span className="teams-inline-badge">{t('teams.badge')}</span>
                    </h4>
                    <p>{t('teams.feature.customConfig.desc')}</p>
                  </div>
                </button>
                <button
                  type="button"
                  className="pro-feature pro-feature-action is-teams-locked"
                  onClick={() => setShowProModal(false)}
                  aria-disabled="true"
                  title={t('teams.lockedHint')}
                >
                  <div className="pro-feature-icon" aria-hidden="true">👥</div>
                  <div className="pro-feature-content">
                    <h4>
                      {t('teams.feature.orgBaseline.title')}
                      <span className="teams-inline-badge">{t('teams.badge')}</span>
                    </h4>
                    <p>{t('teams.feature.orgBaseline.desc')}</p>
                  </div>
                </button>
              </div>
              <div className="modal-footer">
                <button type="button" className="primary" onClick={() => setShowProModal(false)}>
                  {t('app.close')}
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
