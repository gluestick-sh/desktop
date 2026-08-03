package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	// desktopInstallTasksFile stores Tasks-dialog install history under ~/.glue.
	desktopInstallTasksFile       = "desktop-install-tasks.json"
	desktopInstallTasksFileLegacy = "desktop-task-center.json"
	desktopTaskCenterVersion      = 1
	desktopTaskCenterLimit        = 80
)

// TaskCenterTaskDTO is one install task row persisted for the Tasks dialog.
type TaskCenterTaskDTO struct {
	ID         string   `json:"id"`
	Kind       string   `json:"kind"`
	Title      string   `json:"title"`
	Detail     string   `json:"detail,omitempty"`
	Status     string   `json:"status"`
	Progress   float64  `json:"progress,omitempty"`
	Error      string   `json:"error,omitempty"`
	StartedAt  int64    `json:"startedAt"`
	FinishedAt int64    `json:"finishedAt,omitempty"`
	Items      []string `json:"items,omitempty"`
}

type desktopTaskCenterStore struct {
	Version int                 `json:"version"`
	Tasks   []TaskCenterTaskDTO `json:"tasks"`
}

func (a *App) glueDataRoot() (string, error) {
	root := a.glueRootDir()
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		root = filepath.Join(home, ".glue")
	}
	return root, nil
}

func (a *App) desktopInstallTasksPath() (string, error) {
	root, err := a.glueDataRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, desktopInstallTasksFile), nil
}

func (a *App) desktopInstallTasksLegacyPath() (string, error) {
	root, err := a.glueDataRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, desktopInstallTasksFileLegacy), nil
}

func sanitizeTaskCenterTasksForPersist(tasks []TaskCenterTaskDTO) []TaskCenterTaskDTO {
	out := make([]TaskCenterTaskDTO, 0, len(tasks))
	for _, task := range tasks {
		if strings.TrimSpace(task.ID) == "" {
			continue
		}
		if task.Kind != "" && task.Kind != "install" {
			continue
		}
		task.Kind = "install"
		switch task.Status {
		case "completed", "failed", "running", "queued":
			out = append(out, task)
		default:
			continue
		}
	}
	if len(out) > desktopTaskCenterLimit {
		active := make([]TaskCenterTaskDTO, 0, len(out))
		rest := make([]TaskCenterTaskDTO, 0, len(out))
		for _, task := range out {
			if task.Status == "running" || task.Status == "queued" {
				active = append(active, task)
			} else {
				rest = append(rest, task)
			}
		}
		keepRest := desktopTaskCenterLimit - len(active)
		if keepRest < 0 {
			keepRest = 0
		}
		if keepRest > len(rest) {
			keepRest = len(rest)
		}
		out = append(active, rest[:keepRest]...)
	}
	return out
}

func sanitizeTaskCenterTasksForLoad(tasks []TaskCenterTaskDTO) []TaskCenterTaskDTO {
	now := time.Now().UnixMilli()
	out := make([]TaskCenterTaskDTO, 0, len(tasks))
	for _, task := range tasks {
		if strings.TrimSpace(task.ID) == "" {
			continue
		}
		if task.Kind != "" && task.Kind != "install" {
			continue
		}
		task.Kind = "install"
		switch task.Status {
		case "completed", "failed":
			out = append(out, task)
		case "running", "queued":
			task.Status = "failed"
			if strings.TrimSpace(task.Error) == "" {
				task.Error = "interrupted by app restart"
			}
			if task.FinishedAt == 0 {
				task.FinishedAt = now
			}
			out = append(out, task)
		default:
			continue
		}
	}
	if len(out) > desktopTaskCenterLimit {
		out = out[:desktopTaskCenterLimit]
	}
	return out
}

func readDesktopInstallTasksFile(path string) ([]TaskCenterTaskDTO, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var store desktopTaskCenterStore
	if err := json.Unmarshal(data, &store); err != nil {
		return nil, fmt.Errorf("read %s: %w", filepath.Base(path), err)
	}
	return sanitizeTaskCenterTasksForLoad(store.Tasks), nil
}

// GetTaskCenterHistory loads persisted install tasks for the Tasks dialog.
func (a *App) GetTaskCenterHistory() ([]TaskCenterTaskDTO, error) {
	path, err := a.desktopInstallTasksPath()
	if err != nil {
		return nil, err
	}
	tasks, err := readDesktopInstallTasksFile(path)
	if err == nil {
		return tasks, nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}

	legacyPath, err := a.desktopInstallTasksLegacyPath()
	if err != nil {
		return nil, err
	}
	tasks, err = readDesktopInstallTasksFile(legacyPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []TaskCenterTaskDTO{}, nil
		}
		return nil, err
	}
	// Migrate legacy filename on first successful load.
	_ = a.SaveTaskCenterHistory(tasks)
	return tasks, nil
}

// SaveTaskCenterHistory replaces the persisted Tasks dialog history.
// Callers should pass the full list they want kept (including after clear-finished).
func (a *App) SaveTaskCenterHistory(tasks []TaskCenterTaskDTO) error {
	path, err := a.desktopInstallTasksPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	store := desktopTaskCenterStore{
		Version: desktopTaskCenterVersion,
		Tasks:   sanitizeTaskCenterTasksForPersist(tasks),
	}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return err
	}
	if legacyPath, err := a.desktopInstallTasksLegacyPath(); err == nil {
		_ = os.Remove(legacyPath)
	}
	return nil
}
