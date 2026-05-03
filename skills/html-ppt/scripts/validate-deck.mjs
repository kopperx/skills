#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillDir = path.resolve(scriptDir, "..");
const runtimeStartMarker = "/* === HTML PPT RUNTIME CSS START: keep compatible with assets/presenter.js === */";
const runtimeEndMarker = "/* === HTML PPT RUNTIME CSS END === */";

function parseArgs(argv) {
  const args = {
    deck: ".",
    skill: defaultSkillDir,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--deck" || arg === "--skill") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a path value.`);
      }
      args[arg.slice(2)] = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    deck: path.resolve(args.deck),
    skill: path.resolve(args.skill),
    help: args.help,
  };
}

function usage() {
  return [
    "Usage:",
    "  node <skill-dir>/scripts/validate-deck.mjs --deck <deck-dir> --skill <skill-dir>",
    "",
    "Checks a native HTML PPT deck against the fixed presenter.js runtime contract.",
  ].join("\n");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readText(filePath, errors, label) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    errors.push(`Missing or unreadable ${label}: ${filePath} (${error.message})`);
    return "";
  }
}

async function sha256(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripAtBlocks(css) {
  let result = "";
  let index = 0;

  while (index < css.length) {
    if (css[index] !== "@") {
      result += css[index];
      index += 1;
      continue;
    }

    const atStart = index;
    while (index < css.length && css[index] !== "{" && css[index] !== ";") {
      index += 1;
    }

    if (css[index] === ";") {
      index += 1;
      continue;
    }

    if (css[index] !== "{") {
      result += css.slice(atStart);
      break;
    }

    let depth = 0;
    while (index < css.length) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          break;
        }
      }
      index += 1;
    }
  }

  return result;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function topLevelRuleBodies(css, selector) {
  const source = stripAtBlocks(stripComments(css));
  const re = new RegExp(`(^|})\\s*${escapeRegex(selector)}\\s*\\{([^{}]*)\\}`, "g");
  return [...source.matchAll(re)].map((match) => match[2]);
}

function ruleBodies(css, selector) {
  const source = stripComments(css);
  const re = new RegExp(`${escapeRegex(selector)}\\s*\\{([^{}]*)\\}`, "g");
  return [...source.matchAll(re)].map((match) => match[1]);
}

function hasDeclaration(body, property, valuePattern) {
  const re = new RegExp(`(^|;)\\s*${escapeRegex(property)}\\s*:\\s*${valuePattern}\\s*(!important\\s*)?(;|$)`, "i");
  return re.test(body);
}

function hasSelector(css, selector) {
  return ruleBodies(css, selector).length > 0;
}

function requireSelector(css, selector, errors, reason) {
  if (!hasSelector(css, selector)) {
    errors.push(`Fix style.css, not JS: keep ${selector}. ${reason}`);
  }
}

function requireDeclaration(bodies, selector, property, valuePattern, errors, reason) {
  if (!bodies.some((body) => hasDeclaration(body, property, valuePattern))) {
    errors.push(`Fix style.css: ${selector} must keep ${property}: ${reason}.`);
  }
}

function requirePattern(bodies, selector, pattern, errors, reason) {
  if (!bodies.some((body) => pattern.test(body))) {
    errors.push(`Fix style.css: ${selector} must keep ${reason}.`);
  }
}

function validateHtml(html, errors) {
  if (!/<main\b[^>]*class=["'][^"']*\bdeck\b[^"']*["'][^>]*>/i.test(html)) {
    errors.push("Fix index.html: keep a <main class=\"deck\"> runtime container.");
  }

  if (!/<main\b[^>]*\bdata-width=["']?\d+["']?[^>]*\bdata-height=["']?\d+["']?[^>]*>/i.test(html)) {
    errors.push("Fix index.html: keep data-width and data-height on the .deck element.");
  }

  const slideCount = countMatches(html, /<section\b[^>]*class=["'][^"']*\bslide\b[^"']*["'][^>]*>/gi);
  if (slideCount < 1) {
    errors.push("Fix index.html: include at least one section.slide.");
  }

  const slideRootClasses = new Set();
  for (const match of html.matchAll(/<section\b[^>]*class=["']([^"']*\bslide\b[^"']*)["'][^>]*>/gi)) {
    for (const className of match[1].trim().split(/\s+/)) {
      if (className && className !== "slide") {
        slideRootClasses.add(className);
      }
    }
  }

  const titledSlideCount = countMatches(
    html,
    /<section\b(?=[^>]*class=["'][^"']*\bslide\b[^"']*["'])(?=[^>]*\bdata-title=["'][^"']+["'])[^>]*>/gi,
  );
  if (slideCount > 0 && titledSlideCount !== slideCount) {
    errors.push("Fix index.html: every section.slide must keep a non-empty data-title for thumbnails and speaker view.");
  }

  for (const className of ["presenter-progress", "laser-pointer", "ink-layer", "tool-status", "presenter-hint"]) {
    const re = new RegExp(`class=["'][^"']*\\b${escapeRegex(className)}\\b`, "i");
    if (!re.test(html)) {
      errors.push(`Fix index.html: keep the .${className} runtime node after .deck.`);
    }
  }

  const noteCount = countMatches(html, /<aside\b[^>]*class=["'][^"']*\bnotes\b[^"']*["'][^>]*>/gi);
  if (slideCount > 0 && noteCount !== slideCount) {
    errors.push("Fix index.html: keep one aside.notes inside every slide; use concise notes when no detailed script is needed.");
  }
  return { slideCount, noteCount, slideRootClasses };
}

function validateSlideDisplayVariables(css, slideRootClasses, errors) {
  for (const className of slideRootClasses) {
    const selector = `.${className}`;
    const bodies = topLevelRuleBodies(css, selector);
    for (const body of bodies) {
      const displayMatch = body.match(/(^|;)\s*display\s*:\s*(grid|inline-grid|flex|inline-flex)\s*(!important\s*)?(;|$)/i);
      if (!displayMatch) continue;

      const displayValue = displayMatch[2].toLowerCase();
      const requiredValue = displayValue.startsWith("inline-") ? displayValue : displayValue;
      if (!hasDeclaration(body, "--slide-display", requiredValue)) {
        errors.push(
          `Fix style.css: slide root class ${selector} uses display: ${displayValue}; add --slide-display: ${requiredValue}; in the same rule so fullscreen and thumbnails keep the same layout.`,
        );
      }
    }
  }
}

function validateCss(css, errors, slideRootClasses = new Set()) {
  if (!css.includes(runtimeStartMarker) || !css.includes(runtimeEndMarker)) {
    errors.push("Fix style.css: copy the template runtime CSS markers and keep the marked runtime block intact.");
  } else if (css.indexOf(runtimeStartMarker) > css.indexOf(runtimeEndMarker)) {
    errors.push("Fix style.css: runtime CSS START marker must appear before runtime CSS END marker.");
  }

  const rootBodies = ruleBodies(css, ":root");
  if (rootBodies.length === 0) {
    errors.push("Fix style.css: keep :root slide variables.");
  } else {
    requirePattern(rootBodies, ":root", /--slide-width\s*:\s*\d+px/i, errors, "--slide-width in px");
    requirePattern(rootBodies, ":root", /--slide-height\s*:\s*\d+px/i, errors, "--slide-height in px");
  }

  const deckBodies = topLevelRuleBodies(css, ".deck");
  if (deckBodies.length === 0) {
    errors.push("Fix style.css: keep the normal browsing .deck rule.");
  } else {
    requireDeclaration(deckBodies, ".deck", "display", "grid", errors, "grid");
    requireDeclaration(deckBodies, ".deck", "justify-content", "center", errors, "center");
    requireDeclaration(deckBodies, ".deck", "margin-left", "256px", errors, "256px sidebar offset");
  }

  const slideBodies = topLevelRuleBodies(css, ".slide");
  if (slideBodies.length === 0) {
    errors.push("Fix style.css: keep the normal browsing .slide rule.");
  } else {
    requireDeclaration(slideBodies, ".slide", "--slide-display", "block", errors, "block");
    requireDeclaration(slideBodies, ".slide", "position", "relative", errors, "relative");
    requirePattern(slideBodies, ".slide", /width\s*:\s*var\(\s*--slide-width\s*\)/i, errors, "width: var(--slide-width)");
    requirePattern(slideBodies, ".slide", /height\s*:\s*var\(\s*--slide-height\s*\)/i, errors, "height: var(--slide-height)");
    requireDeclaration(slideBodies, ".slide", "overflow", "hidden", errors, "hidden");
  }

  if (slideBodies.some((body) => hasDeclaration(body, "display", "none"))) {
    errors.push(
      "Fix style.css, not JS: normal browsing mode must show every .slide. Move display:none to body.presenting .slide only.",
    );
  }

  validateSlideDisplayVariables(css, slideRootClasses, errors);

  const notesBodies = ruleBodies(css, ".notes");
  if (notesBodies.length === 0) {
    errors.push("Fix style.css, not JS: keep .notes for speaker notes.");
  } else {
    requireDeclaration(notesBodies, ".notes", "display", "none", errors, "none in normal mode");
  }

  for (const selector of [
    ".presenter-hint",
    ".presenter-progress",
    ".presenter-progress span",
    ".laser-pointer",
    ".ink-layer",
    ".tool-status",
    ".tool-status.visible",
    "body.laser-mode .laser-pointer",
    "body.pen-mode",
    "body.pen-mode .ink-layer",
    "body.edit-mode .deck > .slide",
    "body.edit-mode [data-editable=\"true\"]",
    "body.edit-mode [data-editable=\"true\"]:focus",
    "body.edit-mode .deck > .slide .notes",
  ]) {
    requireSelector(css, selector, errors, "The fixed presenter.js or editing mode depends on this rule.");
  }

  const progressBodies = topLevelRuleBodies(css, ".presenter-progress");
  if (progressBodies.length > 0) {
    requireDeclaration(progressBodies, ".presenter-progress", "position", "fixed", errors, "fixed");
    requireDeclaration(progressBodies, ".presenter-progress", "left", "256px", errors, "256px sidebar offset");
  }

  const laserBodies = ruleBodies(css, ".laser-pointer");
  if (laserBodies.length > 0) {
    requireDeclaration(laserBodies, ".laser-pointer", "position", "fixed", errors, "fixed");
    requireDeclaration(laserBodies, ".laser-pointer", "display", "none", errors, "none until laser mode");
    requireDeclaration(laserBodies, ".laser-pointer", "pointer-events", "none", errors, "none");
  }

  const inkBodies = ruleBodies(css, ".ink-layer");
  if (inkBodies.length > 0) {
    requireDeclaration(inkBodies, ".ink-layer", "position", "fixed", errors, "fixed");
    requireDeclaration(inkBodies, ".ink-layer", "display", "none", errors, "none until pen mode");
  }

  const penInkBodies = ruleBodies(css, "body.pen-mode .ink-layer");
  if (penInkBodies.length > 0) {
    requireDeclaration(penInkBodies, "body.pen-mode .ink-layer", "display", "block", errors, "block");
    requireDeclaration(penInkBodies, "body.pen-mode .ink-layer", "pointer-events", "auto", errors, "auto");
  }

  const sidebarBodies = topLevelRuleBodies(css, ".presenter-sidebar");
  if (sidebarBodies.some((body) => hasDeclaration(body, "display", "none"))) {
    errors.push(
      "Fix style.css, not JS: do not hide .presenter-sidebar globally; hide only in body.presenting or small-screen media queries.",
    );
  }
  if (sidebarBodies.length === 0) {
    errors.push("Fix style.css, not JS: keep .presenter-sidebar for non-fullscreen thumbnail mode.");
  } else {
    requireDeclaration(sidebarBodies, ".presenter-sidebar", "position", "fixed", errors, "fixed");
    requireDeclaration(sidebarBodies, ".presenter-sidebar", "width", "256px", errors, "256px");
    requireDeclaration(sidebarBodies, ".presenter-sidebar", "overflow-y", "auto", errors, "auto");
  }

  for (const selector of [
    ".sidebar-title",
    ".sidebar-actions",
    ".sidebar-action",
    ".sidebar-action.secondary",
    ".sidebar-action.active",
    ".thumb-list",
    ".thumb-label",
  ]) {
    requireSelector(css, selector, errors, "The fixed presenter.js generates this sidebar UI class.");
  }

  const thumbPreviewBodies = ruleBodies(css, ".thumb-preview");
  if (thumbPreviewBodies.length === 0) {
    errors.push("Fix style.css, not JS: keep .thumb-preview for sidebar thumbnail containers.");
  } else {
    if (!thumbPreviewBodies.some((body) => hasDeclaration(body, "position", "relative"))) {
      errors.push("Fix style.css: .thumb-preview must use position: relative so cloned slides anchor correctly.");
    }
    if (!thumbPreviewBodies.some((body) => hasDeclaration(body, "overflow", "hidden"))) {
      errors.push("Fix style.css: .thumb-preview must use overflow: hidden so thumbnails are clipped to preview bounds.");
    }
  }

  const thumbSlideBodies = ruleBodies(css, ".thumb-preview .slide");
  if (thumbSlideBodies.length === 0) {
    errors.push("Fix style.css, not JS: keep .thumb-preview .slide; thumbnails clone real slides and scale them through this rule.");
  } else {
    if (!thumbSlideBodies.some((body) => hasDeclaration(body, "position", "absolute"))) {
      errors.push("Fix style.css: .thumb-preview .slide must use position: absolute.");
    }
    if (!thumbSlideBodies.some((body) => /transform\s*:\s*scale\(\s*var\(\s*--thumb-scale\b/i.test(body))) {
      errors.push("Fix style.css: .thumb-preview .slide must use transform: scale(var(--thumb-scale)).");
    }
    if (!thumbSlideBodies.some((body) => /transform-origin\s*:\s*top\s+left/i.test(body))) {
      errors.push("Fix style.css: .thumb-preview .slide must use transform-origin: top left.");
    }
    if (!thumbSlideBodies.some((body) => hasDeclaration(body, "pointer-events", "none"))) {
      errors.push("Fix style.css: .thumb-preview .slide must use pointer-events: none.");
    }
  }

  const thumbActiveBodies = ruleBodies(css, ".thumb-preview .slide.active");
  if (thumbActiveBodies.length === 0) {
    errors.push("Fix style.css, not JS: keep .thumb-preview .slide.active for layout-specific slide display in thumbnails.");
  } else if (!thumbActiveBodies.some((body) => /display\s*:\s*var\(\s*--slide-display\b/i.test(body))) {
    errors.push("Fix style.css: .thumb-preview .slide.active must use display: var(--slide-display).");
  }

  const presentingDeckBodies = ruleBodies(css, "body.presenting .deck");
  if (presentingDeckBodies.length === 0) {
    errors.push("Fix style.css: keep the body.presenting .deck fullscreen centering rule.");
  } else {
    if (!presentingDeckBodies.some((body) => hasDeclaration(body, "width", "100vw"))) {
      errors.push("Fix style.css: body.presenting .deck must use width: 100vw.");
    }
    if (!presentingDeckBodies.some((body) => hasDeclaration(body, "height", "100vh"))) {
      errors.push("Fix style.css: body.presenting .deck must use height: 100vh.");
    }
    if (!presentingDeckBodies.some((body) => hasDeclaration(body, "display", "grid"))) {
      errors.push("Fix style.css: body.presenting .deck must use display: grid.");
    }
    if (!presentingDeckBodies.some((body) => /place-items\s*:\s*center/i.test(body))) {
      errors.push("Fix style.css: body.presenting .deck must use place-items: center.");
    }
  }

  const presentingProgressBodies = ruleBodies(css, "body.presenting .presenter-progress");
  if (presentingProgressBodies.length === 0) {
    errors.push("Fix style.css: keep body.presenting .presenter-progress so progress spans the fullscreen viewport.");
  } else {
    requireDeclaration(presentingProgressBodies, "body.presenting .presenter-progress", "left", "0", errors, "0");
  }

  const presentingSlideBodies = ruleBodies(css, "body.presenting .slide");
  if (presentingSlideBodies.length === 0) {
    errors.push("Fix style.css: keep the body.presenting .slide runtime rule.");
    return;
  }

  if (
    presentingSlideBodies.some(
      (body) => hasDeclaration(body, "width", "100vw") || hasDeclaration(body, "height", "100vh"),
    )
  ) {
    errors.push(
      "Fix style.css, not JS: fullscreen must keep slide dimensions and use --presenter-scale; do not set body.presenting .slide to 100vw/100vh.",
    );
  }

  if (!presentingSlideBodies.some((body) => /transform\s*:\s*scale\(\s*var\(\s*--presenter-scale\b/i.test(body))) {
    errors.push("Fix style.css: body.presenting .slide must use transform: scale(var(--presenter-scale, 1)).");
  }

  if (!presentingSlideBodies.some((body) => hasDeclaration(body, "display", "none"))) {
    errors.push("Fix style.css: body.presenting .slide must hide inactive slides with display: none.");
  }

  const presentingActiveBodies = ruleBodies(css, "body.presenting .slide.active");
  if (presentingActiveBodies.length === 0) {
    errors.push("Fix style.css: keep body.presenting .slide.active for the current fullscreen slide.");
  } else if (!presentingActiveBodies.some((body) => /display\s*:\s*var\(\s*--slide-display\b/i.test(body))) {
    errors.push("Fix style.css: body.presenting .slide.active must use display: var(--slide-display).");
  }

  const presentingHintBodies = ruleBodies(css, "body.presenting .presenter-hint");
  if (presentingHintBodies.length === 0) {
    errors.push("Fix style.css: keep body.presenting .presenter-hint to hide the hint during presentation.");
  } else {
    requireDeclaration(presentingHintBodies, "body.presenting .presenter-hint", "opacity", "0", errors, "0");
    requireDeclaration(presentingHintBodies, "body.presenting .presenter-hint", "pointer-events", "none", errors, "none");
  }

  const presentingSidebarBodies = ruleBodies(css, "body.presenting .presenter-sidebar");
  if (presentingSidebarBodies.length === 0) {
    errors.push("Fix style.css: keep body.presenting .presenter-sidebar to hide thumbnails during presentation.");
  } else {
    requireDeclaration(presentingSidebarBodies, "body.presenting .presenter-sidebar", "display", "none", errors, "none");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const errors = [];
  const deckFiles = {
    index: path.join(args.deck, "index.html"),
    style: path.join(args.deck, "style.css"),
    presenter: path.join(args.deck, "presenter.js"),
  };
  const skillPresenter = path.join(args.skill, "assets", "presenter.js");

  for (const [label, filePath] of Object.entries(deckFiles)) {
    if (!(await exists(filePath))) {
      errors.push(`Missing required deck file ${label}: ${filePath}`);
    }
  }
  if (!(await exists(skillPresenter))) {
    errors.push(`Missing fixed runtime asset: ${skillPresenter}`);
  }

  const html = await readText(deckFiles.index, errors, "index.html");
  const css = await readText(deckFiles.style, errors, "style.css");

  let stats = { slideCount: 0, noteCount: 0 };
  if (html) stats = validateHtml(html, errors);
  if (css) validateCss(css, errors, stats.slideRootClasses || new Set());

  if ((await exists(deckFiles.presenter)) && (await exists(skillPresenter))) {
    const [deckHash, skillHash] = await Promise.all([sha256(deckFiles.presenter), sha256(skillPresenter)]);
    if (deckHash !== skillHash) {
      errors.push(
        `presenter.js differs from fixed runtime; restore by copying ${skillPresenter} into the deck.`,
      );
    }
  }

  if (errors.length > 0) {
    console.error("HTML PPT deck validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`HTML PPT deck validation passed: ${stats.slideCount} slides, ${stats.noteCount} notes.`);
}

main().catch((error) => {
  console.error(`HTML PPT deck validation crashed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
