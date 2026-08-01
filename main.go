package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	if !acquireSingleInstance() {
		return
	}

	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "Gluestick Desktop",
		Width:     1200,
		Height:    800,
		MinWidth:  900,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Debug: options.Debug{
			OpenInspectorOnStartup: false,
		},
		BackgroundColour: &options.RGBA{R: 26, G: 26, B: 46, A: 255},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []any{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			DisableWindowIcon:    false,
			// Theme + per-theme caption colors are applied from the frontend via
			// WindowSetLight/DarkTheme and SetWindowChromeColors. Avoid CustomTheme
			// here — it would reset caption colors on every window activate.
			Theme: windows.Dark,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
