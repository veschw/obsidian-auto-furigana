/**
 * Reading Mode postprocessor for rendering Japanese text with <ruby>.
 *
 * Responsibilities
 *  - Register a Markdown postprocessor that runs on rendered Markdown (Reading Mode).
 *  - Within standard content containers (paragraphs, headings, lists, tables),
 *    walk the DOM, find Text nodes, and replace them with a fragment from `convertFurigana`.
 *  - Support inline manual overrides ({漢字|かん|じ} or [漢字|…]) and apply automatic
 *    segmentation to remaining Japanese spans.
 *
 * Notes
 *  - Scans a conservative set of elements (TAGS) to avoid code blocks and UI chrome.
 *  - Skips nodes already inside a <ruby> to avoid invalid nesting.
 *  - Uses fresh RegExp instances in `convertFurigana` to avoid shared lastIndex state.
 *  - When no Japanese text is present, the traversal is fast and returns early.
 */

import { App, MarkdownPostProcessor, MarkdownPostProcessorContext } from 'obsidian'

import type { PluginSettings } from './settings'
import { convertFurigana } from './furiganaUtils'
import { getAutoRegex, getManualRegex } from './regex'
import { shouldSkipByPath } from './skipOption'

/**
 * Elements to scan inside rendered Markdown.
 * Limited to core text-bearing containers.
 */
const TAGS = 'p, h1, h2, h3, h4, h5, h6, ol, ul, table'

/**
 * skip elements that must not be traversed.
 * Skips code/pre/script/style and any existing ruby subtree.
 */
function isSkippableElement (el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  return tag === 'code' || tag === 'pre' || tag === 'script' || tag === 'style' || tag === 'ruby'
}

/**
 * Collect direct and nested Text nodes under `root`, excluding skippable subtrees.
 * Attributes are not touched; only Text nodes are collected.
 */
function collectTextNodes (root: Node, out: Text[]): void {
  const nodeType = root.nodeType
  if (nodeType === Node.TEXT_NODE) {
    const v = root.nodeValue ?? ''
    if (v.trim().length > 0) out.push(root as Text)
    return
  }
  if (nodeType !== Node.ELEMENT_NODE) return

  const el = root as Element
  if (isSkippableElement(el)) return

  // Do not process inside existing <ruby>; nested ruby is invalid.
  if (el.closest('ruby')) return

  for (let i = 0; i < el.childNodes.length; i++) {
    collectTextNodes(el.childNodes[i], out)
  }
}

/**
 * Factory for the Markdown postprocessor used in Reading Mode.
 * The returned function reads settings via the provided getter on each run.
 */

export function createReadingModePostprocessor (
  app: App,
  getSettings: () => PluginSettings
): MarkdownPostProcessor {
  return async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const settings = getSettings()

    // skip if switched off in settings
    if (!settings.readingMode) return
    // skip note if disabled in frontmatter
    if (shouldSkipByPath(app, ctx.sourcePath)) return

    // Query only the selected content containers.
    const blocks = el.querySelectorAll<HTMLElement>(TAGS)
    if (blocks.length === 0) return

    // Quick precheck regex to skip blocks without Japanese code points.
    const autoQuick = getAutoRegex()
    const quick = new RegExp(autoQuick.source)

    const manualRe = getManualRegex(settings.notationStyle)
    const autoRe = getAutoRegex()

    const processBlock = async (blk: HTMLElement) => {
      // Skip blocks that contain no Japanese characters.
      if (!quick.test(blk.textContent ?? '')) return

      const textNodes: Text[] = []
      collectTextNodes(blk, textNodes)
      if (textNodes.length === 0) return

      // Replace each Text node with the converted fragment.
      await Promise.all(
        textNodes.map(async (tn) => {
          const replacement = await convertFurigana(tn, manualRe, autoRe)
          if (replacement !== tn) tn.replaceWith(replacement)
        })
      )
    }

    // Process all selected containers.
    for (const blk of Array.from(blocks)) {
      await processBlock(blk)
    }
  }
}
