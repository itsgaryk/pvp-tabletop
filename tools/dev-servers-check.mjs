/*
   Does the cleanup in dev-servers.ps1 stop the right processes?

   This exists because the question cannot be answered where the script runs: a
   confined session can neither read a process command line (Get-CimInstance is
   denied) nor write a browser profile into the temp directory, so the matcher would
   ship untested. It lives in tools/dev-servers.lib.mjs for that reason, and this
   check is the whole of its verification - no browser, no server, no network, and
   nothing on the machine is read or stopped.

     node tools/dev-servers-check.mjs
     node tools/dev-servers-check.mjs --quiet     # verdict only

   The cases that matter are the ones that would hurt: another project's vite, the
   browser somebody opened by hand, a path in its 8.3 form, and a run started with
   more pages than any one invocation asks for.
*/

import { findOurs, pidsToStop, isOurBrowser, isOurDevServer, isOurStandIn, chromeProfilePort, profilesToRemove } from './dev-servers.lib.mjs'

const quiet = process.argv.includes('--quiet')
let failures = 0

const check = (label, ok, detail = '') => {
   if (!quiet || !ok) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

const proc = (ProcessId, CommandLine) => ({ ProcessId, CommandLine })

const REPO = 'C:\\deepseek-github\\pvp-tabletop-project3'
const TEMP = 'C:\\Users\\Gary K\\AppData\\Local\\Temp'

/* ------------------------------------------------------------- the positives */

const ours = [
   proc(100, `"C:\\Program Files\\nodejs\\node.exe" ${REPO}\\node_modules\\vite\\bin\\vite.js dev --port 3005`),
   proc(200, `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --headless=new --disable-gpu --remote-debugging-port=9222 --user-data-dir=${TEMP}\\pvp-chrome-9222 --window-size=1277,821 about:blank`),
   proc(201, `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --headless=new --remote-debugging-port=9223 --user-data-dir=${TEMP}\\pvp-chrome-9223 about:blank`),
   proc(202, `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --headless=new --remote-debugging-port=9224 --user-data-dir=${TEMP}\\pvp-chrome-9224 about:blank`),
   proc(300, `node ${REPO}\\tools\\fake-redis.mjs`),
   proc(301, `node ${REPO}\\tools\\fake-deck-api.mjs`)
]

const found = findOurs(ours, { repoName: 'pvp-tabletop', port: 3005 })
check('the dev server is found', found.devServer.join() === '100', JSON.stringify(found.devServer))
check('all three browsers are found', found.browsers.join() === '200,201,202', JSON.stringify(found.browsers))
check('both stand-ins are found', found.standins.join() === '300,301', JSON.stringify(found.standins))
check('and the set to stop is all six, once each', pidsToStop(ours, { repoName: 'pvp-tabletop', port: 3005 }).length === 6,
   JSON.stringify(pidsToStop(ours, { repoName: 'pvp-tabletop', port: 3005 })))

/* ------------------------------------------------- the false positives, which are the point */

check('another project\'s vite is left alone',
   pidsToStop([ proc(400, 'node C:\\other\\project\\node_modules\\vite\\bin\\vite.js dev --port 3005') ], { repoName: 'pvp-tabletop', port: 3005 }).length === 0)

check('a dev server on another port in this repo is left alone',
   pidsToStop([ proc(401, `node ${REPO}\\node_modules\\vite\\bin\\vite.js dev --port 5199`) ], { repoName: 'pvp-tabletop', port: 3005 }).length === 0)

check('the browser you opened yourself is left alone',
   pidsToStop([ proc(500, `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir=${TEMP}\\chrome-profile-mine about:blank`) ]).length === 0)

check('the same for Edge, and for a bare chrome with no profile flag',
   pidsToStop([
      proc(501, `"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --user-data-dir=${TEMP}\\my-edge about:blank`),
      proc(502, '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --headless=new about:blank')
   ]).length === 0)

check('a user-data-dir that merely mentions pvp-chrome is not matched on its own',
   isOurBrowser(`chrome --user-data-dir=${TEMP}\\notes-about-pvp-chrome`) === false)

check('a process with no command line is skipped rather than guessed at',
   pidsToStop([ proc(600, null), proc(601, ''), proc(602, undefined) ]).length === 0)

check('an empty list is not an error', pidsToStop([]).length === 0 && pidsToStop(null).length === 0)

/* ----------------------------------------------------------- the awkward shapes */

/* what Windows hands back for a path with a space and more than 8 characters */
const shortForm = 'C:\\Users\\GARYK~1\\AppData\\Local\\Temp\\pvp-chrome-9222'
check('a profile path in its 8.3 form is still recognised',
   isOurBrowser(`chrome --user-data-dir=${shortForm}`) === true, String(chromeProfilePort(`chrome --user-data-dir=${shortForm}`)))
check('and its port is read out of the short path', chromeProfilePort(`chrome --user-data-dir=${shortForm}`) === 9222)

check('a run with more pages than this invocation asks for still cleans up: 9422 counts',
   isOurBrowser(`chrome --user-data-dir=${TEMP}\\pvp-chrome-9422`) === true)

check('the dev server is matched on the repo and the port together',
   isOurDevServer(`node ${REPO}\\node_modules\\vite\\bin\\vite.js dev --port 3005`, { repoName: 'pvp-tabletop', port: 3005 }) === true &&
   isOurDevServer(`node C:\\other\\vite dev --port 3005`, { repoName: 'pvp-tabletop', port: 3005 }) === false)

check('the stand-ins are matched by name and nothing else',
   isOurStandIn('node tools/fake-redis.mjs') && isOurStandIn('node tools/fake-deck-api.mjs') &&
   isOurStandIn('node tools/browser-check.mjs') === false)

/* --------------------------------------------------------------- the profiles */

check('only this script\'s profile directories are removed',
   profilesToRemove([ 'pvp-chrome-9222', 'pvp-chrome-9224', 'chrome-profile-mine', 'pvp-chrome-', 'pvp-chrome-abc', 'Temp' ]).join() === 'pvp-chrome-9222,pvp-chrome-9224')

console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed`)
   process.exit(1)
}
console.log('verdict: ok - the cleanup stops what it started and nothing else')
