package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSanitizeTaskCenterTasksForLoad_marksInterrupted(t *testing.T) {
	tasks := sanitizeTaskCenterTasksForLoad([]TaskCenterTaskDTO{
		{ID: "install:a", Kind: "install", Title: "a", Status: "running", StartedAt: 1},
		{ID: "install:b", Kind: "install", Title: "b", Status: "completed", StartedAt: 2, FinishedAt: 3},
		{ID: "uninstall:x", Kind: "uninstall", Title: "x", Status: "failed", StartedAt: 4},
	})
	if len(tasks) != 2 {
		t.Fatalf("len=%d", len(tasks))
	}
	if tasks[0].Status != "failed" || tasks[0].Error == "" || tasks[0].FinishedAt == 0 {
		t.Fatalf("running task not marked interrupted: %#v", tasks[0])
	}
	if tasks[1].Status != "completed" {
		t.Fatalf("completed changed: %#v", tasks[1])
	}
}

func TestSaveAndGetTaskCenterHistory(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, desktopInstallTasksFile)
	store := desktopTaskCenterStore{
		Version: 1,
		Tasks: []TaskCenterTaskDTO{
			{ID: "install:demo", Kind: "install", Title: "demo", Status: "failed", StartedAt: 10, FinishedAt: 11, Error: "boom"},
		},
	}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var loaded desktopTaskCenterStore
	if err := json.Unmarshal(raw, &loaded); err != nil {
		t.Fatal(err)
	}
	got := sanitizeTaskCenterTasksForLoad(loaded.Tasks)
	if len(got) != 1 || got[0].Title != "demo" {
		t.Fatalf("got %#v", got)
	}

	persisted := sanitizeTaskCenterTasksForPersist([]TaskCenterTaskDTO{
		{ID: "install:a", Kind: "install", Title: "a", Status: "completed", StartedAt: 1},
		{ID: "install:b", Kind: "uninstall", Title: "b", Status: "failed", StartedAt: 2},
	})
	if len(persisted) != 1 || persisted[0].ID != "install:a" {
		t.Fatalf("persist filter = %#v", persisted)
	}
}
