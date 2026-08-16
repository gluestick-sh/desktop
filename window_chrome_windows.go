//go:build windows

package main

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	dwmwaUseImmersiveDarkModeBefore20H1 = 19
	dwmwaUseImmersiveDarkMode           = 20
	dwmwaBorderColor                    = 34
	dwmwaCaptionColor                   = 35
	dwmwaTextColor                      = 36

	// Windows 11 first public build — DWMWA_CAPTION_COLOR / TEXT / BORDER.
	windows11MinBuild = 22000
	// Windows 10 20H1 preview: DWMWA_USE_IMMERSIVE_DARK_MODE switched 19 → 20.
	immersiveDarkModeBuild = 18985

	swpNosize       = 0x0001
	swpNomove       = 0x0002
	swpNozorder     = 0x0004
	swpNoactivate   = 0x0010
	swpFramechanged = 0x0020
)

var (
	dwmapi                    = windows.NewLazySystemDLL("dwmapi.dll")
	procDwmSetWindowAttribute = dwmapi.NewProc("DwmSetWindowAttribute")
	user32                    = windows.NewLazySystemDLL("user32.dll")
	user32FindWindow          = user32.NewProc("FindWindowW")
	user32SetWindowPos        = user32.NewProc("SetWindowPos")
)

// SetWindowChromeColors paints the native Windows title bar / border to match the UI theme.
// Colors are CSS hex (#RRGGBB or RRGGBB). Empty values are skipped.
//
// Windows 11 can set caption / text / border colors. Windows 10 cannot — those DWM
// attributes are ignored — so we fall back to immersive light/dark caption mode and
// force a non-client redraw (otherwise the bar stays system-black after a theme switch).
func (a *App) SetWindowChromeColors(titleBar, titleText, border string) error {
	hwnd := findMainWindowHWND()
	if hwnd == 0 {
		return fmt.Errorf("main window not found")
	}

	if titleBar != "" {
		setImmersiveDarkMode(hwnd, !isLightHex(titleBar))
	}

	if supportsCaptionColors() {
		if err := setCaptionColors(hwnd, titleBar, titleText, border); err != nil {
			return err
		}
		return nil
	}

	forceCaptionRedraw(hwnd)
	return nil
}

func setCaptionColors(hwnd uintptr, titleBar, titleText, border string) error {
	if titleBar != "" {
		color, err := hexToCOLORREF(titleBar)
		if err != nil {
			return fmt.Errorf("title bar color: %w", err)
		}
		if err := dwmSetAttribute(hwnd, dwmwaCaptionColor, color); err != nil {
			return err
		}
	}
	if titleText != "" {
		color, err := hexToCOLORREF(titleText)
		if err != nil {
			return fmt.Errorf("title text color: %w", err)
		}
		if err := dwmSetAttribute(hwnd, dwmwaTextColor, color); err != nil {
			return err
		}
	}
	if border != "" {
		color, err := hexToCOLORREF(border)
		if err != nil {
			return fmt.Errorf("border color: %w", err)
		}
		if err := dwmSetAttribute(hwnd, dwmwaBorderColor, color); err != nil {
			return err
		}
	}
	return nil
}

func setImmersiveDarkMode(hwnd uintptr, dark bool) {
	var value uint32
	if dark {
		value = 1
	}
	attr := int32(dwmwaUseImmersiveDarkModeBefore20H1)
	if windowsBuildNumber() >= immersiveDarkModeBuild {
		attr = dwmwaUseImmersiveDarkMode
	}
	if err := dwmSetAttribute(hwnd, attr, value); err != nil && attr != dwmwaUseImmersiveDarkModeBefore20H1 {
		_ = dwmSetAttribute(hwnd, dwmwaUseImmersiveDarkModeBefore20H1, value)
	}
}

func forceCaptionRedraw(hwnd uintptr) {
	flags := uintptr(swpNosize | swpNomove | swpNozorder | swpNoactivate | swpFramechanged)
	_, _, _ = user32SetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, flags)
}

func findMainWindowHWND() uintptr {
	title, err := windows.UTF16PtrFromString("Gluestick Desktop")
	if err != nil {
		return 0
	}
	hwnd, _, _ := user32FindWindow.Call(0, uintptr(unsafe.Pointer(title)))
	return hwnd
}

func dwmSetAttribute(hwnd uintptr, attr int32, color uint32) error {
	ret, _, callErr := procDwmSetWindowAttribute.Call(
		hwnd,
		uintptr(attr),
		uintptr(unsafe.Pointer(&color)),
		unsafe.Sizeof(color),
	)
	if ret != 0 {
		if callErr != nil {
			return fmt.Errorf("DwmSetWindowAttribute(%d): %w", attr, callErr)
		}
		return fmt.Errorf("DwmSetWindowAttribute(%d) failed: %d", attr, ret)
	}
	return nil
}

func windowsBuildNumber() uint32 {
	_, _, build := windows.RtlGetNtVersionNumbers()
	return build
}

func supportsCaptionColors() bool {
	return captionColorsSupported(windowsBuildNumber())
}

func captionColorsSupported(build uint32) bool {
	return build >= windows11MinBuild
}

// isLightHex reports whether a CSS hex color is light (WCAG relative luminance > 0.5).
func isLightHex(hex string) bool {
	c, err := hexToCOLORREF(hex)
	if err != nil {
		return false
	}
	r := float64(c&0xff) / 255
	g := float64((c>>8)&0xff) / 255
	b := float64((c>>16)&0xff) / 255
	return 0.2126*linearize(r)+0.7152*linearize(g)+0.0722*linearize(b) > 0.5
}

func linearize(s float64) float64 {
	if s <= 0.03928 {
		return s / 12.92
	}
	return math.Pow((s+0.055)/1.055, 2.4)
}

// hexToCOLORREF converts #RRGGBB to a Windows COLORREF (0x00BBGGRR).
func hexToCOLORREF(hex string) (uint32, error) {
	s := strings.TrimSpace(hex)
	s = strings.TrimPrefix(s, "#")
	if len(s) == 3 {
		s = string([]byte{s[0], s[0], s[1], s[1], s[2], s[2]})
	}
	if len(s) != 6 {
		return 0, fmt.Errorf("invalid hex color %q", hex)
	}
	n, err := strconv.ParseUint(s, 16, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid hex color %q: %w", hex, err)
	}
	r := uint32((n >> 16) & 0xff)
	g := uint32((n >> 8) & 0xff)
	b := uint32(n & 0xff)
	return b<<16 | g<<8 | r, nil
}
