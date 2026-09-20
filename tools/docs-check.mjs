/*
   Do the documentation's own links still resolve?

   The README and the files under docs/ are meant to be read by following links
   between them - "see Leaving, and what closes a room" is a real link now - and
   a link that has gone stale fails in exactly one way: silently. GitHub renders
   it as ordinary text, so a reader lands at the top of the wrong page and
   nothing anywhere says a word.

   Both halves of a link are checked, because each is wrong in its own way:

      the file    must exist, resolved against the file the link was written in
      the anchor  must match a heading in that file, by GitHub's slug rules:
                  lower-cased, punctuation dropped, spaces to hyphens, and a
                  -1/-2 suffix where a heading repeats in one file

   A document that nothing links to is reported too. The README is the index, so
   a doc no other doc mentions is a doc nobody will find.

   Usage:

      node tools/docs-check.mjs            # a line per document, then a verdict
      node tools/docs-check.mjs --quiet    # just the verdict, for CI

   It is read-only: no browser, no network, no store, nothing to configure.
   Exits non-zero when a link is broken, so it can gate a check.

   Note the slug is computed the simple way, which is right for the headings this
   project has - they are ASCII, and the punctuation between them and GitHub's own
   slugger is the same set. A heading carrying an accent or a typographic dash
   would slug differently here than on GitHub, and this would then report a link
   that GitHub resolves. If a heading ever grows one, this needs GitHub's slugger
   rather than a cleverer regex.
*/

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve, relative, extname } from 'node:path'

const ROOT = process.cwd()
const DOCS = 'docs'
const quiet = process.argv.includes('--quiet')

/* GitHub's heading slug, with the counter it appends to a repeated heading */
function slug (heading, seen) {
   const base = heading.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/ /g, '-')
   const n = seen.get(base) || 0
   seen.set(base, n + 1)
   return n === 0 ? base : `${base}-${n}`
}

function anchorsIn (text) {
   const seen = new Map()
   const found = new Set()
   for (const line of text.split(/\r?\n/)) {
      const m = /^#{1,6} +(.*)$/.exec(line)
      if (m) found.add(slug(m[1], seen))
   }
   return found
}

/* a heading inside a fenced block is not a heading, and neither is a link a
   link - diagnostics.md prints both, in the room-log verdict and the shell
   transcripts */
function unfenced (text) {
   let inside = false
   return text.split(/\r?\n/).map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
         inside = !inside
         return ''
      }
      return inside ? '' : line
   }).join('\n')
}

/* the title a markdown link may carry is part of neither half we check, and a
   link that has one must not be skipped rather than checked */
const LINK = /(!?)\[[^\]]*\]\(\s*([^)\s]+?)(?:\s+"[^"]*")?\s*\)/g
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

const isDir = (path) => {
   try {
      return statSync(path).isDirectory()
   } catch {
      return false
   }
}

const isFile = (path) => {
   try {
      return statSync(path).isFile()
   } catch {
      return false
   }
}

const files = [
   'README.md',
   ...readdirSync(DOCS).filter((f) => f.endsWith('.md')).sort().map((f) => `${DOCS}/${f}`)
]

const text = new Map(files.map((f) => [ f, unfenced(readFileSync(f, 'utf8')) ]))
const anchors = new Map()
const anchorsOf = (path) => {
   if (!anchors.has(path)) anchors.set(path, anchorsIn(readFileSync(path, 'utf8')))
   return anchors.get(path)
}

const broken = []
const inbound = new Map(files.map((f) => [ f, 0 ]))
const counts = new Map()

for (const file of files) {
   let checked = 0
   for (const m of text.get(file).matchAll(LINK)) {
      const [ , bang, target ] = m
      if (bang === '!') continue // an image, not a link to a document
      if (EXTERNAL.test(target)) continue // somebody else's URL is not ours to check
      checked += 1

      const hash = target.indexOf('#')
      const rawPath = hash === -1 ? target : target.slice(0, hash)
      const anchor = hash === -1 ? '' : target.slice(hash + 1)

      const path = rawPath === '' ? file : resolve(dirname(file), decodeURIComponent(rawPath))
      const where = relative(ROOT, path).split('\\').join('/') || '.'

      if (rawPath.endsWith('/') || isDir(path)) {
         if (!isDir(path)) broken.push(`${file}: "${target}" -> ${where}/ is not a directory`)
         continue
      }
      if (!isFile(path)) {
         broken.push(`${file}: "${target}" -> ${where} does not exist`)
         continue
      }
      if (extname(path) === '.md' && inbound.has(where)) inbound.set(where, inbound.get(where) + 1)

      if (anchor !== '' && extname(path) === '.md' && !anchorsOf(path).has(anchor)) {
         broken.push(`${file}: "${target}" -> ${where} has no heading "#${anchor}"`)
      }
   }
   counts.set(file, checked)
}

/* the README is the index, so everything else should be reachable from it */
const orphans = files.filter((f) => f !== 'README.md' && (inbound.get(f) || 0) === 0)

if (!quiet) {
   for (const file of files) {
      const n = counts.get(file)
      console.log(`${file.padEnd(24)} ${String(n).padStart(2)} ${n === 1 ? 'link ' : 'links'}`)
   }
   console.log('')
}

const total = [ ...counts.values() ].reduce((a, b) => a + b, 0)

if (broken.length) {
   console.log(`broken links (${broken.length}):`)
   for (const b of broken) console.log(`  [x] ${b}`)
}
if (orphans.length) {
   console.log(`not linked from any page (${orphans.length}):`)
   for (const f of orphans) console.log(`  [-] ${f}`)
}

if (broken.length || orphans.length) {
   console.log(`\nverdict: ${broken.length} broken link${broken.length === 1 ? '' : 's'}, ${orphans.length} unreachable doc${orphans.length === 1 ? '' : 's'}`)
   process.exit(1)
}

console.log(`verdict: ok - ${total} links across ${files.length} files, every one resolves`)
