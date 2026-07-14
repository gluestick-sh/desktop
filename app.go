package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gluestick-sh/core/config"
	"github.com/gluestick-sh/core/engine"
	"github.com/gluestick-sh/core/verbose"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// These may be overridden at link time via:
// -ldflags "-X gluestick.sh/desktop.Version=..." etc.
var (
	Version = "0.1.4"
	Commit  = "none"
	Date    = "unknown"
)

const slowStatsCacheTTL = 10 * time.Minute

type slowStatsCache struct {
	at                 time.Time
	bucketUpdatesCount int
}

// StatsQuery parameters for GetStats.
type StatsQuery struct {
	ForceRefresh   bool `json:"forceRefresh"`
	HideDeprecated bool `json:"hideDeprecated"`
}

// App is the main Glue Desktop application struct.
type App struct {
	ctx                      context.Context
	engine                   *engine.Engine
	initErr                  error
	mu                       sync.Mutex
	slowStats                slowStatsCache
	slowStatsMu              sync.Mutex
	bucketUpdates            bucketUpdatesCache
	bucketUpdatesMu          sync.Mutex
	bucketUpdateCheckRunning bool
	bucketUpdateCheckMu      sync.Mutex
	bucketTasks              map[string]struct{}
	bucketTasksMu            sync.Mutex
	cacheTasks               map[string]struct{}
	cacheTasksMu             sync.Mutex
	doctorBusy               bool
	doctorMu                 sync.Mutex
	bootstrapTasks           map[string]struct{}
	bootstrapTasksMu         sync.Mutex
	bootstrapSeqMu           sync.Mutex
	bootstrapSeqRunning      bool
	installTasks             map[string]context.CancelFunc
	installMu                sync.Mutex
	uninstallActive          bool
	uninstallName            string
	uninstallMu              sync.Mutex
	packageIconCache         sync.Map
	bucketCheckScheduleCh    chan struct{}
}

// NewApp creates a new application instance.
func NewApp() *App {
	return &App{
		bucketCheckScheduleCh: make(chan struct{}, 1),
	}
}

func (a *App) requireEngine() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.engine != nil {
		return nil
	}
	if a.initErr != nil {
		return a.initErr
	}
	return fmt.Errorf("engine not initialized")
}

// IsEngineReady reports whether the engine is initialized (for the frontend).
func (a *App) IsEngineReady() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.engine != nil
}

func logPostOpDuration(ctx context.Context, label string, start time.Time) {
	runtime.LogInfo(ctx, fmt.Sprintf("[post-op] %s: %dms", label, time.Since(start).Milliseconds()))
}

func (a *App) invalidateSlowStatsCache() {
	a.slowStatsMu.Lock()
	a.slowStats = slowStatsCache{}
	a.slowStatsMu.Unlock()
}

func (a *App) bucketCountOnly() int {
	registry, err := a.openBucketRegistry()
	if err != nil {
		return 0
	}
	return len(registry.List())
}

func (a *App) loadSlowStats(forceRefresh bool) (bucketUpdatesCount int, fromCache bool) {
	a.slowStatsMu.Lock()
	if !forceRefresh && !a.slowStats.at.IsZero() && time.Since(a.slowStats.at) < slowStatsCacheTTL {
		u := a.slowStats.bucketUpdatesCount
		a.slowStatsMu.Unlock()
		return u, true
	}
	a.slowStatsMu.Unlock()

	bucketUpdatesCount = 0
	if _, u, err := a.bucketStats(); err == nil {
		bucketUpdatesCount = u
	}

	a.slowStatsMu.Lock()
	a.slowStats = slowStatsCache{
		at:                 time.Now(),
		bucketUpdatesCount: bucketUpdatesCount,
	}
	a.slowStatsMu.Unlock()
	return bucketUpdatesCount, false
}

// startup runs on application launch (returns quickly; engine initializes in a background goroutine).
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	go a.initEngineAsync()
}

func (a *App) initEngineAsync() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		a.failEngineInit(fmt.Errorf("get home directory: %w", err))
		return
	}
	rootDir := filepath.Join(homeDir, ".glue")
	runtime.LogInfo(a.ctx, fmt.Sprintf("Glue root directory: %s", rootDir))

	if err := ensureGlueShim(rootDir); err != nil {
		runtime.LogWarning(a.ctx, fmt.Sprintf("shim seed: %v (install shims may be degraded until shim.exe is bundled)", err))
	} else {
		runtime.LogInfo(a.ctx, "Glue shim runner ready at "+filepath.Join(rootDir, "shim.exe"))
	}

	verboseFromConfig, _ := config.ReadConfigVerbose(rootDir)
	verbose.Set(verboseFromConfig)
	config := &engine.EngineConfig{
		RootDir:  rootDir,
		Workers:  downloadWorkersFromConfig(rootDir),
		Parallel: true,
		Verbose:  verboseFromConfig,
	}
	eng, err := engine.NewEngine(config)
	if err != nil {
		a.failEngineInit(fmt.Errorf("initialize engine: %w", err))
		return
	}

	a.mu.Lock()
	a.engine = eng
	a.mu.Unlock()

	runtime.LogInfo(a.ctx, "Glue engine initialized successfully")
	runtime.EventsEmit(a.ctx, "engine-ready")

	go a.runStartupBootstrapTasks()
	go a.waitSearchIndexReady(eng)
	go a.runBucketCheckScheduler()
}

func (a *App) waitSearchIndexReady(eng *engine.Engine) {
	for !eng.SearchIndexReady() {
		time.Sleep(50 * time.Millisecond)
	}
	runtime.LogInfo(a.ctx, "Search index ready")
	runtime.EventsEmit(a.ctx, "search-index-ready")
}

// IsSearchIndexReady reports whether the bucket manifest search index is built (for the frontend).
func (a *App) IsSearchIndexReady() bool {
	a.mu.Lock()
	eng := a.engine
	a.mu.Unlock()
	if eng == nil {
		return false
	}
	return eng.SearchIndexReady()
}

func (a *App) failEngineInit(err error) {
	a.mu.Lock()
	a.initErr = err
	a.mu.Unlock()
	runtime.LogError(a.ctx, fmt.Sprintf("Engine unavailable: %v", err))
	runtime.EventsEmit(a.ctx, "engine-error", err.Error())
}

// shutdown runs on application exit.
func (a *App) shutdown(ctx context.Context) {
	a.mu.Lock()
	eng := a.engine
	a.mu.Unlock()
	if eng != nil {
		eng.Close()
	}
}

// OpenGlueDataDir opens the ~/.glue root directory (frontend menu action).
func (a *App) OpenGlueDataDir() {
	a.openGlueDataDir()
}

// AboutInfo holds About dialog fields exposed to the frontend.
type AboutInfo struct {
	Version string `json:"version"`
	DataDir string `json:"dataDir"`
}

// GetAboutInfo returns data for the About dialog.
func (a *App) GetAboutInfo() AboutInfo {
	return AboutInfo{
		Version: Version,
		DataDir: a.glueRootDir(),
	}
}

const docsURL = "https://github.com/gluestick-sh/gluestick-sh"

// OpenDocs opens project documentation in the default browser.
func (a *App) OpenDocs() {
	if a.ctx != nil {
		runtime.BrowserOpenURL(a.ctx, docsURL)
	}
}

// PackageInfo is package metadata exposed to the frontend.
type PackageInfo struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
	Bucket      string `json:"bucket"`
	Homepage    string `json:"homepage"`
	License     string `json:"license"`
}

// InstalledPackage is an installed package record exposed to the frontend.
type InstalledPackage struct {
	Name            string `json:"name"`
	Version         string `json:"version"`
	LatestVersion   string `json:"latestVersion,omitempty"`
	UpdateAvailable bool   `json:"updateAvailable"`
	InstalledAt     string `json:"installedAt"`
	Bucket          string `json:"bucket"`
	Description     string `json:"description"`
	Homepage        string `json:"homepage"`
	// InstallSize is deduplicated cache store object size for installed files (matches hardlinked install dir).
	InstallSize int64 `json:"installSize"`
	// VersionLocked skips update checks when true.
	VersionLocked bool `json:"versionLocked"`
}

// InstallProgress is install progress exposed to the frontend.
type InstallProgress struct {
	Name        string                 `json:"name"`
	Phase       string                 `json:"phase"`
	Status      string                 `json:"status"`
	Percentage  float64                `json:"percentage"`
	Message     string                 `json:"message"`
	MessageKey  string                 `json:"messageKey,omitempty"`
	MessageArgs map[string]interface{} `json:"messageArgs,omitempty"`
	BytesDown   int64                  `json:"bytesDown"`
	BytesTotal  int64                  `json:"bytesTotal"`
}

// SearchResult is a package search result exposed to the frontend.
type SearchResult struct {
	Packages []PackageInfo `json:"packages"`
	Total    int           `json:"total"`
}

// Search finds packages in configured buckets.
func (a *App) Search(query string) (*SearchResult, error) {
	if err := a.requireEngine(); err != nil {
		return nil, err
	}

	results, err := a.engine.Search(a.ctx, &engine.SearchRequest{
		Query: query,
		Limit: 0,
	}, nil)
	if err != nil {
		return nil, err
	}

	packages := make([]PackageInfo, 0, len(results))
	for _, pkg := range results {
		desc := pkg.Description
		homepage := pkg.Homepage
		if pkg.Manifest != nil {
			if desc == "" {
				desc = pkg.Manifest.Description
			}
			if homepage == "" {
				homepage = pkg.Manifest.Homepage
			}
		}
		packages = append(packages, PackageInfo{
			Name:        pkg.Name,
			Version:     pkg.Version,
			Description: desc,
			Bucket:      pkg.Bucket,
			Homepage:    homepage,
		})
	}

	return &SearchResult{
		Packages: packages,
		Total:    len(packages),
	}, nil
}

func (a *App) listInstalledFromEngine(checkUpdates bool) ([]InstalledPackage, error) {
	if err := a.requireEngine(); err != nil {
		runtime.LogError(a.ctx, fmt.Sprintf("ListInstalled: %v", err))
		return nil, err
	}

	listStart := time.Now()
	results, err := a.engine.List(a.ctx, &engine.ListRequest{Details: true}, nil)
	if err != nil {
		runtime.LogError(a.ctx, fmt.Sprintf("ListInstalled: engine.List error: %v", err))
		return nil, err
	}
	logPostOpDuration(a.ctx, fmt.Sprintf("listInstalledFromEngine engine.List (%d pkgs, checkUpdates=%v)", len(results), checkUpdates), listStart)

	updateMap := make(map[string]engine.PackageUpdate)
	if checkUpdates {
		updatesStart := time.Now()
		if updates, err := a.engine.CheckPackageUpdates(); err == nil {
			for _, u := range updates {
				updateMap[u.Name] = u
			}
		}
		logPostOpDuration(a.ctx, "listInstalledFromEngine CheckPackageUpdates", updatesStart)
	}

	buildStart := time.Now()
	packages := make([]InstalledPackage, 0, len(results))
	for _, pkg := range results {
		runtime.LogInfo(a.ctx, fmt.Sprintf("ListInstalled: package %s@%s", pkg.Name, pkg.Version))
		installedAt := pkg.InstalledAt
		if installedAt == "" {
			installedAt = time.Now().Format(time.RFC3339)
		}
		item := InstalledPackage{
			Name:        pkg.Name,
			Version:     pkg.Version,
			InstalledAt: installedAt,
			Bucket:      pkg.Bucket,
			Description: pkg.Description,
			Homepage:    pkg.Homepage,
			InstallSize: pkg.InstalledSize,
		}
		if a.engine.IsPackageVersionLocked(pkg.Name) {
			item.VersionLocked = true
		}
		if u, ok := updateMap[pkg.Name]; ok && !item.VersionLocked {
			if engine.UpdateAvailable(item.Version, u.LatestVersion) {
				item.LatestVersion = u.LatestVersion
				item.UpdateAvailable = true
			}
		}
		packages = append(packages, item)
	}
	logPostOpDuration(a.ctx, "listInstalledFromEngine build DTOs", buildStart)

	return packages, nil
}

// ListInstalled lists installed packages with per-package update checks.
func (a *App) ListInstalled() ([]InstalledPackage, error) {
	totalStart := time.Now()
	packages, err := a.listInstalledFromEngine(true)
	logPostOpDuration(a.ctx, "ListInstalled total", totalStart)
	return packages, err
}

// ListInstalledQuick lists installed packages without per-package manifest update checks (fast refresh after install/uninstall).
func (a *App) ListInstalledQuick() ([]InstalledPackage, error) {
	totalStart := time.Now()
	packages, err := a.listInstalledFromEngine(false)
	logPostOpDuration(a.ctx, "ListInstalledQuick total", totalStart)
	return packages, err
}

// Install starts a background install (returns immediately; progress via install:* events). force matches CLI --force.
func (a *App) Install(name string, _ bool, force bool, architecture string, interactive bool) error {
	if err := a.requireEngine(); err != nil {
		return err
	}

	if _, pinVersion := engine.ParsePkgRef(name); pinVersion != "" {
		return fmt.Errorf("installing a pinned version (name@version) requires Gluestick Desktop Pro; use glue install %s from CLI", name)
	}

	key := installTaskKey(name)
	if err := a.tryStartInstall(key); err != nil {
		return err
	}

	go a.runInstallTask(key, name, force, architecture, interactive)
	return nil
}

// CancelInstall cancels an in-progress install (name empty cancels all active installs).
func (a *App) CancelInstall(name string) error {
	a.installMu.Lock()
	defer a.installMu.Unlock()
	if len(a.installTasks) == 0 {
		return fmt.Errorf("no install in progress")
	}
	if strings.TrimSpace(name) == "" {
		for _, cancel := range a.installTasks {
			cancel()
		}
		return nil
	}
	key := installTaskKey(name)
	cancel, ok := a.installTasks[key]
	if !ok {
		return fmt.Errorf("no install in progress for %q", name)
	}
	cancel()
	return nil
}

// ActiveInstallCount returns the number of packages currently installing.
func (a *App) ActiveInstallCount() int {
	a.installMu.Lock()
	defer a.installMu.Unlock()
	return len(a.installTasks)
}

// Uninstall starts a background uninstall (returns immediately; progress via uninstall:* events).
func (a *App) Uninstall(name string) error {
	if err := a.requireEngine(); err != nil {
		return err
	}

	if !a.tryStartUninstall(name) {
		return fmt.Errorf("an uninstall task is already in progress")
	}

	go a.runUninstallTask(name)
	return nil
}

// GetStats returns dashboard statistics. forceRefresh recomputes slow paths (git checks, available package scan).
func (a *App) GetStats(q StatsQuery) (map[string]interface{}, error) {
	if err := a.requireEngine(); err != nil {
		return nil, err
	}
	totalStart := time.Now()

	fastStart := time.Now()
	installedCount := a.engine.InstalledPackageCount()
	totalSize := a.engine.TotalInstalledSize()
	bucketCount := a.bucketCountOnly()
	logPostOpDuration(a.ctx, "Fast stats elapsed", fastStart)

	updatesStart := time.Now()
	updates, err := a.engine.CheckPackageUpdates()
	if err != nil {
		return nil, err
	}
	logPostOpDuration(a.ctx, "Check package updates elapsed", updatesStart)

	activityStart := time.Now()
	activityLogCount, err := a.engine.CountActivityLog("")
	if err != nil {
		return nil, err
	}
	logPostOpDuration(a.ctx, "Count activity log rows elapsed", activityStart)

	slowStart := time.Now()
	bucketUpdatesCount, fromCache := a.loadSlowStats(q.ForceRefresh)
	availablePackagesCount := 0
	if a.engine != nil {
		availablePackagesCount = a.engine.CountAvailablePackages(q.HideDeprecated)
	}
	logPostOpDuration(a.ctx, fmt.Sprintf("Slow stats elapsed (cached=%v)", fromCache), slowStart)
	logPostOpDuration(a.ctx, "Total stats elapsed", totalStart)

	return map[string]interface{}{
		"bucketCount":            bucketCount,
		"bucketUpdatesCount":     bucketUpdatesCount,
		"installedCount":         installedCount,
		"updatesCount":           len(updates),
		"availablePackagesCount": availablePackagesCount,
		"totalSize":              totalSize,
		"activityLogCount":       activityLogCount,
		"slowStatsCached":        fromCache,
	}, nil
}

// ActivityLogEntry is a single activity log row exposed to the frontend.
type ActivityLogEntry struct {
	ID          int64                  `json:"id"`
	Time        string                 `json:"time"`
	Operation   string                 `json:"operation"`
	PackageName string                 `json:"packageName"`
	Version     string                 `json:"version,omitempty"`
	Status      string                 `json:"status"`
	Details     map[string]interface{} `json:"details,omitempty"`
	ErrorDetail string                 `json:"errorDetail,omitempty"`
	// Deprecated: use Operation.
	Action string `json:"action,omitempty"`
	// Deprecated: use PackageName.
	Name string `json:"name,omitempty"`
}

// ActivityLogQuery holds activity log query parameters.
type ActivityLogQuery struct {
	TimeRange string `json:"timeRange"` // all, today, week, month
	Page      int    `json:"page"`
	PageSize  int    `json:"pageSize"`
}

// ActivityLogPage is a paginated activity log result.
type ActivityLogPage struct {
	Items    []ActivityLogEntry `json:"items"`
	Total    int                `json:"total"`
	Page     int                `json:"page"`
	PageSize int                `json:"pageSize"`
}

func activityLogSince(timeRange string) string {
	now := time.Now()
	loc := now.Location()
	var start time.Time
	switch timeRange {
	case "today":
		start = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	case "week":
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		start = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, -(weekday - 1))
	case "month":
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	default:
		return ""
	}
	return start.Format(time.RFC3339)
}

func mapActivityRecord(h map[string]interface{}) ActivityLogEntry {
	op, _ := h["operation"].(string)
	st, _ := h["status"].(string)
	ts, _ := h["timestamp"].(string)
	pkgName, _ := h["package_name"].(string)
	version, _ := h["version"].(string)
	details, _ := h["details"].(map[string]interface{})

	var id int64
	switch v := h["id"].(type) {
	case int64:
		id = v
	case float64:
		id = int64(v)
	case int:
		id = int64(v)
	}

	var errorDetail string
	if details != nil {
		if errMsg, ok := details["error"].(string); ok {
			errorDetail = errMsg
		}
	}

	return ActivityLogEntry{
		ID:          id,
		Time:        ts,
		Operation:   op,
		PackageName: pkgName,
		Version:     version,
		Status:      st,
		Details:     details,
		ErrorDetail: errorDetail,
	}
}

func (a *App) emitActivityLogUpdated() {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "activity:log-updated", map[string]interface{}{})
}

// GetActivityLogPage returns a paginated activity log, optionally filtered by time range.
func (a *App) GetActivityLogPage(query ActivityLogQuery) (*ActivityLogPage, error) {
	if err := a.requireEngine(); err != nil {
		return nil, err
	}

	page := query.Page
	if page < 1 {
		page = 1
	}
	pageSize := query.PageSize
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	since := activityLogSince(query.TimeRange)
	total, err := a.engine.CountActivityLog(since)
	if err != nil {
		return nil, err
	}

	offset := (page - 1) * pageSize
	history, err := a.engine.QueryActivityLog(since, pageSize, offset)
	if err != nil {
		return nil, err
	}

	items := make([]ActivityLogEntry, 0, len(history))
	for _, h := range history {
		items = append(items, mapActivityRecord(h))
	}

	return &ActivityLogPage{
		Items:    items,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// ClearActivityLog removes all activity log entries (Pro-only).
func (a *App) ClearActivityLog() error {
	return a.requireProActive()
}

// ClearActivityLogByTimeRange deletes activity log entries in a time range (Pro-only).
func (a *App) ClearActivityLogByTimeRange(timeRange string) (int, error) {
	if err := a.requireProActive(); err != nil {
		return 0, err
	}
	return 0, fmt.Errorf("requires Gluestick Desktop Pro")
}

// RecordCheckUpdatesResult writes a check-updates result to the activity log.
func (a *App) RecordCheckUpdatesResult(updatesCount int, summary string) error {
	if err := a.requireEngine(); err != nil {
		return err
	}
	return a.engine.RecordCheckUpdatesActivity(updatesCount, summary)
}

// DeleteActivityLog deletes one activity log entry by ID.
func (a *App) DeleteActivityLog(id int64) error {
	if err := a.requireEngine(); err != nil {
		return err
	}
	if id <= 0 {
		return fmt.Errorf("invalid activity log id")
	}
	return a.engine.DeleteActivityLogByID(id)
}
