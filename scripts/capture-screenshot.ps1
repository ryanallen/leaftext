# Drive the app and photograph it. Two modes, and the difference is whose copy it is.
#
#   pwsh scripts/capture-screenshot.ps1 -Doc <file> -Out <out.bmp> [-Width 1000] [-Height 799]
#   pwsh scripts/capture-screenshot.ps1 -Attach -Do 'scroll:500,400,-8' -Out <out.png>
#   pwsh scripts/capture-screenshot.ps1 -DryRun -Do 'click:20,20' -Out <ignored>
#   pwsh scripts/capture-screenshot.ps1 -DismissBox 'Location is not available'
#
# `-DismissBox` takes no picture and no steps. It is the way past the refusal a second
# modal box earns: that one box, canceled by its exact title with Escape, said only once
# it has gone.
#
# Unattached is the documentation shot: it launches its own copy under an account
# name of its own, against a throwaway profile at a pinned size and theme,
# photographs it and asks it to close. That is what makes a picture reproducible,
# and the name is what lets it run while the owner keeps reading in their window.
#
# `-Attach` drives the copy that is already open — the owner's. It launches nothing,
# kills nothing, and writes no profile of any kind, so every flag that would have
# shaped one is refused rather than ignored. Use it to prove a change in the window:
# real wheel notches, real drags, real key presses, then a picture.
#
# Writes a BMP, because Windows can save one with no encoder of its own. An -Out
# ending .png goes on through the app's own `--squeeze-png` — the same encoder the
# flowchart export uses, so there is only ever one of them — which is the format
# that can be read back.
#
# Seven things here each cost a wrong screenshot before they were known:
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
#     Which is why the pointer is parked off the window before the -Do steps run:
#     otherwise a picture with no steps of its own photographs whatever the pointer
#     was left resting on, as a control that is simply there. A deliberate hover is
#     a `move:` step and is untouched by the park.
#  6. The picture is the client rectangle, which is not GetWindowRect. That spans
#     the invisible resize border — 11 px down the left, right and bottom at this
#     machine's scaling — and PrintWindow renders nothing into it, so 24 of the 43
#     published pictures shipped with a black strip. DWMWA_EXTENDED_FRAME_BOUNDS
#     is not it either: measured against this window it stops 2 px short on each of
#     those sides and photographs 2 px of the same black. The client rectangle comes
#     out at exactly the -Width and -Height asked for.
#  7. The app is smaller than the client rectangle: it holds itself off the window
#     on all four sides so its own shadow has room, and PrintWindow renders nothing
#     into that band either — so the picture arrives with a second black frame
#     inside the first, about 30 px down the sides at this machine's scaling. Whole
#     rows and columns of pure #000000 are cut off here, which is the same signature
#     scripts/check-shot-edges.mjs refuses a published picture for; the app draws no
#     pure black anywhere. A throwaway shot goes first purely to measure that band,
#     because pointer steps are offset by it as well as by note 6's border — so a
#     coordinate goes on meaning a pixel in the picture, and -Crop is measured off
#     the app rather than off the window around it.
#
# An unattached shot runs against the throwaway profile in scripts/probe-profile.ps1
# — its own account name and its own config, data and home roots under -Work — so
# nothing here reads or writes the owner's settings, recent files or vault registry.
# A screenshot is not worth risking them, and an earlier version that swapped the
# owner's settings out and back lost them to any kill that beat its restore. That
# file is shared with scripts/probe-launch.ps1, which leaves its copy up instead of
# photographing it; what stays here is only what a shot builds from nothing on top
# of it — the settings, the recent list and the vault registry, all three written or
# removed every run, because a profile carrying the last shot's vaults photographs
# them.

param(
  # Empty opens the no-file home screen.
  [string]$Doc = '',
  # Where the picture goes. Every run that photographs needs one; a dismissal takes no picture and so takes no -Out.
  [string]$Out = '',
  [int]$Width = 1000,
  [int]$Height = 799,
  [string]$ThemeFamily = 'fern',
  [string]$ThemeMode = 'light',
  # How much of the link graph the graph view draws. A big vault at `xl` is a
  # hairball with no readable name in it.
  [ValidateSet('small', 'medium', 'large', 'xl')][string]$GraphScope = 'xl',
  [switch]$LibraryOpen,
  # Lift the padlocks. Off by default so the set matches the app's own default;
  # a picture of typing in the page or the source needs them.
  [switch]$Unlocked,
  # Folders to register as vaults. The library's search box and vault switcher
  # only exist once there is one, so a picture of either needs this.
  [string[]]$Vault = @(),
  # Files to seed the home screen's recent list with, newest first.
  [string[]]$Recents = @(),
  # Paths to seed the home screen's kept list with. Without one the screen draws
  # the plain recent list, so a picture of the pair needs this.
  [string[]]$Favorites = @(),
  # Pointer and keyboard steps run after the page settles and before the shot.
  # Coordinates are pixels in the captured image, which is what you can measure
  # off the last screenshot you took at the same size:
  #   move:X,Y   click:X,Y   rclick:X,Y   drag:X1,Y1,X2,Y2
  #   hold:X1,Y1,X2,Y2 — a drag left mid-gesture, button still down at the shot
  #   drag:X1,Y1,X2,Y2,MOVES,GAP  hold:X1,Y1,X2,Y2,MOVES,GAP — the same walk at a
  #     speed you name, so a fast gesture can be reproduced. Without them the walk
  #     is 12 moves 25 ms apart, which is about thirty a second
  #   scroll:X,Y,NOTCHES (negative scrolls down)
  #   type:text  key:{ESC}   wait:MS
  # Against a window standing on no monitor the pointer steps are played into the
  # page through the app's own gesture ask; type and key are refused there, and
  # `just ask eval` does keys.
  [string[]]$Do = @(),
  # The same steps as one string, separated by spaces. `just drive` passes them this
  # way through scripts/drive.mjs: a step has commas in it, and PowerShell splits an
  # unquoted comma into an array, so `scroll:600,500,-10` reaches -Do as three.
  [string]$Steps = '',
  # "X,Y,W,H" in those same image pixels. Detail shots (the app bar, a popup)
  # ship cropped; a whole window around a 200 px control shows the window.
  [string]$Crop = '',
  [int]$SettleMs = 8000,
  # How long to let the page react to each -Do step before the next one.
  [int]$StepMs = 900,
  # Drive the copy that is already running instead of launching one.
  [switch]$Attach,
  # Cancel one box standing over the window being driven, by the exact title the refusal
  # printed, and stop. Escape only and an exact title, so it can neither press a warning's
  # default button nor cancel a box that merely happened to be there.
  [string]$DismissBox = '',
  # Read the -Do list back and stop. Launches nothing, writes nothing, and never
  # reaches user32, so it runs in `just verify` on a machine with no app built.
  [switch]$DryRun,
  [string]$Exe,
  [string]$Work
)

$ErrorActionPreference = 'Stop'

# ---- what a -Do step means, before anything does it -------------------------

# The counts of numbers each pointer verb accepts. One table: `-DryRun` reads a step
# and Step-Pointer runs the same reading, so a verb cannot exist in one and not the
# other. A drag or a hold takes its four coordinates, or those plus how many moves to
# walk in and how many milliseconds apart, which is how a gesture is made at the speed
# a hand makes it rather than at the one the walk happens to run at.
$STEP_ARITY = @{ move = @(2); click = @(2); rclick = @(2); drag = @(4, 6); hold = @(4, 6); scroll = @(3) }

# What a drag or a hold walks when the step does not say.
$WALK_MOVES = 12
$WALK_GAP_MS = 25

# How a verb's accepted counts read in a refusal: "4 or 6".
function Say-Counts([string]$kind) { ($STEP_ARITY[$kind] | ForEach-Object { "$_" }) -join ' or ' }

function Read-Step([string]$step) {
  $kind, $arg = $step -split ':', 2
  if ($kind -in 'wait', 'type', 'key') {
    if ([string]::IsNullOrEmpty($arg)) { throw "$kind needs something after the colon: $step" }
    $said = switch ($kind) {
      'wait' { "wait $([int]$arg) ms" }
      'type' { "type $arg" }
      'key' { "press $arg" }
    }
    # Which route the step takes against a window standing on no monitor, carried here so the dry run reads the routing back without a window.
    $route = if ($kind -eq 'wait') { '' } else { ' (off screen: refused; eval does keys)' }
    return [pscustomobject]@{ Kind = $kind; Arg = $arg; Numbers = @(); Said = $said; OffScreen = $route }
  }
  if (-not $STEP_ARITY.ContainsKey($kind)) { throw "unknown -Do step: $step" }
  if ([string]::IsNullOrEmpty($arg)) { throw "$kind needs $(Say-Counts $kind) numbers after the colon: $step" }
  $n = @($arg -split ',' | ForEach-Object { [int]$_ })
  if ($STEP_ARITY[$kind] -notcontains $n.Count) {
    throw "$kind takes $(Say-Counts $kind) numbers and got $($n.Count): $step"
  }
  # A walk of no moves is a press and a teleport, and a gap of nothing is 125,000 moves
  # a second — past anything a mouse reports — so neither is a faster hand and both are
  # refused rather than walked.
  $moves = $WALK_MOVES
  $gap = $WALK_GAP_MS
  $paced = $n.Count -eq 6
  if ($paced) {
    $moves = $n[4]
    $gap = $n[5]
    if ($moves -lt 1) { throw "$kind needs at least one move and got $($moves): $step" }
    if ($gap -lt 1) { throw "$kind needs at least a millisecond between moves and got $($gap): $step" }
  }
  $walk = if ($paced) { " in $moves moves $gap ms apart" } else { '' }
  $said = switch ($kind) {
    'move' { "move to $($n[0]),$($n[1])" }
    'click' { "click at $($n[0]),$($n[1])" }
    'rclick' { "right-click at $($n[0]),$($n[1])" }
    'drag' { "drag from $($n[0]),$($n[1]) to $($n[2]),$($n[3])$walk" }
    'hold' { "drag from $($n[0]),$($n[1]) to $($n[2]),$($n[3])$walk and hold the button down, $(if ($paced) { 'photographed where the walk stops' } else { 'photographed after the settle' })" }
    'scroll' { "scroll $($n[2]) notches at $($n[0]),$($n[1])" }
  }
  return [pscustomobject]@{ Kind = $kind; Arg = $arg; Numbers = $n; Said = $said; Moves = $moves; GapMs = $gap; Paced = $paced; OffScreen = ' (off screen: played into the page through the gesture ask)' }
}

# Every flag that shapes the throwaway profile. An attached run is inspecting the
# app somebody else opened, so these are refused with the reason rather than
# quietly doing nothing — a silently ignored -ThemeFamily reads as a theme bug.
$PROFILE_FLAGS = @(
  'Doc', 'Vault', 'Recents', 'Favorites', 'Unlocked', 'ThemeFamily', 'ThemeMode',
  'Width', 'Height', 'GraphScope', 'LibraryOpen', 'Work'
)

if ($Attach) {
  $given = @($PROFILE_FLAGS | Where-Object { $PSBoundParameters.ContainsKey($_) })
  if ($given.Count) {
    $named = ($given | ForEach-Object { "-$_" }) -join ', '
    throw "-Attach drives the copy that is already open, so it cannot set $named. Drop them, or run without -Attach to launch a copy of your own."
  }
}

$asked = @($Do) + @($Steps.Split(@(' ', "`t"), [System.StringSplitOptions]::RemoveEmptyEntries))
$plan = @($asked | ForEach-Object { Read-Step $_ })

# The flag being present is the route, not the flag holding something: an empty title is a
# dismissal nobody named a box for, and refusing it here is what keeps this from falling
# through into a photograph of the window the box is standing over.
$dismissing = $PSBoundParameters.ContainsKey('DismissBox')
if ($dismissing) {
  if (-not $DismissBox) {
    throw 'a dismissal needs the exact title of the box to cancel, the one the refusal printed: just dismiss-box "Location is not available"'
  }
  if ($asked.Count) {
    throw 'a dismissal cancels one box and takes no steps; run the step list again once it is gone'
  }
}
elseif (-not $Out) {
  throw '-Out is where the picture goes, and every run but a dismissal takes one'
}

if ($DryRun) {
  if ($dismissing) {
    Write-Output "would cancel the box titled `"$DismissBox`" standing over the copy that is already open"
    Write-Output 'pressing Escape rather than a default button, and only while that exact title is the box that is there'
    return
  }
  $whose = if ($Attach) { 'the running copy' } else { 'a fresh copy' }
  Write-Output "$($plan.Count) steps against $whose"
  foreach ($step in $plan) { Write-Output "  $($step.Said)$($step.OffScreen)" }
  # Which rectangle a coordinate is in, and which one the picture is, said out loud: they are the same one, and getting that wrong is invisible until a click lands 11 px off.
  Write-Output 'photographing the client rectangle, not the invisible resize border around it'
  return
}

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class LeafShot {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr param);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  public delegate bool EnumProc(IntPtr h, IntPtr param);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  // The title of a visible window of this process owned by the one being driven, or null.
  public static string BoxOver(IntPtr owner, int processId) {
    IntPtr box = BoxWindowOver(owner, processId);
    return box == IntPtr.Zero ? null : TitleOf(box);
  }
  // The same window as a handle, which is what canceling one needs: something to bring forward, and something to watch go away. GW_OWNER is 4. Enumerated rather than asked for: a dialog is not reachable from its owner, only the other way round.
  public static IntPtr BoxWindowOver(IntPtr owner, int processId) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr ignored) {
      if (h == owner || !IsWindowVisible(h) || GetWindow(h, 4) != owner) return true;
      int pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid != processId) return true;
      found = h;
      return false;
    }, IntPtr.Zero);
    return found;
  }
  public static string TitleOf(IntPtr h) {
    var title = new System.Text.StringBuilder(512);
    GetWindowText(h, title, title.Capacity);
    return title.ToString();
  }
}
'@

# See note 2.
[void][LeafShot]::SetProcessDPIAware()

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# The throwaway profile, shared with scripts/probe-launch.ps1 so a shot and a probe cannot drift apart.
. (Join-Path $PSScriptRoot 'probe-profile.ps1')

# The rectangle the app draws into, in screen pixels. See note 6.
function Get-VisibleRect([IntPtr]$hwnd, $window) {
  $client = New-Object LeafShot+RECT
  $at = New-Object LeafShot+POINT
  if (-not [LeafShot]::GetClientRect($hwnd, [ref]$client) -or $client.Right -le 0 -or $client.Bottom -le 0) { return $window }
  if (-not [LeafShot]::ClientToScreen($hwnd, [ref]$at)) { return $window }
  $frame = New-Object LeafShot+RECT
  $frame.Left = $at.X
  $frame.Top = $at.Y
  $frame.Right = $at.X + $client.Right
  $frame.Bottom = $at.Y + $client.Bottom
  return $frame
}

# Whether a window stands where nobody can see it. A copy a build launched is started off every monitor, and the drawing call below needs neither focus nor a place on screen, so pulling one forward would move the keyboard off whatever the owner is typing in and buy the picture nothing.
function Test-OffEveryMonitor([IntPtr]$hwnd) {
  $at = New-Object LeafShot+RECT
  if (-not [LeafShot]::GetWindowRect($hwnd, [ref]$at)) { return $false }
  foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
    if ($screen.Bounds.Contains($at.Left, $at.Top)) { return $false }
  }
  return $true
}

# A box standing over the window about to be driven, by its title, or nothing. This is the one state the foreground reading cannot see: Windows lets a dialog's owner take the foreground while the dialog keeps the keyboard, so GetForegroundWindow, GetLastActivePopup and GetGUIThreadInfo all answer the owner and every key sent to it is swallowed and reported as made.
function Find-BoxOver([IntPtr]$hwnd, [int]$processId) {
  [LeafShot]::BoxOver($hwnd, $processId)
}

# The same box with its handle beside its title. Canceling one needs both: a handle to bring forward and to watch stop being a window, and the title to hold against the one the reader named.
function Find-BoxWindow([IntPtr]$hwnd, [int]$processId) {
  $handle = [LeafShot]::BoxWindowOver($hwnd, $processId)
  if ($handle -eq [IntPtr]::Zero) { return $null }
  return [pscustomobject]@{ Handle = $handle; Title = [LeafShot]::TitleOf($handle) }
}

function Take-Foreground([IntPtr]$hwnd, [int]$processId) {
  if (Test-OffEveryMonitor $hwnd) {
    Write-Output 'the window sits on no monitor, so it is photographed where it stands rather than pulled in front of whatever the owner is reading'
    return
  }
  [void][LeafShot]::SetForegroundWindow($hwnd)
  if ([LeafShot]::GetForegroundWindow() -eq $hwnd) { return }
  # Windows refuses the call from a process that is not already foreground, which a
  # script run from a terminal is not. AppActivate is the shell's own way in and gets
  # past it; the SetForegroundWindow above is what works when this is already in front.
  try { (New-Object -ComObject WScript.Shell).AppActivate($processId) | Out-Null } catch {}
  Start-Sleep -Milliseconds 200
  [void][LeafShot]::SetForegroundWindow($hwnd)
}

function Find-Attached {
  # One process name, one main window. The app is single-instance per copy, so two
  # windows means a second copy was launched against another profile.
  $copies = @(Get-Process leaftext -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero })
  if (-not $copies.Count) { throw 'no copy of the app is running, so there is no window to drive' }
  # A copy built from this checkout is the one this checkout meant. That is what
  # keeps two development copies apart, since each is built and run under its own
  # folder; with none of them here the answer is whatever is running, which is the
  # installed copy the owner reads.
  $ours = @($copies | Where-Object { $_.Path -and $_.Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) })
  if ($ours.Count -eq 1) { return $ours[0] }
  if ($ours.Count -gt 1) { throw "$($ours.Count) copies built from this checkout are running with a window; -Attach cannot tell which one you meant" }
  if ($copies.Count -gt 1) { throw "$($copies.Count) copies are running with a window and none was built from this checkout; -Attach cannot tell which one you meant" }
  return $copies[0]
}

# ---- canceling one box standing over the driven window ----------------------

# The only place here that sends a key at a window that is not the app's own, so every
# guard is about sending it at exactly the box the reader named. Escape alone, because a
# default button accepts the warning instead of backing out of it; and success is said
# only once that same box has gone, since saying it while the box is still up sends the
# build back into the wall it was leaving.
if ($dismissing) {
  $running = Find-Attached
  $hwnd = $running.MainWindowHandle
  $box = Find-BoxWindow $hwnd $running.Id
  if (-not $box) {
    throw "no box stands over the window being driven, so there is nothing to cancel; run the step list again"
  }
  if ($box.Title -ne $DismissBox) {
    throw "the box over the window being driven is titled `"$($box.Title)`", not `"$DismissBox`", so nothing was pressed"
  }
  # This box and no other, and only once Windows says it really is in front: a key sent while something else has focus goes into whatever the owner is typing in.
  [void][LeafShot]::SetForegroundWindow($box.Handle)
  if ([LeafShot]::GetForegroundWindow() -ne $box.Handle) {
    try { (New-Object -ComObject WScript.Shell).AppActivate($running.Id) | Out-Null } catch {}
    Start-Sleep -Milliseconds 200
    [void][LeafShot]::SetForegroundWindow($box.Handle)
  }
  if ([LeafShot]::GetForegroundWindow() -ne $box.Handle) {
    throw "Windows would not bring the box titled `"$DismissBox`" forward, so nothing was pressed; click it once and press Escape"
  }
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
  foreach ($t in 1..20) {
    Start-Sleep -Milliseconds 100
    if (-not [LeafShot]::IsWindow($box.Handle)) { break }
    $still = Find-BoxWindow $hwnd $running.Id
    if (-not $still -or $still.Handle -ne $box.Handle) { break }
  }
  $still = if ([LeafShot]::IsWindow($box.Handle)) { Find-BoxWindow $hwnd $running.Id } else { $null }
  if ($still -and $still.Handle -eq $box.Handle) {
    throw "Escape went to the box titled `"$DismissBox`" and it is still there, so the window is still not drivable"
  }
  Write-Output "canceled the box titled `"$DismissBox`"; run the step list again"
  return
}

if ($Attach) {
  $running = Find-Attached
  if (-not $Exe) { $Exe = $running.Path }
  if (-not $Exe) { $Exe = Join-Path $root 'target\debug\leaftext.exe' }
  # A window that has been up for minutes is settled. The eight seconds are for a
  # launch, and paying them per gesture is most of what drove this by hand slowly.
  if (-not $PSBoundParameters.ContainsKey('SettleMs')) { $SettleMs = 300 }
}
else {
  if (-not $Exe) { $Exe = Join-Path $root 'target\debug\leaftext.exe' }
  if (-not (Test-Path $Exe)) { throw "no binary at $Exe - run 'cargo build' first" }
  if (-not $Work) { $Work = Join-Path ([System.IO.Path]::GetTempPath()) "leaftext-shot" }

  # Unique per run: a copy that wedges is then holding a name no later run goes looking for. A probe copy is named the other way round, off its work folder, because a second command has to address it.
  $shotProfile = Enter-LeafProfile -Work $Work -Name "leaftext-shot-$PID"
  $shotEnvBefore = $shotProfile.Before
  $local = $shotProfile.Local
  $config = $shotProfile.Config

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
    graph_scope          = $GraphScope
    library_closed       = (-not $LibraryOpen)
    library_width        = 240
    window_width         = $Width
    window_height        = $Height
    window_maximized     = $false
    # The first-run bubble, off. The profile is new every run, so without this every
    # picture with the library open carries one floating over the control it points
    # at — a thing the app shows once per install and no picture here is of. These
    # two numbers say a bubble showed on the last launch, which is the app's own
    # rule for a quiet one; a list of hint names would be a second copy of the list
    # in src/assets/shell/hints.js and would drift from it.
    hint_launches        = 1
    hint_last_launch     = 1
  }
  ($shot | ConvertTo-Json -Depth 5) | Out-File -FilePath (Join-Path $config 'settings.json') -Encoding utf8

  # The home screen reads this file, so a picture of it shows whatever is in here
  # — which is why the shot profile seeds its own instead of borrowing the owner's
  # list of wherever they have been working. Written on every run, empty when none
  # were asked for: the app appends to it as it opens files, so a profile reused
  # across a batch would otherwise carry the last shot's document into this one.
  # Kept paths ride the same file. No vault id: a shot registers its vaults from
  # nothing, so a kept path belongs to the group for those outside every vault.
  $kept = @($Favorites | ForEach-Object {
      @{
        vaultId = $null
        path    = $_
        kind    = if (Test-Path -LiteralPath $_ -PathType Container) { 'folder' } else { 'document' }
      }
    })
  (@{ files = @($Recents); favorites = $kept } | ConvertTo-Json -Depth 3) |
    Out-File -FilePath (Join-Path $config 'recent-files.json') -Encoding utf8

  # The vault registry, for the reason written above the recent list: a vault registered for one picture is still registered for the next, and the app registers cloud folders itself at every launch. Deleted rather than emptied — the app owns the schema and builds it.
  $manifest = $shotProfile.Manifest
  foreach ($stale in @($manifest, "$manifest-wal", "$manifest-shm")) {
    if (Test-Path $stale) { Remove-Item $stale -Force }
  }
}

function Stop-ShotCopy($proc) {
  # Closed by asking, the way the close button does it, and only ever the copy this
  # script launched. Nothing here reaches for a process by name: `Get-Process
  # leaftext` answers with the owner's window too. The quit goes down the ask pipe
  # named after the account name the profile block invented, so this copy hears it
  # and nothing else does.
  #
  # The backslashes are load-bearing: a bare double quote inside a single-quoted
  # argument reaches node stripped, and the wrapper wants JSON.
  #
  # LEAFTEXT_ASK_ACCOUNT_ONLY because the account name above is already the copy this means. Without it the wrapper follows the pointer file scripts/probe-copy.mjs keeps, and a shot taken while a probe copy is up would close the probe and leave its own copy on screen.
  if (-not $proc -or $proc.HasExited) { return }
  $env:LEAFTEXT_ASK_ACCOUNT_ONLY = '1'
  try {
    & node (Join-Path $root 'scripts\mcp-leaftext.mjs') --ask '{\"ask\":\"quit\"}' | Out-Null
  }
  finally {
    $env:LEAFTEXT_ASK_ACCOUNT_ONLY = $null
  }
  if (-not $proc.WaitForExit(10000)) {
    Write-Warning "the shot copy would not close when asked; it is still running as pid $($proc.Id) under the name $env:USERNAME, which nothing else looks for"
  }
}

# A vault is a row in manifest.db and nothing else (src/store/vaults.rs), so the
# shot profile can hand the app one without going near the owner's registry. The
# app owns that database and its migrations, so let it build one before writing
# to it — a schema written here would be the second copy of the real one. The
# profile setup above deleted any earlier one, so this is always a fresh database.
if (-not $Attach -and $Vault.Count) {
  if (-not (Test-Path $manifest)) {
    $warm = Start-Process -FilePath $Exe -PassThru
    for ($i = 0; $i -lt 60 -and -not (Test-Path $manifest); $i++) { Start-Sleep -Milliseconds 250 }
    Stop-ShotCopy $warm
    if (-not (Test-Path $manifest)) { throw 'the app never wrote a manifest.db' }
  }
  node (Join-Path $root 'scripts\shot-add-vault.mjs') $manifest @Vault | Out-Null
}

# Off the window, before any step runs. See note 5. Tried in order and the first
# one on screen wins; a window filling the whole screen has nowhere off it, and the
# virtual screen's bottom-left corner is the nearest thing to outside there.
function Park-Pointer($rect) {
  $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $midY = [int](($rect.Top + $rect.Bottom) / 2)
  $midX = [int](($rect.Left + $rect.Right) / 2)
  # Each pair parenthesized: a comma binds tighter than the arithmetic around it here, so `$rect.Left - 24, $midY` is read as one subtraction against a two-element list.
  $spots = @(
    @(($rect.Left - 24), $midY),
    @(($rect.Right + 24), $midY),
    @($midX, ($rect.Top - 24)),
    @($midX, ($rect.Bottom + 24)),
    @(($screen.Left + 1), ($screen.Bottom - 1))
  )
  foreach ($spot in $spots) {
    $x = $spot[0]
    $y = $spot[1]
    if ($x -lt $screen.Left -or $x -ge $screen.Right -or $y -lt $screen.Top -or $y -ge $screen.Bottom) { continue }
    [void][LeafShot]::SetCursorPos($x, $y)
    return
  }
}

# One PrintWindow into a bitmap of the whole window rectangle, with the resize
# border cut back off. See notes 1 and 6.
function Capture-Window([IntPtr]$hwnd, $rect, $vis) {
  $ww = $rect.Right - $rect.Left
  $wh = $rect.Bottom - $rect.Top
  $offX = $vis.Left - $rect.Left
  $offY = $vis.Top - $rect.Top
  $w = $vis.Right - $vis.Left
  $h = $vis.Bottom - $vis.Top
  $bmp = New-Object System.Drawing.Bitmap $ww, $wh
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $gfx.GetHdc()
  $drawn = [LeafShot]::PrintWindow($hwnd, $hdc, 2) # PW_RENDERFULLCONTENT, note 1
  $gfx.ReleaseHdc($hdc)
  # A transparent middle pixel means the webview never rendered into the DC, and
  # the screen is the fallback. It copies the visible frame into the same place
  # the crop below takes it from, so it takes no strip of the desktop with it.
  if (-not $drawn -or $bmp.GetPixel([int]($ww / 2), [int]($wh / 2)).A -eq 0) {
    # Said out of band on purpose: this function returns the bitmap, so a Write-Output here joins it and the caller binds an array where a picture was expected.
    Write-Host 'PrintWindow came back empty; copying from the screen instead'
    $gfx.CopyFromScreen($vis.Left, $vis.Top, $offX, $offY, (New-Object System.Drawing.Size $w, $h))
  }
  $gfx.Dispose()
  if ($w -eq $ww -and $h -eq $wh) { return $bmp }
  $frame = $bmp.Clone((New-Object System.Drawing.Rectangle $offX, $offY, $w, $h), $bmp.PixelFormat)
  $bmp.Dispose()
  return $frame
}

# Where the app is inside the picture. See note 7.
function Measure-AppBox([System.Drawing.Bitmap]$bmp) {
  $w = $bmp.Width
  $h = $bmp.Height
  $box = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $data = $bmp.LockBits($box, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $stride = $data.Stride
  $bmp.UnlockBits($data)
  # Blue, green and red all zero. Alpha is not looked at: PrintWindow leaves it zero where it drew nothing and the app's own pixels arrive opaque, but a screen copy carries neither.
  $rowIsBlack = {
    param($y)
    $at = $y * $stride
    for ($x = 0; $x -lt $w; $x++) {
      if ($bytes[$at] -ne 0 -or $bytes[$at + 1] -ne 0 -or $bytes[$at + 2] -ne 0) { return $false }
      $at += 4
    }
    return $true
  }
  $columnIsBlack = {
    param($x)
    $at = $x * 4
    for ($y = 0; $y -lt $h; $y++) {
      if ($bytes[$at] -ne 0 -or $bytes[$at + 1] -ne 0 -or $bytes[$at + 2] -ne 0) { return $false }
      $at += $stride
    }
    return $true
  }
  $top = 0
  while ($top -lt $h -and (& $rowIsBlack $top)) { $top++ }
  if ($top -eq $h) { return $box }
  $bottom = $h - 1
  while ($bottom -gt $top -and (& $rowIsBlack $bottom)) { $bottom-- }
  $left = 0
  while ($left -lt $w -and (& $columnIsBlack $left)) { $left++ }
  $right = $w - 1
  while ($right -gt $left -and (& $columnIsBlack $right)) { $right-- }
  return New-Object System.Drawing.Rectangle $left, $top, ($right - $left + 1), ($bottom - $top + 1)
}

# Wait by spinning on a stopwatch rather than sleeping. Measured on this machine:
# `Start-Sleep -Milliseconds 1` takes 15.65 and `-Milliseconds 8` takes 17.35, so the
# eight millisecond gap a hand's gesture needs cannot be slept for at all. A spin hit
# 2,000 ms for a 2,000 ms ask. It costs one core for the length of the gesture, paid on
# purpose: raising the system timer resolution instead would change the timing of the
# app being measured, and a driver that alters what it reads is worse than a slow one.
function Wait-Gap([int]$ms) {
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  while ($clock.Elapsed.TotalMilliseconds -lt $ms) { }
}

# One gesture ask down the copy's own pipe, through the wrapper that already knows which copy a build launched. The reply is read back so a refused gesture fails the run rather than reporting a step nobody made.
function Send-GestureAsk([hashtable]$gesture) {
  $json = $gesture | ConvertTo-Json -Compress
  # Windows PowerShell hands a native command its arguments without escaping the quotes inside them, so the JSON's own are escaped by hand or node reads {y:720,ask:gesture}.
  $arg = $json -replace '"', '\"'
  # The wrapper says which copy answered on its error stream, and under Stop this shell turns any stderr line into a thrown error — so that stream is dropped under Continue for the one call, and the exit code is what says whether the ask landed.
  $before = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $reply = & node (Join-Path $PSScriptRoot 'mcp-leaftext.mjs') --ask $arg 2>$null }
  finally { $ErrorActionPreference = $before }
  if ($LASTEXITCODE -ne 0 -or -not $reply) { throw "the copy did not answer the gesture ask $json" }
  $said = "$reply" | ConvertFrom-Json
  if (-not $said.ok) { throw "the gesture ask was refused: $($said.error)" }
}

# A pointer step against a window standing on no monitor, played into the page over the app's own gesture ask: no cursor, no focus and no place on screen. The coordinate sent is the picture's pixel plus the band the app holds itself off the window by, because the ask speaks in the client rectangle's pixels and the picture is the app's box inside it.
function Step-PointerAsk($step, [int]$appX, [int]$appY) {
  $n = $step.Numbers
  switch ($step.Kind) {
    'move' { Send-GestureAsk @{ ask = 'gesture'; kind = 'move'; x = $appX + $n[0]; y = $appY + $n[1] } }
    'click' { Send-GestureAsk @{ ask = 'gesture'; kind = 'click'; x = $appX + $n[0]; y = $appY + $n[1] } }
    'rclick' { Send-GestureAsk @{ ask = 'gesture'; kind = 'rclick'; x = $appX + $n[0]; y = $appY + $n[1] } }
    'scroll' { Send-GestureAsk @{ ask = 'gesture'; kind = 'wheel'; x = $appX + $n[0]; y = $appY + $n[1]; notches = $n[2] } }
    { $_ -in 'drag', 'hold' } {
      $gesture = @{ ask = 'gesture'; kind = $step.Kind; x1 = $appX + $n[0]; y1 = $appY + $n[1]; x2 = $appX + $n[2]; y2 = $appY + $n[3] }
      if ($step.Paced) { $gesture.moves = $step.Moves; $gesture.gap = $step.GapMs }
      Send-GestureAsk $gesture
      # The page's button stays down for the shot, and the finally block below releases it the same way it was pressed.
      if ($step.Kind -eq 'hold') { $script:heldAsk = @{ x = $appX + $n[2]; y = $appY + $n[3] } }
    }
  }
}

function Step-Pointer($step, [int]$left, [int]$top) {
  $n = $step.Numbers
  switch ($step.Kind) {
    'wait' { Start-Sleep -Milliseconds ([int]$step.Arg) }
    'type' { [System.Windows.Forms.SendKeys]::SendWait($step.Arg) }
    'key' { [System.Windows.Forms.SendKeys]::SendWait($step.Arg) }
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
      $moves = $step.Moves
      foreach ($t in 1..$moves) {
        [void][LeafShot]::SetCursorPos(
          $left + $n[0] + [int](($n[2] - $n[0]) * $t / $moves),
          $top + $n[1] + [int](($n[3] - $n[1]) * $t / $moves))
        Wait-Gap $step.GapMs
      }
      # `hold` leaves the button down, so the shot catches the gesture in
      # flight. The finally block below releases it whatever happens; a stuck
      # left button outlives this script and takes the desktop with it.
      if ($step.Kind -eq 'drag') { [LeafShot]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }
      else { $script:buttonDown = $true }
    }
  }
}

$proc = $null
$buttonDown = $false
$heldAsk = $null
$offScreen = $false
try {
  if ($Attach) {
    $hwnd = $running.MainWindowHandle
    # Foreground, and no more: a wheel notch and a key press go to the window that
    # has focus, not the one under the pointer. No restore and no move — those would
    # un-maximize and shove somebody's window to take its picture.
    Take-Foreground $hwnd $running.Id
    # Refused rather than reported as done: SetForegroundWindow fails when the caller
    # is not already foreground, and a wheel notch then lands in whatever is. Clicks
    # and drags carry their own position, so they do not need this.
    # A point on no monitor is clamped onto the desktop, so a mouse gesture cannot reach a copy nobody can see. A pointer step is played into the page through the app's own gesture ask instead — no cursor, no focus and no place on screen — while a key step is refused, because the ask carries no keys.
    $gestures = @($plan | Where-Object { $_.Kind -ne 'wait' })
    $offScreen = [bool]($gestures.Count -and (Test-OffEveryMonitor $hwnd))
    if ($offScreen) {
      $keys = @($plan | Where-Object { $_.Kind -in 'type', 'key' })
      if ($keys.Count) {
        throw ("The window sits on no monitor and a $($keys[0].Kind) step needs the keyboard, which no gesture ask carries. " +
          "Ask the page to do it with 'just ask eval', which needs no focus and no place on screen.")
      }
    }
    else {
      $needsFocus = @($plan | Where-Object { $_.Kind -in 'scroll', 'type', 'key' })
      # Before the foreground reading, because that reading passes here: the box's owner is genuinely in front and the box has the keyboard, so without this a driven save reports every key as sent and leaves the file name field untouched.
      $box = Find-BoxOver $hwnd $running.Id
      if ($needsFocus.Count -and $box) {
        throw ("A box titled `"$box`" stands over the window being driven and keeps the keyboard, so a " +
          "$($needsFocus[0].Kind) step would go nowhere and be reported as made. Cancel it with " +
          "just dismiss-box `"$box`" and run this again.")
      }
      if ($needsFocus.Count -and [LeafShot]::GetForegroundWindow() -ne $hwnd) {
        throw ("Windows would not bring the app's window forward, and a $($needsFocus[0].Kind) step " +
          'goes to whatever has focus. Click the window once and run this again.')
      }
    }
  }
  else {
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
  }

  # Before the settle rather than after it, so whatever the pointer was over has
  # the same time to drop its hover as the page has to draw.
  $parked = New-Object LeafShot+RECT
  [void][LeafShot]::GetWindowRect($hwnd, [ref]$parked)
  Park-Pointer $parked

  Start-Sleep -Milliseconds $SettleMs

  $rect = New-Object LeafShot+RECT
  [void][LeafShot]::GetWindowRect($hwnd, [ref]$rect)
  # See note 6. PrintWindow renders at the window rectangle whatever is asked of it, so the picture is taken whole and the resize border cut off afterwards.
  $vis = Get-VisibleRect $hwnd $rect

  # One throwaway shot before the steps, only to find where the app sits inside the
  # client rectangle. See note 7: the steps are offset by it, so a coordinate
  # measured off the last picture is still the pixel it looks like.
  $probe = Capture-Window $hwnd $rect $vis
  $app = Measure-AppBox $probe
  $probe.Dispose()

  foreach ($step in $plan) {
    if ($offScreen -and $step.Kind -ne 'wait') { Step-PointerAsk $step $app.X $app.Y }
    else { Step-Pointer $step ($vis.Left + $app.X) ($vis.Top + $app.Y) }
    # A hold written with a gap wants the gesture while it is still moving, so it skips
    # the settle: settling first photographs one that stopped moving nearly a second
    # ago. A hold written the old way keeps it, and so do the shots taken with one.
    if ($step.Kind -ne 'hold' -or -not $step.Paced) { Start-Sleep -Milliseconds $StepMs }
  }

  # A step list that finishes a save window closes the window it was driving, and a photograph of a handle that is gone comes back as no picture at all. Said and stopped here, because the file those steps wrote is written either way and the alternative is a run that dies naming a type it could not convert.
  if (-not [LeafShot]::IsWindow($hwnd)) {
    Write-Output 'the window being driven closed while the steps ran, so there is no picture of it; whatever the steps wrote is written'
    return
  }

  $bmp = Capture-Window $hwnd $rect $vis

  # The band the app holds itself off the window by, off. See note 7.
  $app = Measure-AppBox $bmp
  if ($app.Width -ne $bmp.Width -or $app.Height -ne $bmp.Height) {
    $frame = $bmp.Clone($app, $bmp.PixelFormat)
    $bmp.Dispose()
    $bmp = $frame
  }
  $w = $bmp.Width
  $h = $bmp.Height

  if ($Crop) {
    $c = $Crop -split ',' | ForEach-Object { [int]$_ }
    $box = New-Object System.Drawing.Rectangle $c[0], $c[1], $c[2], $c[3]
    $cut = $bmp.Clone($box, $bmp.PixelFormat)
    $bmp.Dispose()
    $bmp = $cut
    $w = $c[2]; $h = $c[3]
  }

  # An -Out ending .png is the BMP put through the app's own encoder, so a driven
  # pass ends with a file that can be read back and there is still one encoder.
  $wantPng = $Out.ToLowerInvariant().EndsWith('.png')
  if ($wantPng -and -not (Test-Path $Exe)) { throw "a .png needs the app's own encoder, and there is no binary at $Exe" }
  $raw = if ($wantPng) { [System.IO.Path]::ChangeExtension($Out, '.bmp') } else { $Out }
  $bmp.Save($raw, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose()
  if ($wantPng) {
    & $Exe --squeeze-png $raw $Out | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "the app could not turn $raw into a PNG" }
    Remove-Item $raw -Force
  }
  Write-Output "${w}x${h} -> $Out"
}
finally {
  if ($buttonDown) { [LeafShot]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }
  # The ask route's held button is the page's, released the way it was pressed — best effort, so a failure here cannot bury the error that got here.
  if ($heldAsk) { try { Send-GestureAsk @{ ask = 'gesture'; kind = 'release'; x = $heldAsk.x; y = $heldAsk.y } } catch {} }
  # Only the copy this script launched, and asked rather than stopped. An attached
  # run has no copy of its own, so it leaves the owner's app up.
  Stop-ShotCopy $proc
  Exit-LeafProfile $shotEnvBefore
}
