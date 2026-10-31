/**
 * Walking the items of a batched node with the keyboard: which item an arrow
 * key moves to, and where an item is.
 *
 * A batched layer (a dense `Scatter`, an `Imshow`) is one tab stop rather than
 * one per datum, so the arrow keys move a *current item* within it. They move
 * the way the picture reads, on screen: Left and Right step through the items
 * in the order they stand along the screen's x (an image steps one column),
 * Up and Down go to the nearest item above or below (an image steps one row),
 * Home and End go to the ends, PageUp and PageDown jump a tenth of the way.
 */

import type { Bounds, Point } from "../geometry";
import type { Matrix } from "../geometry/transform";
import type {
	DrawSpec,
	ImageSpec,
	MarkOutline,
	MarksSpec,
} from "../spec/types";

/** How many items a node walks: a marks node's items, an image's pixels, else 0. */
export function itemCount(spec: DrawSpec): number {
	if (spec.kind === "marks") return spec.count;
	if (spec.kind === "image") return spec.pixels.width * spec.pixels.height;
	return 0;
}

/** Where an image pixel's centre is, in scene units. */
function pixelCenter(spec: ImageSpec, item: number): Point {
	const { width, height } = spec.pixels;
	const u = ((item % width) + 0.5) / width;
	const v = (Math.floor(item / width) + 0.5) / height;
	return {
		x: spec.origin.x + u * spec.xAxis.x + v * spec.yAxis.x,
		y: spec.origin.y + u * spec.xAxis.y + v * spec.yAxis.y,
	};
}

/** An item's centre in scene units, or null for no such item. */
export function itemCenter(spec: DrawSpec, item: number): Point | null {
	if (!(item >= 0 && item < itemCount(spec))) return null;
	if (spec.kind === "marks")
		return { x: spec.centers[2 * item], y: spec.centers[2 * item + 1] };
	if (spec.kind === "image") return pixelCenter(spec, item);
	return null;
}

/** An item's box in scene units (what the focus ring wraps), or null. */
export function itemBox(spec: DrawSpec, item: number): Bounds | null {
	const center = itemCenter(spec, item);
	if (!center) return null;
	if (spec.kind === "marks") {
		const shape = spec.shape;
		if (shape.kind === "outline" || shape.kind === "paths") {
			const outline = shape.kind === "paths" ? shape.outlines[item] : shape;
			return outline ? outlineItemBox(spec, outline, item) : null;
		}
		const rect = spec.shape.kind === "rect";
		const ex = rect ? spec.extents[2 * item] : spec.extents[item];
		const ey = rect ? spec.extents[2 * item + 1] : ex;
		return {
			minX: center.x - ex,
			maxX: center.x + ex,
			minY: center.y - ey,
			maxY: center.y + ey,
		};
	}
	if (spec.kind === "image") {
		const { width, height } = spec.pixels;
		const hx = { x: spec.xAxis.x / width / 2, y: spec.xAxis.y / width / 2 };
		const hy = { x: spec.yAxis.x / height / 2, y: spec.yAxis.y / height / 2 };
		const dx = Math.abs(hx.x) + Math.abs(hy.x);
		const dy = Math.abs(hx.y) + Math.abs(hy.y);
		return {
			minX: center.x - dx,
			maxX: center.x + dx,
			minY: center.y - dy,
			maxY: center.y + dy,
		};
	}
	return null;
}

/**
 * An `outline`/`paths` item's box in scene units: its outline's points
 * placed by its linear part and centre (null for an empty outline).
 */
function outlineItemBox(
	spec: MarksSpec,
	outline: MarkOutline,
	item: number,
): Bounds | null {
	const t = spec.transforms;
	const a = t ? t[4 * item] : 1;
	const b = t ? t[4 * item + 1] : 0;
	const c = t ? t[4 * item + 2] : 0;
	const d = t ? t[4 * item + 3] : 1;
	const x = spec.centers[2 * item];
	const y = spec.centers[2 * item + 1];
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const line of outline.polylines) {
		for (const p of line) {
			const px = x + a * p.x + c * p.y;
			const py = y + b * p.x + d * p.y;
			if (px < minX) minX = px;
			if (px > maxX) maxX = px;
			if (py < minY) minY = py;
			if (py > maxY) maxY = py;
		}
	}
	return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

/** Each marks layer's items sorted by screen x (then y), keyed on its centres and the view's x direction. */
const orders = new WeakMap<
	Float64Array,
	{ flip: boolean; order: Uint32Array; rank: Uint32Array }
>();

function orderOf(
	spec: MarksSpec,
	view: Matrix,
): { order: Uint32Array; rank: Uint32Array } {
	// Screen x is `a * x + c * y + e`; sorting by it is what "left to right" means
	// under any view, and a key per item keeps the sort a plain numeric one.
	const flip = view.a < 0;
	const cached = orders.get(spec.centers);
	if (cached && cached.flip === flip && cached.order.length === spec.count)
		return cached;
	const { count, centers } = spec;
	const keys = new Float64Array(count);
	const tie = new Float64Array(count);
	for (let i = 0; i < count; i++) {
		const x = centers[2 * i];
		const y = centers[2 * i + 1];
		keys[i] = view.a * x + view.c * y;
		tie[i] = view.b * x + view.d * y;
	}
	const order = new Uint32Array(count);
	for (let i = 0; i < count; i++) order[i] = i;
	order.sort((p, q) => keys[p] - keys[q] || tie[p] - tie[q] || p - q);
	const rank = new Uint32Array(count);
	for (let k = 0; k < count; k++) rank[order[k]] = k;
	const entry = { flip, order, rank };
	orders.set(spec.centers, entry);
	return entry;
}

/**
 * The nearest item above (`dir` -1) or below (`dir` 1) `from` on screen: the
 * one closest by vertical distance plus twice the horizontal, so Down from a
 * point goes to what is under it rather than to the far side of the plot.
 */
function verticalNeighbour(
	spec: MarksSpec,
	view: Matrix,
	from: number,
	dir: -1 | 1,
): number | null {
	const { centers, count } = spec;
	const sx = (i: number) =>
		view.a * centers[2 * i] + view.c * centers[2 * i + 1];
	const sy = (i: number) =>
		view.b * centers[2 * i] + view.d * centers[2 * i + 1];
	const x0 = sx(from);
	const y0 = sy(from);
	let best: number | null = null;
	let bestScore = Number.POSITIVE_INFINITY;
	for (let i = 0; i < count; i++) {
		if (i === from) continue;
		const dy = (sy(i) - y0) * dir;
		if (!(dy > 0)) continue;
		const score = dy + 2 * Math.abs(sx(i) - x0);
		if (score < bestScore) {
			bestScore = score;
			best = i;
		}
	}
	return best;
}

/** The navigation keys {@link stepItem} understands. */
export const ITEM_KEYS = [
	"ArrowLeft",
	"ArrowRight",
	"ArrowUp",
	"ArrowDown",
	"Home",
	"End",
	"PageUp",
	"PageDown",
] as const;

/**
 * The item a key moves to from `current` (null: none yet, so any key starts at
 * the first item along the screen), under `view` (scene units → device
 * pixels). Returns `current` at an edge, and null for a key that does not
 * navigate or a node with no items.
 */
export function stepItem(
	spec: DrawSpec,
	current: number | null,
	key: string,
	view: Matrix,
): number | null {
	const count = itemCount(spec);
	if (count === 0 || !(ITEM_KEYS as readonly string[]).includes(key))
		return null;
	const page = Math.max(1, Math.round(count / 10));

	if (spec.kind === "image") {
		const { width, height } = spec.pixels;
		if (current === null) return 0;
		const col = current % width;
		const row = Math.floor(current / width);
		// Which way a column and a row run on screen.
		const colStep = view.a * spec.xAxis.x + view.c * spec.xAxis.y >= 0 ? 1 : -1;
		const rowStep = view.b * spec.yAxis.x + view.d * spec.yAxis.y >= 0 ? 1 : -1;
		const at = (r: number, c: number) =>
			Math.min(height - 1, Math.max(0, r)) * width +
			Math.min(width - 1, Math.max(0, c));
		switch (key) {
			case "ArrowRight":
				return at(row, col + colStep);
			case "ArrowLeft":
				return at(row, col - colStep);
			case "ArrowDown":
				return at(row + rowStep, col);
			case "ArrowUp":
				return at(row - rowStep, col);
			case "Home":
				return 0;
			case "End":
				return count - 1;
			case "PageDown":
				return at(row + rowStep * Math.max(1, Math.round(height / 10)), col);
			case "PageUp":
				return at(row - rowStep * Math.max(1, Math.round(height / 10)), col);
		}
		return current;
	}

	if (spec.kind !== "marks") return null;
	const { order, rank } = orderOf(spec, view);
	if (current === null || current >= count) return order[0];
	const k = rank[current];
	switch (key) {
		case "ArrowRight":
			return order[Math.min(count - 1, k + 1)];
		case "ArrowLeft":
			return order[Math.max(0, k - 1)];
		case "Home":
			return order[0];
		case "End":
			return order[count - 1];
		case "PageDown":
			return order[Math.min(count - 1, k + page)];
		case "PageUp":
			return order[Math.max(0, k - page)];
		case "ArrowDown":
			return verticalNeighbour(spec, view, current, 1) ?? current;
		case "ArrowUp":
			return verticalNeighbour(spec, view, current, -1) ?? current;
	}
	return current;
}

/**
 * An item's 1-based place in the order the keys walk (`aria-posinset`): its
 * rank along the screen for a marks node, its reading-order index for an
 * image. Null for no such item.
 */
export function itemPosition(
	spec: DrawSpec,
	item: number,
	view: Matrix,
): number | null {
	if (!(item >= 0 && item < itemCount(spec))) return null;
	if (spec.kind === "marks") return orderOf(spec, view).rank[item] + 1;
	return item + 1;
}
