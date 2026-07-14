#Requires -Version 5.1
<#
.SYNOPSIS
  Build the Gluestick Desktop NSIS installer for Windows amd64 and/or arm64.

.DESCRIPTION
  Wraps the wails build output (gluestick.exe + shim.exe) into a single-file
  NSIS installer. Unlike the CLI installer it does not download runtime
  dependencies: the desktop app provisions ~/.glue and its tools on first run.

.EXAMPLE
  .\build-installer.ps1
  .\build-installer.ps1 -Version 0.1.4
  .\build-installer.ps1 -Arch amd64 -GluestickExe ..\build\bin\gluestick.exe -ShimExe ..\build\bin\shim.exe
#>
param(
    [ValidateSet('amd64', 'arm64')]
    [string[]]$Arch = @('amd64'),

    [string]$Version = '',
    [string]$GluestickExe = '',
    [string]$ShimExe = '',
    [switch]$SkipSha256
)

$ErrorActionPreference = 'Stop'

$installerDir = $PSScriptRoot
$repoRoot = Split-Path $installerDir -Parent

function Get-DefaultVersion {
    $wailsJson = Join-Path $repoRoot 'wails.json'
    if (Test-Path -LiteralPath $wailsJson) {
        try {
            $info = (Get-Content -LiteralPath $wailsJson -Raw | ConvertFrom-Json).info
            if ($info -and $info.productVersion) { return [string]$info.productVersion }
        } catch { }
    }
    return '0.0.0-dev'
}

function Find-Makensis {
    $candidates = @(
        "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
        "$env:ProgramFiles\NSIS\makensis.exe",
        "${env:ProgramFiles(x86)}\NSIS\Bin\makensis.exe"
    )
    foreach ($path in $candidates) {
        if (Test-Path -LiteralPath $path) { return $path }
    }
    throw @"
NSIS not found. Install it first, for example:
  choco install nsis -y
"@
}

function Resolve-Binary {
    param(
        [string]$Override,
        [string]$TargetArch,
        [string]$FileName
    )
    if ($Override) {
        if (-not (Test-Path -LiteralPath $Override)) {
            throw "$FileName not found: $Override"
        }
        return (Resolve-Path -LiteralPath $Override).Path
    }
    $candidates = @(
        (Join-Path $repoRoot "dist\gluestick-windows-$TargetArch\$FileName"),
        (Join-Path $repoRoot "build\bin\$FileName")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "$FileName not found for $TargetArch. Build first (build.ps1) or pass an explicit path."
}

function Prepare-Payload {
    param(
        [string]$TargetArch,
        [string]$GluestickPath,
        [string]$ShimPath
    )
    $outputDir = Join-Path $installerDir "payload\$TargetArch"
    if (Test-Path -LiteralPath $outputDir) {
        Remove-Item -LiteralPath $outputDir -Recurse -Force
    }
    $null = New-Item -ItemType Directory -Force -Path $outputDir
    Copy-Item -LiteralPath $GluestickPath -Destination (Join-Path $outputDir 'gluestick.exe') -Force
    Copy-Item -LiteralPath $ShimPath -Destination (Join-Path $outputDir 'shim.exe') -Force
    Write-Host "Payload ready: $outputDir"
}

function Build-InstallerForArch {
    param(
        [string]$TargetArch,
        [string]$Ver,
        [string]$Makensis,
        [string]$GluestickOverride,
        [string]$ShimOverride,
        [switch]$SkipHash
    )

    $gluestickPath = Resolve-Binary -Override $GluestickOverride -TargetArch $TargetArch -FileName 'gluestick.exe'
    $shimPath = Resolve-Binary -Override $ShimOverride -TargetArch $TargetArch -FileName 'shim.exe'

    Write-Host "Preparing payload ($TargetArch)..." -ForegroundColor Cyan
    Prepare-Payload -TargetArch $TargetArch -GluestickPath $gluestickPath -ShimPath $shimPath

    $outputDir = Join-Path $installerDir 'output'
    $null = New-Item -ItemType Directory -Force -Path $outputDir
    $setupName = "GluestickDesktopSetup-$TargetArch.exe"
    $setupPath = Join-Path $outputDir $setupName

    Write-Host "Compiling $setupName (version $Ver)..." -ForegroundColor Cyan
    Push-Location $installerDir
    try {
        & $Makensis "/DPAYLOAD_VERSION=$Ver" "/DPAYLOAD_ARCH=$TargetArch" "GluestickDesktop.nsi"
        if ($LASTEXITCODE -ne 0) { throw "makensis failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }

    if (-not (Test-Path -LiteralPath $setupPath)) {
        throw "Installer not produced: $setupPath"
    }

    if (-not $SkipHash) {
        $hash = (Get-FileHash -LiteralPath $setupPath -Algorithm SHA256).Hash.ToLower()
        Set-Content -LiteralPath "$setupPath.sha256" -Value $hash -NoNewline
        Write-Host "SHA256: $hash" -ForegroundColor DarkGray
    }

    Write-Host "Built: $setupPath" -ForegroundColor Green
    return $setupPath
}

if (-not $Version) {
    $Version = Get-DefaultVersion
}

$makensis = Find-Makensis
$built = @()
$singleArch = ($Arch.Count -eq 1)
foreach ($targetArch in $Arch) {
    if (-not $singleArch) {
        Write-Host ""
        Write-Host "=== $targetArch ===" -ForegroundColor Cyan
    }
    $built += Build-InstallerForArch `
        -TargetArch $targetArch `
        -Ver $Version `
        -Makensis $makensis `
        -GluestickOverride $(if ($singleArch) { $GluestickExe } else { '' }) `
        -ShimOverride $(if ($singleArch) { $ShimExe } else { '' }) `
        -SkipHash:$SkipSha256
}

Write-Host ""
Write-Host ("Done. {0} installer(s):" -f $built.Count) -ForegroundColor Green
$built | ForEach-Object { Write-Host "  $_" }
