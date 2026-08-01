//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gluestick-sh/core/procutil"
)

func linkDirectoryJunction(linkPath, targetPath string) error {
	linkPath, err := filepath.Abs(linkPath)
	if err != nil {
		return err
	}
	targetPath, err = filepath.Abs(targetPath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(linkPath), 0755); err != nil {
		return err
	}
	if _, err := os.Lstat(linkPath); err == nil {
		_ = os.Remove(linkPath)
	}
	cmd := exec.Command("cmd", "/C", "mklink", "/J", linkPath, targetPath)
	procutil.HideWindow(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("mklink /J: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
