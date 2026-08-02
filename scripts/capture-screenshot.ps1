# Take one documentation screenshot from the running app.
#
#   pwsh scripts/capture-screenshot.ps1 -Doc <file> -Out <out.bmp> [-Width 1000] [-Height 799]
#
# Writes a BMP, because Windows can save one with no encoder of its own. Turn it
# into the PNG that ships with `just squeeze-png <out.bmp> <out.png>` — the same
# encoder the flowchart export uses, so there is only ever one of them.
#
# Five things here each cost a wrong screenshot before they were known:
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
#  5. PrintWindow does not draw the pointer, but it does draw what the pointer is
#     over. So a hover state photographs; the cursor arrow never appears in the
#     shot, and an alt text that promises one is promising a thing this cannot do.
#
# The app resolves its config and data roots from %APPDATA% and %LOCALAPPDATA%
# (`project_config_dir`), so the shot runs against a throwaway profile under
# -Work rather than the owner's. Nothing here reads or writes the real settings,
# recent files, or vault registry — a screenshot is not worth risking them, and
# an earlier version that swapped the owner's settings out and back lost them to
# any kill that beat its restore.

param(
  # Empty opens the no-file home screen.
  [string]$Doc = '',
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Width = 1000,
  [int]$Height = 799,
  [string]$ThemeFamily = 'fern',
  [string]$ThemeMode = 'light',
  [switch]$LibraryOpen,
  # Lift the padlocks. Off by default so the set matches the app's own default;
  # a picture of typing in the page or the source needs them.
  [switch]$Unlocked,
  # Folders to register as vaults. The library's search box and vault switcher
  # only exist once there is one, so a picture of either needs this.
  [string[]]$Vault = @(),
  # Files to seed the home screen's recent list with, newest first.
  [string[]]$Recents = @(),
  # Pointer and keyboard steps run after the page settles and before the shot.
  # Coordinates are pixels in the captured image, which is what you can measure
  # off the last screenshot you took at the same size:
  #   move:X,Y   click:X,Y   rclick:X,Y   drag:X1,Y1,X2,Y2
  #   hold:X1,Y1,X2,Y2 — a drag left mid-gesture, button still down at the shot
  #   scroll:X,Y,NOTCHES (negative scrolls down)
  #   type:text  key:{ESC}   wait:MS
  [string[]]$Do = @(),
  # "X,Y,W,H" in those same image pixels. Detail shots (the app bar, a popup)
  # ship cropped; a whole window around a 200 px control shows the window.
  [string]$Crop = '',
  [int]$SettleMs = 8000,
  # How long to let the page react to each -Do step before the next one.
  [int]$StepMs = 900,
  [string]$Exe,
  [string]$Work
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

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
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@

# See note 2.
[void][LeafShot]::SetProcessDPIAware()

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
if (-not $Exe) { $Exe = Join-Path $root 'target\debug\leaftext.exe' }
if (-not (Test-Path $Exe)) { throw "no binary at $Exe - run 'cargo build' first" }
if (-not $Work) { $Work = Join-Path ([System.IO.Path]::GetTempPath()) "leaftext-shot" }

$appdata = Join-Path $Work 'roaming'
$local = Join-Path $Work 'local'
$config = Join-Path $appdata 'ryanallen\leaftext\config'
New-Item -ItemType Directory -Force -Path $config | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $local 'ryanallen\leaftext\data') | Out-Null

# See notes 3 and 4: the window size and the theme both come from here.
$shot = [ordered]@{
  minimap_enabled      = $true
  pager_enabled        = $true
  speed_reader_enabled = $false
  code_intel_enabled   = $true
  reading_unlocked     = [bool]$Unlocked
  code_unlocked        = [bool]$Unlocked
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
($shot | ConvertTo-Json -Depth 5) | Out-File -FilePath (Join-Path $config 'settings.json') -Encoding utf8

# The home screen reads this file, so a picture of it shows whatever is in here
# — which is why the shot profile seeds its own instead of borrowing the owner's
# list of wherever they have been working. Written on every run, empty when none
# were asked for: the app appends to it as it opens files, so a profile reused
# across a batch would otherwise carry the last shot's document into this one.
(@{ files = @($Recents) } | ConvertTo-Json -Depth 3) |
  Out-File -FilePath (Join-Path $config 'recent-files.json') -Encoding utf8

function Stop-Leaftext {
  # The app is single-instance: launched while one is already up, the second copy
  # hands the file to the first and exits, leaving no window to photograph — and
  # the running copy has the owner's theme and window size, not the ones set here.
  Get-Process leaftext -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 500
}

$env:APPDATA = $appdata
$env:LOCALAPPDATA = $local
$manifest = Join-Path $local 'ryanallen\leaftext\data\manifest.db'

# A vault is a row in manifest.db and nothing else (src/store/vaults.rs), so the
# shot profile can hand the app one without going near the owner's registry. The
# app owns that database and its migrations, so let it build one before writing
# to it — a schema written here would be the second copy of the real one.
if ($Vault.Count) {
  if (-not (Test-Path $manifest)) {
    Stop-Leaftext
    $warm = Start-Process -FilePath $Exe -PassThru
    for ($i = 0; $i -lt 60 -and -not (Test-Path $manifest); $i++) { Start-Sleep -Milliseconds 250 }
    if (-not $warm.HasExited) { Stop-Process -Id $warm.Id -Force }
    Start-Sleep -Milliseconds 500
    if (-not (Test-Path $manifest)) { throw 'the app never wrote a manifest.db' }
  }
  node (Join-Path $root 'scripts\shot-add-vault.mjs') $manifest @Vault | Out-Null
}

function Step-Pointer([string]$step, [int]$left, [int]$top) {
  $kind, $arg = $step -split ':', 2
  switch ($kind) {
    'wait' { Start-Sleep -Milliseconds ([int]$arg); return }
    'type' { [System.Windows.Forms.SendKeys]::SendWait($arg); return }
    'key' { [System.Windows.Forms.SendKeys]::SendWait($arg); return }
  }
  $n = $arg -split ',' | ForEach-Object { [int]$_ }
  switch ($kind) {
    'move' { [void][LeafShot]::SetCursorPos($left + $n[0], $top + $n[1]) }
    'click' {
      [void][LeafShot]::SetCursorPos($left + $n[0], $top + $n[1])
      Start-Sleep -Milliseconds 120
      [LeafShot]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      [LeafShot]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    }
    'rclick' {
      [void][LeafShot]::SetCursorPos($left + $n[0], $top + $n[1])
      Start-Sleep -Milliseconds 120
      [LeafShot]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
      [LeafShot]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
    }
    'scroll' {
      [void][LeafShot]::SetCursorPos($left + $n[0], $top + $n[1])
      Start-Sleep -Milliseconds 120
      # One notch at a time: the reader re-pins itself to its scroll anchor
      # between events, and a single huge delta lands somewhere else entirely.
      # WHEEL_DELTA is signed but the parameter is not, so a scroll down goes in
      # as its two's complement rather than as a negative number.
      $delta = if ($n[2] -lt 0) { [uint32](4294967296 - 120) } else { [uint32]120 }
      foreach ($t in 1..([Math]::Abs($n[2]))) {
        [LeafShot]::mouse_event(0x0800, 0, 0, $delta, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 60
      }
    }
    { $_ -in 'drag', 'hold' } {
      # In steps, not one jump: a selection follows mousemove events, and a
      # press-and-teleport-and-release selects nothing at all.
      [void][LeafShot]::SetCursorPos($left + $n[0], $top + $n[1])
      Start-Sleep -Milliseconds 120
      [LeafShot]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      foreach ($t in 1..12) {
        [void][LeafShot]::SetCursorPos(
          $left + $n[0] + [int](($n[2] - $n[0]) * $t / 12),
          $top + $n[1] + [int](($n[3] - $n[1]) * $t / 12))
        Start-Sleep -Milliseconds 25
      }
      # `hold` leaves the button down, so the shot catches the gesture in
      # flight. The finally block below releases it whatever happens; a stuck
      # left button outlives this script and takes the desktop with it.
      if ($kind -eq 'drag') { [LeafShot]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }
      else { $script:buttonDown = $true }
    }
    default { throw "unknown -Do step: $step" }
  }
}

$proc = $null
$buttonDown = $false
try {
  Stop-Leaftext

  $launch = @{ FilePath = $Exe; PassThru = $true }
  # Quoted: a folder with a space in it would otherwise reach the app as two
  # arguments, and it opens the home screen instead of the file you asked for.
  if ($Doc) { $launch.ArgumentList = @("`"$Doc`"") }
  $proc = Start-Process @launch
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

  foreach ($step in $Do) {
    Step-Pointer $step $rect.Left $rect.Top
    Start-Sleep -Milliseconds $StepMs
  }

  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $gfx.GetHdc()
  $drawn = [LeafShot]::PrintWindow($hwnd, $hdc, 2) # PW_RENDERFULLCONTENT, note 1
  $gfx.ReleaseHdc($hdc)
  # A transparent middle pixel means the webview never rendered into the DC. The
  # screen is the fallback, not a choice: GetWindowRect spans the invisible
  # resize border, so a screen copy takes a strip of whatever is behind with it.
  if (-not $drawn -or $bmp.GetPixel([int]($w / 2), [int]($h / 2)).A -eq 0) {
    Write-Output 'PrintWindow came back empty; copying from the screen instead'
    $gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
  }
  $gfx.Dispose()

  if ($Crop) {
    $c = $Crop -split ',' | ForEach-Object { [int]$_ }
    $box = New-Object System.Drawing.Rectangle $c[0], $c[1], $c[2], $c[3]
    $cut = $bmp.Clone($box, $bmp.PixelFormat)
    $bmp.Dispose()
    $bmp = $cut
    $w = $c[2]; $h = $c[3]
  }

  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose()
  Write-Output "${w}x${h} -> $Out"
}
finally {
  if ($buttonDown) { [LeafShot]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
}
