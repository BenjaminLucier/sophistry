/**
 * Picking inside a batched node: which item of a {@link MarksSpec}, or which
 * pixel of an {@link ImageSpec}, is under a point.
 *
 * A marks layer can hold 100k items, so a hover cannot afford to test them in
 * turn. The first pick against a `centers` array buckets its items into a
 * uniform grid (one pass), and every later pick against the same array reads
 * the few cells around the point. The grid is keyed on the array's identity in
 * a `WeakMap`, the same contract as the renderer's `Path2D` cache: a spec that
 * hands over the same arrays keeps its grid, a changed layer builds a new one
 * on the next pick, and a layer that is never hovered never builds one.
 */

import type { Point } from "../geometry";
import { distanceToSegment } from "../geometry/path/cubic";
import { revealedOutline } from "../geometry/path/outline-reveal";
import type { ImageSpec, MarkOutline, MarksSpec } from "../spec/types";
import { windingNumber } from "./hit";

/** Items bucketed by cell: `start[c]..start[c + 1]` indexes `items` for cell `c`. */
interface Grid {
	minX: number;
	minY: number;
	cell: number;
	cols: number;
	rows: number;
	start: Uint32Array;
	items: Uint32Array;
	/** The largest item reach (radius, or half-diagonal for a rect). */
	reach: number;
}

const grids = new WeakMap<Float64Array, Grid>();

/** An item's reach from its centre: its radius, or a rect's half-diagonal. */
function reachOf(spec: MarksSpec, i: number): number {
	if (spec.shape.kind === "rect") {
		return Math.hypot(spec.extents[2 * i], spec.extents[2 * i + 1]);
	}
	return spec.extents[i];
}

function buildGrid(spec: MarksSpec): Grid | null {
	const { centers, count } = spec;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let reach = 0;
	let live = 0;
	for (let i = 0; i < count; i++) {
		const x = centers[2 * i];
		const y = centers[2 * i + 1];
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		live++;
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
		const r = reachOf(spec, i);
		if (r > reach) reach = r;
	}
	if (live === 0) return null;
	// About one item per cell on average, but never cells smaller than an item:
	// a query then reads a 3x3 block (plus the reach ring) whatever the density.
	const width = Math.max(maxX - minX, 1e-9);
	const height = Math.max(maxY - minY, 1e-9);
	const side = Math.sqrt((width * height) / live);
	// At most 4096 cells a side, however sparse the outliers make the box.
	const actual = Math.max(side, reach * 2, width / 4095, height / 4095, 1e-9);
	const cols = Math.floor(width / actual) + 1;
	const rows = Math.floor(height / actual) + 1;

	const cellOf = (i: number): number => {
		const cx = Math.min(cols - 1, Math.floor((centers[2 * i] - minX) / actual));
		const cy = Math.min(
			rows - 1,
			Math.floor((centers[2 * i + 1] - minY) / actual),
		);
		return cy * cols + cx;
	};
	// Counting sort into cells: two passes, no per-cell arrays.
	const start = new Uint32Array(cols * rows + 1);
	for (let i = 0; i < count; i++) {
		if (
			!Number.isFinite(centers[2 * i]) ||
			!Number.isFinite(centers[2 * i + 1])
		)
			continue;
		start[cellOf(i) + 1]++;
	}
	for (let c = 0; c < cols * rows; c++) start[c + 1] += start[c];
	const fill = start.slice(0, cols * rows);
	const items = new Uint32Array(live);
	for (let i = 0; i < count; i++) {
		if (
			!Number.isFinite(centers[2 * i]) ||
			!Number.isFinite(centers[2 * i + 1])
		)
			continue;
		items[fill[cellOf(i)]++] = i;
	}
	return { minX, minY, cell: actual, cols, rows, start, items, reach };
}

function gridFor(spec: MarksSpec): Grid | null {
	const cached = grids.get(spec.centers);
	if (cached) return cached;
	const grid = buildGrid(spec);
	if (grid) grids.set(spec.centers, grid);
	return grid;
}

/**
 * Whether `at` is on an `outline`/`paths` item, exactly: inside a closed,
 * filled outline (by non-zero winding, tested in the item's own units
 * through the inverse of its linear part), or within half its stroke width
 * plus `slop` of the outline (measured in scene units).
 *
 * A partly revealed item (`progresses[i]` between 0 and 1) is picked as
 * `hitSpec` picks a shape at that progress: its stroke only where it has
 * been drawn (the same arc-length budget the renderer traces, from the
 * same cached tables), and with no stroke only its fill.
 */
function onOutlineItem(
	spec: MarksSpec,
	outline: MarkOutline,
	i: number,
	at: Point,
	slop: number,
): boolean {
	const x = spec.centers[2 * i];
	const y = spec.centers[2 * i + 1];
	const dx = at.x - x;
	const dy = at.y - y;
	const stroke = spec.strokes ? spec.strokes[i] : spec.style.stroke;
	const width = spec.strokeWidths
		? spec.strokeWidths[i]
		: spec.style.strokeWidth;
	const strokes = !!stroke && stroke !== "none" && width > 0;
	const reach = spec.extents[i] + slop + (strokes ? width / 2 : 0);
	if (dx * dx + dy * dy > reach * reach) return false;
	const t = spec.transforms;
	const a = t ? t[4 * i] : 1;
	const b = t ? t[4 * i + 1] : 0;
	const c = t ? t[4 * i + 2] : 0;
	const d = t ? t[4 * i + 3] : 1;
	const fill = typeof spec.fills === "string" ? spec.fills : spec.fills[i];
	const filled =
		outline.closed && !!fill && fill !== "none" && spec.style.fillOpacity > 0;
	if (filled) {
		const det = a * d - b * c;
		if (det !== 0) {
			const local = { x: (d * dx - c * dy) / det, y: (a * dy - b * dx) / det };
			let winding = 0;
			for (const line of outline.polylines)
				winding += windingNumber(line, local);
			if (winding !== 0) return true;
		}
	}
	if (!strokes && !filled) return false;
	const reveal =
		spec.progresses && spec.progresses[i] < 1 ? spec.progresses[i] : 1;
	// A shape with no stroke has no edge to catch the pointer, and one part
	// drawn has only its drawn part to catch it: the slop-wide ring around a
	// filled outline is for whole items.
	if (reveal < 1 && !strokes) return false;
	// Only the drawn part of the outline, as open pieces (a spent closed
	// polyline already ends on its first point); the whole outline otherwise.
	const lines =
		reveal < 1 ? revealedOutline(outline.polylines, reveal) : outline.polylines;
	const open = reveal < 1;
	// Near the outline, in scene units (a skew would distort local distances).
	const limit = slop + (strokes ? width / 2 : 0);
	const from = { x: 0, y: 0 };
	const to = { x: 0, y: 0 };
	for (const line of lines) {
		const n = line.length;
		if (n === 0) continue;
		const segments = !open && outline.closed && n > 2 ? n : n - 1;
		if (n === 1) {
			const px = x + a * line[0].x + c * line[0].y;
			const py = y + b * line[0].x + d * line[0].y;
			if (Math.hypot(at.x - px, at.y - py) <= limit) return true;
			continue;
		}
		for (let k = 0; k < segments; k++) {
			const p = line[k];
			const q = line[(k + 1) % n];
			from.x = x + a * p.x + c * p.y;
			from.y = y + b * p.x + d * p.y;
			to.x = x + a * q.x + c * q.y;
			to.y = y + b * q.x + d * q.y;
			if (distanceToSegment(at, from, to) <= limit) return true;
		}
	}
	return false;
}

/** Whether `at` is on item `i`, `slop` included. */
function onItem(spec: MarksSpec, i: number, at: Point, slop: number): boolean {
	const shape = spec.shape;
	if (shape.kind === "outline" || shape.kind === "paths") {
		const outline = shape.kind === "paths" ? shape.outlines[i] : shape;
		// `slop` arrives padded by the shared half-width: take that back off,
		// the item's own width is added per item.
		const own = slop - Math.max(0, spec.style.strokeWidth) / 2;
		return !!outline && onOutlineItem(spec, outline, i, at, Math.max(0, own));
	}
	const dx = at.x - spec.centers[2 * i];
	const dy = at.y - spec.centers[2 * i + 1];
	if (spec.shape.kind === "rect") {
		return (
			Math.abs(dx) <= spec.extents[2 * i] + slop &&
			Math.abs(dy) <= spec.extents[2 * i + 1] + slop
		);
	}
	// A symbol is picked as the disc it is inscribed in: symbols are small and a
	// generous target is the point.
	const reach = spec.extents[i] + slop;
	return dx * dx + dy * dy <= reach * reach;
}

/** The largest per-item stroke width, cached on the array (0 for none). */
const widest = new WeakMap<Float32Array, number>();

function widestOf(widths: Float32Array | null | undefined): number {
	if (!widths) return 0;
	let max = widest.get(widths);
	if (max === undefined) {
		max = 0;
		for (let i = 0; i < widths.length; i++)
			if (widths[i] > max) max = widths[i];
		widest.set(widths, max);
	}
	return max;
}

/**
 * An item's fill or stroke is visible at all: not transparent, and (for the
 * outline kinds) not unrevealed. How much of a partly revealed item is
 * pickable is `onOutlineItem`'s question.
 */
function itemShown(spec: MarksSpec, i: number): boolean {
	if (spec.alphas !== null && !(spec.alphas[i] > 0)) return false;
	const { progresses, shape } = spec;
	return (
		!progresses ||
		(shape.kind !== "outline" && shape.kind !== "paths") ||
		progresses[i] > 0
	);
}

/**
 * The topmost item of a marks node under `at` (the highest index, since items
 * paint in index order), or null.
 *
 * @param spec - The marks node's spec.
 * @param at - The point, in scene units.
 * @param slop - Extra reach in scene units (the stroke's half-width is added).
 * @returns The item's index, or null.
 *
 * @category Interaction plumbing
 */
export function pickMark(spec: MarksSpec, at: Point, slop = 0): number | null {
	if (spec.count === 0) return null;
	const grid = gridFor(spec);
	if (!grid) return null;
	const pad = slop + Math.max(0, spec.style.strokeWidth) / 2;
	// Per-item widths may reach past the shared one.
	const span =
		grid.reach + Math.max(pad, slop + widestOf(spec.strokeWidths) / 2);
	const x0 = Math.max(0, Math.floor((at.x - span - grid.minX) / grid.cell));
	const x1 = Math.min(
		grid.cols - 1,
		Math.floor((at.x + span - grid.minX) / grid.cell),
	);
	const y0 = Math.max(0, Math.floor((at.y - span - grid.minY) / grid.cell));
	const y1 = Math.min(
		grid.rows - 1,
		Math.floor((at.y + span - grid.minY) / grid.cell),
	);
	let best = -1;
	for (let cy = y0; cy <= y1; cy++) {
		for (let cx = x0; cx <= x1; cx++) {
			const c = cy * grid.cols + cx;
			for (let k = grid.start[c]; k < grid.start[c + 1]; k++) {
				const i = grid.items[k];
				if (i <= best || i >= spec.count) continue;
				if (itemShown(spec, i) && onItem(spec, i, at, pad)) best = i;
			}
		}
	}
	return best < 0 ? null : best;
}

/**
 * The pixel of an image node under `at`, as `row * width + column`, or null
 * when `at` is outside the image.
 *
 * @category Interaction plumbing
 */
export function pickPixel(spec: ImageSpec, at: Point): number | null {
	const { width, height } = spec.pixels;
	// Solve at = origin + u * xAxis + v * yAxis for (u, v) in 0..1.
	const { xAxis: a, yAxis: b } = spec;
	const det = a.x * b.y - a.y * b.x;
	if (det === 0 || width === 0 || height === 0) return null;
	const dx = at.x - spec.origin.x;
	const dy = at.y - spec.origin.y;
	const u = (dx * b.y - dy * b.x) / det;
	const v = (a.x * dy - a.y * dx) / det;
	if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return null;
	return Math.floor(v * height) * width + Math.floor(u * width);
}
