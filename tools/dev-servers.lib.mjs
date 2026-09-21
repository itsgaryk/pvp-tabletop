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

export function isOurStandIn (commandLine) {
   const line = String(commandLine || '')
   return line.includes('fake-redis') || line.includes('fake-deck-api')
}

/*
   Every process a run leaves behind, from one `Get-CimInstance Win32_Process` list.
   Each entry is { ProcessId, CommandLine } - which is all Windows gives without
   elevation, and all this needs.
*/
export function findOurs (processes, { repoName, port } = {}) {
   const found = { devServer: [], browsers: [], standins: [] }

   for (const proc of processes || []) {
      const line = proc?.CommandLine
      if (!line) continue

      if (isOurDevServer(line, { repoName, port })) found.devServer.push(proc.ProcessId)
      else if (isOurBrowser(line)) found.browsers.push(proc.ProcessId)
      else if (isOurStandIn(line)) found.standins.push(proc.ProcessId)
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
