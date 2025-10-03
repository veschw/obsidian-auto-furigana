import type { App } from 'obsidian'
import type { EditorView } from '@codemirror/view'

const KEY = 'auto-furigana'
const OFF: Set<unknown> = new Set([false, 'false', 'off', 'disabled'])

export function shouldSkipByPath (app: App, path: string): boolean {
  const fm = app.metadataCache.getCache(path)?.frontmatter
  if (!fm) return false
  const v = fm[KEY]
  return OFF.has(v)
}

export function editorViewToPath (app: App, ev: EditorView): string | null {
  let out: string | null = null
  app.workspace.iterateAllLeaves((leaf: any) => {
    const cm = leaf?.view?.editor?.cm
    if (cm === ev) out = leaf?.view?.file?.path ?? null
  })
  return out
}

export function shouldSkipForEditorView (app: App, ev: EditorView): boolean {
  const p = editorViewToPath(app, ev)
  return p ? shouldSkipByPath(app, p) : false
}
