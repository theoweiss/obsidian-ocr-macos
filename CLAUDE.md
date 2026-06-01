# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — esbuild watch build of `src/main.ts` → `main.js` (Obsidian plugin bundle).
- `npm run build` — typecheck (`tsc -noEmit`) then production esbuild.
- `npm run build:swift` — build the Swift `ocr-cli` release binary and copy it to repo root as `ocr-cli`.
- `npm run build:all` — `build:swift` then `build`. Required for a working install; the plugin needs both `main.js` and `ocr-cli` alongside `manifest.json`.
- `npm run lint` — ESLint (uses `eslint-plugin-obsidianmd` rules).
- `./install.sh <vault-path>` — copies `main.js`, `manifest.json`, `ocr-cli` into `<vault>/.obsidian/plugins/obsidian-ocr-macos/`. Refuses if any of the three are missing, so build first.

No test suite is configured. First-time setup requires `npm install` before `npm run build` (otherwise `tsc` is not on PATH).

Quick CLI smoke test: `./ocr-cli /path/to/image.png` should print recognized text to stdout.

## Architecture

This is an Obsidian community plugin (macOS-only) that OCRs vault images via Apple's Vision framework and writes the extracted text as markdown files so Obsidian's native search can index it.

Two-process design:

1. **TypeScript plugin** (`src/`, bundled to `main.js` via esbuild, ESM, `obsidian` is external).
   - `main.ts` — `OCRPlugin` (default export). Owns lifecycle, settings, the `processedFiles` Set persisted via `loadData`/`saveData`, and the vault event wiring. Registers `create`/`modify` handlers only when `autoProcess` is on, but always registers `rename`/`delete` to keep the index in sync. Cache filename scheme: image path with `/` and whitespace replaced by `_`, suffixed `.md`, written under `settings.cacheFolder` (default `_ocr-index/`) with frontmatter `source:` + `processed:` followed by the OCR text.
   - `ocr-service.ts` — `OCRService` shells out to the `ocr-cli` binary located in the plugin directory. Serializes calls through an internal queue (`isProcessing` flag) — there is intentionally only one in-flight OCR at a time. 30s timeout, 1MB stdout buffer.
   - `file-watcher.ts` — `FileWatcher` classifies images by extension, applies `excludedFolders`, and dispatches `create`/`modify` to a callback. Also exposes `getAllImages()` for the "Run OCR on all images" command.
   - `settings.ts` — `OCRSettings`, `DEFAULT_SETTINGS`, and the `OCRSettingTab`. Changing `excludedFolders` propagates into the live `FileWatcher` via `saveSettings` → `setExcludedFolders`.

2. **Swift CLI** (`swift-ocr/Sources/ocr-cli/main.swift`, SwiftPM, macOS 10.15+, executable target `ocr-cli`, no external dependencies). Takes an image path as argv[1], runs `VNRecognizeTextRequest` (accurate, language correction on; revision gated on macOS 11/13), prints recognized lines joined by `\n` to stdout. Exits 2 on missing arg, 1 on image-load or OCR failure with the message on stderr. The plugin invokes it via `child_process.exec`. Note: this `main.swift` was written for this fork — the upstream `theoweiss/obsidian-ocr-macos` repo did not commit Swift sources.

Key cross-file invariant: the plugin resolves the CLI path as `<vault>/<manifest.dir>/ocr-cli`, and image paths passed to it are absolute filesystem paths built from `(vault.adapter as any).basePath + file.path`. Both the plugin bundle and the binary must ship together — `install.sh` enforces this.

Manifest (`manifest.json`) declares `isDesktopOnly: true` and the plugin further gates on `Platform.isMacOS` in `onload`, bailing early with a Notice on other OSes.
