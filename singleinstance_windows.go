//go:build windows

package main

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// Named mutex shared across processes. Kept open for the lifetime of the app;
// the OS releases it when the process exits.
const singleInstanceMutexName = `Local\GluestickDesktopSingleInstance`

var singleInstanceMutex windows.Handle

// acquireSingleInstance returns false when another instance already holds the mutex.
func acquireSingleInstance() bool {
	name, err := windows.UTF16PtrFromString(singleInstanceMutexName)
	if err != nil {
		return true
	}

	handle, err := windows.CreateMutex(nil, false, name)
	if err == windows.ERROR_ALREADY_EXISTS {
		if handle != 0 {
			_ = windows.CloseHandle(handle)
		}
		activateExistingWindow()
		return false
	}
	if err != nil {
		// Fail open: allow startup if mutex creation fails for other reasons.
		return true
	}

	singleInstanceMutex = handle
	return true
}

func activateExistingWindow() {
	user32 := windows.NewLazySystemDLL("user32.dll")
	findWindow := user32.NewProc("FindWindowW")
	showWindow := user32.NewProc("ShowWindow")
	setForeground := user32.NewProc("SetForegroundWindow")

	title, err := windows.UTF16PtrFromString("Gluestick Desktop")
	if err != nil {
		return
	}

	hwnd, _, _ := findWindow.Call(0, uintptr(unsafe.Pointer(title)))
	if hwnd == 0 {
		return
	}

	const swRestore = 9
	showWindow.Call(hwnd, swRestore)
	setForeground.Call(hwnd)
}
