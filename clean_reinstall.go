package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gluestick-sh/core/engine"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// CleanReinstall uninstalls every installed version of a package, deletes its
// persist data and cache index entry, then force-reinstalls from a fresh download.
// Returns immediately; progress is emitted on uninstall:* then install:* events.
func (a *App) CleanReinstall(name string, architecture string) error {
	if err := a.requireEngine(); err != nil {
		return err
	}
	ref := strings.TrimSpace(name)
	if ref == "" {
		return fmt.Errorf("package name is required")
	}
	key := installTaskKey(ref)
	if !a.tryStartUninstall(ref) {
		return fmt.Errorf("an uninstall task is already in progress")
	}
	// Reserve the install slot early so another install of the same package cannot start mid-clean.
	if err := a.tryStartInstall(key); err != nil {
		a.finishUninstall()
		return err
	}
	go a.runCleanReinstallTask(key, ref, strings.TrimSpace(architecture))
	return nil
}

func (a *App) runCleanReinstallTask(key, name, architecture string) {
	defer a.finishInstall(key)
	defer a.finishUninstall()

	pkgName, _ := engine.ParsePkgRef(name)
	if pkgName == "" {
		pkgName = installTaskKey(name)
	}

	uninstallReporter := engine.NewCallbackReporter(func(ev engine.ProgressEvent) {
		runtime.EventsEmit(a.ctx, "uninstall:progress", InstallProgress{
			Name:        name,
			Phase:       string(ev.Phase),
			Status:      string(ev.Status),
			Percentage:  ev.Percentage,
			Message:     ev.Message,
			MessageKey:  ev.MessageKey,
			MessageArgs: ev.MessageArgs,
		})
	})

	runtime.EventsEmit(a.ctx, "uninstall:start", name)

	for i := 0; i < 64; i++ {
		if err := a.ctx.Err(); err != nil {
			runtime.EventsEmit(a.ctx, "uninstall:error", map[string]string{
				"name":  name,
				"error": err.Error(),
			})
			a.emitInstallError(name, err)
			return
		}
		start := time.Now()
		result, err := a.engine.Uninstall(a.ctx, &engine.UninstallRequest{
			Request: engine.Request{Name: pkgName},
			Purge:   true,
		}, uninstallReporter)
		logPostOpDuration(a.ctx, fmt.Sprintf("engine.Uninstall(%s) clean-reinstall step", pkgName), start)
		if err != nil {
			if isNotInstalledErr(err) {
				break
			}
			runtime.EventsEmit(a.ctx, "uninstall:error", map[string]string{
				"name":  name,
				"error": err.Error(),
			})
			a.emitInstallError(name, err)
			return
		}
		if opErr := resultError(result); opErr != nil {
			if isNotInstalledErr(opErr) {
				break
			}
			runtime.EventsEmit(a.ctx, "uninstall:error", map[string]string{
				"name":  name,
				"error": opErr.Error(),
			})
			a.emitInstallError(name, opErr)
			return
		}
		if i == 63 {
			err := fmt.Errorf("clean reinstall: too many versions to remove for %s", pkgName)
			runtime.EventsEmit(a.ctx, "uninstall:error", map[string]string{
				"name":  name,
				"error": err.Error(),
			})
			a.emitInstallError(name, err)
			return
		}
	}

	runtime.EventsEmit(a.ctx, "uninstall:complete", name)

	persistDir := filepath.Join(a.glueRootDir(), "persist", pkgName)
	if err := os.RemoveAll(persistDir); err != nil && !os.IsNotExist(err) {
		wrapped := fmt.Errorf("remove persist data: %w", err)
		a.emitInstallError(name, wrapped)
		return
	}

	if _, err := a.engine.PurgeCachePackage(pkgName); err != nil {
		runtime.LogWarning(a.ctx, fmt.Sprintf("clean reinstall cache purge %s: %v", pkgName, err))
	}

	// Install slot already reserved; runInstallTask also finishes the slot — avoid double finish.
	a.runInstallTaskOwned(key, name, true, architecture, false, "", "")
}

func isNotInstalledErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "is not installed") || strings.Contains(msg, "not installed")
}
