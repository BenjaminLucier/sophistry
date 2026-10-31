/**
 * Gridded colour layers as one image rather than one rectangle per cell.
 *
 * A 1000 × 1000 `<Imshow>` is a million cells. As shapes that is a million
 * nodes; as an image it is one `drawImage` that the camera moves for free. The
 * colours go through a 256-step lookup table of the layer's ramp (what
 * matplotlib's colormaps are, too), so a million cells cost a million table
 * reads instead of a million CSS colour strings.
 */

import type { CoordinateSystem, ImageGeometry } from "@sophistry/core";
import { tryParseColor } from "@sophistry/core/color";
import type { Point } from "@sophistry/core/geometry";

/** Entries in a ramp lookup table. */
const LUT_SIZE = 256;

/** `LUT_SIZE` RGBA entries sampling `colorAt` over 0..1. */
export function rampTable(
	colorAt: (unit: number) => string,
): Uint8ClampedArray {
	const table = new Uint8ClampedArray(LUT_SIZE * 4);
	for (let i = 0; i < LUT_SIZE; i++) {
		const color = tryParseColor(colorAt(i / (LUT_SIZE - 1)));
		if (!color) continue;
		table[4 * i] = color.r;
		table[4 * i + 1] = color.g;
		table[4 * i + 2] = color.b;
		table[4 * i + 3] = Math.round(color.a * 255);
	}
	return table;
}

/**
 * Colours a grid of values into RGBA pixels, row 0 first. Values off the norm
 * (non-finite, or non-positive under a log norm) are transparent, the way
 * those cells are not drawn as shapes.
 */
export function rasterize(
	values: readonly (readonly number[])[],
	ncols: number,
	unitOf: (value: number) => number,
	table: Uint8ClampedArray,
): Uint8ClampedArray {
	const nrows = values.length;
	const data = new Uint8ClampedArray(nrows * ncols * 4);
	const top = LUT_SIZE - 1;
	for (let row = 0; row < nrows; row++) {
		const line = values[row];
		for (let col = 0; col < line.length && col < ncols; col++) {
			const unit = unitOf(line[col]);
			if (!Number.isFinite(unit)) continue;
			const at = 4 * Math.round(Math.min(1, Math.max(0, unit)) * top);
			const out = 4 * (row * ncols + col);
			data[out] = table[at];
			data[out + 1] = table[at + 1];
			data[out + 2] = table[at + 2];
			data[out + 3] = table[at + 3];
		}
	}
	return data;
}

/**
 * The scene frame of an axis-aligned data rectangle, if the coordinate system
 * maps it affinely (linear axes): pixel corner `(0, 0)` at data `(x0, y0)`, the
 * first row running to `x1`, the first column to `y1`. Null under a log or
 * other non-linear axis, where an image would put cells in the wrong places —
 * the caller then draws cells as shapes.
 */
export function affineFrame(
	coords: Pick<CoordinateSystem, "coordsToPoint">,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): Omit<ImageGeometry, "pixels"> | null {
	const o = coords.coordsToPoint(x0, y0);
	const a = coords.coordsToPoint(x1, y0);
	const b = coords.coordsToPoint(x0, y1);
	const far = coords.coordsToPoint(x1, y1);
	const mid = coords.coordsToPoint((x0 + x1) / 2, (y0 + y1) / 2);
	const near = (p: Point, q: Point) => {
		const scale = Math.max(1, Math.abs(q.x), Math.abs(q.y));
		return (
			Math.abs(p.x - q.x) <= 1e-9 * scale && Math.abs(p.y - q.y) <= 1e-9 * scale
		);
	};
	const xAxis = { x: a.x - o.x, y: a.y - o.y };
	const yAxis = { x: b.x - o.x, y: b.y - o.y };
	if (
		!near(far, { x: o.x + xAxis.x + yAxis.x, y: o.y + xAxis.y + yAxis.y }) ||
		!near(mid, {
			x: o.x + (xAxis.x + yAxis.x) / 2,
			y: o.y + (xAxis.y + yAxis.y) / 2,
		})
	)
		return null;
	return { origin: o, xAxis, yAxis };
}

/**
 * Projects many data points into scene units at once, into `out` (interleaved
 * `x, y`). Under linear axes the coordinate system is an affine map, found
 * from three probes and checked at a fourth, and every point is two multiply-
 * adds; otherwise each point goes through `coordsToPoint`.
 *
 * @param xs - Data x per point.
 * @param ys - Data y per point.
 * @param out - Receives `2 * xs.length` numbers.
 */
export function projectPoints(
	coords: CoordinateSystem,
	xs: ArrayLike<number>,
	ys: ArrayLike<number>,
	out: Float64Array,
): void {
	const count = xs.length;
	if (count === 0) return;
	// Probe around the data's own first point, so a clamped or log axis is
	// caught where the data actually is.
	const x0 = Number.isFinite(xs[0]) ? xs[0] : 0;
	const y0 = Number.isFinite(ys[0]) ? ys[0] : 0;
	const frame = affineFrame(coords, x0, y0, x0 + 1, y0 + 1);
	if (frame && probeFits(coords, frame, x0, y0, xs, ys)) {
		const { origin: o, xAxis: a, yAxis: b } = frame;
		for (let i = 0; i < count; i++) {
			const u = xs[i] - x0;
			const v = ys[i] - y0;
			out[2 * i] = o.x + u * a.x + v * b.x;
			out[2 * i + 1] = o.y + u * a.y + v * b.y;
		}
		return;
	}
	for (let i = 0; i < count; i++) {
		const at = coords.coordsToPoint(xs[i], ys[i]);
		out[2 * i] = at.x;
		out[2 * i + 1] = at.y;
	}
}

/**
 * Projects one run of data points into scene points: the run-of-objects
 * counterpart of {@link projectPoints}, with the same affine fast path.
 */
export function projectRun(
	coords: Pick<CoordinateSystem, "coordsToPoint">,
	run: readonly Point[],
): Point[] {
	const count = run.length;
	if (count < 32) return run.map((at) => coords.coordsToPoint(at.x, at.y));
	const x0 = Number.isFinite(run[0].x) ? run[0].x : 0;
	const y0 = Number.isFinite(run[0].y) ? run[0].y : 0;
	const frame = affineFrame(coords, x0, y0, x0 + 1, y0 + 1);
	const xs = new Float64Array(count);
	const ys = new Float64Array(count);
	for (let i = 0; i < count; i++) {
		xs[i] = run[i].x;
		ys[i] = run[i].y;
	}
	if (!frame || !probeFits(coords, frame, x0, y0, xs, ys))
		return run.map((at) => coords.coordsToPoint(at.x, at.y));
	const { origin: o, xAxis: a, yAxis: b } = frame;
	const out: Point[] = new Array(count);
	for (let i = 0; i < count; i++) {
		const u = xs[i] - x0;
		const v = ys[i] - y0;
		out[i] = { x: o.x + u * a.x + v * b.x, y: o.y + u * a.y + v * b.y };
	}
	return out;
}

/**
 * Whether the affine `frame` (unit steps from `(x0, y0)`) agrees with the
 * coordinate system at the data's extremes too: a clamped axis or one that is
 * only locally linear fails here.
 */
function probeFits(
	coords: Pick<CoordinateSystem, "coordsToPoint">,
	frame: Omit<ImageGeometry, "pixels">,
	x0: number,
	y0: number,
	xs: ArrayLike<number>,
	ys: ArrayLike<number>,
): boolean {
	let minX = x0;
	let maxX = x0;
	let minY = y0;
	let maxY = y0;
	for (let i = 0; i < xs.length; i++) {
		const x = xs[i];
		const y = ys[i];
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	const { origin: o, xAxis: a, yAxis: b } = frame;
	for (const [x, y] of [
		[minX, minY],
		[maxX, maxY],
		[minX, maxY],
		[maxX, minY],
	]) {
		const want = coords.coordsToPoint(x, y);
		const u = x - x0;
		const v = y - y0;
		const gx = o.x + u * a.x + v * b.x;
		const gy = o.y + u * a.y + v * b.y;
		const scale = Math.max(1, Math.abs(want.x), Math.abs(want.y));
		if (
			!(Math.abs(gx - want.x) <= 1e-7 * scale) ||
			!(Math.abs(gy - want.y) <= 1e-7 * scale)
		)
			return false;
	}
	return true;
}
