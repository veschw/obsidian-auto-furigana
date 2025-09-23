// make-dict-manifest.mjs
// Node >=18. Run from repo root.
// Usage:
//   TAG=kuromoji_dicts_0.1.2 OWNER=<owner> REPO=<repo> node make-dict-manifest.mjs
// Optional env: OWNER, REPO, TAG, DICT_DIR, OUT

import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const OWNER = process.env.OWNER || 'veschw'
const REPO = process.env.REPO || 'obsidian-auto-furigana'
const TAG = process.env.TAG || 'kuromoji_dicts_0.1.2'

const DICT_DIR = resolve(process.env.DICT_DIR || './dict')
const OUT_PATH = resolve(process.env.OUT || './dict.manifest.json')

const GH_RELEASE_BASE = `https://github.com/${OWNER}/${REPO}/releases/download/${TAG}`

async function sha256Hex (absPath) {
  const buf = await fs.readFile(absPath)
  const h = createHash('sha256').update(buf).digest('hex')
  return { sha256: h, bytes: buf.byteLength }
}

async function listDictFiles (dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.dat.gz'))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b))
}

async function loadExistingOverrides (outPath) {
  try {
    const raw = await fs.readFile(outPath, 'utf8')
    const json = JSON.parse(raw)
    return typeof json._overrides === 'object' ? json._overrides : undefined
  } catch {
    return undefined
  }
}

async function main () {
  const files = await listDictFiles(DICT_DIR)
  if (files.length === 0) {
    throw new Error(`No *.dat.gz files found under ${DICT_DIR}`)
  }

  const manifest = {}
  for (const name of files) {
    const abs = resolve(DICT_DIR, name)
    manifest[name] = await sha256Hex(abs)
  }

  const overrides = await loadExistingOverrides(OUT_PATH)

  // Order: sources, _overrides, then files by name
  const ordered = {}
  ordered.sources = [GH_RELEASE_BASE]
  if (overrides) ordered._overrides = overrides
  for (const name of files) ordered[name] = manifest[name]

  const json = JSON.stringify(ordered, null, 2) + '\n'
  await fs.writeFile(OUT_PATH, json, 'utf8')
  console.log(`Wrote ${OUT_PATH} with ${files.length} entries.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
