---
name: html-ppt
description: Create and iterate native HTML/CSS presentation decks with a lightweight presenter.js, especially academic report HTML PPTs. Use when the user asks to generate, modify, refine, or export an HTML PPT, browser-openable slide deck, section.slide deck, presenter controls, fixed help bar, speaker notes, final single self-contained HTML, or vector PDF via bundled scripts.
---

# HTML PPT

## Scope

Own only the AI-side workflow:

- Generate or update a native HTML/CSS + lightweight `presenter.js` slide project.
- Iterate the deck from user feedback with minimal patches.
- Preserve user/manual text edits unless the user explicitly asks to overwrite them.
- Export the final deck as a single self-contained HTML file by running the bundled build script.
- Export the final deck as a vector PDF by running the bundled Chromium/Edge print script.

Do not add broad presentation theory, user training material, or unrelated automation.

## Source Project

Use the output directory requested by the user. If no directory is specified, create a concise deck directory name from the topic.

Keep the editable source project as three files:

- `index.html`: slide content only; each page is `section.slide`; keep `data-title`; put speaker notes in `aside.notes`.
- `style.css`: deck dimensions, theme, normal browsing mode, fullscreen/presenter mode, editing affordances.
- `presenter.js`: fixed runtime copied from `assets/presenter.js`.

Use `main.deck[data-width][data-height]` as the deck size source. Default to `1280x720` when unspecified.

Treat `presenter.js` as immutable deck infrastructure. Do not hand-write or patch it during normal deck generation or content/style iteration. Copy `assets/presenter.js` into the deck directory whenever a project is created or the runtime is missing.

## Template

Start new decks by copying:

- `assets/template/index.html` -> `<deck-dir>/index.html`
- `assets/template/style.css` -> `<deck-dir>/style.css`
- `assets/presenter.js` -> `<deck-dir>/presenter.js`

Then replace slide content, slide count, title, notes, and CSS theme as needed. Keep the runtime nodes and class names compatible with the fixed `presenter.js`.

## Structure Contract

`index.html` must keep:

- `<link rel="stylesheet" href="./style.css" />`
- `<script src="./presenter.js" defer></script>`
- `<main class="deck" data-width="1280" data-height="720">`
- One `section.slide` per slide, with optional layout classes and `data-title`.
- One `aside.notes` inside each slide when speaker notes are needed.
- Runtime nodes after `.deck`: `.presenter-progress`, `.laser-pointer`, `.ink-layer`, `.tool-status`, `.presenter-hint`.
- A fixed `.help-bar` after the runtime nodes so shared HTML files explain controls without extra documentation.

`style.css` must keep compatible rules for:

- `:root` slide variables: `--slide-width`, `--slide-height`.
- `.deck`, `.slide`, `.slide.active`.
- `body.presenting` fullscreen mode.
- `.presenter-sidebar`, `.slide-thumb`, `.thumb-preview` thumbnail mode.
- `.help-bar`, `.browse-notes`, `.presenter-progress`, `.notes`, `.laser-pointer`, `.ink-layer`, `.tool-status`, `body.edit-mode`.

## Runtime CSS Contract

Treat the template's runtime selectors as infrastructure, not theme code. Prefer copying `assets/template/style.css` first, then change only colors, typography, spacing, backgrounds, and slide-specific layout classes.

Do not hand-write a simplified replacement for the template's runtime CSS. Keep the marked runtime block between:

- `/* === HTML PPT RUNTIME CSS START: keep compatible with assets/presenter.js === */`
- `/* === HTML PPT RUNTIME CSS END === */`

Treat that marked block as fixed runtime CSS. Do not delete it, reorder it, or replace it with a shorter version. Theme the deck through `:root` variables and slide/content layout classes outside that block.

Normal browsing mode must show all slides:

- `.deck` remains a vertical browsing surface for every slide.
- `.deck` must use `display: grid`, `justify-content: center`, and the sidebar offset/progress offset model from the template.
- `.slide` must keep `--slide-display`, `position: relative`, `width: var(--slide-width)`, `height: var(--slide-height)`, and `overflow: hidden`.
- Any slide root layout class that changes the root `section.slide` display mode must set `--slide-display` to the same value. For example, `.split-slide { --slide-display: grid; display: grid; }` or `.toolbar-slide { --slide-display: flex; display: flex; }`. Fullscreen and thumbnail modes restore active slides with `display: var(--slide-display)`, so omitting this variable makes fullscreen layout diverge from normal browsing.
- `.slide` must not be hidden by default. Never set `.slide { display: none; }` outside fullscreen/runtime-specific selectors.
- `.presenter-sidebar` must not be globally hidden. Hide it only under `body.presenting .presenter-sidebar` or in a narrow-screen media query.
- Thumbnail mode must keep `.sidebar-title`, `.sidebar-actions`, `.sidebar-action`, `.thumb-list`, `.thumb-preview`, `.thumb-preview .slide`, `.thumb-preview .slide.active`, and `.thumb-label`. The runtime clones real slides into `.thumb-preview`, so `.thumb-preview .slide` must be absolutely positioned and scaled with `transform: scale(var(--thumb-scale))`.
- Editing and tool mode must keep `.notes`, `body.edit-mode [data-editable="true"]`, `.presenter-progress`, `.laser-pointer`, `.ink-layer`, `.tool-status`, `.tool-status.visible`, `body.laser-mode .laser-pointer`, `body.pen-mode .ink-layer`, and `body.pen-mode`.
- Help mode must keep `.help-bar` visible in normal browsing mode. It should list the core controls: fullscreen, previous/next, fullscreen wheel navigation, speaker view, edit, save, laser, pen, and clear pen.
- Normal browsing notes must be generated by `presenter.js` as `.browse-notes` cards after each slide. Do not hand-author `.browse-notes` in `index.html`; keep the source notes in each slide's `aside.notes`.
- Speaker view is owned by the fixed `presenter.js`. It must preserve mouse wheel navigation inside the popup and fit current/next slide previews by dynamically scaling the 1280x720 slide canvas into the available preview region. Do not replace speaker view CSS with fixed `width`/`height` preview boxes.

Fullscreen/presenter mode must use the fixed runtime scaling model:

- Keep `body.presenting .deck` as a full-viewport grid centered container.
- Keep slides at the deck dimensions from `main.deck[data-width][data-height]`.
- Use `transform: scale(var(--presenter-scale, 1))` in `body.presenting .slide`.
- Do not set `body.presenting .slide` to `width: 100vw`, `height: 100vh`, or other viewport-sized slide dimensions.
- Keep `body.presenting .slide.active` as the only displayed slide in fullscreen mode.
- Before validation, check every custom `section.slide` root class. If it relies on `display: grid` or `display: flex` for slide-level layout, add matching `--slide-display: grid` or `--slide-display: flex` in the same root class rule.
- Keep `body.presenting .presenter-progress`, `body.presenting .presenter-hint`, and `body.presenting .presenter-sidebar` behavior from the template.
- Keep `body.presenting .help-bar` and `body.presenting .browse-notes` hidden so fullscreen presentation shows only the active slide.

HTML slides must keep one `data-title` per slide and should keep one `aside.notes` per slide. Notes may be concise, but do not remove them when the user asks for an academic report deck or speaker view.

For shared browser use, `aside.notes` content appears twice at runtime: it remains inside each slide for speaker view and editing, and `presenter.js` mirrors it into a non-fullscreen `.browse-notes` card below the slide. Saving HTML must remove generated `.browse-notes` cards and preserve only the canonical `aside.notes`.

If a deck looks wrong, fix `style.css` first. Do not patch `presenter.js` unless the user explicitly asks to maintain the runtime itself.

## Generate

When creating a deck:

1. Create the actual slide experience as the first screen, not a landing page.
2. Use `section.slide` for every slide and keep content sparse.
3. Use modern, clean academic styling.
4. Avoid complex JavaScript and external runtime dependencies.
5. Copy the fixed `presenter.js` asset instead of generating JavaScript.
6. Preserve the template's runtime nodes, fixed `.help-bar`, speaker notes, and CSS compatibility selectors.

After generation, verify:

- `index.html`, `style.css`, and `presenter.js` exist.
- Slide count matches the user request.
- `aside.notes` count matches the slide count.
- `node --check <deck-dir>/presenter.js` passes after copying the fixed runtime.
- `node <skill-dir>/scripts/validate-deck.mjs --deck <deck-dir> --skill <skill-dir>` passes.

## Iterate

Before changing an existing deck:

1. Read the latest `index.html`, `style.css`, and `presenter.js`.
2. Identify whether the request is content, style, behavior, or export.
3. Patch only `index.html` and/or `style.css` for normal deck changes.
4. Do not regenerate the whole deck when the user has manually edited text.
5. Do not modify `presenter.js`; if it differs from `assets/presenter.js`, restore it by copying the asset unless the user explicitly asks to maintain the runtime itself.

After edits:

- Recount `section.slide`.
- Recount `aside.notes` when notes are part of the deck.
- Run `node --check presenter.js` after copying or restoring the fixed runtime.
- Run `node <skill-dir>/scripts/validate-deck.mjs --deck <deck-dir> --skill <skill-dir>` after modifying `style.css` or restoring runtime assets.
- If behavior or layout changed, tell the user what to preview.

## Export Single HTML

When the user asks to export, build, merge, package, publish, or produce the final single-file HTML:

1. Export only after the user explicitly indicates the deck is final or asks for the final single-file output.
2. If style/content iteration is still active or unresolved, finish the requested edits first and ask the user to confirm before exporting.
3. Validate the deck before building:

```bash
node <skill-dir>/scripts/validate-deck.mjs --deck <deck-dir> --skill <skill-dir>
```

4. Prefer a project-local build script if one already exists.
5. Otherwise run this skill's bundled script:

```bash
node <skill-dir>/scripts/build-single.mjs --input <deck-dir> --output <deck-dir>/dist/html-ppt-single.html
```

Replace `<skill-dir>` with this skill folder and `<deck-dir>` with the deck directory.

The script must inline local CSS and JS into the output HTML. After export, verify the output file exists and no longer references `style.css` or `presenter.js` as external files.

## Export Vector PDF

When the user asks for `导出矢量 PDF`, `vector PDF`, `可选中文字 PDF`, or final PDF delivery, do not use the browser-internal `Presenter.exportPdf()` button. That button rasterizes slides for convenience. Use the bundled external script so Chromium/Edge prints the HTML/CSS directly:

```bash
node <skill-dir>/scripts/export-pdf.mjs --input <deck-dir> --output <deck-dir>/dist/html-ppt-vector.pdf --skill <skill-dir>
```

Before export, the script runs `validate-deck.mjs` unless `--no-validate` is passed. If validation fails, fix `index.html` or `style.css` first instead of exporting a broken deck.

The script injects temporary print CSS and calls an installed Chromium-family browser. It sets the page size from `<main class="deck" data-width data-height>` using Chromium's 96 CSS pixels per inch model, hides help/notes/runtime UI, and preserves the slide's own padding so page margins are not clipped. Pass `--browser <path-to-chrome-or-edge>` only when auto-detection fails. After export, verify the PDF exists and has nonzero size.

Expected PDF behavior:

- HTML text and simple CSS/SVG shapes usually remain vector/selectable.
- PNG/JPG/canvas content remains raster.
- Some complex CSS effects may still be rasterized by the browser print engine.
