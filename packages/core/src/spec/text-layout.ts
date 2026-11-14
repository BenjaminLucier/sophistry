/**
 * Laying out rich text: runs of differently styled text, wrapped into lines
 * at a width, aligned, with line heights from the largest font on each line.
 *
 * Line breaking uses Pretext's rich-inline layout where a 2D canvas can
 * measure (browsers and workers): Unicode word segmentation, breaks across
 * run boundaries, one measurement cache shared with every other caller.
 * Without a canvas (server rendering, tests under a DOM shim) a simple
 * greedy wrapper takes over: it breaks at spaces only, measuring with the
 * metrics oracle's estimate, so layout still works and stays deterministic.
 *
 * Measurements are taken at a reference size and scaled, as the metrics
 * oracle does: specs carry font sizes in scene units (0.4 is ordinary), and
 * a canvas asked to measure a 0.4px font answers with clamps and noise.
 */

import { clearCache as clearPretextCache } from "@chenglou/pretext";
import type {
	PreparedRichInline,
	RichInlineCursor,
	RichInlineItem,
} from "@chenglou/pretext/rich-inline";
import {
	layoutNextRichInlineLineRange,
	materializeRichInlineLineRange,
	prepareRichInline,
} from "@chenglou/pretext/rich-inline";
import type { MetricsStyle } from "./metrics.js";
import { fontLoads, fontString, measureLabel } from "./metrics.js";

/**
 * One run of text in one font. Sizes are in whatever length unit the caller
 * works in (scene units for specs), and the layout comes back in that unit.
 *
 * @category Text & numbers
 */
export interface LayoutRun {
	text: string;
	font: MetricsStyle;
}

/**
 * Options for {@link layoutText}.
 *
 * @category Text & numbers
 */
export interface TextLayoutOptions {
	/** Wrap at this width. Omitted, only newlines break. */
	width?: number;
	/**
	 * Line height as a multiple of the largest font size on each line.
	 * @default 1.3
	 */
	lineHeight?: number;
	/**
	 * Where each line sits across the block.
	 * @default "left"
	 */
	align?: CanvasTextAlign;
}

/**
 * A piece of one run on one line.
 *
 * @category Text & numbers
 */
export interface LaidOutFragment {
	/** Index of the run it came from. */
	run: number;
	text: string;
	/** Left end, from the block's left edge. */
	x: number;
	/** Baseline, down from the block's top edge. */
	baseline: number;
	/** Advance width. */
	width: number;
}

/**
 * The result of {@link layoutText}.
 *
 * @category Text & numbers
 */
export interface TextLayout {
	fragments: LaidOutFragment[];
	/** The block's width: the wrap width when given, else the longest line. */
	width: number;
	/** The longest line's width. */
	contentWidth: number;
	/** The block's height: every line's height together. */
	height: number;
	/** The first line's baseline, down from the top. */
	firstBaseline: number;
	lineCount: number;
}

/** Where the baseline sits in a line box, as fractions of the font size. */
const ASCENT = 0.8;
const DESCENT = 0.2;
/** The size runs are measured at; see the header. */
const REFERENCE_SIZE = 64;
const EPSILON = 1e-9;

interface Piece {
	run: number;
	text: string;
}

interface Line {
	fragments: { run: number; text: string; x: number; width: number }[];
	width: number;
	/** The run whose size an empty line takes. */
	emptyRun: number;
}

/* ---------------------------------------------------------- measuring */

let canvasAvailable: boolean | undefined;

/** Whether a 2D canvas can measure here, so Pretext can run. */
function canMeasure(): boolean {
	if (canvasAvailable !== undefined) return canvasAvailable;
	if (typeof OffscreenCanvas === "function") {
		canvasAvailable = true;
	} else if (typeof document !== "undefined") {
		try {
			canvasAvailable =
				document.createElement("canvas").getContext("2d") !== null;
		} catch {
			canvasAvailable = false;
		}
	} else {
		canvasAvailable = false;
	}
	return canvasAvailable;
}

const PREPARED_LIMIT = 256;
const prepared = new Map<string, PreparedRichInline>();
let listening = false;

/** Prepared runs, cached by their text and fonts; dropped when a web font loads. */
function prepare(items: RichInlineItem[]): PreparedRichInline {
	if (!listening) {
		listening = true;
		fontLoads.subscribe(() => {
			prepared.clear();
			clearPretextCache();
		});
	}
	const key = JSON.stringify(items);
	const hit = prepared.get(key);
	if (hit) {
		prepared.delete(key);
		prepared.set(key, hit);
		return hit;
	}
	const result = prepareRichInline(items);
	if (prepared.size >= PREPARED_LIMIT) {
		const oldest = prepared.keys().next();
		if (!oldest.done) prepared.delete(oldest.value);
	}
	prepared.set(key, result);
	return result;
}

/* ------------------------------------------------------- line breaking */

/** Lines of one paragraph through Pretext. */
function breakWithPretext(
	runs: readonly LayoutRun[],
	pieces: Piece[],
	width: number | undefined,
): Line[] {
	const largest = Math.max(
		...pieces.map((piece) => runs[piece.run]?.font.fontSize ?? 0),
	);
	if (!(largest > 0)) return [];
	const k = REFERENCE_SIZE / largest;
	const items: RichInlineItem[] = pieces.map((piece) => {
		const font = (runs[piece.run] as LayoutRun).font;
		const item: RichInlineItem = {
			text: piece.text,
			font: fontString({ ...font, fontSize: font.fontSize * k }),
		};
		if (font.letterSpacing) item.letterSpacing = font.letterSpacing * k;
		return item;
	});
	const source = prepare(items);
	const limit = width === undefined ? Number.MAX_SAFE_INTEGER : width * k;
	const lines: Line[] = [];
	let cursor: RichInlineCursor | undefined;
	for (;;) {
		const range = layoutNextRichInlineLineRange(source, limit, cursor);
		if (!range) break;
		const line = materializeRichInlineLineRange(source, range);
		let x = 0;
		const fragments: Line["fragments"] = [];
		for (const fragment of line.fragments) {
			x += fragment.gapBefore;
			fragments.push({
				run: (pieces[fragment.itemIndex] as Piece).run,
				text: fragment.text,
				x: x / k,
				width: fragment.occupiedWidth / k,
			});
			x += fragment.occupiedWidth;
		}
		lines.push({
			fragments,
			width: line.width / k,
			emptyRun: pieces[0]?.run ?? 0,
		});
		cursor = range.end;
	}
	return lines;
}

interface Atom {
	run: number;
	text: string;
	width: number;
	space: boolean;
}

/** Lines of one paragraph without a canvas: greedy, breaking at spaces only. */
function breakGreedily(
	runs: readonly LayoutRun[],
	pieces: Piece[],
	width: number | undefined,
): Line[] {
	const atoms: Atom[] = [];
	for (const piece of pieces) {
		const font = (runs[piece.run] as LayoutRun).font;
		for (const part of piece.text.split(/(\s+)/)) {
			if (!part) continue;
			const space = /^\s+$/.test(part);
			// Runs of spaces collapse to one, even across runs.
			if (space && (atoms.length === 0 || atoms.at(-1)?.space)) continue;
			const text = space ? " " : part;
			atoms.push({
				run: piece.run,
				text,
				width: measureLabel(text, font).width,
				space,
			});
		}
	}
	while (atoms.at(-1)?.space) atoms.pop();

	// Words are the runs of non-space atoms, which may cross run boundaries.
	const lines: Atom[][] = [[]];
	let lineWidth = 0;
	let index = 0;
	while (index < atoms.length) {
		const space = (atoms[index] as Atom).space ? (atoms[index] as Atom) : null;
		const start = space ? index + 1 : index;
		let end = start;
		let wordWidth = 0;
		while (end < atoms.length && !(atoms[end] as Atom).space) {
			wordWidth += (atoms[end] as Atom).width;
			end++;
		}
		const line = lines.at(-1) as Atom[];
		const spaceWidth = line.length > 0 && space ? space.width : 0;
		if (
			width !== undefined &&
			line.length > 0 &&
			lineWidth + spaceWidth + wordWidth > width + EPSILON
		) {
			lines.push(atoms.slice(start, end));
			lineWidth = wordWidth;
		} else {
			if (spaceWidth > 0 && space) line.push(space);
			line.push(...atoms.slice(start, end));
			lineWidth += spaceWidth + wordWidth;
		}
		index = end;
	}

	return lines.map((line) => {
		const fragments: Line["fragments"] = [];
		let x = 0;
		for (const atom of line) {
			const last = fragments.at(-1);
			if (last && last.run === atom.run) {
				last.text += atom.text;
				last.width += atom.width;
			} else {
				fragments.push({
					run: atom.run,
					text: atom.text,
					x,
					width: atom.width,
				});
			}
			x += atom.width;
		}
		return { fragments, width: x, emptyRun: pieces[0]?.run ?? 0 };
	});
}

/** The runs split at newlines: one list of pieces per paragraph. */
function paragraphs(
	runs: readonly LayoutRun[],
): { pieces: Piece[]; run: number }[] {
	const result: { pieces: Piece[]; run: number }[] = [{ pieces: [], run: 0 }];
	runs.forEach((run, index) => {
		const parts = run.text.split("\n");
		parts.forEach((part, partIndex) => {
			if (partIndex > 0) result.push({ pieces: [], run: index });
			const current = result.at(-1) as { pieces: Piece[]; run: number };
			if (current.pieces.length === 0) current.run = index;
			if (part) current.pieces.push({ run: index, text: part });
		});
	});
	return result;
}

/* -------------------------------------------------------------- layout */

/**
 * Lays out runs of text: breaks them into lines (at newlines always, and at
 * `width` when given), aligns each line, and gives every fragment its
 * position. Each line is as tall as its largest font times `lineHeight`.
 *
 * @example
 * ```ts
 * import { layoutText } from "@sophistry/core";
 *
 * const font = { fontSize: 16, fontFamily: "sans-serif", fontWeight: 400, italic: false, letterSpacing: 0 };
 * const layout = layoutText(
 * 	[{ text: "The ", font }, { text: "derivative", font: { ...font, fontWeight: 700 } }, { text: " measures change.", font }],
 * 	{ width: 120, align: "center" },
 * );
 * ```
 *
 * @param runs - The text, one run per style.
 * @param options - Width, line height and alignment.
 * @returns The fragments and the block's size, in the runs' unit.
 *
 * @category Text & numbers
 */
export function layoutText(
	runs: readonly LayoutRun[],
	options: TextLayoutOptions = {},
): TextLayout {
	const lineHeight = options.lineHeight ?? 1.3;
	const width =
		options.width !== undefined && options.width > 0
			? options.width
			: undefined;
	const breakLines = canMeasure() ? breakWithPretext : breakGreedily;

	const lines: Line[] = [];
	for (const paragraph of paragraphs(runs)) {
		const broken =
			paragraph.pieces.length > 0
				? breakLines(runs, paragraph.pieces, width)
				: [];
		if (broken.length === 0) {
			lines.push({ fragments: [], width: 0, emptyRun: paragraph.run });
		} else {
			lines.push(...broken);
		}
	}

	const contentWidth = Math.max(0, ...lines.map((line) => line.width));
	const blockWidth = width ?? contentWidth;
	const align = options.align ?? "left";
	const fragments: LaidOutFragment[] = [];
	let top = 0;
	let firstBaseline = 0;
	lines.forEach((line, index) => {
		const sizes =
			line.fragments.length > 0
				? line.fragments.map((f) => runs[f.run]?.font.fontSize ?? 0)
				: [runs[line.emptyRun]?.font.fontSize ?? 0];
		const largest = Math.max(0, ...sizes);
		const glyphs = largest * (ASCENT + DESCENT);
		const height = Math.max(largest * lineHeight, glyphs);
		const baseline = top + (height - glyphs) / 2 + largest * ASCENT;
		if (index === 0) firstBaseline = baseline;
		const free = blockWidth - line.width;
		const shift =
			align === "center"
				? free / 2
				: align === "right" || align === "end"
					? free
					: 0;
		for (const fragment of line.fragments) {
			fragments.push({
				run: fragment.run,
				text: fragment.text,
				x: shift + fragment.x,
				baseline,
				width: fragment.width,
			});
		}
		top += height;
	});

	return {
		fragments,
		width: blockWidth,
		contentWidth,
		height: top,
		firstBaseline,
		lineCount: lines.length,
	};
}

/**
 * Forgets whether a canvas can measure, so the next layout checks again. For
 * tests that install or remove a canvas.
 *
 * @internal
 */
export function resetTextMeasuring(): void {
	canvasAvailable = undefined;
	prepared.clear();
	clearPretextCache();
}
