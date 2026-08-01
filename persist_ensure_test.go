package main

import "testing"

func TestPersistPathLooksLikeFile(t *testing.T) {
	cases := []struct {
		path string
		file bool
	}{
		{"nativeLang.xml", true},
		{"options.vnc", true},
		{"plugins", false},
		{`TorBrowser\Data\Browser\profile.default`, false},
		{`TorBrowser\Data\Tor`, false},
		{"config.ini", true},
	}
	for _, tc := range cases {
		if got := persistPathLooksLikeFile(tc.path); got != tc.file {
			t.Fatalf("%s: got %v want %v", tc.path, got, tc.file)
		}
	}
}
