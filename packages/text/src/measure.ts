/**
 * Where KaTeX put everything. KaTeX's own tree has no positions (layout is
 * CSS), so the formula is rendered into a hidden host and read back from the
 * DOM:
 *
 * - **glyphs** from text nodes, with a zero-size inline-block marker for the pen
 *   origin and baseline;
 * - **rules** (fraction bars, overlines) from CSS borders;
 * - **SVG paths** (radicals, big delimiters) via `getScreenCTM()`.
 *
 * Results are pixels from the formula's top-left, y down; `outline.ts` and
 * `MathTex.tsx` take it from there.
 */

import katex from "katex";
import type { FaceName } from "./fonts.js";
import { ensureWebFonts, loadFace, resolveFace } from "./fonts.js";

/**
 * An axis-aligned rectangle in pixels, y growing downward.
 *
 * @category Measuring & outlines
 */
export interface PixelRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * One character, positioned on its baseline.
 *
 * @category Measuring & outlines
 */
export interface MeasuredGlyph {
	kind: "glyph";
	char: string;
	face: FaceName;
	/** Font size in pixels, already including every KaTeX sizing class. */
	fontSize: number;
	/** Pen origin in pixels from the formula's left edge; the glyph's left side bearing is applied by the outline. */
	x: number;
	/** Baseline in pixels from the formula's top edge, not the top of the glyph's box. */
	baseline: number;
	/** Visible window from `overflow: hidden` ancestors; null if unclipped, zero-size if clipped away entirely. */
	clip: PixelRect | null;
}

/**
 * A fraction bar, `\overline`, `\hline`, or `\rule` — a border, not a glyph.
 *
 * @category Measuring & outlines
 */
export interface MeasuredRule {
	kind: "rule";
	/** The border's box in pixels. */
	rect: PixelRect;
	/** Visible window from `overflow: hidden` ancestors; null if unclipped, zero-size if clipped away entirely. */
	clip: PixelRect | null;
}

/**
 * A stretchy piece: SVG path data plus its user-units → pixels matrix.
 *
 * @category Measuring & outlines
 */
export interface MeasuredSvg {
	kind: "svg";
	/** SVG path data in the element's own user units. */
	d: string;
	/** `[a, b, c, d, e, f]`, applied as SVG does. */
	matrix: [number, number, number, number, number, number];
	/** Visible window from `overflow: hidden` ancestors; null if unclipped, zero-size if clipped away entirely. */
	clip: PixelRect | null;
}

/**
 * One measured piece of a formula: a glyph, a rule, or a stretchy SVG path.
 *
 * @category Measuring & outlines
 */
export type MeasuredAtom = MeasuredGlyph | MeasuredRule | MeasuredSvg;

/**
 * The raw layout of a formula as returned by {@link measureLatex}, in pixels at {@link HOST_FONT_SIZE}.
 *
 * @category Measuring & outlines
 */
export interface Measurement {
	/** Every piece of the formula, in DOM order (not reading order). */
	atoms: MeasuredAtom[];
	/** The `.katex` element's own box — the typesetter's idea of the extent. */
	box: PixelRect;
	/** The first line's baseline, in pixels down from the box's top. */
	baseline?: number;
}

/**
 * KaTeX options accepted by the measuring and outlining functions.
 *
 * @category Measuring & outlines
 */
export interface MeasureOptions {
	/**
	 * `\displaystyle` sizing and centred fractions.
	 *
	 * @default true
	 */
	displayMode?: boolean;
	/** Extra macros (name to expansion, e.g. `{ "\\R": "\\mathbb{R}" }`), passed straight through to KaTeX. */
	macros?: Record<string, string>;
}

/**
 * Font size in pixels of the hidden host that formulas are measured in.
 *
 * The host is rendered at a large font size and the result scaled later.
 *
 * Every dimension in a KaTeX formula is a multiple of the root font size, so
 * the *shape* of the answer does not depend on this number — only its
 * precision does, and `getBoundingClientRect` returns fractional pixels but a
 * finite number of them. 200px keeps sub-glyph detail (a fraction bar is about
 * 0.04em, or 8px here) well clear of rounding.
 *
 * @category Measuring & outlines
 */
export const HOST_FONT_SIZE = 200;

/** Layout only; `visibility: hidden` still lays out, `display: none` does not. */
function createHost(): HTMLElement {
	const host = document.createElement("div");
	host.setAttribute("aria-hidden", "true");
	host.style.cssText = [
		"position:fixed",
		"left:0",
		"top:0",
		"visibility:hidden",
		"pointer-events:none",
		"white-space:nowrap",
		"line-height:normal",
		`font-size:${HOST_FONT_SIZE}px`,
		// A width the formula cannot reach, so nothing wraps or centres.
		"width:max-content",
		"z-index:-1",
	].join(";");
	return host;
}

/**
 * Intersection of two rects. Rects that miss yield a zero-size rect — not
 * `null`, which means "no clip" — so an empty intersection stays fully clipped.
 * @internal
 */
export function intersect(a: PixelRect, b: PixelRect): PixelRect {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const right = Math.min(a.x + a.width, b.x + b.width);
	const bottom = Math.min(a.y + a.height, b.y + b.height);
	if (right <= x || bottom <= y) return { x, y, width: 0, height: 0 };
	return { x, y, width: right - x, height: bottom - y };
}

/**
 * The clip an element inherits from its `overflow: hidden` ancestors.
 *
 * KaTeX builds a big brace out of one glyph shown three times through three
 * narrow windows, and a `\sqrt` out of an SVG deliberately wider than its box.
 * Ignoring the windows draws the whole glyph three times over. Clips accumulate
 * down the chain and are cached per element, since siblings share ancestors.
 */
function clipChain(
	element: Element,
	root: Element,
	origin: { x: number; y: number },
	cache: Map<Element, PixelRect | null>,
): PixelRect | null {
	if (element === root || !element.parentElement) return null;
	const cached = cache.get(element);
	if (cached !== undefined) return cached;

	const inherited = clipChain(element.parentElement, root, origin, cache);
	const style = getComputedStyle(element);
	let own: PixelRect | null = null;
	if (style.overflow !== "visible" && style.overflowX !== "visible") {
		const box = element.getBoundingClientRect();
		own = {
			x: box.left - origin.x,
			y: box.top - origin.y,
			width: box.width,
			height: box.height,
		};
	}

	const result = !own
		? inherited
		: !inherited
			? own
			: intersect(own, inherited);
	cache.set(element, result);
	return result;
}

/** Border edges as filled rects — a fraction bar is `border-bottom`. */
function ruleRects(
	element: Element,
	style: CSSStyleDeclaration,
	box: PixelRect,
): PixelRect[] {
	// `\rule` is a solid block whose size KaTeX expresses as borders on two
	// sides at once; taking the edges individually would draw an L.
	if (element.classList.contains("katex-rule")) {
		return box.width > 0 && box.height > 0 ? [box] : [];
	}

	const edges: PixelRect[] = [];
	const push = (rect: PixelRect) => {
		if (rect.width > 0 && rect.height > 0) edges.push(rect);
	};
	const width = (value: string, borderStyle: string) =>
		borderStyle === "none" || borderStyle === "hidden"
			? 0
			: Number.parseFloat(value) || 0;

	const top = width(style.borderTopWidth, style.borderTopStyle);
	const bottom = width(style.borderBottomWidth, style.borderBottomStyle);
	const left = width(style.borderLeftWidth, style.borderLeftStyle);
	const right = width(style.borderRightWidth, style.borderRightStyle);

	if (top) push({ x: box.x, y: box.y, width: box.width, height: top });
	if (bottom)
		push({
			x: box.x,
			y: box.y + box.height - bottom,
			width: box.width,
			height: bottom,
		});
	if (left) push({ x: box.x, y: box.y, width: left, height: box.height });
	if (right)
		push({
			x: box.x + box.width - right,
			y: box.y,
			width: right,
			height: box.height,
		});
	return edges;
}

/**
 * Zero-width format characters, which `trim()` keeps. KaTeX puts a zero-width
 * space in every `vlist-s` (a Safari layout fix), at the right edge of each
 * fraction and radical; outlined, it drew as a stray dot there.
 */
const ZERO_WIDTH = /[​-‍⁠﻿]/;

/**
 * Whether a character draws anything: not whitespace, not zero-width.
 * @internal
 */
export function isInk(char: string): boolean {
	return char.trim().length > 0 && !ZERO_WIDTH.test(char);
}

/** A text node and the marker standing in for its pen origin. */
interface TextRun {
	text: string;
	face: FaceName;
	fontSize: number;
	marker: HTMLSpanElement;
	clip: PixelRect | null;
}

let stylesheetChecked = false;

/**
 * KaTeX lays formulas out with its stylesheet, which the application imports
 * once (`import "katex/dist/katex.css"`). Without it every position read back
 * is wrong, so the first formula checks for it: the stylesheet sets `.katex`'s
 * font to KaTeX_Main.
 */
function checkStylesheet(host: HTMLElement): void {
	if (stylesheetChecked) return;
	stylesheetChecked = true;
	const typeset = host.querySelector(".katex");
	if (typeset && !getComputedStyle(typeset).fontFamily.includes("KaTeX_Main")) {
		console.warn(
			'@sophistry/text: KaTeX\'s stylesheet is not loaded, so formulas are laid out wrong. Import it once in your app: import "katex/dist/katex.css";',
		);
	}
}

/**
 * Typesets `tex` in a hidden DOM host and reads its layout back as pixels.
 *
 * Async because the answer is wrong until the KaTeX webfonts are in: a span
 * measured in a fallback face reports that face's advances, and every position
 * downstream of it inherits the error. Requires a browser DOM with KaTeX's
 * stylesheet loaded (`import "katex/dist/katex.css"`). This is the
 * low-level step under {@link outlineLatex}; most code wants `MathTex` or
 * `createLatex` instead. Parse errors do not throw (KaTeX renders the source in
 * its error colour).
 *
 * @param tex - TeX source.
 * @param options - Display mode and macros.
 * @returns Atoms and the overall box, in pixels at {@link HOST_FONT_SIZE}, y down.
 *
 * @category Measuring & outlines
 */
export async function measureLatex(
	tex: string,
	options: MeasureOptions = {},
): Promise<Measurement> {
	await ensureWebFonts();

	const host = createHost();
	document.body.appendChild(host);
	try {
		katex.render(tex, host, {
			displayMode: options.displayMode ?? true,
			macros: options.macros,
			output: "html",
			throwOnError: false,
		});
		checkStylesheet(host);

		const root = host.querySelector<HTMLElement>(".katex-html") ?? host;
		const rootBox = root.getBoundingClientRect();
		const origin = { x: rootBox.left, y: rootBox.top };
		const clips = new Map<Element, PixelRect | null>();
		const relative = (box: DOMRect): PixelRect => ({
			x: box.left - origin.x,
			y: box.top - origin.y,
			width: box.width,
			height: box.height,
		});

		const atoms: MeasuredAtom[] = [];
		const runs: TextRun[] = [];

		// Pass one: rules and SVG straight away, text runs deferred — inserting
		// the markers now would invalidate the rects still being read.
		const walker = document.createTreeWalker(
			root,
			NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
		);
		const pending: { node: Text; parent: HTMLElement }[] = [];
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node.nodeType === Node.TEXT_NODE) {
				const text = node as Text;
				const parent = text.parentElement;
				if (parent && text.data.length > 0)
					pending.push({ node: text, parent });
				continue;
			}

			const element = node as Element;
			if (element instanceof SVGPathElement) {
				const d = element.getAttribute("d");
				const ctm = element.getScreenCTM();
				if (d && ctm) {
					atoms.push({
						kind: "svg",
						d,
						// `e`/`f` are the translation, so shifting to the formula's
						// own origin is a subtraction rather than a matrix multiply.
						matrix: [
							ctm.a,
							ctm.b,
							ctm.c,
							ctm.d,
							ctm.e - origin.x,
							ctm.f - origin.y,
						],
						clip: clipChain(element, root, origin, clips),
					});
				}
				continue;
			}
			if (element instanceof SVGElement) continue;

			const style = getComputedStyle(element);
			const box = relative(element.getBoundingClientRect());
			for (const rect of ruleRects(element, style, box)) {
				atoms.push({
					kind: "rule",
					rect,
					clip: clipChain(element, root, origin, clips),
				});
			}
		}

		// Pass two: one marker per run, all inserted before anything is measured,
		// so a single layout serves the lot.
		for (const { node, parent } of pending) {
			const style = getComputedStyle(parent);
			const marker = document.createElement("span");
			marker.style.cssText = "display:inline-block;width:0;height:0";
			node.before(marker);
			runs.push({
				text: node.data,
				face: resolveFace(style.fontFamily, style.fontWeight, style.fontStyle),
				fontSize: Number.parseFloat(style.fontSize) || HOST_FONT_SIZE,
				marker,
				clip: clipChain(parent, root, origin, clips),
			});
		}

		// The faces are needed for advance widths, so the runs cannot be expanded
		// into glyphs until they are in. Loading them here rather than in
		// `outline.ts` keeps the host alive across the await, which is what lets
		// a face that arrives late still be measured against real positions.
		const faces = new Map<FaceName, Awaited<ReturnType<typeof loadFace>>>();
		await Promise.all(
			[...new Set(runs.map((run) => run.face))].map(async (name) => {
				faces.set(name, await loadFace(name));
			}),
		);

		for (const run of runs) {
			const markerBox = run.marker.getBoundingClientRect();
			// An empty inline-block's baseline is its bottom margin edge, so this
			// is the run's baseline exactly — not an estimate from font metrics,
			// which vary between browsers in which ascent they report.
			const baseline = markerBox.bottom - origin.y;
			const font = faces.get(run.face);
			if (!font) continue;

			let pen = markerBox.left - origin.x;
			const scale = run.fontSize / font.unitsPerEm;
			for (const char of run.text) {
				const glyph = font.charToGlyph(char);
				if (isInk(char)) {
					atoms.push({
						kind: "glyph",
						char,
						face: run.face,
						fontSize: run.fontSize,
						x: pen,
						baseline,
						clip: run.clip,
					});
				}
				pen += (glyph.advanceWidth ?? 0) * scale;
			}
		}

		// The first line's baseline: an empty inline-block's bottom edge, as
		// for the runs, read last so it moves nothing that was measured.
		const line = root.querySelector<HTMLElement>(".base") ?? root;
		const marker = document.createElement("span");
		marker.style.cssText = "display:inline-block;width:0;height:0";
		line.prepend(marker);
		const baseline = marker.getBoundingClientRect().bottom - origin.y;

		return { atoms, box: relative(rootBox), baseline };
	} finally {
		host.remove();
	}
}
