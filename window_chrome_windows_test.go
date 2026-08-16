//go:build windows

package main

import "testing"

func TestHexToCOLORREF(t *testing.T) {
	got, err := hexToCOLORREF("#1e2a4a")
	if err != nil {
		t.Fatal(err)
	}
	// COLORREF is 0x00BBGGRR → B=0x4a, G=0x2a, R=0x1e
	want := uint32(0x4a2a1e)
	if got != want {
		t.Fatalf("hexToCOLORREF(#1e2a4a) = 0x%06x, want 0x%06x", got, want)
	}

	got, err = hexToCOLORREF("fff")
	if err != nil {
		t.Fatal(err)
	}
	if got != 0x00ffffff {
		t.Fatalf("hexToCOLORREF(fff) = 0x%06x, want 0xffffff", got)
	}
}

func TestIsLightHex(t *testing.T) {
	if !isLightHex("#ffffff") {
		t.Fatal("white should be light")
	}
	if !isLightHex("#f1f5f9") {
		t.Fatal("light theme bg-primary should be light")
	}
	if isLightHex("#1e2a4a") {
		t.Fatal("default dark title bar should not be light")
	}
	if isLightHex("#0d1117") {
		t.Fatal("midnight bg should not be light")
	}
	if isLightHex("not-a-color") {
		t.Fatal("invalid hex should not be treated as light")
	}
}

func TestCaptionColorsSupported(t *testing.T) {
	if captionColorsSupported(19045) {
		t.Fatal("Windows 10 22H2 must not report caption-color support")
	}
	if captionColorsSupported(21999) {
		t.Fatal("pre-Windows 11 builds must not report caption-color support")
	}
	if !captionColorsSupported(22000) {
		t.Fatal("Windows 11 22000 must support caption colors")
	}
	if !captionColorsSupported(26200) {
		t.Fatal("current Windows 11 builds must support caption colors")
	}
}
