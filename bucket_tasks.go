package main

import (
	"fmt"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/gluestick-sh/core/bucket"
	"github.com/gluestick-sh/core/message"
)

func makeBucketTaskKey(kind, name string) string {
	return kind + ":" + name
}

func (a *App) startBucketTask(kind, name string) bool {
	a.bucketTasksMu.Lock()
	defer a.bucketTasksMu.Unlock()
	key := makeBucketTaskKey(kind, name)
	if a.bucketTasks == nil {
		a.bucketTasks = make(map[string]struct{})
	}
	if _, ok := a.bucketTasks[key]; ok {
		return false
	}
	a.bucketTasks[key] = struct{}{}
	return true
}

func (a *App) finishBucketTask(kind, name string) {
	a.bucketTasksMu.Lock()
	delete(a.bucketTasks, makeBucketTaskKey(kind, name))
	a.bucketTasksMu.Unlock()
	if kind == "update" {
		a.wakeBucketCheckScheduler()
	}
}

// hasBucketUpdateTaskRunning reports whether a bucket sync (update) task is in progress.
func (a *App) hasBucketUpdateTaskRunning() bool {
	a.bucketTasksMu.Lock()
	defer a.bucketTasksMu.Unlock()
	if a.bucketTasks == nil {
		return false
	}
	for key := range a.bucketTasks {
		if strings.HasPrefix(key, "update:") {
			return true
		}
	}
	return false
}

func (a *App) emitBucketTaskStart(kind, name string) {
	runtime.EventsEmit(a.ctx, "bucket:task:start", map[string]interface{}{
		"kind": kind,
		"name": name,
	})
}

func (a *App) emitBucketTaskProgress(kind, name, phase, messageKey, messageFallback string, messageArgs map[string]interface{}, percent float64) {
	msg := messageFallback
	if messageKey != "" {
		msg = message.FormatEN(messageKey, messageArgs)
	}
	if messageArgs == nil {
		messageArgs = map[string]interface{}{}
	}
	payload := map[string]interface{}{
		"kind":       kind,
		"name":       name,
		"phase":      phase,
		"message":    msg,
		"percentage": percent,
	}
	if messageKey != "" {
		payload["messageKey"] = messageKey
		payload["messageArgs"] = messageArgs
	}
	runtime.EventsEmit(a.ctx, "bucket:task:progress", payload)
}

func (a *App) emitBucketTaskComplete(kind, name string, syncedNames ...[]string) {
	payload := map[string]interface{}{
		"kind": kind,
		"name": name,
	}
	if len(syncedNames) > 0 && len(syncedNames[0]) > 0 {
		payload["syncedNames"] = syncedNames[0]
	}
	runtime.EventsEmit(a.ctx, "bucket:task:complete", payload)
}

func (a *App) emitBucketTaskError(kind, name, errMsg string) {
	runtime.EventsEmit(a.ctx, "bucket:task:error", map[string]interface{}{
		"kind":  kind,
		"name":  name,
		"error": errMsg,
	})
}

func (a *App) newBucketRegistryForTask() (*bucket.Registry, error) {
	if err := a.requireEngine(); err != nil {
		return nil, err
	}
	root := a.glueRootDir()
	if root == "" {
		return nil, fmt.Errorf("glue root directory unavailable")
	}
	registry, err := bucket.NewRegistry(root)
	if err != nil {
		return nil, err
	}
	if err := registry.EnsureGit(); err != nil {
		return nil, fmt.Errorf("git unavailable: %w", err)
	}
	if err := registry.ReloadFromDisk(); err != nil {
		return nil, err
	}
	return registry, nil
}

func (a *App) runAddBucketTask(name, repoURL string) {
	defer a.finishBucketTask("add", name)

	a.emitBucketTaskStart("add", name)
	report := func(ev bucket.BucketProgressEvent) {
		a.emitBucketTaskProgress("add", name, ev.Phase, ev.MessageKey, ev.MessageFallback, ev.MessageArgs, ev.Percent)
	}

	registry, err := a.newBucketRegistryForTask()
	if err != nil {
		a.recordBucketActivity("bucket_add", name, "failed", err.Error())
		a.emitBucketTaskError("add", name, err.Error())
		return
	}

	a.emitBucketTaskProgress("add", name, "prepare", message.BucketPrepareAdd, "", nil, 0)
	if _, err := registry.AddWithProgress(name, repoURL, report); err != nil {
		a.recordBucketActivity("bucket_add", name, "failed", err.Error())
		a.emitBucketTaskError("add", name, err.Error())
		return
	}

	a.emitBucketTaskProgress("add", name, "index", message.BucketIndexRefresh, "", nil, 0)
	a.mu.Lock()
	a.reloadEngineBuckets(false)
	a.invalidateSlowStatsCache()
	a.invalidateBucketUpdatesCache()
	a.mu.Unlock()

	a.recordBucketActivity("bucket_add", name, "success", "")
	a.emitBucketTaskComplete("add", name)
}

func (a *App) runRemoveBucketTask(name string) {
	defer a.finishBucketTask("remove", name)

	a.emitBucketTaskStart("remove", name)
	a.emitBucketTaskProgress("remove", name, "remove", message.BucketRemoving, "", nil, 0)

	registry, err := a.newBucketRegistryForTask()
	if err != nil {
		a.recordBucketActivity("bucket_remove", name, "failed", err.Error())
		a.emitBucketTaskError("remove", name, err.Error())
		return
	}

	if err := registry.Remove(name); err != nil {
		a.recordBucketActivity("bucket_remove", name, "failed", err.Error())
		a.emitBucketTaskError("remove", name, err.Error())
		return
	}

	a.mu.Lock()
	a.reloadEngineBuckets(false)
	a.invalidateSlowStatsCache()
	a.invalidateBucketUpdatesCache()
	a.mu.Unlock()

	a.emitBucketTaskProgress("remove", name, "complete", message.BucketRemoveComplete, "", nil, 100)
	a.recordBucketActivity("bucket_remove", name, "success", "")
	a.emitBucketTaskComplete("remove", name)
}

func (a *App) recordBucketActivity(operation, name, status, errMsg string) {
	if err := a.requireEngine(); err != nil {
		return
	}
	var recordErr error
	switch operation {
	case "bucket_add":
		recordErr = a.engine.RecordBucketAddActivity(name, status, errMsg)
	case "bucket_remove":
		recordErr = a.engine.RecordBucketRemoveActivity(name, status, errMsg)
	case "bucket_update":
		recordErr = a.engine.RecordBucketUpdateActivity(name, status, errMsg)
	default:
		return
	}
	if recordErr != nil {
		runtime.LogError(a.ctx, fmt.Sprintf("recordBucketActivity(%s): %v", operation, recordErr))
		return
	}
	a.emitActivityLogUpdated()
}

func (a *App) emitBucketPartialSynced(name string) {
	runtime.EventsEmit(a.ctx, "bucket:bucket-synced", map[string]interface{}{
		"name":                 name,
		"pendingBucketUpdates": a.pendingBucketUpdatesFromCache(),
	})
}

// afterSingleBucketSynced reloads engine state and refreshes stats after one bucket pull succeeds.
func (a *App) afterSingleBucketSynced(registry *bucket.Registry, name string) {
	a.markBucketsSynced(registry, []string{name})
	a.mu.Lock()
	a.reloadEngineBuckets(true)
	a.invalidateSlowStatsCache()
	a.mu.Unlock()
	a.pruneStaleDownloadOverridesAfterBucketSync()
	a.emitBucketPartialSynced(name)
}

func (a *App) runUpdateBucketsTask(names []string) {
	taskName := updateBucketTaskName(names)
	defer a.finishBucketTask("update", taskName)

	a.emitBucketTaskStart("update", taskName)
	report := func(ev bucket.BucketProgressEvent) {
		a.emitBucketTaskProgress("update", taskName, ev.Phase, ev.MessageKey, ev.MessageFallback, ev.MessageArgs, ev.Percent)
	}

	registry, err := a.newBucketRegistryForTask()
	if err != nil {
		msg := bucket.FormatErr(err)
		a.recordBucketActivity("bucket_update", taskName, "failed", msg)
		a.emitBucketTaskError("update", taskName, msg)
		return
	}

	targets := a.resolveBucketUpdateTargets(registry, names)
	if len(targets) == 0 {
		a.emitBucketTaskProgress("update", taskName, "complete", message.BucketNoUpdates, "", nil, 100)
		a.recordBucketActivity("bucket_update", taskName, "success", "")
		a.emitBucketTaskComplete("update", taskName)
		return
	}

	synced := make([]string, 0, len(targets))
	for i, name := range targets {
		if report != nil {
			pct := float64(i) / float64(len(targets)) * 100
			report(bucket.BucketProgressEvent{
				Phase:      "update",
				MessageKey: message.BucketUpdating,
				MessageArgs: map[string]interface{}{
					"name":    name,
					"current": i + 1,
					"total":   len(targets),
				},
				Percent: pct,
			})
		}
		if err := registry.UpdateSilent([]string{name}); err != nil {
			msg := bucket.FormatErr(err)
			a.recordBucketActivity("bucket_update", taskName, "failed", msg)
			a.emitBucketTaskError("update", taskName, msg)
			return
		}
		synced = append(synced, name)
		a.afterSingleBucketSynced(registry, name)
	}

	if report != nil {
		report(bucket.BucketProgressEvent{
			Phase:      "complete",
			MessageKey: message.BucketUpdateComplete,
			Percent:    100,
		})
	}

	a.recordBucketActivity("bucket_update", taskName, "success", "")
	a.emitBucketTaskComplete("update", taskName, synced)
}

func (a *App) pruneStaleDownloadOverridesAfterBucketSync() {
	if a.engine == nil {
		return
	}
	removed, err := a.engine.PruneStaleManifestDownloadOverrides()
	if err != nil {
		runtime.LogWarning(a.ctx, fmt.Sprintf("prune stale download overrides: %v", err))
		return
	}
	if len(removed) > 0 {
		runtime.LogInfo(a.ctx, fmt.Sprintf("pruned %d stale download override(s) after bucket sync: %v", len(removed), removed))
	}
}

func updateBucketTaskName(names []string) string {
	if len(names) == 0 {
		return "*"
	}
	if len(names) == 1 {
		return names[0]
	}
	return strings.Join(names, ",")
}
