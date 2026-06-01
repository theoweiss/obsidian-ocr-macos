# Security Review

Scope: `src/`, `swift-ocr/` (Package.swift + locally-written `Sources/ocr-cli/main.swift`), `install.sh`, `manifest.json`, `package.json`. Reviewed 2026-06-01 against commit `42676f0` plus locally-added Swift CLI.

## Verdict for manual install (your own machine, your own vault)

**Okay to install manually.** The medium-severity shell-injection issue is fixed in this branch (see Finding #1). `npm install` reports 7 vulnerabilities (3 moderate, 4 high) — all in dev-only tooling (esbuild/eslint/typescript plugins). None of those packages are bundled into `main.js` or shipped to your vault, so they don't affect the running plugin; they're only a concern if you run the build pipeline against hostile input. The plugin is local-only (no network calls), macOS-gated, and operates only on files already in your vault. Risk surface is small. The single real issue is a shell-injection path through image filenames — exploitable only if you add an image to your vault whose **filename** is attacker-controlled. If you only OCR images you took or pasted yourself, this won't fire.

## Findings

### 1. Shell injection via image filename — `src/ocr-service.ts` (FIXED in this branch)

Upstream used `child_process.exec` with the image path interpolated into a double-quoted shell string:

```ts
await execAsync(`"${this.cliPath}" "${imagePath}"`, ...);
```

`exec` runs through `/bin/sh`, and double-quoted shell strings still interpret `"`, `` ` ``, `$`, and `\` — all legal in macOS/APFS filenames. A vault image named, e.g., `foo";touch /tmp/pwn;".png` would execute arbitrary commands when OCR ran on it; auto-processing fires on file `create`, so merely dropping such a file into the vault triggered it. Severity: medium. Not remotely exploitable; required attacker-influenced filenames in your own vault.

**Fixed in this branch** by switching to `child_process.execFile` with `[imagePath]` passed as a separate argv element (no shell involvement). The `isAvailable()` probe was also using shell features (`|| echo "ok"`) — replaced with `fs.access(cliPath, X_OK)`.

### 2. YAML frontmatter injection in cache files — `src/main.ts:328`

```ts
const content = `---
source: "${file.path}"
processed: ${new Date().toISOString()}
---
...`;
```

A filename containing `"` or a newline would produce malformed frontmatter (and could inject arbitrary frontmatter keys). Not a code-execution vector — Obsidian just renders broken metadata — but worth escaping or switching to single-quoted YAML with escape handling. Severity: low.

### 3. OCR output written verbatim into a markdown file — `src/main.ts:333`

Extracted text is interpolated directly into the cache file body. An image containing crafted text could produce `---` lines, dataview queries, HTML, or `[[wiki-links]]` that Obsidian then renders. Since Obsidian markdown isn't a script execution context and the text comes from your own images, this is a content-rendering oddity rather than a security issue. Severity: informational.

### 4. `ocr-cli` binary provenance — `install.sh`

You are building the Swift binary yourself from `swift-ocr/Sources/ocr-cli/main.swift` (~40 lines, no external SwiftPM dependencies — only `Foundation`, `CoreGraphics`, `ImageIO`, `Vision` from the macOS SDK). Trust footprint for the native side is just that file plus Apple frameworks. No pre-built binary download, no signing/notarization checks needed for personal use. Severity: informational.

### 5. Use of private Obsidian API — `src/main.ts:39,160`

`(this.app.vault.adapter as any).basePath` reaches into an undocumented field to get an absolute filesystem path so the Swift CLI can read the image. Not a security issue; will break silently on non-FileSystemAdapter vaults (mobile, remote) — but the plugin is desktop-/macOS-only anyway.

### 6. No path-allowlist on `OCRService.extractText` — `src/ocr-service.ts:20`

The service accepts any absolute path. In-process it is only ever called with vault file paths, so there's no current attack path. Worth noting if the API is ever exposed.

### 7. Privacy / network — none observed

No `fetch`, no `http`, no telemetry. All processing local via Apple Vision. Confirms README's "Privacy First" claim.

### 8. Settings input — safe

`cacheFolder` and `excludedFolders` are user-entered but only used as vault-relative paths through Obsidian's `normalizePath`; no shell interpolation.

### 9. `install.sh` — safe

All variables quoted, vault path validated for `.obsidian/`, refuses to run without the three required artifacts. Tilde expansion is the standard `${VAR/#\~/$HOME}` pattern. No issues.

## Recommended fixes, in priority order

1. ~~Replace `exec` with `execFile` in `ocr-service.ts` (Finding #1).~~ **Done in this branch.**
2. Escape or YAML-encode `file.path` in the frontmatter writer (Finding #2).
3. (Optional) Switch the frontmatter source field to a quoted form with `\` escaping, or use a small YAML serializer.

## Bottom line

For a personal manual install on your own machine, with images you produce yourself: low risk, go ahead. If you ever sync your vault from untrusted sources or share it across machines where someone else can drop files in, patch Finding #1 first.
