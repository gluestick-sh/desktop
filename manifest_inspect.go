package main

import "github.com/gluestick-sh/core/engine"

// InstallManifestInfo exposes manifest JSON and download URLs for debugging installs.
type InstallManifestInfo struct {
	ManifestPath           string   `json:"manifestPath"`
	ManifestJSON           string   `json:"manifestJSON"`
	BucketManifestJSON     string   `json:"bucketManifestJSON"`
	Version                string   `json:"version"`
	DownloadURLs           []string `json:"downloadUrls"`
	BucketDownloadURLs     []string `json:"bucketDownloadUrls"`
	URLOverrideActive      bool     `json:"urlOverrideActive"`
	URLOverrideStale       bool     `json:"urlOverrideStale"`
	JSONOverrideActive     bool     `json:"jsonOverrideActive"`
	JSONOverrideStale      bool     `json:"jsonOverrideStale"`
	Hashes                 []string `json:"hashes"`
	Architecture           string   `json:"architecture,omitempty"`
	AvailableArchitectures []string `json:"availableArchitectures,omitempty"`
	DefaultArchitecture    string   `json:"defaultArchitecture,omitempty"`
	HasInstallerScript     bool     `json:"hasInstallerScript,omitempty"`
}

// GetPackageManifestInspect returns manifest debug info for a package ref (e.g. games/freedroidrpg).
func (a *App) GetPackageManifestInspect(name string) (*InstallManifestInfo, error) {
	if err := a.requireEngine(); err != nil {
		return nil, err
	}
	info, err := a.engine.InspectPackageManifest(a.ctx, name)
	if err != nil {
		return nil, err
	}
	return convertInstallManifestInfo(info), nil
}

// GetInstalledManifestInspect returns manifest info from install.json for an installed version.
func (a *App) GetInstalledManifestInspect(packageName, version string) (*InstallManifestInfo, error) {
	if err := a.requireEngine(); err != nil {
		return nil, err
	}
	info, err := a.engine.InspectInstalledManifest(packageName, version)
	if err != nil {
		return nil, err
	}
	return convertInstallManifestInfo(info), nil
}

func convertInstallManifestInfo(info *engine.InstallManifestInfo) *InstallManifestInfo {
	if info == nil {
		return nil
	}
	return &InstallManifestInfo{
		ManifestPath:           info.ManifestPath,
		ManifestJSON:           info.ManifestJSON,
		BucketManifestJSON:     info.BucketManifestJSON,
		Version:                info.Version,
		DownloadURLs:           append([]string(nil), info.DownloadURLs...),
		BucketDownloadURLs:     append([]string(nil), info.BucketDownloadURLs...),
		URLOverrideActive:      info.URLOverrideActive,
		URLOverrideStale:       info.URLOverrideStale,
		JSONOverrideActive:     info.JSONOverrideActive,
		JSONOverrideStale:      info.JSONOverrideStale,
		Hashes:                 append([]string(nil), info.Hashes...),
		Architecture:           info.Architecture,
		AvailableArchitectures: append([]string(nil), info.AvailableArchitectures...),
		DefaultArchitecture:    info.DefaultArchitecture,
		HasInstallerScript:     info.HasInstallerScript,
	}
}

func convertInstallManifestInfoValue(info engine.InstallManifestInfo) InstallManifestInfo {
	out := convertInstallManifestInfo(&info)
	if out == nil {
		return InstallManifestInfo{}
	}
	return *out
}
