/**
 * Layout over `Bounds`: Manim's positioning vocabulary as pure functions.
 *
 * Placement helpers return an opaque `Placement` (a translation) that only the
 * `place` prop accepts. `center`, `points` and the like are what `localBounds()`
 * measures, so feeding a delta back into them would loop; the opaque type makes
 * that a compile error. `surround` returns `Bounds` instead, for another shape's
 * geometry. Helpers accept `null`/`undefined` bounds and return a zero shift, since
 * a sibling's `ref` may not have fired on the first pass. y is up.
 */

import type { Bounds, Point } from "../geometry";
import {
	centerOf as boundsCenter,
	boundsFromCenter,
	boundsHeight,
	boundsWidth,
	padBounds,
	pointOnBounds as pointOn,
	unionBounds,
} from "../geometry/bounds";

/** A direction, as a unit vector. Same shape as a `Point`, different intent. */
export type Vec2 = Point;

/**
 * The key a `Placement` hides its translation under. Not exported from any
 * barrel, so scene code cannot turn a placement back into numbers.
 *
 * @internal
 */
export const DELTA = Symbol("vis.placement");

/**
 * A translation in scene units, as returned by every placement function here.
 *
 * Has no `x`/`y` and is not a number, so the type system rejects it everywhere
 * except a `place` prop — which is the only place it is safe to spend.
 *
 * @category Layout
 */
export interface Placement {
	readonly [DELTA]: Point;
}

function placement(x: number, y: number): Placement {
	return { [DELTA]: { x, y } };
}

/**
 * A `Placement` that moves nothing — what the helpers answer with when a box
 * hasn't been measured yet.
 *
 * @category Layout
 */
export const NO_SHIFT: Placement = placement(0, 0);

/**
 * Unwraps a delta for the components that apply it. Copies, so a shared
 * constant like `NO_SHIFT` stays one mutation further from a bug.
 *
 * @internal
 */
export function readDelta(shift: Placement | undefined): Point {
	if (!shift) return { x: 0, y: 0 };
	const delta = shift[DELTA];
	return { x: delta.x, y: delta.y };
}

/**
 * Nudges a placement by a hand-written offset.
 *
 * @param shift - The placement to start from.
 * @param by - Extra offset in scene units.
 * @returns A new placement moved by `by` more.
 *
 * @category Layout
 */
export function shiftBy(shift: Placement, by: Point): Placement {
	const delta = shift[DELTA];
	return placement(delta.x + by.x, delta.y + by.y);
}

/**
 * Adds placements together — `sumShifts(alignTo(…, LEFT), nextTo(…, UP))`.
 *
 * Only sound when each argument constrains a different axis, or when you
 * genuinely mean the sum; two competing `nextTo`s on the same axis add up to
 * neither of them.
 *
 * @param shifts - The placements to add.
 * @returns A single placement whose translation is the sum.
 *
 * @category Layout
 */
export function sumShifts(...shifts: Placement[]): Placement {
	let x = 0;
	let y = 0;
	for (const shift of shifts) {
		x += shift[DELTA].x;
		y += shift[DELTA].y;
	}
	return placement(x, y);
}

/**
 * Keeps only the horizontal component — "line up with that, stay at my height".
 *
 * @category Layout
 */
export function onlyX(shift: Placement): Placement {
	return placement(shift[DELTA].x, 0);
}

/**
 * Keeps only the vertical component.
 *
 * @category Layout
 */
export function onlyY(shift: Placement): Placement {
	return placement(0, shift[DELTA].y);
}

/**
 * The scene origin, `(0, 0)` — also the "centre" direction for {@link pointOn}.
 *
 * @category Layout
 */
export const ORIGIN: Vec2 = { x: 0, y: 0 };
/**
 * Unit vector pointing up (scene y is up): `(0, 1)`.
 *
 * @category Layout
 */
export const UP: Vec2 = { x: 0, y: 1 };
/**
 * Unit vector pointing down: `(0, -1)`.
 *
 * @category Layout
 */
export const DOWN: Vec2 = { x: 0, y: -1 };
/**
 * Unit vector pointing left: `(-1, 0)`.
 *
 * @category Layout
 */
export const LEFT: Vec2 = { x: -1, y: 0 };
/**
 * Unit vector pointing right: `(1, 0)`.
 *
 * @category Layout
 */
export const RIGHT: Vec2 = { x: 1, y: 0 };
/**
 * Up-left diagonal, `(-1, 1)` (not normalised). Selects the top-left corner of a box.
 *
 * @category Layout
 */
export const UL: Vec2 = { x: -1, y: 1 };
/**
 * Up-right diagonal, `(1, 1)` (not normalised). Selects the top-right corner of a box.
 *
 * @category Layout
 */
export const UR: Vec2 = { x: 1, y: 1 };
/**
 * Down-left diagonal, `(-1, -1)` (not normalised). Selects the bottom-left corner of a box.
 *
 * @category Layout
 */
export const DL: Vec2 = { x: -1, y: -1 };
/**
 * Down-right diagonal, `(1, -1)` (not normalised). Selects the bottom-right corner of a box.
 *
 * @category Layout
 */
export const DR: Vec2 = { x: 1, y: -1 };

/**
 * Default gap between two placed objects, in scene units. One constant rather
 * than a per-function default so call sites stay terse and a scene reads with
 * one consistent rhythm.
 *
 * @category Layout
 */
export const DEFAULT_GAP = 0.25;

// Box math lives in `geometry/bounds.ts`; these are its names in the layout
// vocabulary (`boundsCenter` is `centerOf`, `pointOn` is `pointOnBounds`).
export {
	boundsFromCenter,
	boundsHeight,
	boundsWidth,
	centerOf as boundsCenter,
	padBounds,
	pointOnBounds as pointOn,
	unionBounds,
} from "../geometry/bounds";

/** Translates a box. Internal: callers outside deal in deltas, not boxes. */
function shiftBounds(bounds: Bounds, delta: Point): Bounds {
	return {
		minX: bounds.minX + delta.x,
		minY: bounds.minY + delta.y,
		maxX: bounds.maxX + delta.x,
		maxY: bounds.maxY + delta.y,
	};
}

/** @category Layout */
export interface NextToOptions {
	/** Gap. Defaults to `DEFAULT_GAP`. */
	gap?: number;
	/**
	 * Which edge to line up on the perpendicular axis — Manim's `aligned_edge`.
	 * `nextTo(a, b, UP, { align: LEFT })` puts `a` above `b`, left edges flush.
	 */
	align?: Vec2;
}

/**
 * Places `self` beside `target` in `direction`, `gap` apart (Manim's `next_to`);
 * `align` flushes an edge on the other axis. Pass `self`'s `localBounds()` and
 * `target`'s `bounds()`, read inside a reactive expression.
 *
 * @param self - Box of the thing being positioned (its `localBounds()`).
 * @param target - Box of the thing to sit beside.
 * @param direction - Which side of `target`, for example `UP` or `RIGHT`.
 * @param options - Gap and edge alignment; see {@link NextToOptions}.
 * @returns A placement for a shape's `place` prop; zero when either box is missing.
 * @see {@link https://sophistry.dev/guides/layout/#placement-helpers}
 * @category Layout
 */
export function nextTo(
	self: Bounds | null | undefined,
	target: Bounds | null | undefined,
	direction: Vec2,
	options: NextToOptions = {},
): Placement {
	if (!self || !target) return NO_SHIFT;
	const gap = options.gap ?? DEFAULT_GAP;
	const align = options.align ?? ORIGIN;
	const anchor = pointOn(target, {
		x: align.x + direction.x,
		y: align.y + direction.y,
	});
	const mine = pointOn(self, {
		x: align.x - direction.x,
		y: align.y - direction.y,
	});
	return placement(
		anchor.x - mine.x + direction.x * gap,
		anchor.y - mine.y + direction.y * gap,
	);
}

/**
 * Flushes `self`'s edge in `direction` with `target`'s — Manim's `align_to`.
 * Only the axes `direction` actually names move, so `alignTo(a, b, LEFT)`
 * leaves the vertical placement alone.
 *
 * @param self - Box of the thing being positioned.
 * @param target - Box to line up with.
 * @param direction - Which edge to match, for example `LEFT` to align left edges.
 * @returns A placement for a `place` prop; zero when either box is missing.
 *
 * @category Layout
 */
export function alignTo(
	self: Bounds | null | undefined,
	target: Bounds | null | undefined,
	direction: Vec2,
): Placement {
	if (!self || !target) return NO_SHIFT;
	const mine = pointOn(self, direction);
	const theirs = pointOn(target, direction);
	return placement(
		direction.x === 0 ? 0 : theirs.x - mine.x,
		direction.y === 0 ? 0 : theirs.y - mine.y,
	);
}

/**
 * Centres `self` on `point` (Manim's `move_to`; `moveTo` is the animation).
 *
 * @param self - Box of the thing being positioned.
 * @param point - Where its centre should end up.
 * @returns A placement for a `place` prop; zero when `self` is missing.
 *
 * @category Layout
 */
export function centerAt(
	self: Bounds | null | undefined,
	point: Point,
): Placement {
	if (!self) return NO_SHIFT;
	const centre = boundsCenter(self);
	return placement(point.x - centre.x, point.y - centre.y);
}

/** @category Layout */
export interface EdgeOptions {
	/** Inset from the frame edge. Defaults to `DEFAULT_GAP`. */
	margin?: number;
}

/**
 * Pins `self` against one edge of `frame`, inset by `margin` — Manim's `to_edge`.
 * Pass `useFrame()()` for the viewport, or any other box to pin within it.
 *
 * @param self - Box of the thing being positioned.
 * @param frame - The box to pin inside.
 * @param direction - Which edge, for example `UP` for the top edge.
 * @param options - Inset from the edge; see {@link EdgeOptions}.
 * @returns A placement for a `place` prop; zero when either box is missing.
 *
 * @category Layout
 */
export function toEdge(
	self: Bounds | null | undefined,
	frame: Bounds | null | undefined,
	direction: Vec2,
	options: EdgeOptions = {},
): Placement {
	if (!self || !frame) return NO_SHIFT;
	const margin = options.margin ?? DEFAULT_GAP;
	const flush = alignTo(self, frame, direction)[DELTA];
	return placement(
		flush.x - direction.x * margin,
		flush.y - direction.y * margin,
	);
}

/**
 * `toEdge` with a diagonal direction — both axes bite, so `UR` pins to the
 * top-right corner. Kept as its own name because that is how it reads at the
 * call site, and because Manim spells the two separately too.
 *
 * @see {@link toEdge} for the parameters.
 *
 * @category Layout
 */
export function toCorner(
	self: Bounds | null | undefined,
	frame: Bounds | null | undefined,
	direction: Vec2,
	options: EdgeOptions = {},
): Placement {
	return toEdge(self, frame, direction, options);
}

/** @category Layout */
export interface SurroundOptions {
	/** Padding on every side. Defaults to `DEFAULT_GAP`. */
	padding?: number;
}

/**
 * The box enclosing `target` with `padding`: what `SurroundingRectangle` draws.
 * A missing target gives a zero-size box at the origin.
 *
 * @param target - Box to enclose.
 * @param options - Padding; see {@link SurroundOptions}.
 * @returns The padded box.
 *
 * @category Layout
 */
export function surround(
	target: Bounds | null | undefined,
	options: SurroundOptions = {},
): Bounds {
	if (!target) return boundsFromCenter(zero(), 0, 0);
	return padBounds(target, options.padding ?? DEFAULT_GAP);
}

/** @category Layout */
export interface ArrangeOptions {
	/** Gap between neighbours. Defaults to `DEFAULT_GAP`. */
	gap?: number;
	/**
	 * Where the arrangement ends up. Defaults to the centre of the items'
	 * combined box *before* arranging, so a row shuffles in place rather than
	 * walking off toward `direction`.
	 */
	center?: Point;
}

/**
 * Fresh every time — a shared constant would be one mutation away from a bug.
 * `arrange` and `arrangeInGrid` do their bookkeeping in plain `Point`s and wrap
 * up as `Placement`s on the way out, so this stays useful internally.
 */
function zero(): Point {
	return { x: 0, y: 0 };
}

/** Shifts a whole set of deltas so the arranged union lands on `target`. */
function recenter(
	items: (Bounds | null | undefined)[],
	deltas: Point[],
	target: Point | undefined,
): Point[] {
	const placed = unionBounds(
		...items.map((item, i) => (item ? shiftBounds(item, deltas[i]) : null)),
	);
	const original = unionBounds(...items);
	if (!placed || !original) return deltas;
	const to = target ?? boundsCenter(original);
	const from = boundsCenter(placed);
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	return deltas.map((d) => ({ x: d.x + dx, y: d.y + dy }));
}

/**
 * Lays items out in a line along `direction`, one delta per item.
 *
 * Each item is placed relative to the *already placed* previous one, so items
 * of different sizes end up with equal gaps rather than equal pitch.
 *
 * @param items - Boxes (or null for not-yet-measured items, which get a zero delta), in order.
 * @param direction - Which way the line runs, for example `RIGHT`.
 * @param options - Gap and final centre; see {@link ArrangeOptions}.
 * @returns One placement per item, in the same order.
 * @category Layout
 */
export function arrange(
	items: (Bounds | null | undefined)[],
	direction: Vec2,
	options: ArrangeOptions = {},
): Placement[] {
	const gap = options.gap ?? DEFAULT_GAP;
	const deltas: Point[] = items.map(() => zero());
	let previous: Bounds | null = null;

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (!item) continue;
		if (previous) deltas[i] = nextTo(item, previous, direction, { gap })[DELTA];
		previous = shiftBounds(item, deltas[i]);
	}

	return recenter(items, deltas, options.center).map((d) =>
		placement(d.x, d.y),
	);
}

/** @category Layout */
export interface GridOptions {
	/** Number of columns. Defaults to `ceil(sqrt(n))`, or whatever `rows` implies. */
	columns?: number;
	/** Number of rows, used to derive `columns` when that is not given. */
	rows?: number;
	/** Fallback gap for both axes. Defaults to `DEFAULT_GAP`. */
	gap?: number;
	/** Horizontal gap, overriding `gap`. */
	columnGap?: number;
	/** Vertical gap, overriding `gap`. */
	rowGap?: number;
	/** Where the grid ends up. Defaults to the items' combined centre. */
	center?: Point;
}

/**
 * Row-major grid layout, one delta per item.
 *
 * Columns take the width of their widest member and rows the height of their
 * tallest, so a grid of mixed-size items still lines up on both axes. Rows run
 * downward because y is up.
 *
 * @param items - Boxes (null for unmeasured items), in row-major order.
 * @param options - Columns/rows, gaps and final centre; see {@link GridOptions}.
 * @returns One placement per item, in the same order.
 *
 * @category Layout
 */
export function arrangeInGrid(
	items: (Bounds | null | undefined)[],
	options: GridOptions = {},
): Placement[] {
	const count = items.length;
	const deltas: Point[] = items.map(() => zero());
	if (count === 0) return [];

	const gap = options.gap ?? DEFAULT_GAP;
	const columnGap = options.columnGap ?? gap;
	const rowGap = options.rowGap ?? gap;
	const columns = Math.max(
		1,
		options.columns ??
			(options.rows
				? Math.ceil(count / Math.max(1, options.rows))
				: Math.ceil(Math.sqrt(count))),
	);
	const rows = Math.ceil(count / columns);

	const colWidth = new Array<number>(columns).fill(0);
	const rowHeight = new Array<number>(rows).fill(0);
	for (let i = 0; i < count; i++) {
		const item = items[i];
		if (!item) continue;
		const c = i % columns;
		const r = Math.floor(i / columns);
		colWidth[c] = Math.max(colWidth[c], boundsWidth(item));
		rowHeight[r] = Math.max(rowHeight[r], boundsHeight(item));
	}

	const colCentre = new Array<number>(columns).fill(0);
	let x = 0;
	for (let c = 0; c < columns; c++) {
		colCentre[c] = x + colWidth[c] / 2;
		x += colWidth[c] + columnGap;
	}
	const rowCentre = new Array<number>(rows).fill(0);
	let y = 0;
	for (let r = 0; r < rows; r++) {
		rowCentre[r] = -(y + rowHeight[r] / 2);
		y += rowHeight[r] + rowGap;
	}

	for (let i = 0; i < count; i++) {
		const item = items[i];
		if (!item) continue;
		const centre = boundsCenter(item);
		deltas[i] = {
			x: colCentre[i % columns] - centre.x,
			y: rowCentre[Math.floor(i / columns)] - centre.y,
		};
	}

	return recenter(items, deltas, options.center).map((d) =>
		placement(d.x, d.y),
	);
}
