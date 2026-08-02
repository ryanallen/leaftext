# Take one documentation screenshot from the running app.
#
#   pwsh scripts/capture-screenshot.ps1 -Doc <file> -Out <out.bmp> [-Width 1000] [-Height 799]
#
# Writes a BMP, because Windows can save one with no encoder of its own. Turn it
# into the PNG that ships with `just squeeze-png <out.bmp> <out.png>` — the same
# encoder the flowchart export uses, so there is only ever one of them.
#
# Four things here each cost a wrong screenshot before they were known:
#
#  1. PrintWindow needs PW_RENDERFULLCONTENT (flag 2). Without it the webview
#     area comes out blank, because it composites outside the window's DC.
#  2. This process must be DPI aware. Otherwise GetWindowRect answers in
#     virtualized coordinates, the bitmap is made too small, and the result is
#     the top-left crop of a larger render rather than the window.
#  3. The window has to open at the wanted size. Resizing it afterwards does not
#     reflow the webview, so the layout stays as created and the content clips.
#     The size goes through settings.json, in logical pixels.
#  4. The theme has to be pinned. `random` draws a different family per launch.
#
# settings.json and recent-files.json are the owner's: both are backed up before
# and restored after, whatever happens.

param(
  [Parameter(Mandatory = $true)][string]$Doc,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Width = 1000,
  [int]$Height = 799,
  [string]$ThemeFamily = 'fern',
  [string]$ThemeMode = 'light',
  [switch]$LibraryOpen,
  [int]$SettleMs = 8000,
  [string]$Exe
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class LeafShot {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@

# See note 2.
[void][LeafShot]::SetProcessDPIAware()

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
if (-not $Exe) { $Exe = Join-Path $root 'target\debug\leaftext.exe' }
if (-not (Test-Path $Exe)) { throw "no binary at $Exe - run 'cargo build' first" }

$config = Join-Path $env:APPDATA 'ryanallen\leaftext\config'
$settings = Join-Path $config 'settings.json'
$recents = Join-Path $config 'recent-files.json'
$saved = @{}
foreach ($file in @($settings, $recents)) {
  if (Test-Path $file) { $saved[$file] = Get-Content $file -Raw }
}

# See notes 3 and 4: the window size and the theme both come from here.
$shot = [ordered]@{
  minimap_enabled      = $true
  pager_enabled        = $true
  speed_reader_enabled = $false
  code_intel_enabled   = $false
  reading_unlocked     = $false
  code_unlocked        = $true
  theme_family         = $ThemeFamily
  theme_mode           = $ThemeMode
  theme_random_used    = @()
  graph_scope          = 'xl'
  library_closed       = (-not $LibraryOpen)
  library_width        = 240
  window_width         = $Width
  window_height        = $Height
  window_maximized     = $false
}

$proc = $null
try {
  # The app is single-instance: launched while one is already up, the second copy
  # hands the file to the first and exits, leaving no window to photograph — and
  # the running copy has the owner's theme and window size, not the ones set here.
  Get-Process leaftext -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 500

  New-Item -ItemType Directory -Force -Path $config | Out-Null
  ($shot | ConvertTo-Json -Depth 5) | Out-File -FilePath $settings -Encoding utf8

  $proc = Start-Process -FilePath $Exe -ArgumentList $Doc -PassThru
  $hwnd = [IntPtr]::Zero
  for ($i = 0; $i -lt 60; $i++) {
    $proc.Refresh()
    if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { $hwnd = $proc.MainWindowHandle; break }
    Start-Sleep -Milliseconds 250
  }
  if ($hwnd -eq [IntPtr]::Zero) { throw 'the window never appeared' }

  # Move only — SWP_NOSIZE. See note 3.
  [void][LeafShot]::ShowWindow($hwnd, 9)
  [void][LeafShot]::SetWindowPos($hwnd, [IntPtr]::Zero, 40, 40, 0, 0, 0x0041)
  [void][LeafShot]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds $SettleMs

  $rect = New-Object LeafShot+RECT
  [void][LeafShot]::GetWindowRect($hwnd, [ref]$rect)
  $w = $rect.Right - $rect.Left
  $h = $rect.Bottom - $rect.Top

  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $gfx.GetHdc()
  $drawn = [LeafShot]::PrintWindow($hwnd, $hdc, 2) # PW_RENDERFULLCONTENT, note 1
  $gfx.ReleaseHdc($hdc)
  # A transparent middle pixel means the webview never rendered into the DC; the
  # screen still has it, as long as the window is in front and unobstructed.
  if (-not $drawn -or $bmp.GetPixel([int]($w / 2), [int]($h / 2)).A -eq 0) {
    Write-Output 'PrintWindow came back empty; copying from the screen instead'
    $gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
  }
  $gfx.Dispose()
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose()
  Write-Output "${w}x${h} -> $Out"
}
finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  foreach ($file in $saved.Keys) { $saved[$file] | Out-File -FilePath $file -Encoding utf8 -NoNewline }
}
