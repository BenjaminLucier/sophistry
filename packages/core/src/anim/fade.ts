/**
 * Fades. The whole category is one opacity tween, plus optional drift so
 * `FadeIn(shift=UP)` has an equivalent.
 */

import type { Point } from "../geometry";
import type { Animatable } from "../tween";
import { resolveInterpolator } from "../tween";
import { valueTo } from "./move";
import { parallel } from "./sequence";
import type { Animation, AnimOptions } from "./types";
import { driveTrack } from "./types";

/** @category Animation presets */
export interface FadeOptions extends AnimOptions {
	/**
	 * Opacity (0..1) that `fadeIn` ends on.
	 * @default 1
	 */
	to?: number;
}

/**
 * Tweens an opacity track up to 1 (or `options.to`), easing out.
 *
 * It does not set the track to 0 first: the fade starts from the track's
 * current value, so initialise the track to 0 for a fade from invisible.
 *
 * @param opacity - Opacity track, 0..1; pass `opacity()` to a shape's `opacity` prop.
 * @param options - Timing options; `easing` defaults to `"out"`.
 * @returns An {@link Animation}.
 * @see {@link fadeOut}
 * @see {@link fadeInFrom}
 *
 * @category Animation presets
 */
export function fadeIn(
	opacity: Animatable<number>,
	options: FadeOptions = {},
): Animation {
	return valueTo(opacity, options.to ?? 1, { easing: "out", ...options });
}

/**
 * Tweens an opacity track down to 0, easing in.
 *
 * @param opacity - Opacity track, 0..1.
 * @param options - Timing options; `easing` defaults to `"in"`.
 * @returns An {@link Animation}.
 * @see {@link fadeIn}
 *
 * @category Animation presets
 */
export function fadeOut(
	opacity: Animatable<number>,
	options: AnimOptions = {},
): Animation {
	return valueTo(opacity, 0, { easing: "in", ...options });
}

/**
 * Tweens an opacity track to an arbitrary value.
 *
 * Identical to {@link valueTo}; it exists so "fade to half" reads naturally
 * beside `fadeIn`/`fadeOut`. Easing defaults to `"smooth"`.
 *
 * @param opacity - Opacity track, 0..1.
 * @param value - Target opacity.
 * @param options - Timing options.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function fadeTo(
	opacity: Animatable<number>,
	value: number,
	options: AnimOptions = {},
): Animation {
	return valueTo(opacity, value, options);
}

/**
 * `FadeIn(shift=...)`: fades in while sliding from an offset back to rest.
 *
 * When entered, the position is displaced by `offset` (and held there through
 * any `delay`) and then tweened back to where it was, so the track ends where
 * it started and composes with layout.
 *
 * @param opacity - Opacity track, 0..1.
 * @param position - Position track in scene units.
 * @param offset - Displacement in scene units to start from (e.g. `{ x: 0, y: -1 }`).
 * @param options - Timing options; `easing` defaults to `"out"`.
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function fadeInFrom(
	opacity: Animatable<number>,
	position: Animatable<Point>,
	offset: Point,
	options: FadeOptions = {},
): Animation {
	return parallel(
		fadeIn(opacity, options),
		driveTrack(position, (rest) => rest, {
			easing: "out",
			...options,
			from: (rest) => ({ x: rest.x + offset.x, y: rest.y + offset.y }),
			interpolate: resolveInterpolator("point"),
		}),
	);
}

/**
 * `FadeOut(shift=...)`: fades out while drifting away by `offset`.
 *
 * @param opacity - Opacity track, 0..1.
 * @param position - Position track in scene units; ends at its start plus `offset`.
 * @param offset - Displacement in scene units.
 * @param options - Timing options; `easing` defaults to `"in"`.
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function fadeOutTo(
	opacity: Animatable<number>,
	position: Animatable<Point>,
	offset: Point,
	options: AnimOptions = {},
): Animation {
	return parallel(
		fadeOut(opacity, options),
		driveTrack(
			position,
			(from) => ({ x: from.x + offset.x, y: from.y + offset.y }),
			{
				easing: "in",
				...options,
				interpolate: resolveInterpolator("point"),
			},
		),
	);
}
