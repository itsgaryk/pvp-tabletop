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
# **One port block per session.** Two sessions on this repository cannot share these
# ports, and a run in one worktree must never close another session's servers - so a
# session moves its whole block with one argument, and `-Stop` takes the same one:
#
#   powershell -File tools\dev-servers.ps1 -BasePort 9230              # session B
#   powershell -File tools\dev-servers.ps1 -Stop -BasePort 9230        # and close it
#
# -BasePort moves the browsers, the app and both stand-ins together; the resulting
# block for a few sessions is in docs/parallel-work.md, and the arithmetic is spelled
# out where the ports are worked out below. The defaults (9222 / 3005 / 6390 / 6391)
# are session A, and are what the rest of this header documents.
#
# (`pwsh` also works where PowerShell 7 is installed; every command below is 5.1-safe,
# which matters because on some hosts `pwsh` does not resolve at all - see $shell.)
#
# Ports, and what expects them (session A; every one of them moves with -BasePort):
#
#   6390  the stand-in store            FAKE in the checks, KV_REST_API_URL below
#   6391  the stand-in deck API         VITE_LIMITLESS_WEB, so Import Random Deck
#                                       never touches limitlesstcg.com
#   3005  the app                        BASE, and what `npm run dev` binds
#   9222+ one Chrome per page           CDP_PORTS, one per player/spectator
#
# -Stop closes what this script started and nothing else: the vite process by its
# command line, one browser per `--user-data-dir` under $env:TEMP, and the two
# stand-ins by name *and* port. It does not need the ports to be reachable to do it,
# and it cannot reach another session's run - but only if it is given that session's
# -BasePort, which is why the `-Stop` line above carries it.
#
# Everything is started with Start-Process and left running, so this script's own
# exit does not take the servers with it. -Stop closes what it started, found by
# its own command lines rather than by port ownership, so it cannot reach anything
# else.

param(
   [int]$Browsers = 3,
   [int]$BasePort = 9222,
   [int]$Port = 3005,
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

# The ports of the run being started *or* closed, resolved before anything branches
# on -Stop, so both paths agree on what "ours" means.
#
#   -BasePort  the first browser, and default 9222 - the one knob that moves a session
#   -Port      the app, derived from -BasePort unless given
#
# -BasePort moves all three families because each session's block holds one of each:
# given -BasePort 9222 + 8n, the browser ports are base..base+2, the app port is
# 3005 + n, and the store ports are 6390 + 2n / 6391 + 2n. The store's stride is two
# rather than one because a session owns a *pair* of store ports, which is what keeps
# the first session on the 6390/6391 this repository has always used. Both formulas are
# one definition with `standInPorts` in tools/dev-servers.lib.mjs, which the matcher and
# the checks use, so those three cannot drift apart.
$stride = 8
$appPortFor = { param([int]$base) 3005 + [int](($base - 9222) / $stride) }

if ($PSBoundParameters.ContainsKey('Port')) {
   $AppPort = $Port
} else {
   $AppPort = & $appPortFor $BasePort
}

if ($AppPort -lt 1 -or $AppPort -gt 65535) {
   throw "-BasePort $BasePort puts the app on $AppPort, which is not a port - use -BasePort 9222 + 8n (9222, 9230, 9238, ...) or say -Port"
}

$StandInPorts = @{ redis = 6390 + (2 * ($AppPort - 3005)); deck = 6391 + (2 * ($AppPort - 3005)) }
$BrowserPorts = @()
for ($i = 0; $i -lt $Browsers; $i++) { $BrowserPorts += ($BasePort + $i) }

$expectPorts = @($StandInPorts.redis, $AppPort)
if (-not $NoDeckApi) { $expectPorts += $StandInPorts.deck }
$expectPorts += $BrowserPorts

# ------------------------------------------------------- the ports are ours --
#
# The three families have to stay in their own slots, and each family gives an
# independent way to check the others: from the app port, the browsers must start at
# 9222 + 8n *and* the store at 6390 + 2n, for the same n. A session that moves one knob
# and not the other is caught here, by arithmetic, rather than being allowed to start
# something that quietly takes a port another session is using.
#
# Only a moved block is checked. The defaults are this script's own and cannot collide
# with themselves, and refusing to start on them would be refusing to start at all.
#
# This runs for -DryRun too: a dry run that calls a colliding layout ready is worse than
# no dry run.
if ($BasePort -ne 9222 -or $PSBoundParameters.ContainsKey('Port')) {
   if ((($BasePort - 9222) % $stride) -ne 0) {
      throw "-BasePort $BasePort is not 9222 + 8n, so it does not name a block. Browsers step by 8 so that each session's block holds exactly one browser range, one app port and two store ports; any other -BasePort has to share a port with a session that did choose a multiple of 8. Use 9222, 9230, 9238, ..."
   }
   $wanted = & $appPortFor $BasePort
   if ($AppPort -ne $wanted) {
      throw "app port $AppPort goes with -BasePort $(9222 + (($AppPort - 3005) * $stride)), not with -BasePort $BasePort (which wants $wanted). The app port and the store ports both follow from the block, so drop -Port or move -BasePort"
   }
   foreach ($port in @($AppPort, $StandInPorts.redis, $StandInPorts.deck)) {
      if ($BrowserPorts -contains $port) {
         throw "port $port is both a browser port and an app or store port - a session's browser range is $BasePort..$($BrowserPorts[-1]) and its app port is $wanted"
      }
   }
}

# ---------------------------------------------------------------- cleanup --
#
# Closing a run is deliberately *not* done by listening port, which is how this
# started and why it did nothing on this host: Get-NetTCPConnection reports no
# listener for the dev server even while it is serving. Its port probe has the same
# blind spot. So a run is identified by facts that do not depend on the network - the
# vite process by its command line, and each browser by the `--user-data-dir` this
# script gave it - and the ports are only a fallback.
#
# The matching itself lives in tools/dev-servers.lib.mjs, not here, because it cannot
# be tested where the script runs: a confined session can neither read a command line
# nor write a browser profile. What is left here touches real processes only.
# tools/dev-servers-check.mjs proves the matcher stops what this started and nothing
# else; run it after touching either file.

function Get-OursNode([int]$AppPort) {
   $script = Join-Path $PSScriptRoot 'dev-servers.pids.mjs'
   if (-not (Test-Path $script)) { return $null }
   if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $null }

   # The app port *is* the ownership: dev-servers.pids.mjs matches the dev server on
   # it and derives the two stand-in ports from it. Without this the matcher would
   # look for the default 3005 and find another session's run instead of this one.
   $env:PORT = "$AppPort"
   try {
      $json = (& node $script 2>$null) -join "`n"
      if (-not $json) { return $null }
      return $json | ConvertFrom-Json
   } catch {
      return $null
   } finally {
      Remove-Item Env:\PORT -ErrorAction SilentlyContinue
   }
}

function Stop-Pids([int[]]$pids) {
   $stopped = 0
   foreach ($id in ($pids | Sort-Object -Unique)) {
      try {
         Stop-Process -Id $id -Force -ErrorAction Stop
         Write-Host "  stopped pid $id"
         $stopped++
      } catch {
         # already gone, or not ours to stop - neither is a failure here
      }
   }
   return $stopped
}

function Stop-ByPort([int]$port) {
   $stopped = 0
   $owners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique)
   foreach ($id in $owners) {
      try {
         Stop-Process -Id $id -Force -ErrorAction Stop
         Write-Host "  stopped pid $id (was listening on $port)"
         $stopped++
      } catch { }
   }
   return $stopped
}

function Clear-Ours {
   $ours = Get-OursNode $AppPort
   $total = 0

   if ($ours) {
      Write-Host 'the app (vite), the browsers this script started, and the stand-ins'
      $total += Stop-Pids @($ours.devServer) + @($ours.browsers) + @($ours.standins)
   } else {
      # the matcher is unreachable - no node, no module, or a command line we cannot
      # read - so say so, and fall back to ports, which may find nothing at all
      Write-Warning '  cannot match on command lines here (node or the module is unavailable), falling back to ports'
      foreach ($port in ($expectPorts | Sort-Object -Unique)) { $total += Stop-ByPort $port }
   }

   return $total
}

if ($Stop) {
   Write-Host "closing what a previous run started (app $AppPort, browsers $($BrowserPorts -join '/'), stand-ins $($StandInPorts.redis)/$($StandInPorts.deck))"
   $total = Clear-Ours

   if ($total -eq 0) {
      Write-Host 'nothing of ours was running'
   } else {
      Write-Host "closed $total process(es)"
   }

   # the browsers' profiles are ours, and a run leaves one per page behind - but only
   # the ones on *this* session's browser ports. Removing every `pvp-chrome-*` would
   # delete a profile another session's browser is still using, and that browser is
   # only given the profile at launch, so it is the one thing that cannot be shared.
   foreach ($port in ($BrowserPorts | Sort-Object -Unique)) {
      $dir = Join-Path $env:TEMP "pvp-chrome-$port"
      if (-not (Test-Path $dir)) { continue }
      try {
         Remove-Item $dir -Recurse -Force -ErrorAction Stop
         Write-Host "  removed profile pvp-chrome-$port"
      } catch {
         Write-Host "  profile pvp-chrome-$port is still in use - it can be deleted once the browser has exited"
      }
   }

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

# is the app serving? This is the authority on readiness, not a port probe: on some
# hosts a TCP connect to the dev server fails while the app serves fine.
function Test-Health([int]$port) {
   try {
      $res = Invoke-WebRequest -Uri "http://localhost:$port/api/relay/health" -UseBasicParsing -TimeoutSec 3
      return $res.StatusCode -eq 200
   } catch {
      return $false
   }
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
   Write-Host "  ports         $(($expectPorts | Sort-Object -Unique) -join ', ')"
   Write-Host "  app port      $AppPort$(if (-not $PSBoundParameters.ContainsKey('Port')) { '  (from -BasePort)' })"
   Write-Host ''
   foreach ($entry in @(
      @{ port = $StandInPorts.redis; what = 'fake redis'; script = 'tools/fake-redis.mjs' },
      @{ port = $StandInPorts.deck; what = 'fake deck api'; script = 'tools/fake-deck-api.mjs' }
   )) {
      if ($NoDeckApi -and $entry.port -eq $StandInPorts.deck) { continue }
      $full = Join-Path $root $entry.script
      $state = if (Test-Port $entry.port) { 'already up' } else { 'would start' }
      Write-Host "  $state  $($entry.what) on $($entry.port)"
      Write-Host "           $full  (exists: $(Test-Path $full))"
   }
   $appState = if (Test-Port $AppPort) { 'already up' } else { 'would start' }
   Write-Host "  $appState  the app on $AppPort via npm run dev"
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
if (-not $NoDeckApi) { $standins += @{ port = $StandInPorts.deck; what = 'fake deck api'; script = 'tools/fake-deck-api.mjs' } }
$standins += @{ port = $StandInPorts.redis; what = 'fake redis'; script = 'tools/fake-redis.mjs' }

foreach ($entry in $standins) {
   if (Test-Port $entry.port) { Write-Host "already up: $($entry.what) on $($entry.port)"; continue }

   Write-Host "starting $($entry.what) on $($entry.port)"
   # the port is passed as an argument, not only through the environment: Windows does
   # not put the environment in the process list, so this is the only way a later
   # `-Stop` can tell this session's stand-in from another session's copy
   Start-Process -FilePath 'node' -ArgumentList @((Join-Path $root $entry.script), '--port', "$($entry.port)") `
      -WorkingDirectory $root -WindowStyle Hidden
   $null = Wait-Port $entry.port $entry.what
}

# the windows the checks are written against: see the header of browser-check.mjs
$devEnv = @{
   KV_REST_API_URL       = "http://127.0.0.1:$($StandInPorts.redis)"
   KV_REST_API_TOKEN     = 'local'
   RELAY_IDLE_MS         = '8000'
   RELAY_PROMPT_MS       = '12000'
   RELAY_MEMBER_STALE_MS = '600000'
   RELAY_POLL_WAIT_MS    = '1500'
}
if (-not $NoDeckApi) { $devEnv.VITE_LIMITLESS_WEB = "http://127.0.0.1:$($StandInPorts.deck)" }

if (Test-Port $AppPort) {
   Write-Host "already up: the app on $AppPort"
} else {
   Write-Host "starting the dev server on $AppPort"
   $envLines = $devEnv.GetEnumerator() | ForEach-Object { "`$env:$($_.Key)='$($_.Value)'" }
   $log = Join-Path $root '.tmp-dev-server.log'
   Start-Process -FilePath $shell -WorkingDirectory $root -WindowStyle Hidden -ArgumentList @(
      '-NoProfile', '-Command', (($envLines -join '; ') + "; npm run dev -- --port $AppPort *> `"$log`"")
   )

   # The app is up when its health route answers, which also proves the relay loaded.
   # The port probe is not allowed to gate this: on some hosts TcpClient cannot reach
   # the app on 3005 on any address while the app is serving happily, so waiting on
   # Test-Port first would spend the whole loop and then warn about an app that had
   # been up the entire time. Ask the app instead; treat the port as a courtesy.
   $ok = $false
   for ($i = 0; $i -lt 180; $i++) {
      if (Test-Health $AppPort) { Write-Host "  up: the app on $AppPort (health answered)"; $ok = $true; break }
      Start-Sleep -Milliseconds 500
   }
   if (-not $ok) { Write-Warning "  the app never answered /api/relay/health on $AppPort - see $log" }
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
