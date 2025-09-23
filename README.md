⚠️ Status: Work in Progress  
This plugin is under development and not ready for general use.  
Breaking changes, incomplete features, or missing functionality are expected.  

# Markdown Furigana Plugin (Obsidian)

An Obsidian plugin for adding automatically generated [furigana](https://en.wikipedia.org/wiki/Furigana) to Japanese text.

## Attribution

This plugin is based on the [Markdown Furigana Plugin by Steven Kraft](https://github.com/steven-kraft/obsidian-markdown-furigana) which supports multiple languages and focuses entirely on manual input. If your goal is to add furigana manually, it will likely be the better choice.  

## What This Plugin Does

This plugin is intended for Japanese text and adds furigana without altering the original notes. Furigana can be shown automatically, entered manually, or combined.  

Key features:  
- **Automatic generation** – Furigana are generated using morphological analysis and shown above Kanji when no manual markup is present.  
- **Display modes** – Furigana can be shown in both **reading mode** and **live preview (editing mode)**. Each mode can be enabled or disabled separately in the settings.  
- **Manual override**: Custom furigana can be added using ruby-style syntax. Manual entries always override automatically generated readings.  
- **Configurable markup style** – Manual overrides can be written using:  
  - Curly brackets `{漢字|ふりがな}` (default).  
  - Square brackets `[漢字|ふりがな]`.  
  - Manual overrides can also be disabled entirely.  
  
The plugin relies on [kuromoji.js](https://github.com/takuyaa/kuromoji.js) for morphological analysis and [wanakana](https://github.com/WaniKani/WanaKana) for kana conversion. The kuromoji dictionaries are downloaded once after installation.


## Examples

### Curly Brackets (default)

| Markdown    | Processed As                           | Displays As                          |
| ----------- | -------------------------------------- | ------------------------------------ |
| {漢字\|かんじ}   | `<ruby>漢字<rt>かんじ</rt></ruby>`          | <ruby>漢字<rt>かんじ</rt></ruby>          |
| {漢字\|かん\|じ} | `<ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>` | <ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby> |

### Square Brackets (optional)

| Markdown    | Processed As                           | Displays As                          |
| ----------- | -------------------------------------- | ------------------------------------ |
| [漢字\|かんじ]   | `<ruby>漢字<rt>かんじ</rt></ruby>`          | <ruby>漢字<rt>かんじ</rt></ruby>          |
| [漢字\|かん\|じ] | `<ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>` | <ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby> |

When no manual markup is used, furigana are added automatically in reading mode and/or live preview, depending on the settings.

## Notes

- The first part of the markup should be Kanji.  
- Furigana should be written in Hiragana or Katakana.  
- If more than one furigana section is specified, the number of sections must match the number of characters in the Kanji part.  

## Limitations

- Only Japanese is supported.  
- Automatic furigana depends on kuromoji’s analysis and may give incorrect readings in some cases.  Complex sentences or unusual words can reduce accuracy.  
- Very large notes may take longer to render.  
