/**
 * Movement presets: tween the position, rotation, scale and colour tracks a
 * component reads (no `.animate` proxy). `valueTo` is the base case;
 * `rotateTo` and `scaleTo` forward to it, and `moveTo` and `colorTo` call
 * `driveTrack` with the matching `resolveInterpolator` entry.
 */

import type { ColorSpace } from "../color";
import type { Point, Polyline } from "../geometry";
import { measure, pointAtT } from "../geometry";
import { pathAlongArc } from "../geometry/lerp";
import type { Animatable, Interpolator } from "../tween";
import { resolveInterpolator } from "../tween";
import { cssColorInterpolator } from "../tween/interpolators";
import type { Animation, AnimOptions } from "./types";
import { driveProgress, driveTrack } from "./types";

/**
 * Tweens a position track to an absolute point, in scene units.
 *
 * The start is captured when the animation is entered, so it works after earlier moves.
 * The point travels in a straight line, or along an arc with `pathArc`.
 *
 * @param position - Position track, e.g. from {@link trackPoint}.
 * @param to - Destination in scene units.
 * @param options - Timing options plus {@link MoveOptions}.
 * @returns An {@link Animation}.
 * @see {@link moveBy}
 * @see {@link moveAlong}
 *
 * @category Animation presets
 */
export function moveTo(
	position: Animatable<Point>,
	to: Point,
	options: MoveOptions = {},
): Animation {
	return driveTrack(position, to, {
		...options,
		interpolate: pointPath(options.pathArc),
	});
}

/** @category Animation presets */
export interface MoveOptions extends AnimOptions {
	/**
	 * Travel along an arc turning through this many radians instead of a
	 * straight line: Manim's `path_arc` (see `pathAlongArc`). Positive is
	 * counter-clockwise. Defaults to 0, straight.
	 */
	pathArc?: number;
}

/** The straight point interpolator, or the arc one for a non-zero `pathArc`. */
function pointPath(
	pathArc: number | undefined,
): Interpolator<Point> | undefined {
	if (!pathArc) return resolveInterpolator("point");
	const path = pathAlongArc(pathArc);
	return (a, b) => (t) => path(a, b, t);
}

/**
 * Tweens a position track by a relative offset from wherever it is when the
 * animation starts.
 *
 * @param position - Position track.
 * @param delta - Offset in scene units.
 * @param options - Timing options plus {@link MoveOptions}.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function moveBy(
	position: Animatable<Point>,
	delta: Point,
	options: MoveOptions = {},
): Animation {
	return driveTrack(
		position,
		(from) => ({ x: from.x + delta.x, y: from.y + delta.y }),
		{
			...options,
			interpolate: pointPath(options.pathArc),
		},
	);
}

/**
 * Moves a position track along a polyline at constant speed.
 *
 * An arc-length table keeps the speed even along curves. Easing defaults to
 * `"linear"` (unlike most presets) so the speed stays constant.
 *
 * @param position - Position track written along the path.
 * @param path - Polyline in scene units.
 * @param options - Timing options; `reverse` runs the path end to start.
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function moveAlong(
	position: Animatable<Point>,
	path: Polyline,
	options: AnimOptions & { reverse?: boolean } = {},
): Animation {
	const table = measure(path);
	return driveProgress(
		(t) => position.set(pointAtT(table, options.reverse ? 1 - t : t)),
		{ easing: "linear", ...options },
	);
}

/**
 * Tweens a plain number track; the direct `ValueTracker` analogue.
 *
 * This is the shared body behind {@link rotateTo}, {@link scaleTo} and
 * {@link fadeTo}. Use it for any numeric signal (a parameter, an angle, a
 * progress value).
 *
 * @param value - Number track.
 * @param to - Target value, or a function from the start value to the target.
 * @param options - Timing options.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function valueTo(
	value: Animatable<number>,
	to: number | ((from: number) => number),
	options: AnimOptions = {},
): Animation {
	return driveTrack(value, to, {
		...options,
		interpolate: resolveInterpolator("number"),
	});
}

/**
 * Tweens a rotation track to an absolute angle in radians.
 *
 * @param rotation - Rotation track, radians.
 * @param radians - Target angle in radians.
 * @param options - Timing options.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function rotateTo(
	rotation: Animatable<number>,
	radians: number,
	options: AnimOptions = {},
): Animation {
	return valueTo(rotation, radians, options);
}

/**
 * Tweens a rotation track by a relative angle in radians from its value at
 * entry.
 *
 * @param rotation - Rotation track, radians.
 * @param radians - Amount to add, in radians.
 * @param options - Timing options.
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function rotateBy(
	rotation: Animatable<number>,
	radians: number,
	options: AnimOptions = {},
): Animation {
	return valueTo(rotation, (from) => from + radians, options);
}

/**
 * Tweens a scale track to an absolute factor (1 is natural size).
 *
 * @param scale - Scale track.
 * @param factor - Target scale factor.
 * @param options - Timing options.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function scaleTo(
	scale: Animatable<number>,
	factor: number,
	options: AnimOptions = {},
): Animation {
	return valueTo(scale, factor, options);
}

/**
 * Tweens a colour track (any CSS colour string) to `to`.
 *
 * Interpolates in `colorSpace` (default `"rgb"`); `"oklch"` avoids a grey
 * midpoint between distant hues.
 *
 * @param color - Colour track holding a CSS colour string.
 * @param to - Target CSS colour.
 * @param options - Timing options plus `colorSpace`, the colour space to blend in.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function colorTo(
	color: Animatable<string>,
	to: string,
	options: AnimOptions & { colorSpace?: ColorSpace } = {},
): Animation {
	const { colorSpace, ...rest } = options;
	return driveTrack(color, to, {
		...rest,
		interpolate: cssColorInterpolator(colorSpace),
	});
}
