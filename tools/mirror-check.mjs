/*
   Does the repository mirror this folder?

   Compares every tracked file by its git blob hash: the tree the GitHub API
   returns already lists each file's hash, and a local file's hash can be computed
   the same way git does.

   Text files are hashed with LF endings, because that is how this project's
   commits are written and a CRLF working copy would otherwise report every file
   as different. **Binaries are hashed byte for byte** - normalising a PNG is
   nonsense, and an earlier version of this check flagged all five of the project's
   images as changed for exactly that reason.

   Usage:

      # fetch the tree the shell's way, so the encoding is right
      $tree = gh api "repos/OWNER/REPO/git/trees/main?recursive=1"
      [System.IO.File]::WriteAllText("$PWD\tree.json", $tree, (New-Object System.Text.UTF8Encoding($false)))

      node tools/mirror-check.mjs tree.json
      node tools/mirror-check.mjs tree.json --quiet   # just the verdict, for CI

   It reads UTF-8 or UTF-16 trees (PowerShell's `>` writes UTF-16, which is worth
   tolerating rather than explaining). Exits non-zero when anything differs, so it
   can gate a check.
*/

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()

/* what git would hash, treating text and binary as what they are */
const BINARY = /\.(png|jpe?g|webp|gif|ico|bmp|avif|woff2?|ttf|otf|eot|pdf|zip|gz|mp[34]|webm|mov)$/i

function blobHash (path) {
   const raw = readFileSync(path)
   const looksBinary = BINARY.test(path) || raw.includes(0)
   const content = looksBinary ? raw : Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
   const header = Buffer.from(`blob ${content.length}\0`, 'utf8')
   return createHash('sha1').update(header).update(content).digest('hex')
}

/* nothing here is in the repository by design */
const IGNORED = [
   /^node_modules\//, /^\.svelte-kit\//, /^build\//, /^\.vercel\//, /^\.npm-cache\//,
   /^\.git\//, /^\.tmp-/, /^build-log\.txt$/, /(^|\/)\.DS_Store$/, /^package\//
]
const ignored = (rel) => IGNORED.some((re) => re.test(rel))

function walk (dir, out = []) {
   for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const rel = relative(ROOT, full).split(sep).join('/')
      if (ignored(rel)) continue
      if (statSync(full).isDirectory()) walk(full, out)
      else out.push(rel)
   }
   return out
}

/* the tree GitHub hands back, in whichever encoding the shell wrote it */
function readTree (path) {
   const raw = readFileSync(path)
   let text = raw.toString('utf8')
   if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
   else if (raw.length > 1 && (raw[1] === 0 || /^\s*\{\s*\0/.test(text.slice(0, 8)))) text = raw.toString('utf16le')
   if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)

   const parsed = JSON.parse(text)
   if (!parsed || !Array.isArray(parsed.tree)) {
      throw new Error(`${path} does not look like a git tree response`)
   }
   return parsed
}

const [ treePath = 'tree.json', ...flags ] = process.argv.slice(2)
const quiet = flags.includes('--quiet')

const tree = readTree(treePath)
const inRepo = new Map(tree.tree.filter((n) => n.type === 'blob').map((n) => [ n.path, n.sha ]))

const local = walk(ROOT)
const localSet = new Set(local)

const differ = []
const onlyLocal = []
const onlyRepo = []

for (const rel of local) {
   const sha = inRepo.get(rel)
   if (!sha) { onlyLocal.push(rel); continue }
   if (blobHash(join(ROOT, rel)) !== sha) differ.push(rel)
}

for (const rel of inRepo.keys()) {
   if (!localSet.has(rel)) onlyRepo.push(rel)
}

if (!quiet) {
   console.log(`repo files: ${inRepo.size} | local files: ${local.length}`)
   console.log(`differ: ${differ.length} | only local: ${onlyLocal.length} | only in repo: ${onlyRepo.length}`)
   if (differ.length) console.log('DIFFER:\n  ' + differ.join('\n  '))
   if (onlyLocal.length) console.log('ONLY LOCAL (not in the repo):\n  ' + onlyLocal.join('\n  '))
   if (onlyRepo.length) console.log('ONLY IN REPO (missing here):\n  ' + onlyRepo.join('\n  '))
} else {
   console.log(differ.length || onlyLocal.length || onlyRepo.length ? 'DIFFERS' : 'MATCHES')
}

process.exit(differ.length || onlyLocal.length || onlyRepo.length ? 1 : 0)
