package main

import (
	"github.com/gluestick-sh/core/config"
)

// BucketSyncConfig exposes background bucket check interval and sync mode to the frontend.
type BucketSyncConfig struct {
	Minutes         int    `json:"minutes"`
	Mode            string `json:"mode"`
	ConfigPath      string `json:"configPath"`
	IntervalOptions []int  `json:"intervalOptions"`
}

func bucketCheckIntervalMinutesFromConfig(root string) int {
	minutes := config.DefaultBucketCheckIntervalMinutes
	if root == "" {
		return minutes
	}
	if n, ok, err := config.ReadConfigBucketCheckInterval(root); err == nil && ok {
		minutes = n
	}
	return minutes
}

func bucketSyncModeFromConfig(root string) string {
	mode := config.DefaultBucketSyncMode
	if root == "" {
		return mode
	}
	if m, ok, err := config.ReadConfigBucketSyncMode(root); err == nil && ok {
		mode = m
	}
	return mode
}

// GetBucketSyncConfig reads bucket sync settings from config.json.
func (a *App) GetBucketSyncConfig() (*BucketSyncConfig, error) {
	root := a.glueRootDir()
	if root == "" {
		return nil, errGlueRootUnavailable()
	}
	return &BucketSyncConfig{
		Minutes:         bucketCheckIntervalMinutesFromConfig(root),
		Mode:            bucketSyncModeFromConfig(root),
		ConfigPath:      config.ConfigPath(root),
		IntervalOptions: append([]int(nil), config.AllowedBucketCheckIntervals...),
	}, nil
}

// SetBucketCheckInterval saves bucket_check_interval_minutes to config.json.
func (a *App) SetBucketCheckInterval(minutes int) error {
	root := a.glueRootDir()
	if root == "" {
		return errGlueRootUnavailable()
	}
	minutes = config.NormalizeBucketCheckInterval(minutes)
	if err := config.WriteConfigBucketCheckInterval(root, minutes); err != nil {
		return err
	}
	a.wakeBucketCheckScheduler()
	return nil
}

// SetBucketSyncMode saves bucket_sync_mode (auto|manual) to config.json.
func (a *App) SetBucketSyncMode(mode string) error {
	root := a.glueRootDir()
	if root == "" {
		return errGlueRootUnavailable()
	}
	mode = config.NormalizeBucketSyncMode(mode)
	if err := config.WriteConfigBucketSyncMode(root, mode); err != nil {
		return err
	}
	return nil
}
