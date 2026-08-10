#requires -Version 5.1
<#
.SYNOPSIS
    Build the two Windows release assets for leaftext: an MSI and an EXE
    installer.

.DESCRIPTION
    This reproduces the Windows release lane locally and in CI without any
    outside build service. It builds the release binary, packages an MSI from
    wix/main.wxs using cargo-wix (WiX Toolset v3), then builds the EXE installer
    from installer/ with that same binary inside it.

    Both produce the same install: same folder, same HKCU values, same single
    Start Menu entry, same file associations. The MSI is the download to take;
    the EXE is for a machine whose policy blocks Windows Installer packages,
    which refuses an MSI whoever signed it.

    Neither is code signed. Signing is a separate step that needs a
    certificate. See the status notes in the private workspace.

.PARAMETER Tag
    Release tag like v0.1.93. If omitted, it is read from .release-tag, and if
    that is missing it is derived from the version in Cargo.toml.

.PARAMETER OutDir
    Folder for the built asset. Default: dist.

.PARAMETER DryRun
    Print the resolved plan and exit without building or packaging.

.EXAMPLE
    pwsh scripts/build-windows-release.ps1 -Tag v0.1.93

.EXAMPLE
    pwsh scripts/build-windows-release.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [string]$Tag,
    [string]$OutDir = "dist",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-RepoRoot {
    $top = (& git rev-parse --show-toplevel).Trim()
    if (-not $top) { throw "Not inside a git repository." }
    return $top
}

function Get-CargoVersion([string]$cargoToml) {
    $line = Select-String -Path $cargoToml -Pattern '^\s*version\s*=\s*"([^"]+)"' |
        Select-Object -First 1
    if (-not $line) { throw "Could not find version in $cargoToml." }
    return $line.Matches[0].Groups[1].Value
}

$repoRoot = Get-RepoRoot
Set-Location $repoRoot

$cargoToml = Join-Path $repoRoot "Cargo.toml"
$version = Get-CargoVersion $cargoToml

if (-not $Tag) {
    $tagFile = Join-Path $repoRoot ".release-tag"
    if (Test-Path $tagFile) {
        $Tag = (Get-Content $tagFile -Raw).Trim()
    } else {
        $Tag = "v$version"
    }
}

# The MSI version must match the Cargo.toml version, so the tag without its
# leading v has to equal that version.
$tagVersion = $Tag.TrimStart("v")
if ($tagVersion -ne $version) {
    throw "Tag $Tag does not match Cargo.toml version $version."
}

$arch = "x86_64"
$dist = Join-Path $repoRoot $OutDir
$msiName = "leaftext-$Tag-windows-$arch.msi"
$setupName = "leaftext-$Tag-windows-$arch.exe"

$exePath = Join-Path $repoRoot "target\release\leaftext.exe"
$setupBuilt = Join-Path $repoRoot "target\release\leaftext-setup.exe"
$msiPath = Join-Path $dist $msiName
$setupPath = Join-Path $dist $setupName

Write-Host "Repo:        $repoRoot"
Write-Host "Version:     $version"
Write-Host "Tag:         $Tag"
Write-Host "Out folder:  $dist"
Write-Host "Assets:      $msiName, $setupName"

if ($DryRun) {
    Write-Host "Dry run: nothing built."
    return
}

# 1. Build the release binary for the host target (x86_64-pc-windows-msvc).
& cargo build --release --locked --bins
if ($LASTEXITCODE -ne 0) { throw "cargo build failed." }
if (-not (Test-Path $exePath)) { throw "Expected binary not found: $exePath" }

# 2. Make sure cargo-wix is available, then build the MSI from wix/main.wxs.
#    cargo-wix drives WiX v3 (candle and light), which is preinstalled on the
#    GitHub windows-latest runner.
& cargo wix --version *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing cargo-wix..."
    & cargo install cargo-wix --locked
    if ($LASTEXITCODE -ne 0) { throw "cargo install cargo-wix failed." }
}

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null

# -L passes -sice:ICE20 to light: that check demands an exit dialog, and the
# one-screen installer in wix/main.wxs deliberately has none.
& cargo wix --no-build --nocapture --package leaftext --output $msiPath -L "-sice:ICE20"
if ($LASTEXITCODE -ne 0) { throw "cargo wix failed." }
if (-not (Test-Path $msiPath)) { throw "MSI not produced: $msiPath" }

# 3. Build the EXE installer with that same binary inside it. LEAFTEXT_APP_EXE is
#    what its build script reads; without it the installer builds with no app in
#    it and refuses to install anything, so the size check below is what stops
#    an empty one ever being published.
$env:LEAFTEXT_APP_EXE = $exePath
& cargo build --release --locked --package leaftext-setup
if ($LASTEXITCODE -ne 0) { throw "cargo build of the EXE installer failed." }
if (-not (Test-Path $setupBuilt)) { throw "EXE installer not produced: $setupBuilt" }
Copy-Item $setupBuilt $setupPath -Force
$appSize = (Get-Item $exePath).Length
if ((Get-Item $setupPath).Length -lt ($appSize / 4)) {
    throw "The EXE installer is too small to be carrying the app; it built without a payload."
}

# 4. Verification: report version and list the built files. No secrets printed.
Write-Host ""
Write-Host "Built leaftext $version ($Tag). Assets in $dist :"
Get-ChildItem $dist -File | ForEach-Object {
    "{0,12:N0}  {1}" -f $_.Length, $_.Name | Write-Host
}
