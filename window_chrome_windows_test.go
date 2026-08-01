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
