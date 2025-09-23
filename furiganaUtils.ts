/**
 * Utilities for generating <ruby> markup (furigana) for Japanese text.
 *
 * Responsibilities
 *  - Provide a synchronous segmentation function that splits a Japanese string
 *    into aligned base chunks (kanji/kana) and readings.
 *  - Convert a plain Text node into a fragment that mixes manual overrides
 *    (`{漢字|かん|じ}` or `[漢字|かん|じ]`) with automatically generated ruby.
 *  - Construct <ruby> elements where each <rb>/<rt> pair aligns per chunk.
 */

import * as wanakana from 'wanakana'
import { getTokenizer } from './kuromojiInit' // must return a built kuromoji tokenizer or null

/**
 * Minimal subset of kuromoji's token type used here.
 * `reading` is katakana in the ipadic dictionary; this module normalizes it.
 */
type KuromojiToken = {
  // eslint-disable-next-line camelcase
  surface_form: string
  reading?: string | null
}

/** CJK Unified Ideographs (incl. Ext. A) + compatibility block. */
const KANJI_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/
/** Hiragana, Katakana, prolonged sound mark (ー). */
const KANA_RE = /[\u3040-\u30FFー]/

/** Fast predicates/utilities used throughout. */
const hasKanji = (s: string): boolean => KANJI_RE.test(s)
const isKana = (ch: string): boolean => KANA_RE.test(ch)
/** Normalize any reading (katakana/romaji) to hiragana. */
const hira = (s: string): string => wanakana.toHiragana(s)

/* ------------------------------------------------------------------ *
 *                          Ruby element helper
 * ------------------------------------------------------------------ */

/**
 * Build a <ruby> element from parallel arrays of base chunks and readings.
 *
 * Each base chunk is wrapped in <rb>, followed by an <rt>. For kana-only
 * chunks, an empty <rt> is emitted so that the rb/rt pairing stays aligned
 * with adjacent kanji chunks. This is important because browsers pair
 * siblings greedily when <rb> is not used explicitly.
 *
 * Example structure:
 *   <ruby class="furi">
 *     <rb>漢</rb><rt>かん</rt><rb>字</rb><rt>じ</rt><rb>は</rb><rt></rt>
 *   </ruby>
 *
 * @param kanji Parallel array of base text chunks.
 * @param furi  Parallel array of readings; indices align with `kanji`.
 * @returns     A <ruby> element containing explicit <rb>/<rt> pairs.
 */
export function makeRuby (kanji: string[], furi: string[]): HTMLElement {
  const ruby = document.createElement('ruby')
  ruby.classList.add('furi')

  const len = Math.max(kanji.length, furi.length)
  for (let i = 0; i < len; i++) {
    const base = kanji[i] ?? ''
    const reading = furi[i] ?? ''

    // Explicit per-chunk <rb>/<rt> to avoid browser auto-grouping surprises.
    const rb = document.createElement('rb')
    rb.textContent = base
    ruby.appendChild(rb)

    const rt = document.createElement('rt')
    // Only display furigana above chunks containing kanji; keep empty <rt>
    // for kana segments so parallel arrays stay aligned.
    rt.textContent = (base && KANJI_RE.test(base)) ? reading : ''
    ruby.appendChild(rt)
  }
  return ruby
}

/* ------------------------------------------------------------------ *
 *                Okurigana-aware split for a single token
 * ------------------------------------------------------------------ */

/**
 * Split a token's surface form into [prefix kana][kanji core][suffix kana],
 * and align the reading accordingly.
 *
 * Heuristic:
 *  - Consume matching kana from the start/end of the surface form if they
 *    appear in the same order in the reading. The remainder is treated as
 *    the kanji core. Typical cases:
 *      お願い → prefix=「お」, base=「願」, suffix=「い」
 *      食べる → base=「食」, suffix=「べる」
 *
 * @param surface      Token surface form.
 * @param readingHira  Token reading normalized to hiragana.
 * @returns            Decomposition with base and matched prefix/suffix.
 */
function splitOkurigana (surface: string, readingHira: string): {
  base: string
  baseReading: string
  prefix: { base: string, reading: string }
  suffix: { base: string, reading: string }
} {
  let i = 0
  let prefixBase = ''
  let prefixRead = ''

  // Collect leading kana that match the reading's prefix.
  while (i < surface.length) {
    const ch = surface[i]
    if (!isKana(ch)) break
    const h = hira(ch)
    if (readingHira.startsWith(h)) {
      prefixBase += ch
      prefixRead += h
      readingHira = readingHira.slice(h.length)
      i++
    } else break
  }

  // Collect trailing kana that match the reading's suffix.
  let j = surface.length - 1
  let suffixBase = ''
  let suffixRead = ''
  while (j >= i) {
    const ch = surface[j]
    if (!isKana(ch)) break
    const h = hira(ch)
    if (readingHira.endsWith(h)) {
      suffixBase = ch + suffixBase
      suffixRead = h + suffixRead
      readingHira = readingHira.slice(0, readingHira.length - h.length)
      j--
    } else break
  }

  const base = surface.slice(i, j + 1)
  const baseReading = readingHira
  return {
    base,
    baseReading,
    prefix: { base: prefixBase, reading: prefixRead },
    suffix: { base: suffixBase, reading: suffixRead }
  }
}

/* ------------------------------------------------------------------ *
 *                 Public synchronous segmentation API
 * ------------------------------------------------------------------ */

/**
 * Segment a Japanese string into aligned base chunks and readings.
 *
 * Output shape:
 *   [{ kanji: string[]; furi: string[] }]
 * with parallel arrays where `kanji[k]` is the base chunk and `furi[k]`
 * is its reading (hiragana). Kana chunks have their kana as the "reading"
 * to preserve alignment; consumers decide whether to render it.
 *
 * If the Kuromoji tokenizer is unavailable, a single token is used as a
 * fallback, maintaining the contract of parallel arrays.
 *
 * @param jp  Input string (Japanese).
 * @returns   Array with a single segment object containing parallel arrays.
 */
export function getFuriganaSegmentsSync (
  jp: string
): Array<{ kanji: string[]; furi: string[] }> {
  const outKanji: string[] = []
  const outFuri: string[] = []

  if (!jp) return [{ kanji: [], furi: [] }]

  // Safe getter; null when not initialized yet.
  const tokenizer = typeof getTokenizer === 'function' ? getTokenizer() : null

  // Tokenize or fallback to a single "token".
  const tokens: KuromojiToken[] = tokenizer
    ? (tokenizer.tokenize(jp) as KuromojiToken[])
    : [{ surface_form: jp, reading: undefined }]

  for (const t of tokens) {
    const surface = t.surface_form || ''
    if (!surface) continue

    // Kuromoji reading is usually katakana; normalize and guard against "*".
    let reading = (t.reading && t.reading !== '*') ? String(t.reading) : surface
    reading = hira(reading)

    // Kana-only segment → pass through (preserves alignment).
    if (!hasKanji(surface)) {
      outKanji.push(surface)
      outFuri.push(reading)
      continue
    }

    // Split okurigana and align readings.
    const { base, baseReading, prefix, suffix } = splitOkurigana(surface, reading)
    if (prefix.base) { outKanji.push(prefix.base); outFuri.push(prefix.reading) }
    if (base) { outKanji.push(base); outFuri.push(baseReading || reading) }
    if (suffix.base) { outKanji.push(suffix.base); outFuri.push(suffix.reading) }
  }

  // Fallback: if segmentation produced nothing, pair the whole string with its
  // hiragana reading to keep downstream logic simple.
  if (outKanji.length === 0) {
    return [{ kanji: [jp], furi: [hira(jp)] }]
  }
  return [{ kanji: outKanji, furi: outFuri }]
}

/* ------------------------------------------------------------------ *
 *                   Reading Mode converter (DOM-based)
 * ------------------------------------------------------------------ */

/**
 * Convert a single Text node to a DocumentFragment that contains:
 *  - manual overrides rendered from `{漢字|かな|...}` or `[漢字|...]` markup
 *  - automatic furigana for Japanese spans outside manual markup
 *
 * The function creates fresh RegExp instances from the provided patterns to
 * avoid shared `lastIndex` state across callers. Manual overrides are applied
 * first; gaps are then processed with automatic segmentation.
 *
 * @param textNode        Text node to replace.
 * @param REGEX_MANUAL    Global regex matching manual override blocks.
 *                        Must expose capture groups: (1) kanji base, (2) '|' + readings.
 * @param REGEX_AUTOMATIC Global regex for broad Japanese spans.
 * @returns               A Node to replace the original text node. If no
 *                        changes are made, the original Text node is returned.
 */
export async function convertFurigana (
  textNode: Text,
  REGEX_MANUAL: RegExp,
  REGEX_AUTOMATIC: RegExp
): Promise<Node> {
  const text = textNode.nodeValue ?? ''
  const frag = document.createDocumentFragment()

  // Use fresh regex instances to avoid mutated lastIndex from upstream usage.
  const manual = new RegExp(REGEX_MANUAL.source, 'g')
  const auto = new RegExp(REGEX_AUTOMATIC.source, 'g')

  let cursor = 0
  let m: RegExpExecArray | null

  /**
   * Process a plain slice (no manual markup) and apply automatic furigana
   * to Japanese spans inside it. Non-Japanese content is preserved verbatim.
   */
  const pushAuto = (slice: string) => {
    if (!slice) return
    let last = 0
    let a: RegExpExecArray | null

    while ((a = auto.exec(slice)) !== null) {
      const from = a.index
      const to = from + a[0].length

      // Emit text before the match.
      if (from > last) frag.appendChild(document.createTextNode(slice.slice(last, from)))

      const span = a[0]
      if (hasKanji(span)) {
        // Segment and render as <ruby>.
        const segs = getFuriganaSegmentsSync(span)
        const { kanji, furi } = segs[0]
        frag.appendChild(makeRuby(kanji, furi))
      } else {
        // Kana-only → keep as plain text (lighter DOM, same appearance).
        frag.appendChild(document.createTextNode(span))
      }
      last = to
    }

    // Emit tail after the last match.
    if (last < slice.length) {
      frag.appendChild(document.createTextNode(slice.slice(last)))
    }
  }

  // Walk manual overrides in order; automatic processing covers the gaps.
  while ((m = manual.exec(text)) !== null) {
    const start = m.index ?? 0
    const end = start + m[0].length

    // Gap before a manual override → apply automatic processing.
    if (start > cursor) pushAuto(text.slice(cursor, start))

    // Render the manual override as <ruby>.
    const base = m[1] ?? ''
    // The second capture starts with a leading '|' (e.g., '|かん|じ'); strip it.
    const parts = (m[2] ?? '').split('|').slice(1)

    let kanjiArr: string[]
    let furiArr: string[]

    if (parts.length <= 1) {
      // Single reading applies to the entire base.
      kanjiArr = [base]
      furiArr = [parts[0] ?? '']
    } else {
      // Multiple readings: distribute per character.
      kanjiArr = base.split('')
      if (parts.length === kanjiArr.length) {
        furiArr = parts
      } else {
        // Best-effort alignment when counts differ: pad missing readings with the last one.
        furiArr = []
        for (let i = 0; i < kanjiArr.length; i++) {
          furiArr[i] = parts[i] ?? parts[parts.length - 1] ?? ''
        }
      }
    }

    frag.appendChild(makeRuby(kanjiArr, furiArr))
    cursor = end
  }

  // Tail after the last manual match (if any).
  if (cursor < text.length) pushAuto(text.slice(cursor))

  // If nothing changed, return the original node to avoid re-rendering.
  if (frag.childNodes.length === 0) return textNode
  return frag
}
