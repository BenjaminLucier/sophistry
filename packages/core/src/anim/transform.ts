/**
 * Transform / morph: animation presets over `geometry/morph.ts`'s strategies.
 * `morph` for one polyline, `morphCurve` for one native curve, `morphPath`
 * for SVG shapes of many rings (holes, separate pieces), and `morphWith` to
 * replay a prebuilt interpolator.
 */

import type { CurvePath, Polyline } from "../geometry/index.js";
import type {
	MorphInterpolator,
	RingsInterpolator,
} from "../geometry/morph.js";
import {
	morphCurvePaths,
	morphPathData,
	morphPolylines,
} from "../geometry/morph.js";
import type { Animatable } from "../tween/index.js";
import type { Animation, AnimOptions } from "./types.js";
import { driveProgress } from "./types.js";

/** @category Animation presets */
export interface MorphOptions extends AnimOptions {
	/** Aligns ring correspondence so closed shapes don't spin en route. Pass `true` for polygons and circles. */
	closed?: boolean;
	/** Vertex count of the interpolated result (the geometry layer picks a default when omitted). */
	samples?: number;
	/**
	 * Carry every point along an arc turning through this many radians,
	 * instead of a straight line: Manim's `path_arc`. `Math.PI` is
	 * `CounterclockwiseTransform`, `-Math.PI` is `ClockwiseTransform`.
	 * Defaults to 0, straight.
	 */
	pathArc?: number;
}

/**
 * Morphs a polyline track into another polyline.
 *
 * The two shapes may have different vertex counts; they are resampled to a
 * common count first. The interpolator is built once when the animation is entered from
 * the track's current value, then sampled per frame, so every frame is a
 * fresh polyline written to the track.
 *
 * @param points - Polyline track to drive.
 * @param to - Target polyline in scene units.
 * @param options - Timing options plus `closed`, `samples` and `pathArc`.
 * @returns An {@link Animation}.
 * @see {@link morphCurve}
 * @see {@link morphPath}
 *
 * @category Animation presets
 */
export function morph(
	points: Animatable<Polyline>,
	to: Polyline,
	options: MorphOptions = {},
): Animation {
	let interpolator: MorphInterpolator = () => points.peek();
	return driveProgress((t) => points.set(interpolator(t)), {
		...options,
		begin() {
			interpolator = morphPolylines(points.peek(), to, {
				closed: options.closed,
				samples: options.samples,
				pathArc: options.pathArc,
			});
		},
	});
}

/**
 * Morphs a `CurvePath` track into another by lerping control points directly.
 *
 * The curve-native counterpart of {@link morph}: every intermediate frame
 * stays an exact bezier rather than a resampled polyline.
 *
 * @param curve - Curve track to drive.
 * @param to - Target curve in scene units.
 * @param options - Timing options.
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function morphCurve(
	curve: Animatable<CurvePath>,
	to: CurvePath,
	options: AnimOptions = {},
): Animation {
	let from: CurvePath = curve.peek();
	return driveProgress((t) => curve.set(morphCurvePaths(from, to, t)), {
		...options,
		begin() {
			from = curve.peek();
		},
	});
}

/**
 * Morphs one SVG shape into another and writes the in-between rings into a
 * track, for a closed `path()`'s `points`.
 *
 * The two shapes may differ in every way a path can: vertex counts, curves,
 * holes, the number of separate pieces. Rings are paired outline with
 * outline and hole with hole, so holes stay holes; a ring with no partner
 * grows from a point or shrinks to one. See `morphPathData`.
 *
 * @param rings - Track of rings to drive.
 * @param from - SVG path data to start from.
 * @param to - SVG path data to end on.
 * @param options - Timing options plus `tolerance`, the flattening budget for
 *   curves, and `pathArc` (see {@link MorphOptions}).
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function morphPath(
	rings: Animatable<Polyline[]>,
	from: string,
	to: string,
	options: AnimOptions & { tolerance?: number; pathArc?: number } = {},
): Animation {
	let interpolator: RingsInterpolator = () => rings.peek();
	return driveProgress((t) => rings.set(interpolator(t)), {
		...options,
		begin() {
			interpolator = morphPathData(from, to, {
				tolerance: options.tolerance,
				pathArc: options.pathArc,
			});
		},
	});
}

/**
 * Drives a polyline track from a prebuilt morph interpolator.
 *
 * Reuse one interpolator across replays to skip the setup cost {@link morph}
 * pays on every entry. Unlike `morph`, it does not read the track's
 * current value.
 *
 * @param points - Polyline track to drive.
 * @param interpolator - Maps progress 0..1 to a polyline.
 * @param options - Timing options.
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function morphWith(
	points: Animatable<Polyline>,
	interpolator: MorphInterpolator,
	options: AnimOptions = {},
): Animation {
	return driveProgress((t) => points.set(interpolator(t)), options);
}
