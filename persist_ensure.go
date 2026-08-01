package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gluestick-sh/core/manifest"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ensurePersistInstallPaths creates missing persist install paths after install.
// Glue may skip dotted directory names like Tor Browser's profile.default (treated as files),
// and Scoop pre_install movedir can leave the install path absent. Empty directories are enough
// for apps that initialize a profile on first launch.
func (a *App) ensurePersistInstallPaths(pkgName, installDir string) {
	if a == nil || strings.TrimSpace(pkgName) == "" || strings.TrimSpace(installDir) == "" {
		return
	}
	entries := persistEntriesFromInstallRecord(installDir)
	if len(entries) == 0 {
		return
	}
	persistRoot := filepath.Join(a.glueRootDir(), "persist", pkgName)
	for _, entry := range entries {
		installRel := filepath.FromSlash(entry.InstallName())
		dataRel := filepath.FromSlash(entry.DataName())
		installPath := filepath.Join(installDir, installRel)
		persistPath := filepath.Join(persistRoot, dataRel)

		if _, err := os.Lstat(installPath); err == nil {
			continue
		}

		if info, err := os.Stat(persistPath); err == nil {
			if info.IsDir() {
				if err := linkDirectoryJunction(installPath, persistPath); err != nil {
					runtime.LogWarning(a.ctx, fmt.Sprintf("ensure persist link %s: %v", installRel, err))
				}
			} else if err := copyFileSimple(persistPath, installPath); err != nil {
				runtime.LogWarning(a.ctx, fmt.Sprintf("ensure persist file %s: %v", installRel, err))
			}
			continue
		}

		if persistPathLooksLikeFile(installRel) {
			continue
		}
		if err := os.MkdirAll(installPath, 0755); err != nil {
			runtime.LogWarning(a.ctx, fmt.Sprintf("ensure persist dir %s: %v", installRel, err))
		}
	}
}

func persistEntriesFromInstallRecord(installDir string) []manifest.PersistEntry {
	raw, err := os.ReadFile(filepath.Join(installDir, "install.json"))
	if err != nil {
		return nil
	}
	var rec struct {
		Manifest *manifest.Manifest `json:"manifest"`
	}
	if err := json.Unmarshal(raw, &rec); err != nil || rec.Manifest == nil {
		return nil
	}
	return rec.Manifest.PersistEntries()
}

// persistPathLooksLikeFile uses a conservative extension list. Names like profile.default
// are directories despite containing a dot.
func persistPathLooksLikeFile(rel string) bool {
	base := filepath.Base(rel)
	if !strings.Contains(base, ".") {
		return false
	}
	ext := strings.ToLower(filepath.Ext(base))
	switch ext {
	case ".ini", ".xml", ".json", ".txt", ".conf", ".cfg", ".yml", ".yaml", ".toml",
		".js", ".css", ".html", ".htm", ".log", ".dat", ".db", ".sqlite", ".sqlite3",
		".bat", ".cmd", ".ps1", ".reg", ".properties", ".config", ".vnc":
		return true
	default:
		return false
	}
}

func copyFileSimple(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = out.ReadFrom(in)
	return err
}
