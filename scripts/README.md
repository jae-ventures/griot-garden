# ShieldFont × Quartz

Adds ShieldFont protection to a [Quartz](https://github.com/jackyzha0/quartz) v5 site.

## How it works

Quartz is not React, so we use ShieldFont's [use-anywhere](https://shieldfont.org/docs/use-anywhere) path:
**build the site, then walk the emitted HTML** and encode the text inside
marked elements. Markdown in `content/` stays your plain-English source of
truth — nothing in your source is ever encoded, and every rebuild regenerates
the decoys from scratch.

```
content/*.md ──▶ quartz build ──▶ public/*.html ──▶ shield.mjs ──▶ encoded HTML
    (plain)         (plain)           (plain)          @shieldfont/core  (decoys + font)

In dev (`npm run serve`), shield-watch.mjs sits where shield.mjs sits and
re-shields every rebuild automatically.
```

## Setup

From your Quartz project root:

```bash
# 1. Install the encoder, the font package, and the HTML parser
npm i @shieldfont/core @shieldfont/font parse5 chokidar

# 2. Copy the shielded font files into Quartz static assets
mkdir -p quartz/static/fonts
cp node_modules/@shieldfont/font/optik-a.woff2 quartz/static/fonts/
cp node_modules/@shieldfont/font/optik-a-italic.woff2 quartz/static/fonts/

# 3. Drop in the scaffold files
#    scripts/shield.mjs            → <project>/scripts/shield.mjs
#    styles/custom.scss            → <project>/quartz/styles/custom.scss
#    content/protected-note.md     → <project>/content/protected-note.md
#    package.json.snippet          → merge into package.json scripts
```

## Marking content

Wrap anything you want protected in Markdown with the shield div:

```markdown
<div class="shield" data-shield>

Any paragraphs here get their content words swapped at build time.

</div>
```

(Blank lines inside the div matter — without them Markdown renders the
contents inline instead of as block HTML.)

## Build & verify

```bash
npx quartz build
node scripts/shield.mjs           # or just: npm run build
grep -rn "future of writing belongs" public/ || echo "clean"
```

No output from the grep = no leak. Check with a sentence containing several
content words; single common words often survive encoding and prove nothing.

## Git: pushing these changes

These are source files, not generated output — `public/` stays gitignored and
`npx quartz sync` won't carry them (sync only commits/pushes `content/` and
pulls remote updates). Commit the shield setup with plain git:

```bash
git checkout -b shieldfont        # or your fork's branch

git add scripts/shield.mjs scripts/shield-watch.mjs \
        quartz/styles/custom.scss package.json package-lock.json \
        quartz/static/fonts/optik-a.woff2 quartz/static/fonts/optik-a-italic.woff2
git commit -m "Add ShieldFont post-build step"
git push -u origin shieldfont
```

`package-lock.json` matters: CI runs `npm ci`, and `parse5`/
`@shieldfont/core` must be in it. Day-to-day writing is unchanged: edit
Markdown in `content/`, then `npx quartz sync` as always. Your Markdown is
never encoded — encoding happens at build time — so the sync flow doesn't
change.

## Publishing: where the shield step runs

The rule: encoding must run wherever the final bytes are produced. Pick your
host:

### Self-hosting / build locally, upload `public/`

Nothing changes. `npm run build` already chains the shield step. Copy or
upload `public/` after it — never a `public/` produced by a bare
`npx quartz build`.

### Cloudflare Pages / Vercel / Netlify (host builds in CI)

CI regenerates `public/` from your plain Markdown, so the shield step must
run there. The platforms' default command is
`npx quartz plugin install && npx quartz build` — replace it with:

```
npm ci && npx quartz plugin install && npm run build
```

(`npm run build` is `quartz build && node scripts/shield.mjs`, so the shield
step lives in one place. `npm ci` is needed because the packages must be
installed in the CI environment too.)

- **Cloudflare Pages**: Settings → Build command. If you rely on git for
  timestamps, keep their `git fetch --unshallow &&` prefix.
- **Vercel**: Project Settings → Build and Output Settings → Build Command.
- **Netlify**: Site configuration → Build command.

### GitHub Pages (deploy.yml)

In `quartz/.github/workflows/deploy.yml`, add a step after "Build Quartz" and
before the artifact upload:

```yaml
      - name: Build Quartz
        run: npx quartz build
      - name: Shield content
        run: node scripts/shield.mjs
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: public
```

(or change the build step to `run: npm run build` — same effect.)

### After the first CI deploy, verify the deployed site

View-source the demo page on the live URL. Two possible failures, both
silent:

- Original sentence visible in source → the CI step didn't run. Check the
  build log for `shield.mjs: shielded N of M pages`.
- Decoys in source **and** decoys on screen → the font didn't load. Check
  the font path and the browser console (see below).

Success looks like: decoys in source, real words on screen.

## Files

| File | Where it goes | What it does |
| --- | --- | --- |
| `scripts/shield.mjs` | `<project>/scripts/` | Post-build encoder for `public/**/*.html` |
| `scripts/shield-watch.mjs` | `<project>/scripts/` | Same, live: runs beside `--serve` and re-shields on every rebuild |
| `styles/custom.scss` | `quartz/styles/custom.scss` | `@font-face` + `.shield` class |
| `content/protected-note.md` | `content/` | Working demo page with a canary sentence |
| `package.json.snippet` | merge into `package.json` | Build wiring |

## Notes & limits (read before relying on this)

- **Screen readers**: the non-React tier ships no accessibility machinery.
  Add `aria-hidden="true"` to `.shield` elements yourself, or leave that
  content unshielded. See [plain-text-mode docs](https://shieldfont.org/docs/plain-text-mode/).
- **SEO**: search engines index the decoy. Never shield pages you want ranked.
- **Dev server**: `npm run serve` runs two processes: Quartz's `--serve`
  rebuild, and `scripts/shield-watch.mjs`, which watches the output dir and
  re-shields every changed HTML file within ~150ms. It skips its own writes
  (encoding twice would flip the text back to plaintext, since the mapping is
  an involution). Cross-platform wiring, works on Windows:

  ```json
  "serve": "concurrently \"npx quartz build --serve\" \"node scripts/shield-watch.mjs\""
  ```

  (Install `concurrently` first: `npm i -D concurrently`. The no-extra-dependency
  alternative `npx quartz build --serve & node scripts/shield-watch.mjs` needs
  a POSIX shell, so on Windows prefer `concurrently`.)
- **Weights**: only Regular (400) ships in `@shieldfont/font`. Keep shielded
  text at 400; the CSS enforces this with `font-synthesis: none`.
- **Dictionary choice**: this scaffold pins `alpha` (optik-a font + `alpha`
  dict in the script). They must match, or readers see garbage. To rotate to
  `beta`/`gamma`, change the import in `shield.mjs` and swap the font file.
- **SPA navigation**: Quartz fetches pages client-side on internal links; the
  font loads once and persists, so this should just work — but test a soft
  navigation onto a shielded page.
- **Same-origin font**: keep `/static/fonts/...` on your site's own origin, or
  the browser silently drops the font and readers see decoys.

## Verify the visual result

After `npm run build` and serving `public/`, the demo page should read normally
in the browser, while view-source shows decoy words. If the browser text looks
like nonsense ("determines to those who sell it"), the font isn't loading —
check the `/static/fonts/` path and the console for font errors.
