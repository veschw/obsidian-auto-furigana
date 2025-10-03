/**
 * One-time installer for the Kuromoji ipadic dictionary files.
 *
 * Responsibilities
 *  - Verify that required dictionary files exist under:
 *      .obsidian/plugins/<plugin-id>/dict/
 *  - Validate each file by byte size and SHA-256.
 *  - Download missing or corrupted files from the first working source.
 *  - Write files via Obsidian's vault adapter, with console-only progress logs.
 *
 * Source configuration
 *  - `dict.manifest.json` provides integrity data:
 *      { "<file>": { sha256, bytes }, ... }
 *  - The same JSON also carries global download bases:
 *      { "sources": [<baseURL1>, <baseURL2>, ...] }
 *    Resolution: all files use the top-level `sources` list.
 *
 * Failures
 *  - Warnings and errors are logged to the console only.
 *  - Errors are thrown to allow upstream handling; installation stops on first failure.
 */

import { App, requestUrl } from 'obsidian'
import type { PluginManifest } from 'obsidian'
import dictManifest from './dict.manifest.json'

/** ---- Tunables ---------------------------------------------------------- */

/** Soft timeout for a single HTTP attempt (ms). */
const DOWNLOAD_TIMEOUT_MS = 15_000

/** How many times to retry per base URL before moving to the next one. */
const PER_BASE_RETRIES = 2

/** Initial backoff between retries (ms). Grows exponentially per attempt. */
const RETRY_BACKOFF_MS = 800

/** Prefix for all console logs from this module. */
const LOGP = '[AutoFurigana/DictInstaller]'

/** ---- Types ------------------------------------------------------------- */

interface DictEntry {
  sha256: string
  bytes: number
}

interface DictManifest {
  sources?: string[]
  [filename: string]: any
}

/** ---- Helpers ----------------------------------------------------------- */

function isValidManifest (m: unknown): m is DictManifest {
  if (!m || typeof m !== 'object') return false
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    if (k === 'sources') continue
    if (!v || typeof v !== 'object') continue
    const ent = v as DictEntry
    if (typeof ent.sha256 !== 'string' || typeof ent.bytes !== 'number') return false
  }
  return true
}

async function sha256Hex (buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf)
  const bytes = new Uint8Array(hash)
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

async function tryReadBinary (app: App, relPath: string): Promise<ArrayBuffer | null> {
  try {
    const ab = await (app.vault.adapter as any).readBinary(relPath)
    if (ab && (ab as ArrayBuffer).byteLength !== undefined) return ab as ArrayBuffer
    return null
  } catch {
    return null
  }
}

function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Wrap Obsidian's requestUrl with a soft timeout. If the timeout fires, reject.
 * Note: requestUrl currently has no AbortController; the in-flight request is
 * not canceled but the caller proceeds as if timed out.
 */
async function requestUrlWithTimeout (url: string, timeoutMs: number): Promise<ArrayBuffer> {
  let timer: number | undefined
  try {
    const timeoutPromise = new Promise<ArrayBuffer>((resolve, reject) => {
      timer = window.setTimeout(() => {
        reject(new Error(`Timeout after ${timeoutMs} ms`))
      }, timeoutMs)
    })

    const resPromise = (async () => {
      const res = await requestUrl({ url, method: 'GET', throw: true })
      const data: ArrayBuffer | undefined =
        (res as any).arrayBuffer ?? (res as any).contentArrayBuffer
      if (!data) throw new Error('No binary data in response')
      return data
    })()

    return await Promise.race([resPromise, timeoutPromise])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Download a file from the first working base URL, with retries & timeout per base.
 * Throws if all candidates fail.
 */
async function fetchWithFallback (
  fileName: string,
  bases: string[],
  timeoutMs = DOWNLOAD_TIMEOUT_MS
): Promise<ArrayBuffer> {
  let lastErr: unknown = null

  for (const base of bases) {
    const url = base.endsWith('/') ? `${base}${fileName}` : `${base}/${fileName}`
    // console.info(`${LOGP} Attempting download of ${fileName} from base: ${base}`)
    for (let attempt = 0; attempt <= PER_BASE_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const backoff = RETRY_BACKOFF_MS * (2 ** (attempt - 1))
          console.warn(`${LOGP} Retry ${attempt}/${PER_BASE_RETRIES} for ${url} after ${backoff} ms…`)
          await sleep(backoff)
        }

        // console.info(`${LOGP} GET ${url}`)
        const data = await requestUrlWithTimeout(url, timeoutMs)
        return data
      } catch (e) {
        lastErr = e
        const msg = e instanceof Error ? e.message : String(e)
        const isLastAttempt = attempt === PER_BASE_RETRIES
        console.warn(`${LOGP} Download attempt failed for ${url}: ${msg}${isLastAttempt ? ' (moving to next source)' : ''}`)
        // continue to next retry or next base
      }
    }
  }

  console.error(`${LOGP} All sources failed for ${fileName}.`)
  throw lastErr ?? new Error('All sources failed')
}

/** ---- Public API -------------------------------------------------------- */

/**
 * Ensure that all dictionary files are present and valid in the vault.
 * Missing or invalid files are downloaded using the manifest-provided sources.
 *
 * Console-only logging. Errors are thrown for upstream handling.
 */
export async function ensureDictInstalled (app: App, manifest: PluginManifest): Promise<void> {
  if (!isValidManifest(dictManifest)) {
    console.error(`${LOGP} Invalid dict.manifest.json; cannot verify or install dictionaries.`)
    return
  }

  const configDir = (app.vault as any).configDir ?? '.obsidian'
  const pluginDir = `${configDir}/plugins/${manifest.id}`.replace(/\\/g, '/')
  const dictDir = `${pluginDir}/dict`
  const adapter: any = app.vault.adapter

  // Ensure destination directory exists.
  try {
    if (!(await adapter.exists(dictDir))) {
      console.info(`${LOGP} Creating dict directory: ${dictDir}`)
      await adapter.mkdir(dictDir)
    }
  } catch (e) {
    console.error(`${LOGP} Failed to create dict directory: ${dictDir}`, e)
    throw e
  }

  // Collect file entries from the manifest (exclude control keys).
  const manifestJson = dictManifest as DictManifest
  const names = Object.keys(manifestJson)
    .filter(k => k !== 'sources')
    .sort()

  // Determine which files require installation.
  const toInstall: string[] = []
  for (const name of names) {
    const rel = `${dictDir}/${name}`
    const want = manifestJson[name] as DictEntry

    try {
      const buf = await tryReadBinary(app, rel)
      if (buf) {
        const sizeOk = buf.byteLength === want.bytes
        const gotSha = await sha256Hex(buf)
        const shaOk = gotSha === want.sha256

        if (sizeOk && shaOk) {
          continue
        }

        // log why validation failed
        if (!sizeOk) {
          console.warn(`${LOGP} Size mismatch for ${name}: expected ${want.bytes}B, got ${buf.byteLength}B.`)
        }
        if (!shaOk) {
          console.warn(`${LOGP} SHA-256 mismatch for ${name}: expected ${want.sha256}, got ${gotSha}.`)
        }
      } else {
        // console.warn(`${LOGP} Missing file: ${name}`)
      }
    } catch (e) {
      console.warn(`${LOGP} Failed to read/validate ${name}; will reinstall.`, e)
    }

    toInstall.push(name)
  }

  if (toInstall.length === 0) {
    // console.info(`${LOGP} All dictionary files present and valid.`)
    return
  }

  // If sources are missing entirely and installation is needed, warn and stop.
  const bases = (manifestJson.sources ?? []).filter(s => typeof s === 'string' && s.length > 0)
  if (bases.length === 0) {
    console.error(`${LOGP} No download sources configured in dict.manifest.json; cannot install missing dictionaries.`)
    return
  }

  // Install files sequentially. Console logs indicate progress.
  let installed = 0
  for (const name of toInstall) {
    const rel = `${dictDir}/${name}`
    const want = manifestJson[name] as DictEntry

    try {
      const data = await fetchWithFallback(name, bases, DOWNLOAD_TIMEOUT_MS)

      const gotSha = await sha256Hex(data)
      if (gotSha !== want.sha256) {
        console.error(`${LOGP} Checksum mismatch for ${name}: expected ${want.sha256}, got ${gotSha}.`)
        throw new Error(`Checksum mismatch for ${name}`)
      }
      if (data.byteLength !== want.bytes) {
        console.error(`${LOGP} Size mismatch for ${name}: expected ${want.bytes}B, got ${data.byteLength}B.`)
        throw new Error(`Size mismatch for ${name}`)
      }

      await adapter.writeBinary(rel, data)

      installed++
      console.info(`${LOGP} Installed ${name} (${installed}/${toInstall.length}).`)
    } catch (e) {
      console.error(`${LOGP} Failed to install ${name}.`, e)
      throw e
    }
  }

  console.info(`${LOGP} Installation complete: ${installed}/${toInstall.length} files installed.`)
}
