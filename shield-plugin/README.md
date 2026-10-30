# ShieldFont for Quartz v5

Publishes your writing with the words replaced. The HTML your site serves holds
decoy text; the Optik webfont renders those decoys back into your original prose
for human readers. Scrapers, feed readers, and "view source" see the decoys.

This kit is a **Quartz v5 transformer plugin**.

---

## What a transformer plugin actually is in Quartz v5

Worth reading once — the previous attempts failed entirely on this point.

Quartz v5 turned plugins into ordinary npm packages that a loader discovers from
`quartz.config.yaml`. A plugin is not a file you import into a config, and it is
not a script you run beside the build. It is a package directory with an entry
point, listed in the config, instantiated by the loader, and invoked by the build
pipeline in process.

Three stages exist, and which one you hook decides what you can see:

| Hook | Tree | Used for |
| --- | --- | --- |
| `markdownPlugins` | mdast (Markdown AST) | syntax, text transforms |
| `htmlPlugins` | hast (HTML AST) | post-render HTML fixes |
| `externalResources` | — | injecting CSS/JS into pages |

**This plugin uses `markdownPlugins`.** That is the decisive choice, and it is
what every earlier version got wrong.

In the mdast stage, Markdown has been parsed but not yet turned into HTML. Your
`<div data-shield>` line is an `html` node, and — crucially — the paragraphs
between the tags are ordinary `paragraph`, `text`, and `inlineCode` nodes. So:

- text is reachable as text, with emphasis and links already separated out;
- `code` and `inlineCode` are distinct node types, so skipping them is
  structural rather than a fragile string check;
- no HTML string ever has to be re-parsed (`hast-util-raw` is not involved, and
  is not a dependency).

An `htmlPlugins` hook cannot do this cheaply: by then the div and its contents
have been flattened into hashed-in HTML, and any text extraction means reparsing
markup — which is where the earlier versions broke.

Because the transform runs **inside every build**, full or incremental, a
`--serve` reload can never serve unencoded plaintext. There is no watcher, no
`public/` rewriting, and no race with the browser reload. That was the original
gibberish bug: a separate script encoded the output *after* Quartz had already
told the browser to reload.

---

## Install

Requirements: Quartz v5, Node 22+.

1. Copy the `shield-plugin` folder next to your Quartz project.

2. Register it:

   ```bash
   npx quartz plugin add ./shield-plugin
   ```

   The loader sees a prebuilt `dist/` and uses it as-is — it does **not** run
   `npm install` for the plugin. You do not need the plugin's `node_modules` to
   build your site.

3. Make sure the woff2 files are where the stylesheet expects them:
   `quartz/static/fonts/optik-a.woff2` and `optik-a-italic.woff2`.

   The font is not part of this kit or of `@shieldfont/core` — you already have
   it serving your pages. Keep the variant that matches `mapping` (alpha →
   `optik-a`).

4. Append `styles/custom.scss` to `your-quartz/quartz/styles/custom.scss` if it
   is not already there.

5. Build:

   ```bash
   npx quartz build --serve
   ```

Nothing else is required. `quartz.config.yaml` gets a `- source:` entry and
`quartz.lock.json` records the resolution; both are generated for you.

---

## Writing shielded text

Two syntaxes, both rewritable: a `<div>` marker (works today) and HTML comment
markers (quieter in the source).

```markdown
<div data-shield>

Two paragraphs and a list, all shielded, in one div. Blank lines between blocks
keep Markdown processing active, so **bold**, *italics*, and lists still work
and are encoded word by word.

- one
- two

</div>
```

```markdown
<!-- shield-on -->

Alternative form, same result.

<!-- shield-off -->
```

Rules of thumb:

- **One div per section, not per paragraph.** A whole section in one shield is
  the natural unit.
- **Keep code outside.** Encoding corrupts identifiers, and the Optik font would
  "decode" monospace into fluent nonsense.
- **Keep quotes outside** if you want native `<blockquote>` styling and citation
  plugins; quotes are public words anyway.
- **Headings between shields stay plain** — structural, low-information. Put a
  heading inside the shield if it names something unpublished.
- **Inline code inside a shield is skipped automatically**, so naming a command
  or flag in prose stays copy-pasteable.

After the build, marked text is wrapped in `<div class="shield">` and the marker
attributes are gone: the shipped HTML carries no trace of the build step.

---

## How the font fits in

`styles/custom.scss` applies `font-family: "Optik"` to `.shield`. The mapping is
bidirectional:

```text
your Markdown  ──encode──▶  HTML holds "This overview is braked"   (bots, view-source)
                                   │
                            Optik font renders
                                   ▼
                            reader sees "This paragraph is shielded"
```

Encoder and font must come from the same dictionary. This kit ships and defaults
to **alpha** (`optik-a.woff2`). Using `optik-b` with the `alpha` mapping produces
confident, fluent, wrong prose — the exact failure mode worth remembering, since
it looks like a license to publish while saying something you did not write.

To change dictionary, pass options in the config entry:

```yaml
- source: ./shield-plugin
  options:
    mapping: beta          # or gamma; match optik-b / optik-c
    wrapperClass: shield
    markerAttribute: data-shield
```

---

## Verifying a page

```bash
grep -c 'class="shield"' public/your-page.html   # expect > 0
```

Then confirm the decoys are inside and your prose is not:

```bash
node --input-type=module -e '
import { decode, alpha } from "@shieldfont/core"
console.log(decode("This overview is braked", alpha))'
```

`assertShipped` from `@shieldfont/core` does this check for a whole document and
is the only helper that can tell a protected page from an unprotected one.

---

## Troubleshooting

**Text is not transformed.**
Confirm the plugin is registered and running:

```bash
grep -n "shield-plugin" quartz.config.yaml quartz.lock.json
```

If `quartz.lock.json` is missing the entry, the add step never completed. Re-run
`npx quartz plugin add ./shield-plugin`.

**`Could not load plugin ... to detect category` / `no dist/index.d.ts found`.**
The loader requires compiled output. `dist/` ships with this kit; if you deleted
it, rebuild inside the plugin folder:

```bash
cd shield-plugin && npm install && npx tsup
```

**`ENOENT ... .quartz/plugins/shield` during add.**
A stale symlink from an older layout. Delete `.quartz/plugins/shield` (or the
whole `.quartz/plugins` folder) and re-add.

**`Cannot find module 'hast-util-raw'`.**
Gone from this version — it was only needed by the abandoned `htmlPlugins`
approach. If you still see it, you are on an older copy; use this kit's
`dist/`.

**Text renders as fluent nonsense.**
Dictionary mismatch: `mapping` does not match the woff2 you serve. Check that
`options.mapping` and the `@font-face` URL point at the same variant.

**Text is plaintext in the browser.**
Read the page source, not the rendered page. If the source shows decoys and the
screen shows your prose, everything is working. If the source shows your prose,
the plugin did not run — see the first item.

---

## Package layout

```text
shield-plugin/
  src/index.ts        plugin source (remark-stage transform)
  tsup.config.ts      bundling: @shieldfont/core is inlined
  dist/index.js       self-contained bundle, zero imports
  dist/index.d.ts     self-contained types, zero imports
  package.json        quartz manifest: name, category transformer
```

`dist/` is checked in on purpose: the loader prefers prebuilt output, and its
absence triggers a dependency install that can fail on a machine without the
plugin's dev toolchain.
