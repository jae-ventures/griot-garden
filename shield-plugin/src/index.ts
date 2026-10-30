import { visit } from "unist-util-visit"
import { encode, alpha } from "@shieldfont/core"

/**
 * The encoding dictionary: flat `{source: target}` pairs. Declared structurally
 * (= `Mapping` from @shieldfont/core) rather than imported, so the published
 * .d.ts has no external imports and resolves in a project that installed only
 * this plugin with a prebuilt dist/ and no node_modules of its own.
 */
export type ShieldMapping = Record<string, string>

/* ------------------------------------------------------------------ *
 * Structural types.
 *
 * Declared locally on purpose: the published .d.ts is produced by tsup's
 * dts pass, and `unified` / `mdast` are external to the bundle (Quartz
 * supplies them at runtime). Importing their types here would make the dts
 * build depend on packages a consumer may not have hoisted.
 * ------------------------------------------------------------------ */

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  [key: string]: unknown
}
type MdRoot = MdNode & { children: MdNode[] }

type MdTransformer = (tree: MdRoot, file?: unknown) => void
type MdAttacher = (opts?: unknown) => MdTransformer
type PluggableList = Array<MdAttacher | [MdAttacher, unknown]>

/* ------------------------------------------------------------------ *
 * Quartz v5 plugin shape (mirrored from @quartz-community/types, which
 * ships no prebuilt dist of its own).
 * ------------------------------------------------------------------ */

interface QuartzTransformerPluginInstance {
  name: string
  markdownPlugins?: (ctx?: unknown) => PluggableList
}

export type QuartzTransformerPlugin<O = undefined> = (opts?: O) => QuartzTransformerPluginInstance

export interface ShieldFontOptions {
  /** Which ShieldFont dictionary to encode with. Must match the webfont
   *  you serve: alpha -> optik-a.woff2, beta -> optik-b, gamma -> optik-c. */
  mapping?: ShieldMapping
  /** Class placed on the wrapper div. The stylesheet applies the Optik
   *  font to it, so this is what makes the browser decode the text. */
  wrapperClass?: string
  /** Attribute used to mark a hand-written <div>. */
  markerAttribute?: string
}

const DEFAULTS: Required<ShieldFontOptions> = {
  mapping: alpha as ShieldMapping,
  wrapperClass: "shield",
  markerAttribute: "data-shield",
}

/* ------------------------------------------------------------------ *
 * Marker recognition.
 *
 * Two syntaxes, both of which survive Markdown untouched (they are raw
 * HTML, so remark-parse puts them in `html` nodes — the text between them
 * stays ordinary mdast, which is the whole point):
 *
 *   <!-- shield-on -->   ...   <!-- shield-off -->     block markers
 *   <div data-shield>    ...   </div>                  div markers
 *
 * Both are rewritten to a plain <div class="shield"> wrapper, which is
 * what the stylesheet needs to switch fonts. The markers themselves are
 * consumed, so the shipped HTML carries no sign ShieldFont was used.
 * ------------------------------------------------------------------ */

const COMMENT_OPEN = /^<!--\s*shield-on\s*-->$/i
const COMMENT_CLOSE = /^<!--\s*shield-off\s*-->$/i
const DIV_TAG = /<div\b([^>]*)>/i
const DIV_CLOSE = /<\/div\s*>/gi
const DIV_OPEN = /<div\b/gi

type Mode = null | "comment" | "div"

interface State {
  mode: Mode
  /** How many <div> are open while tracking a div marker block. */
  divDepth: number
}

/** Encode every text descendant. `code` and `inlineCode` nodes hold their
 *  content in `value`, not in text children, so they are skipped for free. */
function encodeText(node: MdNode, mapping: ShieldMapping) {
  visit(node, "text", (text: { value: string }) => {
    text.value = encode(text.value, mapping as Record<string, string>)
  })
}

/** True when the open tag carries the marker attribute as a bare word. */
function isMarked(attrs: string, marker: string) {
  const re = new RegExp(`(^|\\s)${marker}(?=[\\s=/>]|$)`, "i")
  return re.test(attrs)
}

/** Encode the text between tags of a single html string, leaving the tags
 *  (and therefore attributes) byte-identical. Used for the one-line form
 *  `<div data-shield>text</div>`. */
function encodeInlineTags(value: string, mapping: ShieldMapping) {
  // Split into alternating [text, tag, text, tag, ...]; tags pass through
  // untouched so attributes survive byte-for-byte.
  return value
    .split(/(<[^>]*>)/)
    .map((part, i) => (i % 2 === 1 ? part : encode(part, mapping as Record<string, string>)))
    .join("")
}

/**
 * One sequential pass over a children array, carrying marker state across
 * siblings. Nested containers are only descended into when we are *not*
 * already inside a shield, which also guarantees each text node is encoded
 * exactly once (encode is its own inverse, so encoding twice would undo it).
 */
function processChildren(children: MdNode[], state: State, opts: Required<ShieldFontOptions>): MdNode[] {
  const out: MdNode[] = []
  const openTag = `<div class="${opts.wrapperClass}">`

  for (const node of children) {
    if (node.type === "html") {
      const value = (node.value ?? "").trim()

      if (state.mode === null) {
        if (COMMENT_OPEN.test(value)) {
          state.mode = "comment"
          out.push({ type: "html", value: openTag })
          continue
        }

        const open = DIV_TAG.exec(value)
        if (open && isMarked(open[1], opts.markerAttribute)) {
          // One-line form: the whole block lives in this single html node.
          if (DIV_CLOSE.test(value)) {
            DIV_CLOSE.lastIndex = 0
            const inner = value.slice(open.index + open[0].length, value.lastIndexOf("</div>"))
            out.push({ type: "html", value: openTag + encodeInlineTags(inner, opts.mapping) + "</div>" })
            continue
          }
          state.mode = "div"
          state.divDepth = 1
          out.push({ type: "html", value: openTag })
          continue
        }

        out.push(node)
        continue
      }

      if (state.mode === "comment") {
        if (COMMENT_CLOSE.test(value)) {
          state.mode = null
          out.push({ type: "html", value: "</div>" })
          continue
        }
        // Other comments inside the block are kept but never encoded.
        out.push(node)
        continue
      }

      // div mode: count nested <div> so only the real close ends the block.
      DIV_OPEN.lastIndex = 0
      DIV_CLOSE.lastIndex = 0
      const opens = (value.match(DIV_OPEN) ?? []).length
      const closes = (value.match(DIV_CLOSE) ?? []).length
      state.divDepth += opens - closes
      if (state.divDepth <= 0) {
        state.mode = null
        out.push({ type: "html", value: "</div>" })
        continue
      }
      out.push(node)
      continue
    }

    if (state.mode !== null) {
      encodeText(node, opts.mapping)
      out.push(node)
      continue
    }

    if (Array.isArray(node.children)) {
      node.children = processChildren(node.children, state, opts)
    }
    out.push(node)
  }

  return out
}

const remarkShieldFont = (opts: Required<ShieldFontOptions>): MdAttacher => {
  return () => (tree: MdRoot) => {
    tree.children = processChildren(tree.children, { mode: null, divDepth: 0 }, opts)
  }
}

/**
 * ShieldFont for Quartz v5.
 *
 * Encodes the text inside marked regions at build time, so the HTML your
 * site serves holds decoy words while readers see your prose once the
 * Optik webfont renders it. Runs in the remark stage — the same place
 * Quartz's own transformers run — so it applies to full and incremental
 * (`--serve`) builds alike, before the browser is ever told to reload.
 */
export const ShieldFont: QuartzTransformerPlugin<ShieldFontOptions> = (userOptions?: ShieldFontOptions) => {
  const opts: Required<ShieldFontOptions> = { ...DEFAULTS, ...userOptions }
  return {
    name: "ShieldFont",
    markdownPlugins(): PluggableList {
      return [remarkShieldFont(opts)]
    },
  }
}

/* Static category marker read by Quartz v5's loader (`detectCategoryFromModule`).
 * Without it the loader probes `ShieldFont()` and infers the category from the
 * returned object; declaring it makes detection deterministic. */
;(ShieldFont as unknown as { quartzCategory: string }).quartzCategory = "transformer"

export default ShieldFont
