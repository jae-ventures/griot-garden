// ShieldFont post-build step for Quartz (v5).
// Runs AFTER `quartz build` emits HTML into the output directory.
// Encodes text nodes inside any element carrying data-shield.
//
// Install once, in your Quartz project root:
//   npm i @shieldfont/core parse5
//
// Usage:
//   node scripts/shield.mjs                 # encodes public/**/*.html
//   node scripts/shield.mjs -d docs         # or point it at another output dir

import { readFileSync, writeFileSync, globSync } from "node:fs";
import { parseArgs } from "node:util";
import { encode, alpha } from "@shieldfont/core";
import * as parse5 from "parse5";

const { values } = parseArgs({
  options: { out: { type: "string", short: "o", default: "public" } },
});
const OUT = values.out.replace(/\/$/, "");

// Depth-first walk: encode every text node in place.
const encodeTextNodes = (node, dict) => {
  if (node.nodeName === "#text") node.value = encode(node.value, dict);
  for (const child of node.childNodes ?? []) encodeTextNodes(child, dict);
};

// Find every element with data-shield and shield it.
const visit = (node, dict) => {
  const attrs = node.attrs ?? [];
  if (attrs.some((a) => a.name === "data-shield")) encodeTextNodes(node, dict);
  for (const child of node.childNodes ?? []) visit(child, dict);
};

const files = globSync(`${OUT}/**/*.html`);
if (files.length === 0) {
  console.error(`shield.mjs: no HTML files under ${OUT}/ — run \`quartz build\` first.`);
  process.exit(1);
}

let shielded = 0;
for (const file of files) {
  const raw = readFileSync(file, "utf8");
  if (!raw.includes("data-shield")) continue; // skip untouched pages fast
  const doc = parse5.parse(raw);
  visit(doc, alpha);
  writeFileSync(file, parse5.serialize(doc));
  shielded++;
}

console.log(`shield.mjs: shielded ${shielded} of ${files.length} pages (${OUT}/).`);
