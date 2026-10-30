/**
 * The encoding dictionary: flat `{source: target}` pairs. Declared structurally
 * (= `Mapping` from @shieldfont/core) rather than imported, so the published
 * .d.ts has no external imports and resolves in a project that installed only
 * this plugin with a prebuilt dist/ and no node_modules of its own.
 */
type ShieldMapping = Record<string, string>;
interface MdNode {
    type: string;
    value?: string;
    children?: MdNode[];
    [key: string]: unknown;
}
type MdRoot = MdNode & {
    children: MdNode[];
};
type MdTransformer = (tree: MdRoot, file?: unknown) => void;
type MdAttacher = (opts?: unknown) => MdTransformer;
type PluggableList = Array<MdAttacher | [MdAttacher, unknown]>;
interface QuartzTransformerPluginInstance {
    name: string;
    markdownPlugins?: (ctx?: unknown) => PluggableList;
}
type QuartzTransformerPlugin<O = undefined> = (opts?: O) => QuartzTransformerPluginInstance;
interface ShieldFontOptions {
    /** Which ShieldFont dictionary to encode with. Must match the webfont
     *  you serve: alpha -> optik-a.woff2, beta -> optik-b, gamma -> optik-c. */
    mapping?: ShieldMapping;
    /** Class placed on the wrapper div. The stylesheet applies the Optik
     *  font to it, so this is what makes the browser decode the text. */
    wrapperClass?: string;
    /** Attribute used to mark a hand-written <div>. */
    markerAttribute?: string;
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
declare const ShieldFont: QuartzTransformerPlugin<ShieldFontOptions>;

export { type QuartzTransformerPlugin, ShieldFont, type ShieldFontOptions, type ShieldMapping, ShieldFont as default };
