package main

import (
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/gluestick-sh/core/bucket"
	"github.com/gluestick-sh/core/config"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const bucketCheckMaxAttempts = 3

// bucketCheckRetryDelays: wait before 2nd and 3rd attempt (5s, then 10s).
var bucketCheckRetryDelays = []time.Duration{
	5 * time.Second,
	10 * time.Second,
}

func (a *App) tryStartBucketUpdateCheck() bool {
	a.bucketUpdateCheckMu.Lock()
	defer a.bucketUpdateCheckMu.Unlock()
	if a.bucketUpdateCheckRunning {
		return false
	}
	a.bucketUpdateCheckRunning = true
	return true
}

func (a *App) finishBucketUpdateCheck() {
	a.bucketUpdateCheckMu.Lock()
	a.bucketUpdateCheckRunning = false
	a.bucketUpdateCheckMu.Unlock()
}

// StartBucketUpdateCheck checks each bucket in the background (always runs a new check).
func (a *App) StartBucketUpdateCheck() {
	a.startBucketUpdateCheck(true)
}

// StartBucketUpdateCheckIfStale checks buckets only when the cached result is missing or expired.
func (a *App) StartBucketUpdateCheckIfStale() {
	if a.bucketUpdatesCacheValid() {
		return
	}
	a.startBucketUpdateCheck(false)
}

func (a *App) startBucketUpdateCheck(force bool) {
	if err := a.requireEngine(); err != nil {
		runtime.EventsEmit(a.ctx, "bucket:update-check:done", map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	if !force && a.bucketUpdatesCacheValid() {
		return
	}
	if a.hasBucketUpdateTaskRunning() {
		return
	}
	if !a.tryStartBucketUpdateCheck() {
		return
	}
	go a.runBucketUpdateCheck()
}

func (a *App) runBucketUpdateCheck() {
	defer a.finishBucketUpdateCheck()

	registry, err := a.openBucketRegistry()
	if err != nil {
		msg := bucket.FormatErr(err)
		a.recordBucketCheckActivity(0, nil, "failed", msg)
		runtime.EventsEmit(a.ctx, "bucket:update-check:done", map[string]interface{}{
			"error": msg,
		})
		return
	}

	buckets := registry.List()
	runtime.EventsEmit(a.ctx, "bucket:update-check:start", map[string]interface{}{
		"count": len(buckets),
	})
	var wg sync.WaitGroup
	for _, b := range buckets {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			entry := a.checkBucketWithRetry(registry, name)
			a.mergeBucketUpdate(name, entry)
			a.invalidateSlowStatsCache()
			a.bucketUpdatesMu.Lock()
			stored := a.bucketUpdates.updates[name]
			a.bucketUpdatesMu.Unlock()
			payload := bucketUpdateResultPayload(name, stored)
			payload["pendingBucketUpdates"] = a.pendingBucketUpdatesFromCache()
			runtime.EventsEmit(a.ctx, "bucket:update-check:result", payload)
		}(b.Name)
	}
	wg.Wait()

	a.touchBucketUpdatesCache()
	a.invalidateSlowStatsCache()

	withUpdates := 0
	updateNames := make([]string, 0)
	cached, _ := a.snapshotBucketUpdates()
	for _, b := range buckets {
		entry, ok := cached[b.Name]
		if ok && entry.CheckOK && entry.HasUpdates {
			withUpdates++
			updateNames = append(updateNames, b.Name)
		}
	}
	sort.Strings(updateNames)

	a.recordBucketCheckActivity(withUpdates, updateNames, "success", "")

	autoSyncStarted := false
	if withUpdates > 0 && bucketSyncModeFromConfig(a.glueRootDir()) == config.BucketSyncModeAuto {
		if err := a.UpdateBuckets([]string{}); err != nil {
			runtime.LogWarning(a.ctx, fmt.Sprintf("auto bucket sync: %v", err))
		} else {
			autoSyncStarted = true
		}
	}

	runtime.EventsEmit(a.ctx, "bucket:update-check:done", map[string]interface{}{
		"withUpdates": withUpdates,
		"names":       updateNames,
		"autoSync":    autoSyncStarted,
	})
}

func (a *App) checkBucketOnce(registry *bucket.Registry, name string) bucketUpdateEntry {
	status, err := registry.CheckUpdate(name)
	entry := bucketUpdateEntry{
		HasUpdates:   status.HasUpdates,
		LocalCommit:  status.LocalCommit,
		RemoteCommit: status.RemoteCommit,
		CheckOK:      status.OK,
		CheckError:   bucket.FormatGitError(status.ErrMsg),
	}
	if err != nil && !status.OK && entry.CheckError == "" {
		entry.CheckError = bucket.FormatErr(err)
	}
	return entry
}

func (a *App) checkBucketWithRetry(registry *bucket.Registry, name string) bucketUpdateEntry {
	var entry bucketUpdateEntry
	for attempt := 0; attempt < bucketCheckMaxAttempts; attempt++ {
		if attempt > 0 {
			if a.hasBucketUpdateTaskRunning() {
				break
			}
			delay := bucketCheckRetryDelays[attempt-1]
			time.Sleep(delay)
			if a.hasBucketUpdateTaskRunning() {
				break
			}
		}
		entry = a.checkBucketOnce(registry, name)
		if entry.CheckOK {
			break
		}
	}
	return entry
}

func (a *App) runBucketCheckScheduler() {
	for {
		a.mu.Lock()
		ready := a.engine != nil
		a.mu.Unlock()
		if ready {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}

	for {
		sleepFor := a.timeUntilNextScheduledBucketCheck()
		if sleepFor > 0 {
			select {
			case <-time.After(sleepFor):
			case <-a.bucketCheckScheduleCh:
			}
			continue
		}

		if !a.hasBucketUpdateTaskRunning() {
			a.StartBucketUpdateCheckIfStale()
		}

		// If another goroutine refreshed the cache while we were due, wait for the next slot.
		if !a.bucketUpdatesCacheStale() {
			select {
			case <-time.After(2 * time.Second):
			case <-a.bucketCheckScheduleCh:
			}
		}
	}
}

func (a *App) recordBucketCheckActivity(withUpdates int, names []string, status, errMsg string) {
	if err := a.requireEngine(); err != nil {
		return
	}
	if err := a.engine.RecordBucketCheckActivity(withUpdates, names, status, errMsg); err != nil {
		runtime.LogError(a.ctx, fmt.Sprintf("recordBucketCheckActivity: %v", err))
		return
	}
	a.emitActivityLogUpdated()
}
