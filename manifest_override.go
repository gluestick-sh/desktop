package main

import "strings"

// SetManifestDownloadOverride saves a user-edited download URL for a package ref.
// The override is tied to the current bucket manifest hash; when the bucket updates,
// the saved URL is ignored so versioned download links do not stick.
// Hash is not stored: URL-only overrides keep using the current bucket hash while active.
func (a *App) SetManifestDownloadOverride(pkgRef, downloadURL string) error {
	return a.SetManifestDownloadOverrideWithHash(pkgRef, downloadURL, "")
}

// SetManifestDownloadOverrideWithHash saves a download URL and optional hash override
// tied to the bucket manifest hash (same freshness rule as URL-only).
func (a *App) SetManifestDownloadOverrideWithHash(pkgRef, downloadURL, hash string) error {
	if err := a.requireEngine(); err != nil {
		return err
	}
	urls := []string{}
	if strings.TrimSpace(downloadURL) != "" {
		urls = []string{strings.TrimSpace(downloadURL)}
	}
	hashes := []string{}
	if strings.TrimSpace(hash) != "" {
		hashes = []string{strings.TrimSpace(hash)}
	}
	return a.engine.SetManifestDownloadOverrideForRef(a.ctx, pkgRef, urls, hashes)
}

// ClearManifestDownloadOverride removes a saved download URL override.
func (a *App) ClearManifestDownloadOverride(pkgRef string) error {
	if err := a.requireEngine(); err != nil {
		return err
	}
	return a.engine.ClearManifestDownloadOverride(pkgRef)
}

// SetManifestJSONOverride saves user-edited manifest JSON for a package ref.
func (a *App) SetManifestJSONOverride(pkgRef, jsonText string) error {
	if err := a.requireEngine(); err != nil {
		return err
	}
	return a.engine.SetManifestJSONOverrideForRef(a.ctx, pkgRef, jsonText)
}

// ClearManifestJSONOverride removes a saved manifest JSON override.
func (a *App) ClearManifestJSONOverride(pkgRef string) error {
	if err := a.requireEngine(); err != nil {
		return err
	}
	return a.engine.ClearManifestJSONOverride(pkgRef)
}
