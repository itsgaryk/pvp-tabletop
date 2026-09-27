/*
   What a run of dev-servers.ps1 looks like from the outside, and how to close it.

   This is a module rather than a block inside the script for one reason: a cleanup
   that does not work is worse than no cleanup, and it cannot be tested where it
   runs. The dev-server side of this project is hosted on a host where a confined
   session can neither read a process command line nor write to the temp directory,
   so the matcher could not be exercised there at all. Kept here, it is pure
   functions over plain objects and node can test it (tools/dev-servers-check.mjs),
   while the script keeps only the parts that touch real processes - Start-Process,
   Stop-Process, Get-CimInstance, Remove-Item.

   Nothing here reads the machine: every function takes the process list as an
   argument, so a test can hand it whatever it likes.
*/

/*
   The browser this script starts is recognised by its profile directory, not by its
   executable or its command line in general: `--user-data-dir=...\pvp-chrome-9422`.
   That name is the script's own invention, so matching it cannot reach a browser
   somebody opened by hand. The 8.3 form Windows may hand back for the temp
   directory is stripped first, or a short path would hide the marker.
*/
export function chromeProfilePort (commandLine) {
   const line = shortPathsExpanded(String(commandLine || ''))
   const match = /pvp-chrome-(\d+)/.exec(line)
   return match ? Number(match[1]) : null
}

/* the temp path in its 8.3 form, e.g. C:\Users\GARYK~1\... - the marker survives, but only after this */
function shortPathsExpanded (line) {
   return line.replace(/[A-Za-z]:\\[^\\]*~[0-9]+\\/g, (short) => ` ${short} `)
}

export function isOurBrowser (commandLine) {
   const line = String(commandLine || '')
   return line.includes('--user-data-dir=') && chromeProfilePort(line) !== null
}

/*
   Vite, as `npm run dev` leaves it: a node process whose command line names the repo
   and the dev port. Both, not either - `vite` alone would be any project's dev
   server, and `3005` alone could be anything at all.
*/
export function isOurDevServer (commandLine, { repoName = 'pvp-tabletop', port = 3005 } = {}) {
   const line = String(commandLine || '')
   return line.includes(repoName) && line.includes(String(port)) && /vite|npm/i.test(line)
}

/*
   The port a process was *started* with, as `--port 6392` or `--port=6392`.

   This is the whole of how a stand-in is told apart from another session's copy of
   the same script. The port cannot come from the environment: Windows does not put
   a process's environment in the process list, so the only place a session's copy
   of `fake-redis.mjs` records which port it owns is its own command line. Both
   `--port` spellings are accepted because both are legal and a caller may write
   either.
*/
export function commandLinePort (commandLine) {
   const line = String(commandLine || '')
   const match = /--port[=\s]+(\d+)/.exec(line)
   return match ? Number(match[1]) : null
}

const STAND_INS = [ 'fake-redis', 'fake-deck-api' ]

/*
   Which stand-in this is, or null for any other process.

   Matched on the *script name*, not the repository path, because these two files
   are referred to by a relative path in most of the documentation and by an
   absolute one when the script starts them.
*/
export function standInOf (commandLine) {
   const line = String(commandLine || '')
   return STAND_INS.find((name) => line.includes(name)) || null
}

/*
   Is this our stand-in? It has to be the script we started *and* on the port this
   run owns - both, for the same reason the dev server needs both.

   Name alone is what this used to match on, and name alone is unsafe the moment
   two sessions are running: every session's `fake-redis.mjs` looks identical by
   name, so `-Stop` in one worktree would close the store out from under another
   session that was in the middle of a check. The port is per-session (see
   docs/parallel-work.md), so it is what makes the match belong to one run.

   With no `port` given there is nothing to own, and this answers false for
   everything. That is deliberate: an unowned match is the bug, not a fallback.
*/
export function isOurStandIn (commandLine, { port } = {}) {
   if (!STAND_INS.includes(standInOf(commandLine))) return false
   return Number.isInteger(port) && commandLinePort(commandLine) === port
}

/*
   Where a run's two stand-ins live, given the port the app itself is on.

   One definition, used by the script that starts them, by the matcher that closes
   them, and by the checks that talk to them, so those three cannot drift apart.

   The block is two ports per session - 6390/6391 for the first, 6392/6393 for the
   second - because two *sessions* must not share a store, while the first session's
   pair has to stay 6390/6391, which is what this repository has always used and what
   the docs and `-DryRun` name. Stepping `appPort` by one therefore steps the store by
   two: the app and the store are not in the same stride, and pretending they were is
   what put a second session's store on the first session's deck API.
*/
export function standInPorts (appPort = 3005) {
   const base = Number.isInteger(appPort) ? appPort : 3005
   const block = 2 * Math.max(0, base - 3005)
   return { redis: 6390 + block, deck: 6391 + block }
}

/*
   Every process a run leaves behind, from one `Get-CimInstance Win32_Process` list.
   Each entry is { ProcessId, CommandLine } - which is all Windows gives without
   elevation, and all this needs.
*/
export function findOurs (processes, { repoName, port } = {}) {
   const found = { devServer: [], browsers: [], standins: [] }
   const { redis, deck } = standInPorts(port)

   for (const proc of processes || []) {
      const line = proc?.CommandLine
      if (!line) continue

      if (isOurDevServer(line, { repoName, port })) found.devServer.push(proc.ProcessId)
      else if (isOurBrowser(line)) found.browsers.push(proc.ProcessId)
      else if (isOurStandIn(line, { port: redis }) || isOurStandIn(line, { port: deck })) found.standins.push(proc.ProcessId)
   }

   return found
}

/*
   The whole set to stop, as one list of pids. A browser is claimed before the
   stand-in rule is tried - the two cannot collide, since a browser's command line
   does not name a stand-in - and a pid is never listed twice.
*/
export function pidsToStop (processes, options = {}) {
   const found = findOurs(processes, options)
   return [ ...new Set([ ...found.devServer, ...found.browsers, ...found.standins ]) ]
}

/*
   Which profile directories a run left behind, from a directory listing. -Stop
   removes these: a browser that has exited leaves its profile, one per page, and
   they are the script's own naming so nothing else is at risk.
*/
export function profilesToRemove (names) {
   return (names || []).filter((name) => /^pvp-chrome-\d+$/.test(String(name)))
}
