/**
 * Settings UI and persisted state for the Automatic Furigana plugin.
 *
 * Exposes:
 *  - PluginSettings: shape of stored configuration
 *  - DEFAULT_SETTINGS: initial values applied on first load
 *  - MyPluginSettingTab: settings tab for editing configuration
 */

import { App, PluginSettingTab, Setting } from 'obsidian'
import type AutoFurigana from './main'
import type { NotationStyle } from './regex'

/**
 * Persisted configuration for the plugin.
 * - readingMode: enable rendering in Reading Mode (postprocessor)
 * - editingMode: enable rendering in Live Preview (CodeMirror)
 * - notationStyle: manual-override bracket style
 */
export interface PluginSettings {
  readingMode: boolean
  editingMode: boolean
  notationStyle: NotationStyle
}

/**
 * Default values for new installations or missing keys.
 * Values are chosen to enable both modes and curly-brace overrides by default.
 */
export const DEFAULT_SETTINGS: PluginSettings = {
  readingMode: true,
  editingMode: false,
  notationStyle: 'curly'
}

/**
 * Obsidian settings tab for this plugin.
 * Reads from the host plugin instance and writes changes back via saveSettings.
 */
export class MyPluginSettingTab extends PluginSettingTab {
  plugin: AutoFurigana

  constructor (app: App, plugin: AutoFurigana) {
    super(app, plugin)
    this.plugin = plugin
  }

  /**
   * Build the settings UI. Called by Obsidian when the tab is opened.
   */
  display (): void {
    const { containerEl } = this
    containerEl.empty()

    containerEl.createEl('h2', { text: 'Automatic Furigana — Settings' })

    // Reading Mode
    new Setting(containerEl)
      .setName('Reading Mode')
      .setDesc('Render furigana in Reading Mode. Source text remains unchanged.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.readingMode)
          .onChange(async (value) => {
            await this.plugin.saveSettings({ readingMode: value })
          })
      )

    // Live Preview
    new Setting(containerEl)
      .setName('Live Preview (editor)')
      .setDesc('Render furigana inside the editor. Source text remains unchanged.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.editingMode)
          .onChange(async (value) => {
            await this.plugin.saveSettings({ editingMode: value })
          })
      )

    // Manual override notation style
    new Setting(containerEl)
      .setName('Manual override notation')
      .setDesc('Choose the bracket style for manual overrides, e.g., {漢字|かん|じ} or [漢字|かん|じ].')
      .addDropdown(dd => {
        dd.addOption('curly', 'Curly braces: {base|reading}')
        dd.addOption('square', 'Square brackets: [base|reading]')
        dd.addOption('none', 'Disabled')
        dd.setValue(this.plugin.settings.notationStyle)
        dd.onChange(async (value) => {
          await this.plugin.saveSettings({
            notationStyle: value as NotationStyle
          })
        })
      })

    // Tips
    const tips = containerEl.createEl('div', { cls: 'setting-item-description' })
    tips.createEl('p', {
      text:
        'For multi-character bases, separate readings with “|”, e.g., {漢字|かん|じ}. ' +
        'For a single reading across the whole base, use one segment, e.g., {今日|きょう}.'
    })
  }
}
