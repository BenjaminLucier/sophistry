// @ts-check
/// <reference types="@expressive-code/plugin-collapsible-sections" />
/**
 * An Expressive Code plugin that folds a code block's leading `import`
 * statements, the way the sidebar's groups start collapsed. The fold is drawn
 * by `@expressive-code/plugin-collapsible-sections`, which must be registered
 * after this plugin; this one only tells it which lines to fold.
 *
 * A block keeps its imports open when it sets its own `collapse` range, or
 * when its meta says `collapseImports=false`.
 */

const SCRIPT_LANGS = new Set([
	"js",
	"jsx",
	"mjs",
	"cjs",
	"ts",
	"tsx",
	"mts",
	"cts",
	"javascript",
	"typescript",
]);

/** Fewer import lines than this stay open: a one-line fold saves nothing. */
const MIN_LINES = 2;

const IMPORT_START = /^\s*import\b/;
// The line that finishes an import: `... from "x"` or a bare `import "x"`.
const IMPORT_END = /(\bfrom\s*|^\s*import\s*)(["'])[^"']*\2\s*;?\s*$/;
const COMMENT = /^\s*(\/\/|\/\*|\*)/;

/**
 * The 1-based line range of the import statements at the top of `lines`, or
 * `undefined` when there are fewer than {@link MIN_LINES} of them. Comments
 * and blank lines before the first import are left out of the range; blank
 * lines and comments between imports are folded with them.
 *
 * @param {readonly string[]} lines
 * @returns {{ from: number, to: number } | undefined}
 */
export function leadingImportRange(lines) {
	let from = 0;
	let to = 0;
	let inImport = false;
	for (let i = 0; i < lines.length; i++) {
		const line = /** @type {string} */ (lines[i]);
		if (inImport) {
			if (IMPORT_END.test(line)) {
				inImport = false;
				to = i + 1;
			}
		} else if (IMPORT_START.test(line)) {
			if (from === 0) from = i + 1;
			if (IMPORT_END.test(line)) to = i + 1;
			else inImport = true;
		} else if (line.trim() !== "" && !COMMENT.test(line)) {
			break;
		}
	}
	if (from === 0 || to === 0 || inImport) return undefined;
	if (to - from + 1 < MIN_LINES) return undefined;
	return { from, to };
}

/** @returns {import("@astrojs/starlight/expressive-code").ExpressiveCodePlugin} */
export function pluginCollapseImports() {
	return {
		name: "Collapse imports",
		hooks: {
			preprocessMetadata: ({ codeBlock }) => {
				if (!SCRIPT_LANGS.has(codeBlock.language)) return;
				if (codeBlock.metaOptions.getBoolean("collapseImports") === false) {
					return;
				}
				const own = codeBlock.props.collapse;
				const hasOwn =
					(Array.isArray(own) ? own.length > 0 : own !== undefined) ||
					codeBlock.metaOptions.getRanges("collapse").length > 0;
				if (hasOwn) return;
				const range = leadingImportRange(
					codeBlock.getLines().map((line) => line.text),
				);
				if (range) codeBlock.props.collapse = [`${range.from}-${range.to}`];
			},
		},
	};
}
