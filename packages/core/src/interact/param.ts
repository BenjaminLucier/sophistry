/**
 * Drag projections: what is being dragged (a point, number, angle or path
 * parameter). `pointParam` is the identity. `pathParam` and `alongPath` look the
 * same on screen; the first writes `t`, the second a `Point`.
 */

import type { ArcTable, Point, Polyline } from "../geometry/index.js";
import { pointAtT } from "../geometry/index.js";
import type { Readable } from "../reactive/index.js";
import { isReadable } from "../reactive/index.js";
import { arcTableFor, closestPointOnTable } from "./constrain.js";
import type { DragParam } from "./drag.js";

/**
 * A polyline given outright, or one that changes (an animating graph): a
 * `Readable` or a getter, read afresh on every move.
 *
 * @category Interaction
 */
export type LineSource = Polyline | Readable<Polyline> | (() => Polyline);

function readLine(line: LineSource): Polyline {
	if (typeof line === "function") return line();
	if (isReadable(line)) return (line as Readable<Polyline>).peek();
	return line;
}

/** Wraps into `(−π, π]`, the shortest way round. */
function wrap(angle: number): number {
	return angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
}

function quantize(value: number, step: number | undefined): number {
	return step && step > 0 ? Math.round(value / step) * step : value;
}

/**
 * Snaps `value` to `lo + k * step`, counting steps from `lo` so `lo` is always
 * reachable, then clamps into the range so rounding never overshoots `hi`.
 * Unclamped params snap but are not clamped.
 */
function quantizeRange(
	lo: number,
	hi: number,
	value: number,
	step: number | undefined,
	clamped: boolean,
): number {
	if (!step || !(step > 0)) return value;
	const snapped = lo + Math.round((value - lo) / step) * step;
	if (!clamped) return snapped;
	const min = Math.min(lo, hi);
	const max = Math.max(lo, hi);
	return Math.min(max, Math.max(min, snapped));
}

/**
 * The identity: the value *is* the position. `draggable`'s default, and the
 * case every constraint in `constrain.ts` was written against.
 *
 * @returns A {@link DragParam} over {@link Point}.
 *
 * @category Interaction
 */
export function pointParam(): DragParam<Point> {
	return {
		toValue: (at) => at,
		toPoint: (value) => value,
	};
}

/** @category Interaction */
export interface AngleParamOptions {
	/**
	 * How far from the pivot the handle sits, for the value → point direction.
	 * In local scene units. Defaults to wherever the grab began, which is what a
	 * handle on a ring wants and costs nothing to measure.
	 */
	radius?: number;
	/** Snap to a multiple of this many radians. */
	step?: number;
	/** Keep the angle within `[min, max]` radians, after unwrapping (so a range beyond ±π is allowed). */
	clamp?: [number, number];
}

/**
 * Drag to radians about `pivot`, for rotation handles. Turns accumulate (three
 * laps is about 6π), measured counter-clockwise from +x. Use one instance per
 * handle.
 *
 * @param pivot - The point the handle rotates about, in local units.
 * @param options - Radius, snap step and clamp; see {@link AngleParamOptions}.
 * @returns A {@link DragParam} whose value is the angle in radians.
 *
 * @category Interaction
 */
export function angleParam(
	pivot: Point,
	options: AngleParamOptions = {},
): DragParam<number> {
	let session: Point | null = null;
	let base = 0;
	let previous = 0;
	let total = 0;
	let radius = options.radius ?? 1;

	return {
		toValue(at, ctx) {
			if (session !== ctx.start) {
				session = ctx.start;
				base = ctx.origin;
				// The first proposed point is `toPoint(origin)`, whose angle is the
				// origin whatever the radius — so seeding the unwrap with the origin
				// itself makes the opening frame a zero delta and keeps the radius
				// out of the accumulation entirely.
				previous = ctx.origin;
				total = 0;
				if (options.radius === undefined) {
					const grabbed = Math.hypot(
						ctx.start.x - pivot.x,
						ctx.start.y - pivot.y,
					);
					radius = grabbed > 0 ? grabbed : 1;
				}
			}
			const raw = Math.atan2(at.y - pivot.y, at.x - pivot.x);
			total += wrap(raw - previous);
			previous = raw;

			let angle = quantize(base + total, options.step);
			if (options.clamp) {
				angle = Math.min(options.clamp[1], Math.max(options.clamp[0], angle));
			}
			return angle;
		},
		toPoint: (value) => ({
			x: pivot.x + radius * Math.cos(value),
			y: pivot.y + radius * Math.sin(value),
		}),
	};
}

/** @category Interaction */
export interface ScalarParamOptions {
	/**
	 * The values at `from` and at `to`.
	 * @default `[0, 1]`
	 */
	range?: [number, number];
	/** Snap to `range[0] + k * step`, in value units rather than in distance; never past the range when clamped. */
	step?: number;
	/**
	 * Keep the value between the endpoints.
	 * @default true
	 */
	clamp?: boolean;
}

/**
 * Drag → a number along the segment `from`→`to`. The slider, and the thing a
 * scrubber is built from: point the value at a timeline's `t` and the scene
 * scrubs because the timeline reads the same cell.
 *
 * Off-axis pointer movement is projected onto the segment rather than ignored,
 * so the knob keeps up with a finger that wanders — the behaviour every native
 * slider has and the one people miss immediately when it is absent.
 *
 * @param from - The segment's start, in local scene units (value `range[0]`).
 * @param to - The segment's end, in local scene units (value `range[1]`).
 * @param options - Value range, snap step and clamping; see {@link ScalarParamOptions}.
 * @returns A {@link DragParam} whose value is a number.
 *
 * @category Interaction
 */
export function scalarParam(
	from: Point,
	to: Point,
	options: ScalarParamOptions = {},
): DragParam<number> {
	const [lo, hi] = options.range ?? [0, 1];
	const clamped = options.clamp ?? true;
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const lengthSquared = dx * dx + dy * dy;

	const limit = (t: number) => (clamped ? Math.min(1, Math.max(0, t)) : t);

	return {
		toValue(at) {
			// A degenerate segment has no direction to project onto; answering with
			// the low end is the only choice that is not a NaN.
			if (lengthSquared === 0) return lo;
			const t = limit(
				((at.x - from.x) * dx + (at.y - from.y) * dy) / lengthSquared,
			);
			return quantizeRange(lo, hi, lo + (hi - lo) * t, options.step, clamped);
		},
		toPoint(value) {
			const t = hi === lo ? 0 : limit((value - lo) / (hi - lo));
			return { x: from.x + dx * t, y: from.y + dy * t };
		},
	};
}

/**
 * Drag → normalized arc-length position along a polyline.
 *
 * The projection is the same one `alongPath` performs; only the value differs.
 * See this module's header for which to reach for. `line` may be a `Readable` or a getter,
 * so a point can be dragged along a curve that is itself animating; the arc
 * table is memoised on the polyline's identity, so a still curve measures once.
 *
 * @param line - The polyline (or a `Readable` or getter for one), in local scene units.
 * @returns A {@link DragParam} whose value is the normalized arc-length `t`, 0 at
 * the start of the line and 1 at its end.
 *
 * @category Interaction
 */
export function pathParam(line: LineSource): DragParam<number> {
	const table = (): ArcTable => arcTableFor(readLine(line));
	return {
		toValue: (at) => closestPointOnTable(table(), at).t,
		toPoint: (value) => pointAtT(table(), value),
	};
}
