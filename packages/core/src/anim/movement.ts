/**
 * Point-map presets — Manim's `Homotopy`, `ApplyPointwiseFunction` and
 * `ApplyComplexFunction`. Each drives a points track (one polyline or
 * several) by sending every point somewhere: along a family of maps over
 * time, or straight (or round an arc) to its image under one map.
 *
 * A non-linear map bends the space *between* two vertices too, which a
 * polyline cannot show with the vertices it has: a square through `z²` with
 * four corners comes out a smaller square, not the curved shape it should
 * be. So long edges are split first (`points.ts`), finely enough to bend:
 * by default into pieces of a sixty-fourth of the shape's size. Linear maps
 * need none of this; `linearTransform()` does those exactly and for free.
 */

import type { Point, Polyline } from "../geometry";
import type { Complex } from "../geometry/complex";
import type { PointPath } from "../geometry/lerp";
import { pathAlongArc } from "../geometry/lerp";
import type { Animatable } from "../tween";
import { asRings, extentOf, splitLongEdges } from "./points";
import type { Animation, AnimOptions } from "./types";
import { driveProgress } from "./types";

/** Default split length, as a share of the shape's larger side. */
const SPLIT_SHARE = 1 / 64;

/** @category Animation presets */
export interface PointMapOptions extends AnimOptions {
	/**
	 * Longest edge to keep before the map is applied, in scene units: longer
	 * ones are split so the map can bend them. Defaults to a sixty-fourth of
	 * the shape's larger side; 0 splits nothing.
	 */
	segmentLength?: number;
}

/** The track's rings at entry, split finely enough for a map to bend them. */
function prepare<T extends Polyline | Polyline[]>(
	value: T,
	segmentLength: number | undefined,
) {
	const { rings, wrap } = asRings(value);
	const step = segmentLength ?? extentOf(rings) * SPLIT_SHARE;
	return { rings: splitLongEdges(rings, step), wrap };
}

/**
 * `Homotopy`: moves every point of a shape through a family of maps,
 * `h(point, t)` for `t` from 0 to 1, so the shape flows through whatever
 * shapes the family passes through. `h(p, 0)` should be `p`; the shape's own
 * points are written back when the animation is rewound to its start, and it
 * ends at `h(p, 1)`.
 *
 * Duration defaults to 3 seconds, as Manim's.
 *
 * @param points - Points track of a `path()` or `polygram()`: one polyline or several.
 * @param h - Where point `p` is at time `t`, 0..1.
 * @param options - Timing options plus {@link PointMapOptions}.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function homotopy<T extends Polyline | Polyline[]>(
	points: Animatable<T>,
	h: (point: Point, t: number) => Point,
	options: PointMapOptions = {},
): Animation {
	let rest = points.peek();
	let prepared = prepare(rest, options.segmentLength);
	return driveProgress(
		(t) => {
			if (t <= 0) {
				points.set(rest);
				return;
			}
			points.set(
				prepared.wrap(prepared.rings.map((ring) => ring.map((p) => h(p, t)))),
			);
		},
		{
			...options,
			duration: options.duration ?? 3,
			begin() {
				rest = points.peek();
				prepared = prepare(rest, options.segmentLength);
			},
		},
	);
}

/** @category Animation presets */
export interface ApplyFunctionOptions extends PointMapOptions {
	/**
	 * Carry each point to its image along an arc turning through this many
	 * radians (see `pathAlongArc`) instead of a straight line. Defaults to 0.
	 */
	pathArc?: number;
}

/** Each point from where it is to `targets[r][i]`, along `path`. */
function towardImages<T extends Polyline | Polyline[]>(
	points: Animatable<T>,
	map: (p: Point) => Point,
	pathArc: () => number,
	options: PointMapOptions,
): Animation {
	let rest = points.peek();
	let prepared = prepare(rest, options.segmentLength);
	let targets: Polyline[] = [];
	let path: PointPath = pathAlongArc(0);
	return driveProgress(
		(t) => {
			if (t <= 0) {
				points.set(rest);
				return;
			}
			points.set(
				prepared.wrap(
					prepared.rings.map((ring, r) =>
						ring.map((p, i) =>
							t >= 1 ? targets[r][i] : path(p, targets[r][i], t),
						),
					),
				),
			);
		},
		{
			...options,
			begin() {
				rest = points.peek();
				prepared = prepare(rest, options.segmentLength);
				targets = prepared.rings.map((ring) => ring.map(map));
				path = pathAlongArc(pathArc());
			},
		},
	);
}

/**
 * `ApplyPointwiseFunction`: sends every point of a shape to its image under
 * `f`, each along a straight line (or an arc, with `pathArc`), and leaves it
 * there. For a linear `f`, `linearTransform()` is exact and cheaper.
 *
 * @param points - Points track of a `path()` or `polygram()`: one polyline or several.
 * @param f - Where each point goes, scene units in and out.
 * @param options - Timing options plus {@link ApplyFunctionOptions}.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function applyFunction<T extends Polyline | Polyline[]>(
	points: Animatable<T>,
	f: (point: Point) => Point,
	options: ApplyFunctionOptions = {},
): Animation {
	return towardImages(points, f, () => options.pathArc ?? 0, options);
}

/**
 * `ApplyComplexFunction`: the plane as the complex numbers (x is the real
 * part, y the imaginary), and every point of a shape sent to `f(z)`. As in
 * Manim, each point travels along an arc turning through the argument of
 * `f(1)`, so a map that rotates (`z·i`, say) is seen to rotate rather than
 * cut straight across; pass `pathArc` to choose.
 *
 * The points are in the shape's own scene units: draw the shape at the
 * scale you want the plane read at, or inside a `complexPlane()`'s
 * coordinates by mapping through its `numberToPoint`/`pointToNumber` yourself.
 *
 * @param points - Points track of a `path()` or `polygram()`: one polyline or several.
 * @param f - The complex function.
 * @param options - Timing options plus {@link ApplyFunctionOptions}.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function applyComplexFunction<T extends Polyline | Polyline[]>(
	points: Animatable<T>,
	f: (z: Complex) => Complex,
	options: ApplyFunctionOptions = {},
): Animation {
	const map = (p: Point): Point => {
		const w = f({ re: p.x, im: p.y });
		return { x: w.re, y: w.im };
	};
	return towardImages(
		points,
		map,
		() => {
			if (options.pathArc !== undefined) return options.pathArc;
			const one = f({ re: 1, im: 0 });
			const angle = Math.atan2(one.im, one.re);
			return Number.isFinite(angle) ? angle : 0;
		},
		options,
	);
}

/** @category Animation presets */
export interface PhaseFlowOptions extends PointMapOptions {
	/**
	 * How long each point flows for, in the field's own time units: the flow
	 * covers `virtualTime` whatever the animation's `duration`. Defaults to
	 * 1, as Manim's.
	 */
	virtualTime?: number;
	/**
	 * Integration steps over the whole flow (RK4).
	 * @default 64
	 */
	steps?: number;
}

/** One RK4 step of `f` from `p` over `h`. */
function rk4(f: (p: Point) => Point, p: Point, h: number): Point {
	const k1 = f(p);
	const k2 = f({ x: p.x + (h / 2) * k1.x, y: p.y + (h / 2) * k1.y });
	const k3 = f({ x: p.x + (h / 2) * k2.x, y: p.y + (h / 2) * k2.y });
	const k4 = f({ x: p.x + h * k3.x, y: p.y + h * k3.y });
	return {
		x: p.x + (h / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
		y: p.y + (h / 6) * (k1.y + 2 * k2.y + 2 * k3.y + k4.y),
	};
}

/**
 * `PhaseFlow`: every point of a shape flows along the vector field `f` for
 * `virtualTime`, as a particle dropped there would, and the shape is carried
 * with it: the phase portrait of a system acting on a whole region at once.
 * `f` is in the shape's own scene units, point in and velocity out, like
 * `streamLines()`' field outside a coordinate system.
 *
 * Each point's path is integrated once when the animation is entered (RK4,
 * `steps` steps) and sampled after that, so a frame costs a lookup per
 * point and scrubbing is exact. A point whose path leaves the finite numbers
 * stays where it last was. Easing defaults to `"linear"`, so the flow runs
 * at the field's own pace, as in Manim.
 *
 * @param points - Points track of a `path()` or `polygram()`: one polyline or several.
 * @param f - The field: the velocity at each point.
 * @param options - Timing options plus {@link PhaseFlowOptions}.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function phaseFlow<T extends Polyline | Polyline[]>(
	points: Animatable<T>,
	f: (point: Point) => Point,
	options: PhaseFlowOptions = {},
): Animation {
	const steps = Math.max(1, Math.round(options.steps ?? 64));
	const virtualTime = options.virtualTime ?? 1;
	let rest = points.peek();
	let wrap = asRings(rest).wrap;
	/** Per ring, per point, its position at each of `steps + 1` times. */
	let paths: Point[][][] = [];
	return driveProgress(
		(t) => {
			if (t <= 0) {
				points.set(rest);
				return;
			}
			const at = Math.min(1, t) * steps;
			const i = Math.min(steps - 1, Math.floor(at));
			const k = at - i;
			points.set(
				wrap(
					paths.map((ring) =>
						ring.map((path) => ({
							x: path[i].x + (path[i + 1].x - path[i].x) * k,
							y: path[i].y + (path[i + 1].y - path[i].y) * k,
						})),
					),
				),
			);
		},
		{
			...options,
			easing: options.easing ?? "linear",
			begin() {
				rest = points.peek();
				const prepared = prepare(rest, options.segmentLength);
				wrap = prepared.wrap;
				const h = virtualTime / steps;
				paths = prepared.rings.map((ring) =>
					ring.map((start) => {
						const path: Point[] = [start];
						let p = start;
						for (let s = 0; s < steps; s++) {
							const next = rk4(f, p, h);
							if (Number.isFinite(next.x) && Number.isFinite(next.y)) p = next;
							path.push(p);
						}
						return path;
					}),
				);
			},
		},
	);
}
