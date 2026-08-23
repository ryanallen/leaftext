# The throwaway profile a copy of the app is launched against when it must not touch the one the owner is reading. Dot-sourced, never run: `. (Join-Path $PSScriptRoot 'probe-profile.ps1')`.
#
# Two callers, one block, on purpose. scripts/capture-screenshot.ps1 takes a reproducible documentation photograph and closes its copy in the same breath; scripts/probe-launch.ps1 leaves its copy up so a build can ask it, drive it and ask it again. Both need exactly the same separation, and two copies of it drift — the drift shows up as a probe writing into the owner's recent files.
#
# What the separation is made of, and what each piece cost before it was known:
#
#  - %APPDATA% and %LOCALAPPDATA% move under a work folder. The app resolves its
#    config and data roots from them (`project_config_dir` in src/lib.rs), so the
#    owner's settings, recent files and vault registry are never read or written.
#  - %USERPROFILE% and the three OneDrive variables are starved. src/known_folders.rs
#    is the only thing that reads them and it makes a vault of every cloud folder it
#    finds under them, which is how a picture of the vault list came to show this
#    machine's folders. Starved rather than switched off, so the app needs no branch
#    that exists only for a launcher.
#  - %USERNAME% becomes a name of its own. src/single_instance.rs names the instance
#    slot after it and src/pipe.rs names the ask pipe after it, so a copy launched
#    under a name nobody else is using gets its own window instead of handing its
#    file to whatever is already up, and answers a quit nothing else hears.
#
# Every variable is saved before it is written over, because this process outlives the copy when another script calls it — and one of them is the account name the app is asked questions under, so a run that leaves it rewritten points everything after it at a copy that has already closed.

$ErrorActionPreference = 'Stop'

# Sets the environment and returns what to put back, plus the folders the caller seeds. The loop variable is not $name: PowerShell variables are case-insensitive, so it would be the $Name parameter.
function Enter-LeafProfile {
  param(
    [Parameter(Mandatory = $true)][string]$Work,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $appdata = Join-Path $Work 'roaming'
  $local = Join-Path $Work 'local'
  $config = Join-Path $appdata 'ryanallen\leaftext\config'
  $emptyHome = Join-Path $Work 'home'
  New-Item -ItemType Directory -Force -Path $config | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $local 'ryanallen\leaftext\data') | Out-Null
  New-Item -ItemType Directory -Force -Path $emptyHome | Out-Null

  $before = [ordered]@{}
  foreach ($varName in 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'USERNAME', 'OneDrive', 'OneDriveConsumer', 'OneDriveCommercial') {
    $before[$varName] = [Environment]::GetEnvironmentVariable($varName)
  }

  $env:APPDATA = $appdata
  $env:LOCALAPPDATA = $local
  $env:USERPROFILE = $emptyHome
  $env:OneDrive = ''
  $env:OneDriveConsumer = ''
  $env:OneDriveCommercial = ''
  $env:USERNAME = $Name

  [ordered]@{
    Before   = $before
    Work     = $Work
    AppData  = $appdata
    Local    = $local
    Config   = $config
    Home     = $emptyHome
    Name     = $Name
    Manifest = Join-Path $local 'ryanallen\leaftext\data\manifest.db'
  }
}

# After the copy has been asked to quit, never before it: the account name is what addresses the pipe.
function Exit-LeafProfile($before) {
  if (-not $before) { return }
  foreach ($varName in $before.Keys) {
    [Environment]::SetEnvironmentVariable($varName, $before[$varName])
  }
}

# The account name a work folder is always launched under, so a close run in a different process can address the copy an open run started without being told. Derived rather than remembered, which is what lets `just probe-close` stand alone: this process is gone by the time anything asks the copy a question.
function Get-LeafProfileName([string]$Work) {
  Split-Path -Leaf $Work
}
