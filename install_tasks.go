package main

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/gluestick-sh/core/engine"
	"github.com/gluestick-sh/core/message"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func installTaskKey(ref string) string {
	pkg, _ := engine.ParsePkgRef(strings.TrimSpace(ref))
	if pkg == "" {
		return strings.ToLower(strings.TrimSpace(ref))
	}
	return strings.ToLower(pkg)
}

func (a *App) tryStartInstall(key string) error {
	a.installMu.Lock()
	defer a.installMu.Unlock()
	if a.installTasks == nil {
		a.installTasks = make(map[string]context.CancelFunc)
	}
	if _, exists := a.installTasks[key]; exists {
		return fmt.Errorf("package %q is already being installed", key)
	}
	if len(a.installTasks) >= MaxParallelInstalls {
		return fmt.Errorf("too many installs in progress (max %d)", MaxParallelInstalls)
	}
	a.installTasks[key] = nil
	return nil
}

func (a *App) emitInstallError(name string, err error) {
	if err == nil {
		err = fmt.Errorf("install failed")
	}
	runtime.EventsEmit(a.ctx, "install:progress", InstallProgress{
		Name:       name,
		Phase:      "error",
		Status:     "failed",
		Percentage: 0,
		Message:    err.Error(),
	})
	runtime.EventsEmit(a.ctx, "install:error", map[string]any{
		"name":  name,
		"error": err.Error(),
	})
}

func (a *App) finishInstall(key string) {
	a.installMu.Lock()
	defer a.installMu.Unlock()
	if a.installTasks != nil {
		delete(a.installTasks, key)
	}
}

func (a *App) setInstallCancel(key string, cancel context.CancelFunc) {
	a.installMu.Lock()
	defer a.installMu.Unlock()
	if a.installTasks == nil {
		a.installTasks = make(map[string]context.CancelFunc)
	}
	a.installTasks[key] = cancel
}

func (a *App) emitInstallCancelled(name string) {
	runtime.EventsEmit(a.ctx, "install:progress", InstallProgress{
		Name:       name,
		Phase:      "error",
		Status:     "cancelled",
		Percentage: 0,
		Message:    message.FormatEN(message.ProgressInstallCancelled, nil),
		MessageKey: message.ProgressInstallCancelled,
	})
	runtime.EventsEmit(a.ctx, "install:cancelled", map[string]any{
		"name": name,
	})
}

func (a *App) runInstallTask(key, name string, force bool, architecture string, interactive bool, downloadURL, downloadHash string) {
	defer a.finishInstall(key)
	a.runInstallTaskOwned(key, name, force, architecture, interactive, downloadURL, downloadHash)
}

// runInstallTaskOwned performs the install; the caller owns finishInstall(key).
// downloadURL/downloadHash are one-shot InstallRequest overrides (not written to config).
func (a *App) runInstallTaskOwned(key, name string, force bool, architecture string, interactive bool, downloadURL, downloadHash string) {
	ctx, cancel := context.WithCancel(a.ctx)
	a.setInstallCancel(key, cancel)
	defer cancel()

	installRef, err := a.engine.ResolveInstallRef(a.ctx, name)
	if err != nil {
		a.emitInstallError(name, err)
		return
	}

	reporter := engine.NewCallbackReporter(func(ev engine.ProgressEvent) {
		progress := InstallProgress{
			Name:        installRef,
			Phase:       string(ev.Phase),
			Status:      string(ev.Status),
			Percentage:  ev.Percentage,
			Message:     ev.Message,
			MessageKey:  ev.MessageKey,
			MessageArgs: ev.MessageArgs,
			BytesDown:   ev.Bytes,
			BytesTotal:  ev.TotalBytes,
		}
		runtime.EventsEmit(a.ctx, "install:progress", progress)
	})

	runtime.EventsEmit(a.ctx, "install:start", installRef)

	options := map[string]string{}
	if strings.TrimSpace(architecture) != "" {
		options["architecture"] = strings.TrimSpace(architecture)
	}
	if interactive {
		options["interactive"] = "true"
	}

	installStart := time.Now()
	req := &engine.InstallRequest{
		Request: engine.Request{Name: installRef, Force: force, Options: options},
	}
	if u := strings.TrimSpace(downloadURL); u != "" {
		req.DownloadURLOverrides = []string{u}
		if h := strings.TrimSpace(downloadHash); h != "" {
			req.DownloadHashOverrides = []string{h}
		}
	}
	result, err := a.engine.Install(ctx, req, reporter)
	logPostOpDuration(a.ctx, fmt.Sprintf("engine.Install(%s) completed", installRef), installStart)

	if err != nil {
		if errors.Is(err, context.Canceled) {
			a.emitInstallCancelled(installRef)
			return
		}
		a.emitInstallError(installRef, err)
		return
	}
	if opErr := resultError(result); opErr != nil {
		if errors.Is(opErr, context.Canceled) {
			a.emitInstallCancelled(installRef)
			return
		}
		a.emitInstallError(installRef, opErr)
		return
	}

	pkgName, _ := engine.ParsePkgRef(installRef)
	if pkgName == "" {
		pkgName = installTaskKey(installRef)
	}
	if result != nil && strings.TrimSpace(result.Version) != "" {
		installDir := filepath.Join(a.glueRootDir(), "apps", pkgName, result.Version)
		a.ensurePersistInstallPaths(pkgName, installDir)
	}

	completePayload := map[string]interface{}{
		"name":    installRef,
		"version": result.Version,
		"success": true,
	}
	if len(result.Suggestions) > 0 {
		suggestions := make([]map[string]string, len(result.Suggestions))
		for i, s := range result.Suggestions {
			suggestions[i] = map[string]string{"label": s.Label, "ref": s.Ref}
		}
		completePayload["suggestions"] = suggestions
	}
	runtime.EventsEmit(a.ctx, "install:complete", completePayload)
}
