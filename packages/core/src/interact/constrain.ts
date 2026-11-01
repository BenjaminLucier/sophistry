/**
 * Drag constraints: pure functions from a proposed point to an allowed one,
 * resolved by name like easings. `chain` composes them in the order written.
 * `alongPath` is a closest-point search plus an arc-length lookup
 * (`geometry/path/`).
 */

import { padBounds } from "../geometry/bounds.js";
import type { ArcTable, Bounds, Point, Polyline } from "../geometry/index.js";
import { measure } from "../geometry/index.js";
import { createResolver } from "../geometry/resolver.js";

import type { Readable } from "../reactive/index.js";
import { isReadable } from "../reactive/index.js";
import type { ScenePointerEvent } from "./types.js";

/**
 * Where a gesture is, and where it began, in the units the projection works in.
 *
 * `origin` is read **once**, at `start` — never per move. A projection that
 * re-read the cell would be integrating its own output, which is the drift the
 * origin-plus-offset rule exists to avoid.
 *
 * @category Interaction
 */
export interface DragContext<T> {
	/** The cell's value when the gesture started. */
	origin: T;
	/** The pointer at gesture start, in the node's local units. */
	start: Point;
	/** The pointer now, in the node's local units. */
	pointer: Point;
	event: ScenePointerEvent;
}

/**
 * A clamp on the proposed position, in the node's local units.
 *
 * Constraints are stated in *point* space rather than in `T`, so one library of
 * them serves every projection: `snapToGrid` means the same thing whether the
 * value being produced is a point, an angle or a path parameter. They run
 * before `toValue`, in the order given.
 *
 * @category Interaction
 */
export type DragConstraint = (
	proposed: Point,
	ctx: DragContext<Point>,
) => Point;

/**
 * A constraint function, or the name of a built-in one (see {@link ConstraintName}).
 *
 * @category Interaction
 */
export type ConstraintSpec = DragConstraint | ConstraintName;

/**
 * The built-in constraints that take no arguments, usable as strings: free, horizontal-only, vertical-only.
 *
 * @category Interaction
 */
export type ConstraintName = "free" | "axisX" | "axisY";

/**
 * A value given outright, or one that moves: a `Readable` (a `Track`, a
 * `derive`) or a getter. Read afresh on every constrained move.
 *
 * @category Interaction
 */
export type ValueSource<T> = T | Readable<T> | (() => T);

/** The current value of a {@link ValueSource}. */
function readSource<T extends object>(source: ValueSource<T>): T {
	if (typeof source === "function") return (source as () => T)();
	if (isReadable(source)) return (source as Readable<T>).peek();
	return source as T;
}

/**
 * A box given outright, or one that moves (a `Readable` or a getter, such as
 * the viewport frame). Units are the node's local scene units.
 *
 * @category Interaction
 */
export type BoundsSource = ValueSource<Bounds>;

function readBounds(box: BoundsSource): Bounds {
	return readSource(box);
}

/**
 * Arc tables memoised on the polyline's *identity*.
 *
 * A curve rebuilt every frame measures every frame, which is the honest cost of
 * dragging along something that is itself animating; a still curve measures
 * once and the entry disappears with the array. Weak, so a lesson that cycles
 * through fifty curves does not keep fifty tables alive.
 */
const TABLES = new WeakMap<Polyline, ArcTable>();

/**
 * The arc-length table for a polyline, measured once per array identity.
 *
 * @param line - The polyline, in any units.
 * @returns A cached {@link ArcTable} (cumulative lengths and total).
 *
 * @category Interaction plumbing
 */
export function arcTableFor(line: Polyline): ArcTable {
	const cached = TABLES.get(line);
	if (cached) return cached;
	const table = measure(line);
	TABLES.set(line, table);
	return table;
}

/**
 * Where a point on a polyline is, in all the ways anyone downstream wants it.
 *
 * @category Bounds & hit math
 */
export interface ClosestPoint {
	/** The closest point on the polyline, in the polyline's units. */
	point: Point;
	/** Normalized arc-length position, the parameter `pointAtT` takes. */
	t: number;
	/** Straight-line distance from the query point to `point`, in the polyline's units. */
	distance: number;
	/** Index of the segment's first vertex — for "which edge is this on". */
	index: number;
}

/**
 * The closest point on a polyline, by perpendicular projection onto each
 * segment. Exported because it is independently useful: snapping a label to a
 * curve, finding which edge of a graph a click landed on, measuring how far a
 * sampled point has strayed from the exact one.
 *
 * Linear in the number of vertices, with no spatial index. A flattened curve is
 * a few hundred points and this runs per pointer move, which is nothing; a
 * hundred-thousand-point path would want bucketing, and does not exist here.
 *
 * @param table - An arc table, from {@link arcTableFor}.
 * @param at - The query point, in the polyline's units.
 * @returns The nearest point, its normalized arc-length `t` in [0, 1], the
 * distance to it and the segment index. An empty table echoes `at`.
 *
 * @category Bounds & hit math
 */
export function closestPointOnTable(table: ArcTable, at: Point): ClosestPoint {
	const points = table.points;
	if (points.length === 0) {
		return { point: { x: at.x, y: at.y }, t: 0, distance: 0, index: 0 };
	}
	if (points.length === 1 || table.total === 0) {
		return {
			point: { ...points[0] },
			t: 0,
			distance: Math.hypot(at.x - points[0].x, at.y - points[0].y),
			index: 0,
		};
	}

	let best: ClosestPoint = {
		point: { ...points[0] },
		t: 0,
		distance: Number.POSITIVE_INFINITY,
		index: 0,
	};

	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const lengthSquared = dx * dx + dy * dy;
		const local =
			lengthSquared === 0
				? 0
				: Math.min(
						1,
						Math.max(
							0,
							((at.x - a.x) * dx + (at.y - a.y) * dy) / lengthSquared,
						),
					);
		const point = { x: a.x + dx * local, y: a.y + dy * local };
		const distance = Math.hypot(at.x - point.x, at.y - point.y);
		if (distance < best.distance) {
			const along =
				table.lengths[i] + (table.lengths[i + 1] - table.lengths[i]) * local;
			best = { point, t: along / table.total, distance, index: i };
		}
	}

	return best;
}

/**
 * {@link closestPointOnTable} for a raw polyline, measuring (and caching) its arc table.
 *
 * @category Bounds & hit math
 */
export function closestPointOnPolyline(
	line: Polyline,
	at: Point,
): ClosestPoint {
	return closestPointOnTable(arcTableFor(line), at);
}

/* ------------------------------------------------------------- constraints */

/**
 * No constraint: the proposed point is used as is. Named so `"free"` can be spelled where a name is expected.
 *
 * @category Interaction
 */
export function free(): DragConstraint {
	return (proposed) => proposed;
}

/**
 * Horizontal only — `y` held at wherever the gesture found it.
 *
 * Held at the *origin's* `y` rather than at the pointer's, so the lock is to
 * where the thing was when it was picked up. Anything else would let a drag
 * that begins with a slight vertical twitch shift the axis it is locked to.
 *
 * @category Interaction
 */
export function axisX(): DragConstraint {
	return (proposed, ctx) => ({ x: proposed.x, y: ctx.origin.y });
}

/**
 * Vertical only — `x` held at wherever the gesture found it. See {@link axisX}.
 *
 * @category Interaction
 */
export function axisY(): DragConstraint {
	return (proposed, ctx) => ({ x: ctx.origin.x, y: proposed.y });
}

/**
 * Onto the line through `through` (the grab point, by default) in direction
 * `v` — `axisX`/`axisY` for any angle, and the constraint a slider's track is.
 *
 * @param v - The line's direction vector (need not be unit length; zero pins the point).
 * @param through - A point on the line, in the node's local units. Defaults to the grab origin.
 *
 * @category Interaction
 */
export function alongDirection(v: Point, through?: Point): DragConstraint {
	const lengthSquared = v.x * v.x + v.y * v.y;
	return (proposed, ctx) => {
		if (lengthSquared === 0) return through ?? ctx.origin;
		const base = through ?? ctx.origin;
		const t =
			((proposed.x - base.x) * v.x + (proposed.y - base.y) * v.y) /
			lengthSquared;
		return { x: base.x + v.x * t, y: base.y + v.y * t };
	};
}

/** @category Interaction */
export interface ClampOptions {
	/**
	 * Half the size of the thing being dragged, so what stays inside the box is
	 * the *shape* rather than its centre. A number is square; a point is the two
	 * half-extents. A circle of radius `r` wants `r`; a `w`×`h` rectangle wants
	 * `{ x: w / 2, y: h / 2 }`.
	 */
	half?: number | Point;
}

/**
 * Keeps the dragged position inside a box, shrunk by the shape's half-extent.
 *
 * A box smaller than the shape pins the position to the box's centre.
 *
 * @param box - The allowed region in the node's local scene units, or a
 * `Readable`/getter for one that moves (it is re-read on every move).
 * @param options - `half`: the shape's half-size so its edge, not its centre,
 * stays inside.
 *
 * @category Interaction
 */
export function toBounds(
	box: BoundsSource,
	options: ClampOptions = {},
): DragConstraint {
	const half = options.half ?? 0;
	return (proposed) => {
		const outer = readBounds(box);
		// `padBounds` for the isotropic case, so a "keep it inside" here and a
		// `surround` in a scene mean the same arithmetic by the same code.
		const inner =
			typeof half === "number"
				? padBounds(outer, -half)
				: {
						minX: outer.minX + half.x,
						maxX: outer.maxX - half.x,
						minY: outer.minY + half.y,
						maxY: outer.maxY - half.y,
					};
		// A box smaller than the shape has no interior left; centring in it is the
		// only stable answer, and it beats the min/max fighting each other.
		const clamp = (value: number, lo: number, hi: number) =>
			lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, value));
		return {
			x: clamp(proposed.x, inner.minX, inner.maxX),
			y: clamp(proposed.y, inner.minY, inner.maxY),
		};
	};
}

/**
 * Keeps the dragged position on screen. Pass the scene's frame as a
 * `Readable` (or a getter) so a resized stage re-clamps without the
 * constraint being rebuilt. It is {@link toBounds} under another name.
 *
 * @param frame - The visible bounds in scene units, normally the scene's frame.
 * @param options - `half`: the shape's half-size, as for {@link toBounds}.
 *
 * @category Interaction
 */
export function inFrame(
	frame: BoundsSource,
	options: ClampOptions = {},
): DragConstraint {
	return toBounds(frame, options);
}

/** @category Interaction */
export interface SnapOptions {
	/** Where the lattice has a vertex, in local units. Defaults to the scene origin. */
	origin?: Point;
	/**
	 * Only snap within this distance, in local units. Without it the value is
	 * always on the lattice; with it the grid is a magnet and everything between
	 * the vertices stays continuous.
	 */
	within?: number;
}

/**
 * Snaps the dragged position to a lattice.
 *
 * @param step - The lattice spacing in local scene units; a number is square, a
 * point is `{ x, y }` spacings. A non-positive spacing leaves that axis free.
 * @param options - `origin` (a lattice vertex) and `within` (magnet radius);
 * see {@link SnapOptions}.
 *
 * @category Interaction
 */
export function snapToGrid(
	step: number | Point,
	options: SnapOptions = {},
): DragConstraint {
	const sx = typeof step === "number" ? step : step.x;
	const sy = typeof step === "number" ? step : step.y;
	const origin = options.origin ?? { x: 0, y: 0 };
	return (proposed) => {
		const snap = (value: number, base: number, size: number) =>
			size > 0 ? base + Math.round((value - base) / size) * size : value;
		const point = {
			x: snap(proposed.x, origin.x, sx),
			y: snap(proposed.y, origin.y, sy),
		};
		if (options.within === undefined) return point;
		const distance = Math.hypot(point.x - proposed.x, point.y - proposed.y);
		return distance <= options.within ? point : proposed;
	};
}

/**
 * A magnet: snaps to the nearest of `points`, but only from within `radius`.
 *
 * The radius is what makes it usable — a snap with unlimited reach is a
 * quantiser, and the feel people want is a value that is free until it is near
 * something, then decisive.
 *
 * @param points - Snap targets in local scene units.
 * @param radius - Reach of each magnet, in local scene units.
 *
 * @category Interaction
 */
export function snapTo(points: Point[], radius: number): DragConstraint {
	return (proposed) => {
		let best: Point | null = null;
		let bestDistance = radius;
		for (const point of points) {
			const distance = Math.hypot(point.x - proposed.x, point.y - proposed.y);
			if (distance <= bestDistance) {
				best = point;
				bestDistance = distance;
			}
		}
		return best ? { ...best } : proposed;
	};
}

/**
 * Pins the dragged position to a circle: each proposed point is projected
 * radially onto it.
 *
 * Dead centre (no direction) maps to the point due east on the circle.
 *
 * @param center - The circle's centre, in the node's local scene units.
 * @param r - Radius in local scene units.
 *
 * @category Interaction
 */
export function onCircle(center: Point, r: number): DragConstraint {
	return (proposed) => {
		const dx = proposed.x - center.x;
		const dy = proposed.y - center.y;
		const length = Math.hypot(dx, dy);
		// Dead centre has no direction to project along; the point due east of the
		// centre is arbitrary but stable, which is what matters for one frame.
		if (length === 0) return { x: center.x + r, y: center.y };
		return { x: center.x + (dx / length) * r, y: center.y + (dy / length) * r };
	};
}

/**
 * Onto the closest point of a polyline — a function graph, a circle sampled as
 * a ring, a streamline. The constraint the maths wants most often.
 *
 * Keeps the *position* as the value; `pathParam` is the same projection keeping
 * the parameter instead. `line` may be a `Readable` or a getter, so the curve
 * can animate under the point being dragged along it.
 *
 * @param line - The polyline to stay on, in the node's local scene units, or a
 * `Readable`/getter for one. An empty line leaves the point unconstrained.
 *
 * @category Interaction
 */
export function alongPath(line: ValueSource<Polyline>): DragConstraint {
	return (proposed) => {
		const points = readSource(line);
		if (points.length === 0) return proposed;
		return closestPointOnTable(arcTableFor(points), proposed).point;
	};
}

/**
 * Applies constraints in order, each receiving the previous one's output.
 * The composition that `draggable`'s array form of `constrain` is sugar for.
 *
 * @param parts - Constraint functions or built-in names.
 * @returns One combined {@link DragConstraint}.
 *
 * @category Interaction
 */
export function chain(...parts: ConstraintSpec[]): DragConstraint {
	const resolved = parts.map((part) => resolveConstraint(part));
	return (proposed, ctx) => {
		let point = proposed;
		for (const part of resolved) if (part) point = part(point, ctx);
		return point;
	};
}

/**
 * The named built-ins. Only the ones that take no arguments can be spelled as a
 * string, which is the same line `easings` draws: a name is sugar for a value,
 * never a parser for one.
 *
 * @category Interaction
 */
export const constraints = Object.freeze({
	free: free(),
	axisX: axisX(),
	axisY: axisY(),
} satisfies Record<string, DragConstraint>);

const constraintResolver = createResolver<DragConstraint>(
	"constraint",
	constraints,
);

/**
 * Turns a constraint spec into a function: a name is looked up, an array is
 * chained, `undefined` or `[]` means none.
 *
 * @returns The constraint, or `null` for no constraint.
 *
 * @category Interaction plumbing
 */
export function resolveConstraint(
	spec: ConstraintSpec | ConstraintSpec[] | undefined,
): DragConstraint | null {
	if (spec === undefined) return null;
	if (Array.isArray(spec)) return spec.length === 0 ? null : chain(...spec);
	return constraintResolver.resolve(spec);
}
