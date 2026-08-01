//go:build windows

package main

import (
	"fmt"
	"strconv"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	dwmwaBorderColor  = 34
	dwmwaCaptionColor = 35
	dwmwaTextColor    = 36
)

var (
	dwmapi                      = windows.NewLazySystemDLL("dwmapi.dll")
	procDwmSetWindowAttribute   = dwmapi.NewProc("DwmSetWindowAttribute")
	user32FindWindow            = windows.NewLazySystemDLL("user32.dll").NewProc("FindWindowW")
)

// SetWindowChromeColors paints the native Windows title bar / border to match the UI theme.
// Colors are CSS hex (#RRGGBB or RRGGBB). Empty values are skipped.
func (a *App) SetWindowChromeColors(titleBar, titleText, border string) error {
	hwnd := findMainWindowHWND()
	if hwnd == 0 {
		return fmt.Errorf("main window not found")
	}

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
