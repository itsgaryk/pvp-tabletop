# Start everything the browser checks need, from a shell that is *not* sandboxed.
#
# Why this exists: three things a check needs are refused inside a confined agent
# session, and only one of them can be worked around.
#
#   the dev server   Vite 4 starts an esbuild service over piped stdio, which a
#                    sandbox that refuses new pipes kills with `spawn EPERM`
#   the browsers    Chrome exits 0xFFFF7001 before reading its own command line
#                    (even `chrome.exe --version`), so no flag combination helps
#   the store        fine either way: it is a plain node process
#
# So this script is meant to be run by hand, outside the sandbox, and left running.
# It does not run any check itself - it only puts the three things in place, so an
# agent (or you) can then run `node tools/browser-check.mjs` against them.
#
#   pwsh -File tools\dev-servers.ps1            # store + dev server + 3 browsers
#   pwsh -File tools\dev-servers.ps1 -Browsers 2
#
# Ports, and what expects them:
#
#   6390  the stand-in store            FAKE in the checks, KV_REST_API_URL below
#   6391  the stand-in deck API         VITE_LIMITLESS_WEB, so Import Random Deck
#                                       never touches limitlesstcg.com
#   3005  the app                        BASE, and what `npm run dev` binds
#   9222+ one Chrome per page           CDP_PORTS, start one per player/spectator

param(
   [int]$Browsers = 3,
   [int]$BasePort = 9222,
   [string]$Chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Wait-Port([int]$port, [string]$what) {
   for ($i = 0; $i -lt 60; $i++) {
      if (Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue) {
         Write-Host "  up: $what on $port"
         return
      }
      Start-Sleep -Milliseconds 500
   }
   Write-Warning "  $what never answered on $port"
}

if (-not (Test-Path $Chrome)) {
   throw "Chrome not found at $Chrome - pass -Chrome <path>"
}

Write-Host "store (fake redis) on 6390"
Start-Process -FilePath 'node' -ArgumentList 'tools/fake-redis.mjs' -WorkingDirectory $root -WindowStyle Hidden

Write-Host "deck API stand-in on 6391"
Start-Process -FilePath 'node' -ArgumentList 'tools/fake-deck-api.mjs' -WorkingDirectory $root -WindowStyle Hidden

Wait-Port 6390 'fake redis'
Wait-Port 6391 'fake deck api'

# the windows the checks are written against: see the header of browser-check.mjs
$devEnv = @{
   KV_REST_API_URL        = 'http://127.0.0.1:6390'
   KV_REST_API_TOKEN      = 'local'
   VITE_LIMITLESS_WEB     = 'http://127.0.0.1:6391'
   RELAY_IDLE_MS          = '8000'
   RELAY_PROMPT_MS        = '12000'
   RELAY_MEMBER_STALE_MS  = '600000'
   RELAY_POLL_WAIT_MS     = '1500'
}
$envLines = $devEnv.GetEnumerator() | ForEach-Object { "`$env:$($_.Key)='$($_.Value)'" }

Write-Host "dev server on 3005"
Start-Process -FilePath 'pwsh' -WorkingDirectory $root -WindowStyle Hidden -ArgumentList @(
   '-NoProfile', '-Command', (($envLines -join '; ') + "; npm run dev *> `"$root\.dev-server.log`"")
)

# the app is up when its health route answers, which also proves the relay loaded
for ($i = 0; $i -lt 120; $i++) {
   try {
      $res = Invoke-WebRequest -Uri 'http://localhost:3005/api/relay/health' -UseBasicParsing -TimeoutSec 2
      if ($res.StatusCode -eq 200) { Write-Host "  up: the app on 3005"; break }
   } catch { }
   Start-Sleep -Milliseconds 500
   if ($i -eq 119) { Write-Warning "  the app never answered - see .dev-server.log" }
}

# one browser per page: a single CDP connection cannot multiplex them (see browser.mjs)
for ($i = 0; $i -lt $Browsers; $i++) {
   $port = $BasePort + $i
   $profile = Join-Path $env:TEMP "pvp-chrome-$port"
   New-Item -ItemType Directory -Force -Path $profile | Out-Null

   Start-Process -FilePath $Chrome -ArgumentList @(
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', "--remote-debugging-port=$port",
      "--user-data-dir=$profile", '--window-size=1277,821', 'about:blank'
   )
   Wait-Port $port "chrome (page $($i + 1))"
}

Write-Host @"

Ready. Nothing here is closed for you - kill these when you are done.

   node tools/browser-check.mjs                  all sections
   node tools/browser-check.mjs --only panel     one section
   node tools/solo-check.mjs
   node tools/mirror-check.mjs

CDP_PORTS=$($BasePort),$($BasePort + 1),$($BasePort + 2)   # override if one browser failed to start
"@
