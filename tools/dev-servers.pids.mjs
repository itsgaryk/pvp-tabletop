/*
   Which processes a run of dev-servers.ps1 left behind, as JSON.

   The PowerShell script calls this for its -Stop path, and it exists as a separate
   file so that the only machine-reading line in the cleanup is one line of node
   rather than a pipeline of PowerShell string matching. The matching itself is in
   dev-servers.lib.mjs, which is pure and tested by dev-servers-check.mjs; this file
   is the adapter that hands it real processes.

   It reads only: `Get-CimInstance Win32_Process` through PowerShell, no more. The
   killing is done by the caller, which owns the list it asked for.

     node tools/dev-servers.pids.mjs
     {"devServer":[123],"browsers":[456,457,458],"standins":[789,790]}
*/

import { execFileSync } from 'node:child_process'
import { findOurs } from './dev-servers.lib.mjs'

const DEV_PORT = Number(process.env.PORT || 3005)
const REPO_NAME = 'pvp-tabletop'

/* PowerShell is what reads a command line on Windows without extra packages */
function processes () {
   const ps = [
      'Get-CimInstance Win32_Process',
      '| Where-Object { $_.CommandLine }',
      '| Select-Object ProcessId, CommandLine',
      '| ConvertTo-Json -Compress -Depth 3'
   ].join(' ')

   const shell = process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe'

   const raw = execFileSync(shell, [ '-NoProfile', '-Command', ps ], {
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024
   }).trim()

   if (!raw) return []

   const parsed = JSON.parse(raw)
   return Array.isArray(parsed) ? parsed : [ parsed ]
}

try {
   const list = processes()
   const found = findOurs(list, { repoName: REPO_NAME, port: DEV_PORT })
   process.stdout.write(JSON.stringify(found))
} catch (err) {
   /* the caller decides what to do without us; say so on stderr and fail clearly */
   process.stderr.write(`dev-servers.pids: could not read the process list (${err.message})\n`)
   process.exit(1)
}
