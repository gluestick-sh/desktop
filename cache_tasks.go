package main

import (
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/gluestick-sh/core/cache"
	"github.com/gluestick-sh/core/message"
)

const cacheGCTaskName = "gc"

func (a *App) startCacheTask(kind string) bool {
	a.cacheTasksMu.Lock()
	defer a.cacheTasksMu.Unlock()
	if a.cacheTasks == nil {
		a.cacheTasks = make(map[string]struct{})
	}
	if len(a.cacheTasks) > 0 {
		return false
	}
	a.cacheTasks[kind] = struct{}{}
	return true
}

func (a *App) emitCacheTaskStart(kind, name string) {
	payload := map[string]interface{}{
		"kind": kind,
	}
	if name != "" {
		payload["name"] = name
	}
	runtime.EventsEmit(a.ctx, "cache:task:start", payload)
}

func (a *App) emitCacheTaskProgress(kind, name, phase, messageKey string, messageArgs map[string]interface{}, percent float64) {
	if messageArgs == nil {
		messageArgs = map[string]interface{}{}
	}
	payload := map[string]interface{}{
		"kind":        kind,
		"phase":       phase,
		"message":     message.FormatEN(messageKey, messageArgs),
		"messageKey":  messageKey,
		"messageArgs": messageArgs,
		"percentage":  percent,
	}
	if name != "" {
		payload["name"] = name
	}
	runtime.EventsEmit(a.ctx, "cache:task:progress", payload)
}

func (a *App) emitCacheTaskComplete(kind, name string, result CacheSpaceResult) {
	payload := map[string]interface{}{
		"kind":         kind,
		"removedBlobs": result.RemovedBlobs,
		"freedBytes":   result.FreedBytes,
	}
	if name != "" {
		payload["name"] = name
	}
	runtime.EventsEmit(a.ctx, "cache:task:complete", payload)
}

func (a *App) emitCacheTaskError(kind, name, errMsg string) {
	payload := map[string]interface{}{
		"kind":  kind,
		"error": errMsg,
	}
	if name != "" {
		payload["name"] = name
	}
	runtime.EventsEmit(a.ctx, "cache:task:error", payload)
}

func (a *App) finishCacheTask(kind string) {
	a.cacheTasksMu.Lock()
	defer a.cacheTasksMu.Unlock()
	delete(a.cacheTasks, kind)
}

func (a *App) runCacheGCTask() {
	defer a.finishCacheTask(cacheGCTaskName)

	a.emitCacheTaskStart(cacheGCTaskName, "")

	report := func(ev cache.GCProgressEvent) {
		a.emitCacheTaskProgress(cacheGCTaskName, "", ev.Phase, ev.MessageKey, ev.MessageArgs, ev.Percent)
	}

	result, err := a.engine.RunCacheGCWithProgress(report)
	if err != nil {
		a.emitCacheTaskError(cacheGCTaskName, "", err.Error())
		return
	}

	if result.RemovedBlobs > 0 || result.FreedBytes > 0 {
		a.emitCacheTaskProgress(cacheGCTaskName, "", cache.GCPhaseComplete, message.GCCompleteFreed, map[string]interface{}{
			"removed": result.RemovedBlobs,
			"freed":   formatCacheBytes(result.FreedBytes),
		}, 100)
	} else {
		a.emitCacheTaskProgress(cacheGCTaskName, "", cache.GCPhaseComplete, message.GCCompleteNothing, nil, 100)
	}
	a.emitCacheTaskComplete(cacheGCTaskName, "", CacheSpaceResult{
		RemovedBlobs: result.RemovedBlobs,
		FreedBytes:   result.FreedBytes,
	})
}

const cachePurgeTaskPrefix = "purge:"

func cachePurgeTaskName(pkgName string) string {
	return cachePurgeTaskPrefix + pkgName
}

func (a *App) runCachePurgeTask(pkgName string) {
	taskName := cachePurgeTaskName(pkgName)
	defer a.finishCacheTask(taskName)

	a.emitCacheTaskStart("purge", pkgName)

	report := func(ev cache.GCProgressEvent) {
		a.emitCacheTaskProgress("purge", pkgName, ev.Phase, ev.MessageKey, ev.MessageArgs, ev.Percent)
	}

	result, err := a.engine.PurgeCachePackageWithProgress(pkgName, report)
	if err != nil {
		a.emitCacheTaskError("purge", pkgName, err.Error())
		return
	}

	if result.RemovedBlobs > 0 {
		a.emitCacheTaskProgress("purge", pkgName, cache.GCPhaseComplete, message.PurgeCompleteFreed, map[string]interface{}{
			"removed": result.RemovedBlobs,
			"freed":   formatCacheBytes(result.FreedBytes),
		}, 100)
	} else {
		a.emitCacheTaskProgress("purge", pkgName, cache.GCPhaseComplete, message.PurgeCompleteNothing, map[string]interface{}{
			"name": pkgName,
		}, 100)
	}
	a.emitCacheTaskComplete("purge", pkgName, CacheSpaceResult{
		RemovedBlobs: result.RemovedBlobs,
		FreedBytes:   result.FreedBytes,
	})
}

func formatCacheBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}
