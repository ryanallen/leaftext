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
    Write-Output "closed the probe copy under $name"
    return
  }

  if (-not $Exe) { $Exe = Join-Path $root 'target\debug\leaftext.exe' }
  if (-not (Test-Path $Exe)) { throw "no binary at $Exe - run 'cargo build' first" }
  if (Test-LeafPipe $name) {
    throw "a probe copy is already up under $name - close it with 'just probe-close' or launch this one under a different -Work name"
  }

  # -PassThru for the process id alone, which is what lets a later ask tell a probe that is still up from a pointer left behind by a session that crashed. The copy outlives this script either way: Start-Process makes an independent process.
  $launched = if ($Doc) { Start-Process -FilePath $Exe -ArgumentList $Doc -PassThru } else { Start-Process -FilePath $Exe -PassThru }
  if (-not (Wait-LeafPipe $name $true $TimeoutMs)) {
    throw "the copy launched under $name never answered its pipe"
  }

  # Read by scripts/probe.mjs, which writes the pointer the ask wrapper reads. One line each, name first, so a person running this directly can see what to talk to.
  Write-Output "name=$name"
  Write-Output "pid=$($launched.Id)"
  Write-Output "work=$workDir"
}
finally {
  Exit-LeafProfile $entered.Before
}
