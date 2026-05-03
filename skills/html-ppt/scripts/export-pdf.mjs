#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillDir = path.resolve(scriptDir, "..");

function parseArgs(argv) {
  const options = {
    input: ".",
    output: null,
    html: "index.html",
    skill: defaultSkillDir,
    browser: null,
    validate: true,
    keepTemp: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--input" && next) {
      options.input = next;
      index += 1;
    } else if (arg === "--output" && next) {
      options.output = next;
      index += 1;
    } else if (arg === "--html" && next) {
      options.html = next;
      index += 1;
    } else if (arg === "--skill" && next) {
      options.skill = next;
      index += 1;
    } else if (arg === "--browser" && next) {
      options.browser = next;
      index += 1;
    } else if (arg === "--no-validate") {
      options.validate = false;
    } else if (arg === "--keep-temp") {
      options.keepTemp = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    "Usage:",
    "  node export-pdf.mjs --input <deck-dir> --output <deck-dir>/dist/html-ppt-vector.pdf --skill <skill-dir>",
    "",
    "Options:",
    "  --input        Deck directory containing index.html, style.css, presenter.js",
    "  --output       Output PDF path",
    "  --html         HTML filename inside input directory, default index.html",
    "  --skill        html-ppt skill directory, default parent of this script",
    "  --browser      Explicit Chromium/Chrome/Edge executable path",
    "  --no-validate  Skip validate-deck.mjs before export",
    "  --keep-temp    Keep the generated print HTML for debugging",
  ].join("\n");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: options.stdio || "pipe",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const message = stderr.trim() || stdout.trim() || `${command} exited with code ${code}`;
      reject(new Error(message));
    });
  });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function candidateBrowsers() {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    return [
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    ];
  }

  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }

  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ];
}

async function findBrowser(explicitBrowser) {
  if (explicitBrowser) {
    const resolved = path.resolve(explicitBrowser);
    if (await exists(resolved)) return resolved;
    throw new Error(`Browser executable not found: ${resolved}`);
  }

  for (const candidate of candidateBrowsers()) {
    if (candidate && await exists(candidate)) {
      return candidate;
    }
  }

  throw new Error("No Chromium/Chrome/Edge executable found. Pass --browser <path>.");
}

function escapeStyle(text) {
  return text.replace(/<\/style/gi, "<\\/style");
}

function stripRuntimeState(html) {
  return html
    .replace(/\sclass="([^"]*\b(?:presenting|laser-mode|pen-mode|edit-mode)\b[^"]*)"/g, (match, value) => {
      const cleaned = value
        .split(/\s+/)
        .filter((item) => item && !["presenting", "laser-mode", "pen-mode", "edit-mode"].includes(item))
        .join(" ");
      return cleaned ? ` class="${cleaned}"` : "";
    })
    .replace(/\scontenteditable="[^"]*"/g, "")
    .replace(/\sspellcheck="[^"]*"/g, "")
    .replace(/\sdata-editable="[^"]*"/g, "");
}

function getDeckSize(html) {
  const deckMatch = html.match(/<main\b[^>]*class=["'][^"']*\bdeck\b[^"']*["'][^>]*>/i);
  const deckTag = deckMatch?.[0] || "";
  const widthMatch = deckTag.match(/\bdata-width=["']?(\d+)["']?/i);
  const heightMatch = deckTag.match(/\bdata-height=["']?(\d+)["']?/i);
  return {
    width: Number(widthMatch?.[1]) || 1280,
    height: Number(heightMatch?.[1]) || 720,
  };
}

function formatInches(px) {
  return `${(px / 96).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}in`;
}

function buildPrintCss(width, height) {
  const pageWidth = formatInches(width);
  const pageHeight = formatInches(height);

  return `
<style data-html-ppt-vector-export>
@page {
  size: ${pageWidth} ${pageHeight};
  margin: 0;
}

html,
body {
  width: ${width}px;
  min-width: ${width}px;
  height: ${height}px;
  min-height: ${height}px;
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
  overflow: visible !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.presenter-sidebar,
.presenter-progress,
.laser-pointer,
.ink-layer,
.tool-status,
.presenter-hint,
.help-bar,
.browse-notes,
.notes {
  display: none !important;
}

.deck {
  display: block !important;
  width: ${width}px !important;
  margin: 0 !important;
  padding: 0 !important;
}

.slide {
  position: relative !important;
  display: var(--slide-display, block) !important;
  width: ${width}px !important;
  height: ${height}px !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  overflow: hidden !important;
  transform: none !important;
  box-shadow: none !important;
  break-inside: avoid;
  break-after: page;
  page-break-inside: avoid;
  page-break-after: always;
}

.slide:last-of-type {
  break-after: auto;
  page-break-after: auto;
}
</style>`;
}

async function buildPrintHtml(inputDir, htmlFile, outputFile) {
  const htmlPath = path.resolve(inputDir, htmlFile);
  let html = await fs.readFile(htmlPath, "utf8");
  html = stripRuntimeState(html);
  const { width, height } = getDeckSize(html);
  const printCss = buildPrintCss(width, height);
  const baseHref = `<base href="${pathToFileURL(inputDir + path.sep).href}">`;

  if (!/<base\b/i.test(html)) {
    html = html.replace(/<head\b[^>]*>/i, (match) => `${match}\n  ${baseHref}`);
  }

  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${printCss}\n</head>`);
  } else {
    html = `${printCss}\n${html}`;
  }

  await fs.writeFile(outputFile, html, "utf8");
  return { width, height };
}

async function validateDeck(inputDir, skillDir) {
  const validateScript = path.join(skillDir, "scripts", "validate-deck.mjs");
  await run(process.execPath, [validateScript, "--deck", inputDir, "--skill", skillDir]);
}

async function exportPdf(options) {
  const inputDir = path.resolve(options.input);
  const skillDir = path.resolve(options.skill || defaultSkillDir);
  const outputPath = path.resolve(options.output || path.join(inputDir, "dist", "html-ppt-vector.pdf"));

  if (options.validate) {
    await validateDeck(inputDir, skillDir);
  }

  const browser = await findBrowser(options.browser);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "html-ppt-pdf-"));
  const tempHtml = path.join(tempDir, "print.html");

  try {
    await buildPrintHtml(inputDir, options.html, tempHtml);
    const userDataDir = path.join(tempDir, "profile");
    const fileUrl = pathToFileURL(tempHtml).href;
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=2000",
      `--user-data-dir=${userDataDir}`,
      "--print-to-pdf-no-header",
      `--print-to-pdf=${outputPath}`,
      fileUrl,
    ];

    await run(browser, args);

    if (!await exists(outputPath)) {
      throw new Error(`PDF export failed; output was not created: ${outputPath}`);
    }

    const stat = await fs.stat(outputPath);
    if (stat.size === 0) {
      throw new Error(`PDF export failed; output is empty: ${outputPath}`);
    }

    return outputPath;
  } finally {
    if (options.keepTemp) {
      console.log(`Kept temporary export HTML: ${tempHtml}`);
    } else {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    return;
  }

  const outputPath = await exportPdf(options);
  console.log(`Wrote vector PDF ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
