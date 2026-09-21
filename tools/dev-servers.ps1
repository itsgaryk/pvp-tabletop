# Start everything the browser checks need, from a shell that is *not* sandboxed.
#
# Why this exists: three things a check needs are refused inside a confined agent
# session, and only one of them can be worked around.
#
#   the dev server   Vite 4 starts an esbuild service over piped stdio, which a
#                    sandbox that refuses new pipes kills with `spawn EPERM`
#   the browsers    Chrome exits 0xFFFF7001 before reading its own command line
#                    (even `chrome.exe --version`), and Edge asserts rather than
#                    rendering anything
#   the store        fine either way: it is a plain node process
#
# So this script is meant to be run by hand, outside the sandbox, and left running.
# It does not run any check itself - it only puts the four things in place, so an
# agent (or you) can then run `node tools/browser-check.mjs` against them.
#
#   powershell -File tools\dev-servers.ps1                 # store + dev server + 3 browsers
#   powershell -File tools\dev-servers.ps1 -Browsers 2     # only the pages you need
#   powershell -File tools\dev-servers.ps1 -NoDeckApi      # skip the deck-import stand-in
#   powershell -File tools\dev-servers.ps1 -DryRun         # say what it would start
#   powershell -File tools\dev-servers.ps1 -Stop           # close all of it again
#
# (`pwsh` also works where PowerShell 7 is installed; every command below is 5.1-safe,
# which matters because on some hosts `pwsh` does not resolve at all - see $shell.)
#
# Ports, and what expects them:
#
#   6390  the stand-in store            FAKE in the checks, KV_REST_API_URL below
#   6391  the stand-in deck API         VITE_LIMITLESS_WEB, so Import Random Deck
#                                       never touches limitlesstcg.com
#   3005  the app                        BASE, and what `npm run dev` binds
#   9222+ one Chrome per page           CDP_PORTS, one per player/spectator
#
# Everything is started with Start-Process and left running, so this script's own
# exit does not take the servers with it. -Stop closes what it started, found by
# the ports above rather than by process name, so it cannot reach anything else.

param(
   [int]$Browsers = 3,
   [int]$BasePort = 9222,
   [switch]$NoDeckApi,
   [switch]$Stop,
   [switch]$DryRun,
   [string]$Chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
)

$ErrorActionPreference = 'Stop'

# `pwsh` (PowerShell 7) is not installed everywhere - on this host `pwsh` does not
# resolve at all and only 5.1's powershell.exe exists - so the dev server is started
# with this host's own executable, by absolute path, rather than a name that may not
# resolve from Start-Process
$shell = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path $shell)) { $shell = (Get-Command pwsh -ErrorAction Stop).Source }

# tools/ is this file's own directory, so the repo root is one level up and every
# path below is absolute: the script is runnable from any working directory.
# no ternary and no `??`: this has to parse in Windows PowerShell 5.1 as well, which
# is what `pwsh` resolves to on some hosts and what the checks are usually run from
$root = Split-Path -Parent $PSScriptRoot
$ports = @(6390, 3005)
if (-not $NoDeckApi) { $ports += 6391 }
for ($i = 0; $i -lt $Browsers; $i++) { $ports += ($BasePort + $i) }

function Stop-ByPort([int]$port) {
   $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
   foreach ($id in $owners) {
      try {
         Stop-Process -Id $id -Force -ErrorAction Stop
         Write-Host "  stopped pid $id on $port"
      } catch {
         Write-Warning "  could not stop pid $id on $port"
      }
   }
}

if ($Stop) {
   Write-Host 'closing what a previous run started'
   foreach ($port in ($ports | Sort-Object -Unique)) { Stop-ByPort $port }
   exit 0
}

function Test-Port([int]$port) {
   $client = [System.Net.Sockets.TcpClient]::new()
   try {
      return $client.ConnectAsync('127.0.0.1', $port).Wait(400)
   } catch {
      return $false
   } finally {
      $client.Dispose()
   }
}

function Wait-Port([int]$port, [string]$what, [int]$tries = 120) {
   for ($i = 0; $i -lt $tries; $i++) {
      if (Test-Port $port) { Write-Host "  up: $what on $port"; return $true }
      Start-Sleep -Milliseconds 500
   }
   Write-Warning "  $what never answered on $port"
   return $false
}

if (-not (Test-Path $Chrome)) {
   throw "Chrome not found at $Chrome - pass -Chrome <path>"
}

# -DryRun: say what would be started, resolve every path, and start nothing. This is
# how the script is checked from a session that cannot spawn (see the header of
# docs/gotchas.md), and it is worth running once before a real run.
if ($DryRun) {
   Write-Host "dry run - nothing will be started`n"
   Write-Host "  script path   $PSCommandPath"
   Write-Host "  repo root     $root"
   Write-Host "  dev server    $shell"
   Write-Host "  chrome        $Chrome"
   Write-Host "  ports         $(($ports | Sort-Object -Unique) -join ', ')"
   Write-Host ''
   foreach ($entry in @(
      @{ port = 6390; what = 'fake redis'; script = 'tools/fake-redis.mjs' },
      @{ port = 6391; what = 'fake deck api'; script = 'tools/fake-deck-api.mjs' }
   )) {
      if ($NoDeckApi -and $entry.port -eq 6391) { continue }
      $full = Join-Path $root $entry.script
      $state = if (Test-Port $entry.port) { 'already up' } else { 'would start' }
      Write-Host "  $state  $($entry.what) on $($entry.port)"
      Write-Host "           $full  (exists: $(Test-Path $full))"
   }
   $appState = if (Test-Port 3005) { 'already up' } else { 'would start' }
   Write-Host "  $appState  the app on 3005 via npm run dev"
   for ($i = 0; $i -lt $Browsers; $i++) {
      $port = $BasePort + $i
      $state = if (Test-Port $port) { 'already up' } else { 'would start' }
      Write-Host "  $state  chrome (page $($i + 1)) on $port"
   }
   if ($NoDeckApi) { Write-Host "`n  (VITE_LIMITLESS_WEB is not set: deck import will go to limitlesstcg.com)" }
   exit 0
}

# already listening means an earlier run is still up: reuse it rather than start a
# second one that cannot bind, which would leave two scripts disagreeing about it
$standins = @()
if (-not $NoDeckApi) { $standins += @{ port = 6391; what = 'fake deck api'; script = 'tools/fake-deck-api.mjs' } }
$standins += @{ port = 6390; what = 'fake redis'; script = 'tools/fake-redis.mjs' }

foreach ($entry in $standins) {
   if (Test-Port $entry.port) { Write-Host "already up: $($entry.what) on $($entry.port)"; continue }

   Write-Host "starting $($entry.what) on $($entry.port)"
   Start-Process -FilePath 'node' -ArgumentList (Join-Path $root $entry.script) `
      -WorkingDirectory $root -WindowStyle Hidden
   $null = Wait-Port $entry.port $entry.what
}

# the windows the checks are written against: see the header of browser-check.mjs
$devEnv = @{
   KV_REST_API_URL       = 'http://127.0.0.1:6390'
   KV_REST_API_TOKEN     = 'local'
   RELAY_IDLE_MS         = '8000'
   RELAY_PROMPT_MS       = '12000'
   RELAY_MEMBER_STALE_MS = '600000'
   RELAY_POLL_WAIT_MS    = '1500'
}
if (-not $NoDeckApi) { $devEnv.VITE_LIMITLESS_WEB = 'http://127.0.0.1:6391' }

if (Test-Port 3005) {
   Write-Host 'already up: the app on 3005'
} else {
   Write-Host 'starting the dev server on 3005'
   $envLines = $devEnv.GetEnumerator() | ForEach-Object { "`$env:$($_.Key)='$($_.Value)'" }
   $log = Join-Path $root '.dev-server.log'
   Start-Process -FilePath $shell -WorkingDirectory $root -WindowStyle Hidden -ArgumentList @(
      '-NoProfile', '-Command', (($envLines -join '; ') + "; npm run dev *> `"$log`"")
   )

   # the app is up when its health route answers, which also proves the relay loaded
   $ok = $false
   for ($i = 0; $i -lt 180; $i++) {
      if (Test-Port 3005) {
         try {
            $res = Invoke-WebRequest -Uri 'http://localhost:3005/api/relay/health' -UseBasicParsing -TimeoutSec 3
            if ($res.StatusCode -eq 200) { Write-Host '  up: the app on 3005 (health answered)'; $ok = $true; break }
         } catch { }
      }
      Start-Sleep -Milliseconds 500
   }
   if (-not $ok) { Write-Warning '  the app never answered /api/relay/health - see .dev-server.log' }
}

# one browser per page: a single CDP connection cannot multiplex them (see browser.mjs)
$started = @()
for ($i = 0; $i -lt $Browsers; $i++) {
   $port = $BasePort + $i
   $profile = Join-Path $env:TEMP "pvp-chrome-$port"

   if (Test-Port $port) { Write-Host "already up: chrome on $port"; $started += $port; continue }

   New-Item -ItemType Directory -Force -Path $profile | Out-Null
   Start-Process -FilePath $Chrome -ArgumentList @(
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', "--remote-debugging-port=$port",
      "--user-data-dir=$profile", '--window-size=1277,821', 'about:blank'
   )

   if (Wait-Port $port "chrome (page $($i + 1))") { $started += $port }
}

Write-Host @"

Ready. Nothing here is closed for you - `powershell -File tools\dev-servers.ps1 -Stop` closes it.

   node tools/browser-check.mjs                  all sections
   node tools/browser-check.mjs --only panel     one section
   node tools/solo-check.mjs
   node tools/mirror-check.mjs

CDP_PORTS=$($started -join ',')   # only the browsers that actually came up
"@
