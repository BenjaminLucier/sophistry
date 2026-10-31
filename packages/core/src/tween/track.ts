/**
 * Track helpers over the core's `track` (`reactive/`): the point track that
 * movement animations drive, and a guard telling a writable track from a
 * read-only Readable. A track is Manim's `ValueTracker`, except that anything
 * bound to it follows it without an `always_redraw` wrapper.
 */

import type { Point } from "../geometry";
import type { Track } from "../reactive";
import { isReadable, track } from "../reactive";

/**
 * Creates a track holding a 2D point in scene units; the common case for
 * movement animations such as {@link moveTo}.
 *
 * @example
 * ```ts
 * import { createScene, moveTo, trackPoint } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.querySelector("#figure")! });
 * const position = trackPoint(0, 0);
 * void scene.play(moveTo(position, { x: 3, y: 1 }));
 * ```
 *
 * @param x - Initial x in scene units.
 * @param y - Initial y in scene units.
 * @returns A `Track<Point>`.
 *
 * @category Tracks & clocks
 */
export function trackPoint(x: number, y: number): Track<Point> {
	return track({ x, y });
}

/**
 * Type guard: true for a writable {@link Track} (a {@link Readable} with a
 * `set` method), such as one made by `track` or {@link trackPoint}. A
 * `derive`d value is not a track.
 *
 * @param value - Anything.
 * @returns Whether `value` is a writable track.
 * @category Tracks & clocks
 */
export function isTrack(value: unknown): value is Track<unknown> {
	return (
		isReadable(value) &&
		typeof (value as Partial<Track<unknown>>).set === "function"
	);
}
