/**
 * Live Preview layer that renders Japanese text with per-chunk <ruby>.
 *
 * Responsibilities
 *  - Decorate Japanese spans (and manual-override blocks) with inline widgets
 *    that render <ruby> using the same DOM structure as Reading Mode.
 *  - Skip code fences and inline code spans to avoid altering code blocks.
 *  - Remain IME-friendly by avoiding decorations near the caret and during composition.
 *
 * Implementation notes
 *  - Inline backticks are matched with variable-length runs (`` … ```, ```` … ````).
 *  - Fence state is bootstrapped from the start of the document so mid-viewport scans
 *    remain correct.
 *  - The DOM for <ruby> is produced via `makeRuby` with aligned <rb>/<rt> pairs.
 */

import { Extension, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType
} from '@codemirror/view'
import { NotationStyle, getManualRegex, getAutoRegex } from './regex'
import { getFuriganaSegmentsSync, makeRuby } from './furiganaUtils'

/* ------------------------------- Helpers ------------------------------- */

/** Quick check for Japanese code points to short-circuit non-Japanese documents. */
const AUTO_QUICK = /[\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF]/

/**
 * True if a line opens or closes a fenced code block.
 * Supports backticks and tildes with optional info strings.
 */
function lineTogglesFence (text: string): boolean {
  const t = text.trimStart()
  return /^(```+|~~~+)(\s|$)/.test(t)
}

/**
 * Scan inline code spans on a single line, honoring variable-length runs.
 * Returns [from, to) offsets relative to the line start that should be skipped.
 * An opening run of N backticks closes only with a run of exactly N backticks.
 */
function inlineBacktickRanges (lineText: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const s = lineText
  const len = s.length
  let i = 0

  while (i < len) {
    if (s[i] === '`') {
      let runLen = 1
      while (i + runLen < len && s[i + runLen] === '`') runLen++
      const openerLen = runLen
      const openerStart = i
      i += openerLen

      let closeStart = -1
      while (i < len) {
        if (s[i] === '`') {
          runLen = 1
          while (i + runLen < len && s[i + runLen] === '`') runLen++
          if (runLen === openerLen) {
            closeStart = i
            i += openerLen
            break
          } else {
            i += runLen
          }
        } else {
          i++
        }
      }

      if (closeStart !== -1) {
        ranges.push([openerStart, closeStart + openerLen])
      }
    } else {
      i++
    }
  }
  return ranges
}

/** Half-open interval overlap check used to avoid decorating near selection/caret. */
function overlaps (aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return aFrom < bTo && bFrom < aTo
}

/** Expand a single cursor position to a small “no-decoration” zone. */
function caretBuffer (pos: number, size = 1): [number, number] {
  return [pos - size, pos + size]
}

/* --------------------------- Ruby widget (DOM) -------------------------- */

class RubyWidget extends WidgetType {
  constructor (readonly text: string) {
    super()
  }

  eq (other: RubyWidget): boolean {
    return this.text === other.text
  }

  toDOM (): HTMLElement {
    const segs = getFuriganaSegmentsSync(this.text)

    const span = document.createElement('span')
    for (const seg of segs) {
      const allKana = seg.kanji.every(k => /^[\u3040-\u30FFー]+$/.test(k))
      if (allKana) {
        span.appendChild(document.createTextNode(seg.kanji.join('')))
      } else {
        span.appendChild(makeRuby(seg.kanji, seg.furi))
      }
    }
    return span
  }

  ignoreEvent (): boolean {
    return false
  }
}

/* ------------------------- Decoration computation ----------------------- */

function buildDecorations (view: EditorView, style: NotationStyle): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()

  // Skip early if document has no Japanese code points (fast path for large files).
  if (!AUTO_QUICK.test(view.state.doc.toString())) {
    return builder.finish()
  }

  const { from: visFrom, to: visTo } = view.viewport

  // Bootstrap fence state from the start of the document to the first visible line.
  let insideFence = false
  const firstVisibleLine = view.state.doc.lineAt(visFrom).number
  for (let n = 1; n < firstVisibleLine; n++) {
    const lineText = view.state.doc.line(n).text
    if (lineTogglesFence(lineText)) insideFence = !insideFence
  }

  // Precompute “no-decoration” zones for selection/caret and IME composition.
  const noDecor: Array<[number, number]> = []
  for (const r of view.state.selection.ranges) {
    const [a1, a2] = caretBuffer(r.anchor, view.composing ? 2 : 1)
    const [h1, h2] = caretBuffer(r.head, view.composing ? 2 : 1)
    noDecor.push([Math.min(a1, a2), Math.max(a1, a2)])
    noDecor.push([Math.min(h1, h2), Math.max(h1, h2)])
  }

  // Fresh regexes per build to avoid shared lastIndex state.
  const REGEX_MANUAL = getManualRegex(style)
  const REGEX_AUTOMATIC = getAutoRegex()

  // Walk visible lines.
  let line = view.state.doc.line(firstVisibleLine)
  while (line.from <= visTo) {
    const text = line.text

    // Fence toggle for this line (pre-check to match CommonMark behavior).
    if (lineTogglesFence(text)) {
      insideFence = !insideFence
    }

    if (!insideFence && AUTO_QUICK.test(text)) {
      const codeSpans = inlineBacktickRanges(text)
      const hitsCode = (fromRel: number, toRel: number) =>
        codeSpans.some(([a, b]) => overlaps(fromRel, toRel, a, b))

      // Manual overrides.
      {
        const manual = new RegExp(REGEX_MANUAL.source, 'g')
        for (const m of text.matchAll(manual)) {
          const m0 = m[0]
          if (!m0) continue
          const relFrom = m.index ?? 0
          const relTo = relFrom + m0.length
          if (hitsCode(relFrom, relTo)) continue

          const absFrom = line.from + relFrom
          const absTo = line.from + relTo
          if (noDecor.some(([a, b]) => overlaps(absFrom, absTo, a, b))) continue

          builder.add(
            absFrom,
            absTo,
            Decoration.replace({
              widget: new RubyWidget(m0),
              inclusive: false,
              block: false
            })
          )
        }
      }

      // Automatic coverage for remaining spans.
      {
        const auto = new RegExp(REGEX_AUTOMATIC.source, 'g')
        for (const m of text.matchAll(auto)) {
          const m0 = m[0]
          if (!m0) continue
          const relFrom = m.index ?? 0
          const relTo = relFrom + m0.length
          if (hitsCode(relFrom, relTo)) continue

          const absFrom = line.from + relFrom
          const absTo = line.from + relTo
          if (noDecor.some(([a, b]) => overlaps(absFrom, absTo, a, b))) continue

          builder.add(
            absFrom,
            absTo,
            Decoration.replace({
              widget: new RubyWidget(m0),
              inclusive: false,
              block: false
            })
          )
        }
      }
    }

    if (line.to >= visTo) break
    line = view.state.doc.line(line.number + 1)
  }

  return builder.finish()
}

/* ------------------------------ View plugin ----------------------------- */

/**
 * Create the Live Preview extension for a given manual-notation style.
 * Reconfiguration is handled by the host plugin via a Compartment.
 */
export function viewPlugin (notationStyle: NotationStyle): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor (public view: EditorView) {
        this.decorations = buildDecorations(view, notationStyle)
      }

      update (u: ViewUpdate): void {
        if (
          u.docChanged ||
          u.selectionSet ||
          u.viewportChanged ||
          u.transactions.some(t => t.isUserEvent('input') || t.isUserEvent('delete')) ||
          u.view.composing !== this.view.composing
        ) {
          this.decorations = buildDecorations(this.view, notationStyle)
        }
      }
    },
    {
      decorations: v => (v as any).decorations
    }
  )
}
