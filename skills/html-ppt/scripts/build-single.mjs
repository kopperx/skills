#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const options = {
    input: ".",
    output: null,
    html: "index.html",
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
    "  node build-single.mjs --input <deck-dir> --output <deck-dir>/dist/html-ppt-single.html",
    "",
    "Options:",
    "  --input   Deck directory containing index.html, style.css, presenter.js",
    "  --output  Output single HTML path",
    "  --html    HTML filename inside input directory, default index.html",
  ].join("\n");
}

function escapeStyle(text) {
  return text.replace(/<\/style/gi, "<\\/style");
}

function escapeScript(text) {
  return text.replace(/<\/script/gi, "<\\/script");
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

async function replaceStylePlaceholders(html, inputDir) {
  const linkPattern = /<link\b([^>]*?)\bhref=["']([^"']+)["']([^>]*?)>/gi;
  let output = "";
  let lastIndex = 0;

  for (const match of html.matchAll(linkPattern)) {
    const [full, before, href, after] = match;
    const attrs = `${before} ${after}`;

    output += html.slice(lastIndex, match.index);
    lastIndex = match.index + full.length;

    if (!/\brel=["'][^"']*\bstylesheet\b/i.test(attrs) || /^(?:https?:)?\/\//i.test(href) || href.startsWith("data:")) {
      output += full;
      continue;
    }

    const cssPath = path.resolve(inputDir, href);
    const css = await fs.readFile(cssPath, "utf8");
    output += `<style data-inlined-from="${href}">\n${escapeStyle(css)}\n</style>`;
  }

  output += html.slice(lastIndex);
  return output;
}

async function replaceScriptTags(html, inputDir) {
  const scriptPattern = /<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi;
  const inlineScripts = [];
  let output = "";
  let lastIndex = 0;

  for (const match of html.matchAll(scriptPattern)) {
    const [full, before, src, after] = match;

    output += html.slice(lastIndex, match.index);
    lastIndex = match.index + full.length;

    if (/^(?:https?:)?\/\//i.test(src) || src.startsWith("data:")) {
      output += full;
      continue;
    }

    const jsPath = path.resolve(inputDir, src);
    const js = await fs.readFile(jsPath, "utf8");
    inlineScripts.push(`<script data-inlined-from="${src}">\n${escapeScript(js)}\n</script>`);
  }

  output += html.slice(lastIndex);

  if (inlineScripts.length === 0) {
    return output;
  }

  if (/<\/body>/i.test(output)) {
    return output.replace(/<\/body>/i, `${inlineScripts.join("\n")}\n</body>`);
  }

  return `${output}\n${inlineScripts.join("\n")}`;
}

async function buildSingleHtml(options) {
  const inputDir = path.resolve(options.input);
  const htmlPath = path.resolve(inputDir, options.html);
  const outputPath = path.resolve(options.output || path.join(inputDir, "dist", "html-ppt-single.html"));

  let html = await fs.readFile(htmlPath, "utf8");
  html = stripRuntimeState(html);
  html = await replaceStylePlaceholders(html, inputDir);
  html = await replaceScriptTags(html, inputDir);

  if (!/^\s*<!doctype html>/i.test(html)) {
    html = `<!DOCTYPE html>\n${html}`;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, "utf8");

  return outputPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    return;
  }

  const outputPath = await buildSingleHtml(options);
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
