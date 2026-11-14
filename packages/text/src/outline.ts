/**
 * Measured atoms to closed contours: `measure.ts` says where each glyph sits,
 * opentype.js supplies its shape, and the result is ordinary polylines. Output is
 * in em units, y down, origin at the formula's top-left; `MathTex.tsx` flips to
 * scene units.
 */

import type { Bounds, Point, Polyline } from "@sophistry/core/geometry";
import { boundsOf, flattenPath, lerpPoint } from "@sophistry/core/geometry";
import { loadFace } from "./fonts.js";
import type { MeasuredAtom, MeasureOptions, PixelRect } from "./measure.js";
import { HOST_FONT_SIZE, measureLatex } from "./measure.js";

/**
 * One drawable piece of a formula, in the order it should be written.
 *
 * A part is the unit of everything downstream: the reveal spends its budget
 * part by part, `write` staggers over parts, and a transform between two
 * formulas matches parts up. Keeping `char` on it is what lets a scene address
 * "the `x` in the numerator" the way `DecimalNumber` addresses a digit.
 *
 * @category Measuring & outlines
 */
export interface LatexPart {
	/** A font glyph, a CSS rule (fraction bar, `\\overline`), or a stretchy SVG piece (`\\sqrt` tail, big delimiter). */
	kind: "glyph" | "rule" | "svg";
	/** Present on glyphs; the source character, not a glyph id. */
	char?: string;
	/** Closed contours in em, y-down. A glyph with a counter has two. */
	polylines: Polyline[];
	/** Bounding box of `polylines`, in em, y-down. */
	box: Bounds;
}

/**
 * A typeset formula as outlines, in em with y down (see {@link outlineLatex}).
 *
 * @category Measuring & outlines
 */
export interface LatexOutline {
	/** Drawable pieces in reading order. */
	parts: LatexPart[];
	/** The formula's own box in em, y-down, starting at the origin. */
	width: number;
	/** Height of the formula's box, in em. */
	height: number;
	/** The first line's baseline, in em down from the box's top. */
	baseline?: number;
}

/** Sutherland–Hodgman against one edge of the clip box. */
function clipEdge(
	points: Polyline,
	inside: (p: Point) => boolean,
	cross: (a: Point, b: Point) => Point,
): Polyline {
	const out: Polyline = [];
	for (let i = 0; i < points.length; i++) {
		const current = points[i];
		const previous = points[(i + points.length - 1) % points.length];
		const currentIn = inside(current);
		if (currentIn !== inside(previous)) out.push(cross(previous, current));
		if (currentIn) out.push(current);
	}
	return out;
}

/**
 * Clips a closed contour to a rect.
 *
 * Sutherland–Hodgman, which is the right algorithm here precisely because it
 * closes the contour along the clip edge rather than leaving it open: a big
 * brace is one glyph seen through three narrow windows, and each window has to
 * come back as something fillable. It degenerates on concave shapes into
 * zero-width bridges along the boundary, which fill correctly and are invisible.
 */
function clipToRect(points: Polyline, rect: PixelRect): Polyline {
	const { x, y, width, height } = rect;
	const right = x + width;
	const bottom = y + height;

	let result = points;
	result = clipEdge(
		result,
		(p) => p.x >= x,
		(a, b) => lerpPoint(a, b, (x - a.x) / (b.x - a.x)),
	);
	result = clipEdge(
		result,
		(p) => p.x <= right,
		(a, b) => lerpPoint(a, b, (right - a.x) / (b.x - a.x)),
	);
	result = clipEdge(
		result,
		(p) => p.y >= y,
		(a, b) => lerpPoint(a, b, (y - a.y) / (b.y - a.y)),
	);
	result = clipEdge(
		result,
		(p) => p.y <= bottom,
		(a, b) => lerpPoint(a, b, (bottom - a.y) / (b.y - a.y)),
	);
	return result;
}

/** A rule is a rect; giving it a `d` keeps one code path for every atom. */
function ruleData(rect: PixelRect): string {
	const { x, y, width, height } = rect;
	return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
}

function transformed(
	points: Polyline,
	matrix: [number, number, number, number, number, number],
): Polyline {
	const [a, b, c, d, e, f] = matrix;
	return points.map((p) => ({
		x: a * p.x + c * p.y + e,
		y: b * p.x + d * p.y + f,
	}));
}

/**
 * Largest flattening error, as a fraction of the em: invisible at any size a
 * formula is shown at, and far fewer points than a fixed pixel tolerance at
 * the measuring size.
 */
const FLATNESS_PER_EM = 1 / 1500;

/**
 * `flattenPath`'s tolerance for type `em` units across. The flatness test
 * squares a length, so this scales with the square of the size, which makes
 * the subdivision scale-free: one glyph at two sizes flattens to the same
 * vertices, and a superscript `2` morphs onto a full-size `2` vertex for
 * vertex.
 */
function flatness(em: number): number {
	return (em * FLATNESS_PER_EM) ** 2;
}

/**
 * Turns one atom into contours in pixel space.
 *
 * Async only for glyphs, and only for the first glyph of a face — `loadFace`
 * hands back a settled promise afterwards.
 */
async function contoursOf(atom: MeasuredAtom): Promise<Polyline[]> {
	if (atom.kind === "rule") {
		return flattenPath(ruleData(atom.rect)).map((sub) => sub.points);
	}

	if (atom.kind === "svg") {
		// The path is in its own units; the matrix says how many pixels one is.
		const [a, b, c, d] = atom.matrix;
		const pixelsPerUnit = Math.sqrt(Math.abs(a * d - b * c)) || 1;
		return flattenPath(atom.d, flatness(HOST_FONT_SIZE / pixelsPerUnit)).map(
			(sub) => transformed(sub.points, atom.matrix),
		);
	}

	const font = await loadFace(atom.face);
	// opentype puts the baseline at `y` and grows downward, which is the
	// convention this module already works in — no flip needed.
	const data = font
		.charToGlyph(atom.char)
		.getPath(atom.x, atom.baseline, atom.fontSize)
		.toPathData(3);
	return flattenPath(data, flatness(atom.fontSize)).map((sub) => sub.points);
}

/**
 * Typesets `tex` and returns its outlines, ready to draw or animate.
 *
 * Parts come back in writing order — left to right, then top to bottom — rather
 * than in DOM order, because DOM order puts a fraction's denominator before its
 * bar. Reading order is what a reveal should follow.
 *
 * Uncached and browser-only; prefer {@link latexOutline}, which memoises.
 *
 * @param tex - TeX source.
 * @param options - Display mode and macros.
 * @returns Parts and box size in em, y down, origin at the formula's top-left.
 *
 * @category Measuring & outlines
 */
export async function outlineLatex(
	tex: string,
	options: MeasureOptions = {},
): Promise<LatexOutline> {
	const measurement = await measureLatex(tex, options);
	const scale = 1 / HOST_FONT_SIZE;

	const parts: LatexPart[] = [];
	for (const atom of measurement.atoms) {
		const contours = await contoursOf(atom);
		const kept: Polyline[] = [];
		// A zero-size clip (empty intersection of ancestor windows) shows nothing.
		const fullyClipped =
			atom.clip !== null && (atom.clip.width <= 0 || atom.clip.height <= 0);
		for (const contour of fullyClipped ? [] : contours) {
			const clipped = atom.clip ? clipToRect(contour, atom.clip) : contour;
			// Two points cannot enclose anything; a clip that grazed a corner
			// leaves exactly that, and it would show up as a stray reveal step.
			if (clipped.length < 3) continue;
			kept.push(clipped.map((p) => ({ x: p.x * scale, y: p.y * scale })));
		}
		if (kept.length === 0) continue;

		parts.push({
			kind: atom.kind,
			char: atom.kind === "glyph" ? atom.char : undefined,
			polylines: kept,
			box: boundsOf(kept),
		});
	}

	parts.sort((a, b) => a.box.minX - b.box.minX || a.box.minY - b.box.minY);

	return {
		parts,
		width: measurement.box.width * scale,
		height: measurement.box.height * scale,
		baseline:
			measurement.baseline === undefined
				? undefined
				: measurement.baseline * scale,
	};
}

/**
 * Outlines kept before the least recently used one is evicted.
 *
 * A `<MathTex>` tracking a live value typesets a new formula per value, so an
 * unbounded map grows for as long as the scene runs. An LRU, as for label
 * metrics (`scene/labels/metrics.ts`), keeps the scene's stable formulas resident
 * under any amount of churn.
 *
 * @internal
 */
export const OUTLINE_CACHE_LIMIT = 256;

/** One in-flight or settled outline per formula, least recently used first. */
const cache = new Map<string, Promise<LatexOutline>>();

/**
 * {@link outlineLatex}, memoised on the formula and its options.
 *
 * Repeat calls share one promise; a failed typeset is evicted so a retry
 * starts fresh. At most {@link OUTLINE_CACHE_LIMIT} outlines are kept (LRU).
 *
 * @param tex - TeX source.
 * @param options - Display mode and macros (`displayMode` defaults to true).
 * @returns The outline in em, y down.
 *
 * @category Measuring & outlines
 */
export function latexOutline(
	tex: string,
	options: MeasureOptions = {},
): Promise<LatexOutline> {
	const key = JSON.stringify([
		tex,
		options.displayMode ?? true,
		options.macros,
	]);
	const existing = cache.get(key);
	if (existing) {
		// Re-insert to mark as most recently used.
		cache.delete(key);
		cache.set(key, existing);
		return existing;
	}

	const pending = outlineLatex(tex, options).catch((error: unknown) => {
		// Only evict our own entry: it may have been evicted and replaced.
		if (cache.get(key) === pending) cache.delete(key);
		throw error;
	});
	if (cache.size >= OUTLINE_CACHE_LIMIT) {
		const oldest = cache.keys().next();
		if (!oldest.done) cache.delete(oldest.value);
	}
	cache.set(key, pending);
	return pending;
}

/** @internal Entries currently cached, for tests. */
export function outlineCacheSize(): number {
	return cache.size;
}

/**
 * A part as SVG path data (`M`/`L`/`Z` per contour), in the part's own units.
 * Useful for `new Path2D(...)` or an `<svg>` export.
 *
 * @param part - The part to serialise.
 * @param decimals - Digits after the decimal point. Defaults to 3.
 * @returns Path data string.
 *
 * @category Measuring & outlines
 */
export function partPathData(part: LatexPart, decimals = 3): string {
	const round = (value: number) => value.toFixed(decimals);
	return part.polylines
		.map(
			(line) =>
				`M${round(line[0].x)} ${round(line[0].y)}` +
				line
					.slice(1)
					.map((p) => `L${round(p.x)} ${round(p.y)}`)
					.join("") +
				"Z",
		)
		.join("");
}
