# Launch a copy of the app beside the owner's and leave it up, or ask that copy to close. Behind `just probe-copy` and `just probe-close`, through scripts/probe.mjs.
#
#   pwsh scripts/probe-launch.ps1 -Doc <file> [-Work <name>]
#   pwsh scripts/probe-launch.ps1 -Close [-Work <name>]
#
# The other launcher, scripts/capture-screenshot.ps1, photographs its copy and asks it to close in the same breath, so the copy is gone before the next command starts. A build needs four commands against one copy — ask, read, drive, ask again — which is what this one is for. Both share the throwaway profile in scripts/probe-profile.ps1.
#
# The account name comes from the work folder rather than being invented per run — see Get-LeafProfileName. A second work folder is a second copy, up at the same time, under a name of its own.
#
# A work folder is kept rather than emptied. A shot wants a profile built from nothing every run — a picture of a reused one shows the last shot's vaults — and a probe wants the opposite: watching a window size come back needs the launch after the one that set it.
#
# Nothing here reaches for a process by name. `Get-Process leaftext` answers with the owner's window too, and stopping a copy of the app throws away the window size, place and maximized state that only a real close saves. The copy is asked to quit down its own pipe, and the wait is on that pipe going away.
#
# The copy comes up off every monitor, so a build can watch a change without a window landing over whatever the owner is reading. That place travels with the process rather than through a setting or an argument: `CreateProcessW` carries a startup position, and Windows hands it to the first window the process builds with no position of its own, which is the window the app builds. Asking for it through the app's own window builder cannot work — a position matching no monitor is thrown away and cascaded onto the primary — and a setting could not put a probe off screen and keep the owner's window on it with one field. The app's half is the keyboard: it reads the place it was started at and shows a window on no monitor without taking focus. A copy the owner opens carries no startup position and comes up exactly where it always did.

param(
  # Empty opens the no-file home screen.
  [string]$Doc = '',
  # A name, not a path: two probes are two names. Reused across launches on purpose.
  [string]$Work = 'default',
  [switch]$Close,
  [string]$Exe,
  # How long to wait for the copy to answer its pipe, or to stop answering it.
  [int]$TimeoutMs = 30000
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
. (Join-Path $PSScriptRoot 'probe-profile.ps1')

$workDir = Join-Path ([System.IO.Path]::GetTempPath()) "leaftext-probe-$Work"
$name = Get-LeafProfileName $workDir
$privateExe = Join-Path $workDir 'leaftext.exe'

# Whether a copy is listening under that name. Enumerating the pipe directory rather than Test-Path on one entry: the filesystem provider answers False for a named pipe often enough that a launch would look like it never came up.
function Test-LeafPipe([string]$pipeName) {
  try {
    # Matched on the tail of the path rather than through Split-Path, which does not read a pipe path as a folder and a leaf.
    $wanted = "\leaftext-journal-$pipeName"
    return @([System.IO.Directory]::GetFiles('\\.\pipe\') | Where-Object { $_.EndsWith($wanted, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
  }
  catch {
    return $false
  }
}

function Wait-LeafPipe([string]$pipeName, [bool]$wantUp, [int]$ms) {
  $deadline = [datetime]::UtcNow.AddMilliseconds($ms)
  while ([datetime]::UtcNow -lt $deadline) {
    if ((Test-LeafPipe $pipeName) -eq $wantUp) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return (Test-LeafPipe $pipeName) -eq $wantUp
}

# Where a copy is put so nobody can see it: past the top-left corner of every monitor at once. Computed rather than written down, because a monitor added to the left of the primary moves the virtual screen's own corner and a fixed number would leave the copy back in view. The distance is further than any window is wide or tall, so no edge of the copy reaches the nearest monitor, and it is held off the floor of the signed number Windows carries a startup place in.
function Get-OffScreenSpot {
  Add-Type -AssemblyName System.Windows.Forms
  Add-LeafLaunchType
  # Screen pixels, both here and in the place handed over: without this, Windows reads the position as the launcher's scaled pixels and converts it for the app, so a point computed 10,000 short of the corner arrives 6,667 short of it on a 150% screen — and the number the app then reads back is not the number its window got.
  [void][LeafLaunch]::SetProcessDPIAware()
  $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $away = 10000
  return [pscustomobject]@{
    X = [Math]::Max(($screen.Left - $away), -30000)
    Y = [Math]::Max(($screen.Top - $away), -30000)
  }
}

function Add-LeafLaunchType {
  if ('LeafLaunch' -as [type]) { return }
  Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class LeafLaunch {
  public const uint STARTF_USEPOSITION = 0x00000004;
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFOW {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute;
    public uint dwFlags; public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
    public IntPtr hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, IntPtr dir, ref STARTUPINFOW si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr h);
}
'@
}

# The launch. Start-Process cannot carry a startup place, so this is CreateProcessW with STARTF_USEPOSITION: Windows keeps that point for the first overlapped window the process builds with no place of its own, which is the window the app builds. The place only — the size stays whatever the profile last saved, because the app passes that to its own window builder and leaves the platform nothing but the position. Both handles are closed here, so the copy is nobody's child and outlives this script.
function Start-LeafOffScreen([string]$exe, [string]$doc, [int]$x, [int]$y) {
  Add-LeafLaunchType
  $si = New-Object LeafLaunch+STARTUPINFOW
  $si.cb = [System.Runtime.InteropServices.Marshal]::SizeOf([type]'LeafLaunch+STARTUPINFOW')
  $si.dwFlags = [LeafLaunch]::STARTF_USEPOSITION
  $si.dwX = $x
  $si.dwY = $y
  # Quoted, both of them: a path with a space in it would otherwise reach the app as two arguments and open the home screen instead of the file asked for.
  $line = if ($doc) { "`"$exe`" `"$doc`"" } else { "`"$exe`"" }
  $pi = New-Object LeafLaunch+PROCESS_INFORMATION
  # The folder goes as a pointer rather than a string: PowerShell hands $null to a string parameter as an empty one, and an empty current folder is a name Windows refuses before it reads anything else.
  $ok = [LeafLaunch]::CreateProcessW($exe, (New-Object System.Text.StringBuilder $line), [IntPtr]::Zero, [IntPtr]::Zero, $false, 0, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$si, [ref]$pi)
  if (-not $ok) {
    $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "the copy would not start at $x,$y - Windows answered error $code"
  }
  [void][LeafLaunch]::CloseHandle($pi.hThread)
  [void][LeafLaunch]::CloseHandle($pi.hProcess)
  return $pi.dwProcessId
}

# The backslashes are load-bearing: a bare double quote inside a single-quoted argument reaches node stripped, and the wrapper wants JSON.
#
# LEAFTEXT_ASK_ACCOUNT_ONLY because the account name is already the copy this means. Without it the wrapper would follow the pointer file instead, and closing one probe would close whichever other one happens to be up.
function Send-LeafQuit {
  $env:LEAFTEXT_ASK_ACCOUNT_ONLY = '1'
  try {
    & node (Join-Path $root 'scripts\mcp-leaftext.mjs') --ask '{\"ask\":\"quit\"}' | Out-Null
  }
  finally {
    $env:LEAFTEXT_ASK_ACCOUNT_ONLY = $null
  }
}

# The refusal and the build come before the profile is entered, so a name already up costs nothing and a build that fails on the code leaves the last executable unlaunched rather than standing in for the tree. The build is then copied into this name's own folder, because two probes sharing target\debug lock each other out of it.
$builtExe = $null
if (-not $Close -and (Test-LeafPipe $name)) {
  throw "a probe copy is already up under $name - close it with 'just probe-close' or launch this one under a different -Work name"
}
if (-not $Close -and -not $Exe) {
  Push-Location $root
  try {
    & cargo build
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed with exit code $LASTEXITCODE" }
  }
  finally {
    Pop-Location
  }
  $builtExe = Join-Path $root 'target\debug\leaftext.exe'
  if (-not (Test-Path $builtExe)) { throw "cargo build succeeded without writing $builtExe" }
}
elseif (-not $Close -and -not (Test-Path $Exe)) {
  throw "no binary at $Exe"
}

$entered = Enter-LeafProfile -Work $workDir -Name $name
try {
  if ($Close) {
    if (-not (Test-LeafPipe $name)) {
      Write-Output "no probe copy was up under $name"
      return
    }
    Send-LeafQuit
    if (-not (Wait-LeafPipe $name $false $TimeoutMs)) {
      throw "the probe copy under $name would not close when asked, and nothing here will stop it: a kill throws its window size and place away"
    }
    if (Test-Path -LiteralPath $privateExe) { Remove-Item -LiteralPath $privateExe -Force }
    Write-Output "closed the probe copy under $name"
    return
  }

  if (-not $Exe) {
    Copy-Item -LiteralPath $builtExe -Destination $privateExe -Force
    $Exe = $privateExe
  }

  # The place, and the process id a later ask needs to tell a probe that is still up from a pointer left behind by a session that crashed. The copy outlives this script: CreateProcessW makes an independent process, and both handles are closed before this returns.
  $spot = Get-OffScreenSpot
  $launchedPid = Start-LeafOffScreen $Exe $Doc $spot.X $spot.Y
  if (-not (Wait-LeafPipe $name $true $TimeoutMs)) {
    throw "the copy launched under $name never answered its pipe"
  }

  # Read by scripts/probe.mjs, which writes the pointer the ask wrapper reads. One line each, name first, so a person running this directly can see what to talk to.
  Write-Output "name=$name"
  Write-Output "pid=$launchedPid"
  Write-Output "at=$($spot.X),$($spot.Y)"
  Write-Output "work=$workDir"
}
finally {
  Exit-LeafProfile $entered.Before
}
