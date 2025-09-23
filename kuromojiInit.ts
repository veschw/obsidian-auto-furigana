/**
 * Kuromoji Tokenizer Initialization for Obsidian.
 *
 * Purpose
 *  - Load Kuromoji dictionary files from the plugin's `dict/` folder inside the vault.
 *  - Temporarily patch `XMLHttpRequest.open` so Kuromoji's BrowserDictionaryLoader
 *    can fetch each dictionary file via Obsidian's `app://` resource URLs.
 *  - Expose a safe getter for the built tokenizer and a promise-based initializer.
 *
 * Exports
 *  - getTokenizer(): Tokenizer | null      // safe getter for current tokenizer (nullable)
 *  - tokenizer: Tokenizer | null           // direct reference (nullable)
 *  - initializeTokenizer(app, manifest): Promise<void>
 *
 * Usage
 *  - Call `await initializeTokenizer(app, manifest)` once (e.g., on plugin load)
 *    before calling `getTokenizer()` from other modules.
 */

import * as kuromoji from 'kuromoji'
import { Tokenizer, IpadicFeatures } from 'kuromoji'
import type { App, PluginManifest } from 'obsidian'

// Tokenizer instance is null until initialization completes.
export let tokenizer: Tokenizer<IpadicFeatures> | null = null

// Prevent concurrent builds (idempotent initializer).
let building = false

/** Safe getter for downstream code; returns null if not initialized yet. */
export function getTokenizer (): Tokenizer<IpadicFeatures> | null {
  return tokenizer
}

/**
 * The set of ipadic files the BrowserDictionaryLoader expects. These must
 * exist under the plugin's `dict/` directory, shipped with the plugin.
 */
const DICT_FILES = [
  'base.dat.gz',
  'cc.dat.gz',
  'check.dat.gz',
  'tid.dat.gz',
  'tid_pos.dat.gz',
  'tid_map.dat.gz',
  'unk.dat.gz',
  'unk_char.dat.gz',
  'unk_compat.dat.gz',
  'unk_invoke.dat.gz',
  'unk_map.dat.gz',
  'unk_pos.dat.gz'
] as const

/**
 * Kuromoji is configured with a `dicPath`. The loader requests files like
 * `${dicPath}/base.dat.gz`. `dicPath` gets pointed to this sentinel string and
 * patch XHR so that any URL starting with `${SENTINEL}/...` is rewritten to
 * an Obsidian `app://` URL for the corresponding file.
 */
const SENTINEL = '__KUROMOJI_DICT__'

/**
 * Build a mapping from dictionary filenames to Obsidian resource URLs.
 * Example:
 *   'base.dat.gz' → 'app://obsidian.md/.../plugins/<id>/dict/base.dat.gz'
 *
 * Throws if a file cannot be resolved, since kuromoji will fail later anyway.
 */
function buildUrlMap (app: App, manifest: PluginManifest): Record<string, string> {
  // Resolve the plugin's dict folder relative to the vault root.
  const configDir = (app.vault as any).configDir ?? '.obsidian'
  const baseRel = `${configDir}/plugins/${manifest.id}/dict/`.replace(/\\/g, '/')
  const adapter: any = app.vault.adapter

  const map: Record<string, string> = {}
  for (const name of DICT_FILES) {
    const rel = baseRel + name
    const url = adapter.getResourcePath(rel) // Obsidian-provided app:// URL
    if (!url) throw new Error(`Cannot resolve dictionary file: ${rel}`)
    map[name] = url
  }
  return map
}

/**
 * Initialize the Kuromoji tokenizer.
 * - Idempotent: concurrent or repeated calls are safe; only the first build runs.
 * - Temporarily patches XMLHttpRequest.open for the duration of the build.
 * - Restores the original XHR method immediately after the builder callback fires.
 *
 * Errors are surfaced to the caller; a `console.warn` is emitted for visibility.
 */
export function initializeTokenizer (
  app: App,
  manifest: PluginManifest
): Promise<void> {
  if (tokenizer) return Promise.resolve()
  if (building) {
    return new Promise(resolve => {
    // Poll until tokenizer appears or building flips (simple coalescing).
      const id = window.setInterval(() => {
        if (tokenizer || !building) {
          window.clearInterval(id)
          resolve()
        }
      }, 50)
    })
  }

  building = true

  return new Promise<void>((resolve, reject) => {
    let unpatch: (() => void) | null = null

    try {
      const urlMap = buildUrlMap(app, manifest)

      /**
       * Patch XHR.open so Kuromoji can fetch `${SENTINEL}/<file>` and actually
       * read from the correct `app://` URL for `<file>`.
       *
       * Notes:
       *  - Only rewrites URLs when they start with the sentinel.
       *  - Other requests pass through unchanged.
       *  - The patch is reverted immediately after the builder callback fires.
       */
      const origOpen = XMLHttpRequest.prototype.open
      XMLHttpRequest.prototype.open = function (
        method: string,
        url: string,
        async?: boolean,
        user?: string | null,
        password?: string | null
      ) {
        try {
          if (typeof url === 'string' && url.startsWith(SENTINEL)) {
            // Extract "<file>" from "<SENTINEL>/<file>"
            const file = url.slice(SENTINEL.length + 1)
            const mapped = urlMap[file]
            if (mapped) {
              // Rewrite to the vault resource URL.
              url = mapped
            }
          }
        } catch {
          // Fall through; open() will likely fail and be reported by kuromoji.
        }
        // @ts-ignore - defer to the original signature
        return origOpen.call(this, method, url, async, user, password)
      }
      unpatch = () => {
        XMLHttpRequest.prototype.open = origOpen
      }

      const builder = kuromoji.builder({ dicPath: SENTINEL })
      builder.build((err, built) => {
        // Restore state regardless of outcome.
        unpatch?.()
        building = false

        if (err || !built) {
          console.warn('[AutoFurigana] Tokenizer initialization failed.', err)
          reject(err)
          return
        }
        tokenizer = built!
        resolve()
      })
    } catch (e) {
      // Clean up state and restore XHR on synchronous failures too.
      unpatch?.()
      building = false
      reject(e)
    }
  })
}
