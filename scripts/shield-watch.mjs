// ShieldFont watcher for Quartz `--serve`.
// Quartz rebuilds HTML into the output dir on every content change; this
// process re-shields each changed file a moment later. Run it alongside
// `npx quartz build --serve`.
//
// Usage:  node scripts/shield-watch.mjs [-o public]

import { readFileSync, writeFileSync, globSync } from "node:fs";
import { parseArgs } from "node:util";
import { encode, alpha } from "@shieldfont/core";
import * as parse5 from "parse5";
import chokidar from "chokidar"; // already a Quartz dependency

const { values } = parseArgs({
  options: { out: { type: "string", short: "o", default: "public" } },
});
const OUT = values.out.replace(/\/$/, "");

const encodeTextNodes = (node, dict) => {
  if (node.nodeName === "#text") node.value = encode(node.value, dict);
  for (const child of node.childNodes ?? []) encodeTextNodes(child, dict);
};
const visit = (node, dict) => {
  if ((node.attrs ?? []).some((a) => a.name === "data-shield")) {
    encodeTextNodes(node, dict);
  }
  for (const child of node.childNodes ?? []) visit(child, dict);
};

// The encoding is idempotent for intact files, but Quartz rewrites the whole
// file from scratch on each rebuild, so we can just re-encode blindly.
// Debounce: Quartz may write several files in quick succession.
const pending = new Map();
const lastWritten = new Map(); // file -> content we wrote, so we skip our own writes
const shield = (file) => {
  try {
    const raw = readFileSync(file, "utf8");
    if (!raw.includes("data-shield")) return;
    if (lastWritten.get(file) === raw) return; // our own output, not Quartz's
    const doc = parse5.parse(raw);
    visit(doc, alpha);
    const out = parse5.serialize(doc);
    lastWritten.set(file, out);
    writeFileSync(file, out);
    console.log(`shield-watch: shielded ${file}`);
  } catch (err) {
    // File may be mid-write; the next chokidar event retries.
    console.error(`shield-watch: ${file}: ${err.message}`);
  }
};

const flush = (path) => {
  clearTimeout(pending.get(path));
  pending.delete(path);
  shield(path);
};

// chokidar v4 dropped glob support: watch the dir recursively, filter here.
const isHtml = (p) => p.endsWith(".html");
const watcher = chokidar.watch(OUT, {
  ignoreInitial: false,
  recursive: true,
  awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
});

const initial = globSync(`${OUT}/**/*.html`);
for (const f of initial) shield(f);
if (initial.length) console.log(`shield-watch: shielded ${initial.length} existing page(s).`);

watcher.on("all", (event, path) => {
  if ((event !== "add" && event !== "change") || !isHtml(path)) return;
  // Short debounce so a rebuild touching many files doesn't parse mid-write.
  clearTimeout(pending.get(path));
  pending.set(path, setTimeout(() => flush(path), 150));
});

console.log(`shield-watch: watching ${OUT}/**/*.html for changes…`);
