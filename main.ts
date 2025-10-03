/**
 * Automatic Furigana Generator for Obsidian.
 *
 * Responsibilities
 *  - Load and persist user settings.
 *  - Ensure Kuromoji dictionary assets exist in the vault.
 *  - Initialize the Kuromoji tokenizer (reads dict via patched XHR).
 *  - Register Reading Mode postprocessor (DOM-based <ruby> rendering).
 *  - Register Live Preview extension (CodeMirror 6 widget-based rendering).
 *
 * Notes
 *  - Reading Mode and Live Preview can be toggled independently in settings.
 *  - Manual-override notation style is forwarded to both renderers.
 *  - Live Preview uses a CodeMirror Compartment for dynamic reconfiguration.
 */

import { Plugin } from 'obsidian'
import { Compartment, Extension } from '@codemirror/state'

import { DEFAULT_SETTINGS, type PluginSettings, MyPluginSettingTab } from './settings'
import { ensureDictInstalled } from './kuromojiDictInstaller'
import { initializeTokenizer } from './kuromojiInit'
import { viewPlugin } from './furiganaLivePreviewMode'
import { createReadingModePostprocessor } from './furiganaReadingMode'

/**
 * Main plugin class.
 */
export default class AutoFurigana extends Plugin {
  /** Persisted settings loaded on startup. */
  settings: PluginSettings

  /** Compartment to reconfigure the Live Preview extension without reopening editors. */
  private lpCompartment = new Compartment()

  /** Reading Mode postprocessor bound to a settings getter. */
  public postprocessor = createReadingModePostprocessor(this.app, () => this.settings)

  /**
   * Load settings from the vault and apply defaults for missing keys.
   */
  async loadSettings (): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  /**
   * Persist a partial settings update and react exactly once to the change.
   */
  async saveSettings (patch: Partial<PluginSettings>): Promise<void> {
    const prev = this.settings
    const next = (this.settings = { ...this.settings, ...patch })
    await this.saveData(this.settings)
    this.applySettingsChange(prev, next)
  }

  /**
   * Apply changes to features affected by a settings update.
   * Reconfigures Live Preview and refreshes Reading Mode if needed.
   */
  private applySettingsChange (prev: PluginSettings, next: PluginSettings): void {
    // Live Preview: reconfigure the CodeMirror extension based on the new state.
    const ext: Extension = next.editingMode ? viewPlugin(this.app, next.notationStyle) : []
    this.app.workspace.iterateAllLeaves((leaf) => {
      // @ts-ignore - Obsidian's MarkdownView type
      const view = (leaf as any).view
      // @ts-ignore - editor.cm is CodeMirror6 EditorView
      const cm = view?.editor?.cm
      if (cm?.dispatch) {
        cm.dispatch({ effects: this.lpCompartment.reconfigure(ext) })
      }
    })

    // Reading Mode: refresh rendered views if the toggle or notation style changed.
    const needsRefresh =
      prev.readingMode !== next.readingMode || prev.notationStyle !== next.notationStyle
    if (needsRefresh) this.refreshAllReadingViews()
  }

  /**
   * Force a rerender of all Reading Mode views to reflect the current configuration.
   */
  private refreshAllReadingViews (): void {
    this.app.workspace.getLeavesOfType('markdown').forEach((leaf: any) => {
      if (leaf.view?.getMode?.() === 'preview') {
        if (leaf.view.previewMode?.rerender) {
          leaf.view.previewMode.rerender(true)
        } else if (leaf.rebuildView) {
          leaf.rebuildView()
        }
      }
    })
  }

  /**
   * Reconfigure the Live Preview extension across all open editors.
   * This helper is kept for potential external calls; internal updates use applySettingsChange().
   */
  private reconfigureLivePreview (next: PluginSettings): void {
    const ext: Extension = next.editingMode ? viewPlugin(this.app, next.notationStyle) : []
    this.app.workspace.iterateAllLeaves((leaf) => {
      // @ts-ignore - Obsidian's MarkdownView type
      const mdView = leaf.view && leaf.view.getViewType && leaf.view.getViewType() === 'markdown' ? leaf.view : null
      // @ts-ignore - editor.cm is CodeMirror6 EditorView
      const cm = mdView?.editor?.cm
      if (cm) cm.dispatch({ effects: this.lpCompartment.reconfigure(ext) })
    })
  }

  /**
   * Plugin lifecycle: onload.
   * Loads settings, ensures dictionaries are installed, initializes the tokenizer,
   * and registers UI and renderers. Emits console warnings if initialization steps fail.
   */
  async onload (): Promise<void> {
    // Settings
    await this.loadSettings()

    // Dictionary installation
    try {
      await ensureDictInstalled(this.app, this.manifest)
    } catch (e) {
      // Emit a clear warning for operational visibility in the console.
      console.warn(
        '[AutoFurigana] Dictionary installation failed. Automatic segmentation may be degraded.',
        e
      )
      // Proceed: the rendering path falls back gracefully if the tokenizer is unavailable.
    }

    // Tokenizer initialization (includes a built-in timeout in kuromojiInit).
    try {
      await initializeTokenizer(this.app, this.manifest)
    } catch (e) {
      // Common cases include timeouts and missing/corrupt dictionaries.
      console.warn(
        '[AutoFurigana] Kuromoji tokenizer initialization failed or timed out. ' +
          'Furigana rendering will fall back to non-tokenized behavior.',
        e
      )
      // Proceed: downstream utilities guard against a null tokenizer.
    }

    // Settings UI
    this.addSettingTab(new MyPluginSettingTab(this.app, this))

    // Reading Mode postprocessor (DOM-based).
    this.registerMarkdownPostProcessor(this.postprocessor)

    // Live Preview extension (CodeMirror 6).
    const initialExt: Extension = this.settings.editingMode
      ? viewPlugin(this.app, this.settings.notationStyle)
      : []
    this.registerEditorExtension(this.lpCompartment.of(initialExt))

    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        // Only care about markdown files
        if (file && (file as any).extension === 'md') {
          this.refreshAllReadingViews()
        }
      })
    )
  }

  /**
   * Plugin lifecycle: onunload.
   * No explicit teardown required; Obsidian disposes registered resources.
   */
  onunload (): void {}
}
