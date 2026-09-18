/*
 * Is the thing I merged actually live?
 *
 * Deploy lag cost three rounds once: a PR was merged but not serving, the check
 * was done by hand twice, and "deployed" was claimed once when it was not. This
 * answers it in one command, from the outside, without a browser:
 *
 *   node tools/deployed.mjs --url https://your-app.vercel.app
 *   node tools/deployed.mjs --url https://your-app.vercel.app "some marker"
 *   node tools/deployed.mjs --url https://your-app.vercel.app --compare logoText
 *   node tools/deployed.mjs --local                  # just this build
 *   DEPLOY_URL=https://your-app.vercel.app node tools/deployed.mjs marker
 *
 * Two independent answers, because either alone can mislead:
 *
 *   the fingerprint - SvelteKit writes /_app/version.json, and every asset
 *   carries a content hash in its filename. Two builds of the same source
 *   produce the same set; a different set means the deployment is a different
 *   build, whatever the dashboard says.
 *
 *   the marker - a literal string you know is in your change. It is searched in
 *   the local build and in the served bundle, and "local yes, deployment no" is
 *   the exact answer to "has my merge shipped?".
 *
 * A marker has to survive minification, so pick a string literal, a route path,
 * an event name or a CSS class - not an identifier you invented, which the
 * minifier is free to rename.
 *
 * Read-only: it fetches, and never deploys, promotes or purges anything.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/* only these are worth hashing with intent to search; a png is hashed, never read as text */
const TEXT = /\.(js|mjs|css|json|html|svg|txt|map)$/i
const APP_PREFIX = '/_app/'

/*
   The files the fingerprint is compared over: the module graph a browser can
   reach. Images and fonts are left out on both sides because the served side is
   discovered by following imports, and a png is never imported - version.json
   covers "is this the same build" for those.
*/
const COMPARABLE = /\.(js|mjs|css|json)$/i

/* a graph crawl is bounded, so a pathological build cannot turn into a spider */
const MAX_ASSETS = 300

const opts = {
   url: process.env.DEPLOY_URL || process.env.APP_URL || null,
   json: false,
   localOnly: false,
   local: null,
   markers: []
}

const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
   const arg = argv[i]
   if (arg === '--json') opts.json = true
   else if (arg === '--local') opts.localOnly = true
   else if (arg === '--url') opts.url = argv[++i] || null
   else if (arg.startsWith('--url=')) opts.url = arg.slice(6)
   else if (arg === '--dir') opts.local = argv[++i] || null
   else if (arg.startsWith('--dir=')) opts.local = arg.slice(6)
   else if (arg === '--help' || arg === '-h') { usage(); process.exit(0) }
   else if (arg.startsWith('-')) fail(`unknown option ${arg}`)
   else opts.markers.push(arg)
}

function usage () {
   console.log(`Ask whether a deployment is the build you think it is.

usage: node tools/deployed.mjs [--url URL] [--dir PATH] [--local] [--json] [marker ...]

  --url URL   deployment to inspect (or $DEPLOY_URL / $APP_URL)
  --dir PATH  local build to compare against (default .vercel/output/static,
              falling back to .svelte-kit/output/client)
  --local     inspect only the local build, no network
  --json      structured output

With no markers it prints the two fingerprints, which is enough on its own:
different fingerprints mean a different build. Each marker is then searched in
both, and "local yes, deployment no" means the change has not shipped.`)
}

function fail (message) {
   console.error(`deployed: ${message}`)
   console.error('usage: node tools/deployed.mjs [--url URL] [--dir PATH] [--local] [marker ...]')
   process.exit(1)
}

if (opts.url) opts.url = opts.url.replace(/\/+$/, '')
if (!opts.url && !opts.localOnly) {
   fail('no deployment to inspect - pass --url, or set DEPLOY_URL, or use --local')
}

const shortHash = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 12)

/* --------------------------------------------------------------- local side -- */

/*
   The local build, i.e. what `npm run build` just produced. `.vercel/output/static`
   is the directory a Vercel deploy actually serves, so it is preferred: checking
   against it is checking against the artefact rather than a near-copy of it.
*/
function localAppDir () {
   if (opts.local) {
      if (!existsSync(opts.local)) fail(`no such directory: ${opts.local}`)
      return opts.local
   }

   const candidates = [
      join(process.cwd(), '.vercel', 'output', 'static', '_app'),
      join(process.cwd(), '.svelte-kit', 'output', 'client', '_app')
   ]

   for (const dir of candidates) if (existsSync(dir)) return dir

   fail('no local build found - run `npm run build` first, or pass --dir')
}

function walk (root, dir = root, out = []) {
   for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(root, full, out)
      else out.push(full)
   }
   return out
}

function readLocal () {
   const appDir = localAppDir()
   const files = new Map()

   for (const full of walk(appDir)) {
      const key = relative(appDir, full).split(sep).join('/')
      files.set(key, readFileSync(full))
   }

   let version = null
   if (files.has('version.json')) {
      try { version = JSON.parse(files.get('version.json').toString()).version } catch { version = null }
   }

   return { source: appDir, root: join(appDir, '..'), version, files }
}

/* ------------------------------------------------------------ deployed side -- */

async function fetchAsset (url, { text = false } = {}) {
   const res = await fetch(url)
   if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
   return {
      buffer: Buffer.from(await res.arrayBuffer()),
      headers: Object.fromEntries(res.headers)
   }
}

/*
   A path that can only be a real build asset. Loose matching here is not
   harmless: Vite's output is full of quoted fragments that end in `.js` or
   `.css` (`".css"`, template pieces, `__vite__mapDeps` entries with Windows
   separators), and treating those as assets fills the report with paths that
   404 on a real CDN and makes a matching deployment look like a different one.

   Checking the basename rather than the whole string is what catches the bare
   `".css"` case: resolving that against the entry gives
   `/_app/immutable/entry/.css`, which looks like a path but is a fragment.
*/
function isCleanAsset (resolved) {
   if (!resolved.startsWith('/_app/immutable/')) return false
   const base = resolved.slice(resolved.lastIndexOf('/') + 1)
   return /^[A-Za-z0-9_@~][A-Za-z0-9_@.~-]*\.(?:js|mjs|css|json)$/.test(base)
}

/*
   Every asset path a chunk refers to, as a served path.

   This is what makes the marker answer trustworthy. A browser does not load
   every chunk in the deployment: the HTML preloads the entry, and the rest is
   reached through `import()` - so searching only what the HTML mentions would
   report a perfectly deployed route chunk as "NOT FOUND", which is the same
   wrong "not deployed" claim this tool exists to stop. Following the graph is
   what a browser does, so it is what the check has to do.
*/
function assetRefs (text, fromPath) {
   const out = new Set()

   for (const match of text.matchAll(/["'`]([^"'`\s]+)["'`]/g)) {
      let ref = match[1]
      if (!/\.(js|mjs|css|json)$/i.test(ref)) continue
      if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:')) continue
      /* a path with an interpolation in it is not a path */
      if (ref.includes('${')) continue
      /*
         Vite writes Windows separators into its dependency arrays
         ("..\\nodes\\3.js"), while the import beside it uses forward slashes.
         Both mean the same file, so both are normalised to one.
      */
      ref = ref.replace(/\\/g, '/')

      let resolved
      try {
         /* resolved against the importing file, exactly as the browser resolves it */
         resolved = new URL(ref, `http://assets${fromPath}`).pathname.replace(/\/{2,}/g, '/')
      } catch {
         continue
      }

      if (isCleanAsset(resolved)) out.add(resolved)
   }

   return out
}

/* the initial set: what the served HTML itself references */
function htmlRefs (html) {
   return [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((ref) => ref.includes(APP_PREFIX))
      .map((ref) => {
         const path = ref.startsWith('http') ? new URL(ref).pathname : ref
         return (path.startsWith('/') ? path : `/${path}`).replace(/\/{2,}/g, '/')
      })
}

async function readDeployed (base) {
   const res = await fetch(`${base}/`)
   if (!res.ok) throw new Error(`${base}/ -> HTTP ${res.status}`)
   const html = await res.text()

   const files = new Map()
   const missing = []
   const queue = [...new Set([...htmlRefs(html), `${APP_PREFIX}version.json`])]
   const queued = new Set(queue)

   while (queue.length && files.size < MAX_ASSETS) {
      const path = queue.shift()

      try {
         const { buffer } = await fetchAsset(base + path)
         /*
            Keyed relative to `_app`, which is how the local side is keyed, so the
            two sets can be compared name for name. The served path keeps its
            leading `/_app/`, the local one does not.
         */
         files.set(path.replace(APP_PREFIX, ''), buffer)

         if (/\.(js|mjs|css)$/i.test(path)) {
            for (const ref of assetRefs(buffer.toString('utf8'), path)) {
               if (!queued.has(ref)) {
                  queued.add(ref)
                  queue.push(ref)
               }
            }
         }
      } catch (err) {
         missing.push({ path, error: err.message })
      }
   }

   let version = null
   const raw = files.get('version.json')
   if (raw) {
      try { version = JSON.parse(raw.toString()).version } catch { version = null }
   }

   return {
      base,
      version,
      files,
      missing,
      headers: Object.fromEntries(res.headers),
      html
   }
}

/* ------------------------------------------------------------------ analysis -- */

/* relative paths, so the two sides can be compared entry by entry */
const keysOf = (local) => [...local.files.keys()]

function looksText (key) {
   return TEXT.test(key)
}

function searchMarkers (marker, sets) {
   const found = {}
   for (const [side, files] of Object.entries(sets)) {
      if (!files) { found[side] = null; continue }
      const hits = []
      for (const [key, buffer] of files) {
         if (!looksText(key)) continue
         const text = buffer.toString('utf8')
         const count = text.split(marker).length - 1
         if (count > 0) hits.push({ file: key, count })
      }
      found[side] = hits
   }
   return found
}

function compareFiles (local, deployed) {
   /*
      Only the module graph on both sides. The served side is discovered by
      following imports, so an image the app fetches at runtime would always look
      "local only" and turn a matching deployment into a scary-looking diff.
   */
   const mine = new Set(keysOf(local).filter((key) => COMPARABLE.test(key)))
   const theirs = new Set([...deployed.files.keys()].filter((key) => COMPARABLE.test(key)))

   /* filename hashes mean an asset that changed is simply a different name */
   const onlyLocal = [...mine].filter((key) => !theirs.has(key)).sort()
   const onlyDeployed = [...theirs].filter((key) => !mine.has(key)).sort()
   const same = [...mine].filter((key) => theirs.has(key)).length

   return { onlyLocal, onlyDeployed, same }
}

/* -------------------------------------------------------------------- output -- */

const pad = (value, width) => String(value ?? '').padEnd(width)

function printHuman (model) {
   const { local, deployed, markers, verdict } = model

   console.log(`deployment: ${deployed ? deployed.base : '(not checked - --local)'}`)

   if (deployed) {
      const cache = deployed.headers['x-vercel-cache'] || deployed.headers['cache-control'] || 'n/a'
      const age = deployed.headers['age']
      const date = deployed.headers['date']
      console.log(`  served at: ${date || 'unknown'}   cache: ${cache}${age ? `   age: ${age}s` : ''}`)
      if (deployed.missing.length) {
         console.log(`  ${deployed.missing.length} referenced asset(s) did not answer:`)
         for (const item of deployed.missing.slice(0, 5)) console.log(`    ${item.path} - ${item.error}`)
      }
   }

   console.log('\nbuild fingerprints')
   const countOf = (files) => [...files.keys()].filter((key) => COMPARABLE.test(key)).length
   console.log(`  local build   version ${pad(local.version, 18)} ${countOf(local.files)} module-graph files   (${local.source})`)
   if (deployed) {
      console.log(`  deployment    version ${pad(deployed.version, 18)} ${countOf(deployed.files)} module-graph files`)
   }

   if (deployed) {
      const diff = compareFiles(local, deployed)
      console.log(`\nmodule graph: ${diff.same} identical filename(s), ${diff.onlyLocal.length} local-only, ${diff.onlyDeployed.length} deployment-only`)
      for (const key of diff.onlyLocal.slice(0, 10)) console.log(`  local only      ${key}`)
      if (diff.onlyLocal.length > 10) console.log(`  ... and ${diff.onlyLocal.length - 10} more local-only`)
      for (const key of diff.onlyDeployed.slice(0, 10)) console.log(`  deployed only   ${key}`)
      if (diff.onlyDeployed.length > 10) console.log(`  ... and ${diff.onlyDeployed.length - 10} more deployment-only`)
   }

   if (markers.length) {
      console.log('\nmarkers')
      for (const entry of markers) {
         console.log(`  "${entry.marker}"`)
         for (const [side, hits] of Object.entries(entry.hits)) {
            if (hits === null) {
               console.log(`    ${pad(side, 11)} (not checked)`)
            } else if (!hits.length) {
               console.log(`    ${pad(side, 11)} NOT FOUND`)
            } else {
               const total = hits.reduce((sum, hit) => sum + hit.count, 0)
               console.log(`    ${pad(side, 11)} found x${total} in ${hits.map((hit) => hit.file).join(', ')}`)
            }
         }
      }
   }

   console.log(`\nverdict: ${verdict}`)
}

function printJson (model) {
   const plain = {
      deployment: model.deployed
         ? {
            base: model.deployed.base,
            version: model.deployed.version,
            headers: model.deployed.headers,
            missing: model.deployed.missing,
            files: [...model.deployed.files.keys()].sort()
         }
         : null,
      local: {
         source: model.local.source,
         version: model.local.version,
         files: [...model.local.files.keys()].sort()
      },
      markers: model.markers,
      verdict: model.verdict
   }

   console.log(JSON.stringify(plain, null, 2))
}

/* ---------------------------------------------------------------------- main -- */

const local = readLocal()

let deployed = null
if (!opts.localOnly) {
   try {
      deployed = await readDeployed(opts.url)
   } catch (err) {
      fail(`could not read the deployment: ${err.message}`)
   }
}

const sets = {
   local: local.files,
   deployment: deployed ? deployed.files : null
}

const markers = opts.markers.map((marker) => ({
   marker,
   hits: searchMarkers(marker, sets)
}))

/* ---- the verdict: one sentence, and it should be the true one ---- */

/*
   The verdict: one sentence, and it has to be the true one.

   The marker answer is preferred over the fingerprint one, because it is the
   question that was actually asked ("is my change live?"). It is only trusted
   when the marker is in the local build at all - a marker that is nowhere
   proves nothing, and saying "not deployed" on that basis would be the same
   mistake the deploy-lag rounds were made of.
*/
const localHas = (entry) => Boolean(entry.hits.local?.length)
const deployedHas = (entry) => Boolean(entry.hits.deployment?.length)

const diff = deployed ? compareFiles(local, deployed) : null
const notShipped = markers.filter((entry) => localHas(entry) && !deployedHas(entry))
const nowhere = markers.filter((entry) => !localHas(entry) && !deployedHas(entry))
const sameVersion = Boolean(deployed) && deployed.version != null && deployed.version === local.version
const setsMatch = deployed && diff.onlyLocal.length === 0 && diff.onlyDeployed.length === 0

let verdict
if (!deployed) {
   verdict = `local build only - version ${local.version}, ${local.files.size} files`
} else if (notShipped.length) {
   verdict = `NOT DEPLOYED - ${notShipped.map((entry) => `"${entry.marker}"`).join(', ')} `
      + `${notShipped.length === 1 ? 'is' : 'are'} in the local build but not in the served bundle, `
      + `so the deployment is behind this build. Wait for the build, or check the Vercel dashboard.`
} else if (markers.length && !markers.some(localHas)) {
   verdict = `cannot tell - none of the markers are in the local build either, so they prove nothing. `
      + `Pick a string that is in your change and survives minification (a literal, a route path, an event name).`
} else if (sameVersion) {
   verdict = `deployed - the served bundle is this build (version ${local.version})`
} else if (setsMatch) {
   verdict = `deployed, but version.json differs (local ${local.version}, live ${deployed.version}) - `
      + `every asset name matches, so this is a rebuild of the same source`
} else {
   verdict = `a DIFFERENT build is live - ${diff.onlyLocal.length} asset(s) in this build are not served `
      + `and ${diff.onlyDeployed.length} served asset(s) are not in this build `
      + `(local ${local.version}, live ${deployed.version}).`
   if (nowhere.length) {
      verdict += ` Note: ${nowhere.map((entry) => `"${entry.marker}"`).join(', ')} `
         + `${nowhere.length === 1 ? 'is' : 'are'} in neither, so ${nowhere.length === 1 ? 'it proves' : 'they prove'} nothing.`
   }
}

const model = { local, deployed, markers, verdict }

if (opts.json) printJson(model)
else printHuman(model)
