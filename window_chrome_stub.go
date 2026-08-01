//go:build !windows

package main

// SetWindowChromeColors is a no-op outside Windows (native title bar theming is Win32/DWM-only).
func (a *App) SetWindowChromeColors(titleBar, titleText, border string) error {
	return nil
}
