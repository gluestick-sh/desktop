//go:build !windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
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
	return os.Symlink(targetPath, linkPath)
}
