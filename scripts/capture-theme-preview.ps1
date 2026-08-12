param(
  [Parameter(Mandatory = $true)][string]$Family,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Reference = (Join-Path $PSScriptRoot '..\..\docs\done\repo\theme-color-reference.md')
)

$root = Split-Path -Parent $PSScriptRoot
$theme = Join-Path $root "themes\$Family.md"
if (-not (Test-Path -LiteralPath $theme)) { throw "no theme family at $theme" }
if (-not (Test-Path -LiteralPath $Reference)) { throw "no reference document at $Reference" }
$title = ([System.IO.File]::ReadAllLines($theme, [System.Text.UTF8Encoding]::new($false)) | Where-Object { $_ -match '^# ' } | Select-Object -First 1) -replace '^# ', ''
if (-not $title) { throw "the theme family has no heading: $theme" }
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) "leaftext-theme-preview-$PID-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
  $document = Join-Path $scratch 'theme-color-reference.md'
  $text = [System.IO.File]::ReadAllText($Reference, [System.Text.UTF8Encoding]::new($false))
  $text = [regex]::Replace($text, '^# .*$', "# $title Leaftext Theme", [System.Text.RegularExpressions.RegexOptions]::Multiline)
  [System.IO.File]::WriteAllText($document, $text, [System.Text.UTF8Encoding]::new($false))
  $light = Join-Path $scratch 'light.png'
  $dark = Join-Path $scratch 'dark.png'
  & (Join-Path $PSScriptRoot 'capture-screenshot.ps1') -Doc $document -ThemeFamily $Family -ThemeMode light -Out $light
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & (Join-Path $PSScriptRoot 'capture-screenshot.ps1') -Doc $document -ThemeFamily $Family -ThemeMode dark -Out $dark
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  node (Join-Path $PSScriptRoot 'compose-shots.mjs') diagonal $Out $dark $light
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
