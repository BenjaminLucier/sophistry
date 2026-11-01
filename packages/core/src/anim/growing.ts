/**
 * Growing presets (Manim's `growing`): bring a shape in by scale rather than by
 * arc length. The rest value is captured on entry (`peek`), the start state is
 * held through `delay`, and an aborted grow snaps back to rest so a cancelled
 * script never leaves a shape half-size or invisible.
 */

import type { Bounds, Point } from "../geometry/index.js";
import { pointOnBounds } from "../geometry/index.js";
import type { Animatable } from "../tween/index.js";
import { resolveInterpolator } from "../tween/index.js";
import { parallel } from "./sequence.js";
import type { Animation, AnimOptions } from "./types.js";
import { driveTrack } from "./types.js";

/** Manim grows over about a second, easing out of the pop. */
const DEFAULT_DURATION = 1;

/**
 * Wraps `inner` so that aborting it snaps every track in `tracks` back to the
 * value it had when the animation was entered.
 */
function settling(
	inner: Animation,
	tracks: (Animatable<number> | Animatable<Point>)[],
	capture?: () => void,
): Animation {
	let snaps: (() => void)[] = [];
	return {
		duration: inner.duration,
		begin() {
			capture?.();
			snaps = (tracks as Animatable<unknown>[]).map((track) => {
				const rest = track.peek();
				return () => track.set(rest);
			});
			inner.begin?.();
		},
		seek: (t) => inner.seek(t),
		// Restoring keeps the captured rest value (see `Animation.restore`): the
		// tracks now hold the start state, which must not be recaptured as rest.
		restore: () => inner.restore?.(),
		abort() {
			inner.abort?.();
			for (const snap of snaps) snap();
		},
	};
}

/**
 * `GrowFromCenter` — the shape swells from nothing about its own centre.
 *
 * Drives a scale track from 0 to wherever it was resting. The component's
 * `origin` decides what "centre" means; left unset that is the shape's own
 * bounding-box centre, which is exactly Manim's behaviour.
 *
 * This is also Manim's `GrowArrow`: set `origin={tail}` on an `arrow()` and the
 * scale track pivots on the tail. It inflates a small complete arrow, head and
 * all, where `draw()` draws a full-size one progressively.
 *
 * @param scale - Scale track; its value when the animation is entered is the resting scale.
 * @param options - Timing options; duration 1 s and easing `"out"` by default.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function growFromCenter(
	scale: Animatable<number>,
	options: AnimOptions = {},
): Animation {
	return settling(
		driveTrack(scale, (rest) => rest, {
			duration: DEFAULT_DURATION,
			easing: "out",
			...options,
			from: 0,
		}),
		[scale],
	);
}

/**
 * `ShrinkToCenter`: the inverse of {@link growFromCenter}; the scale collapses
 * to 0.
 *
 * @param scale - Scale track.
 * @param options - Timing options; duration 1 s and easing `"in"` by default.
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function shrinkToCenter(
	scale: Animatable<number>,
	options: AnimOptions = {},
): Animation {
	// No settling tail: ending small *is* the intent, so an abort that leaves it
	// part-way is a shape mid-shrink rather than a shape that lost its size.
	return driveTrack(scale, 0, {
		duration: DEFAULT_DURATION,
		easing: "in",
		...options,
	});
}

/**
 * `GrowFromPoint` — the shape grows while travelling from `from` to its resting
 * position, so it reads as having been thrown from somewhere.
 *
 * Built the same way as `fadeInFrom`: displace first, then tween both tracks
 * back together. Because both resting values are captured on entry, this
 * composes with layout — the shape lands wherever it would have been anyway.
 *
 * @param scale - Scale track.
 * @param position - Position track in scene units.
 * @param from - Scene-space point the shape starts at.
 * @param options - Timing options; duration 1 s and easing `"out"` by default.
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function growFromPoint(
	scale: Animatable<number>,
	position: Animatable<Point>,
	from: Point,
	options: AnimOptions = {},
): Animation {
	return growFrom(scale, position, () => ({ ...from }), options);
}

/**
 * Manim's `GrowFromEdge`: the shape unfolds from one edge or corner of its own
 * box, which stays pinned. Any direction works (`{ x: 0.5, y: 1 }` is a point
 * along the top edge). Pass the shape's resting box, `handle()?.localBounds()`.
 *
 * @param scale - Scale track.
 * @param position - Position track.
 * @param bounds - The shape's resting box, in the shape's local coordinates.
 * @param direction - Anchor on the box, e.g. `{ x: -1, y: 0 }` for the left edge.
 * @param options - Timing options; duration 1 s and easing `"out"` by default.
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function growFromEdge(
	scale: Animatable<number>,
	position: Animatable<Point>,
	bounds: Bounds,
	direction: Point,
	options: AnimOptions = {},
): Animation {
	// The start point is computed on entry from the then-current rest values.
	return growFrom(
		scale,
		position,
		(restPosition, restScale) => {
			const anchor = pointOnBounds(bounds, direction);
			const centre = pointOnBounds(bounds, ORIGIN_DIRECTION);
			return {
				x: restPosition.x + restScale * (anchor.x - centre.x),
				y: restPosition.y + restScale * (anchor.y - centre.y),
			};
		},
		options,
	);
}

/**
 * Shared body of the point and edge grows: scale from 0 and position from
 * `start(restPosition, restScale)` back to rest, snapping back if aborted.
 */
function growFrom(
	scale: Animatable<number>,
	position: Animatable<Point>,
	start: (restPosition: Point, restScale: number) => Point,
	options: AnimOptions,
): Animation {
	const shared: AnimOptions = {
		duration: DEFAULT_DURATION,
		easing: "out",
		...options,
	};
	// The position start needs the scale's rest value, but the scale leaf
	// writes 0 as soon as it is entered (before the position leaf is), so
	// capture the rest scale before either runs.
	let restScale = 1;
	return settling(
		parallel(
			driveTrack(scale, (rest) => rest, { ...shared, from: 0 }),
			driveTrack(position, (rest) => rest, {
				...shared,
				from: (rest) => start(rest, restScale),
				interpolate: resolveInterpolator("point"),
			}),
		),
		[scale, position],
		() => {
			restScale = scale.peek();
		},
	);
}

/** The centre of a box, as a direction. Local so `anim/` needn't import `scene/`. */
const ORIGIN_DIRECTION: Point = { x: 0, y: 0 };

/** @category Animation presets */
export interface SpinInOptions extends AnimOptions {
	/**
	 * Turn to arrive through, in radians. Defaults to Manim's quarter turn.
	 * @default Math.PI / 2
	 */
	turn?: number;
}

/**
 * `SpinInFromNothing` — grows while rotating into place.
 *
 * The rotation *ends* at rest, so the shape settles at whatever angle the scene
 * had it; only the approach spins. Both tracks are driven together, so easing
 * applies to the pair and the spin can't outrun the growth.
 *
 * @param scale - Scale track.
 * @param rotation - Rotation track, radians.
 * @param options - Timing options plus `turn`; duration 1 s and easing `"out"` by default.
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function spinInFromNothing(
	scale: Animatable<number>,
	rotation: Animatable<number>,
	options: SpinInOptions = {},
): Animation {
	const turn = options.turn ?? Math.PI / 2;
	const shared: AnimOptions = {
		duration: DEFAULT_DURATION,
		easing: "out",
		...options,
	};
	return settling(
		parallel(
			driveTrack(scale, (rest) => rest, { ...shared, from: 0 }),
			driveTrack(rotation, (rest) => rest, {
				...shared,
				from: (rest) => rest - turn,
			}),
		),
		[scale, rotation],
	);
}
