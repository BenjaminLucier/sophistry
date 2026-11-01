/**
 * Emphasis presets — `Indicate`, `Flash`, `Wiggle`, `Circumscribe`.
 *
 * These are the ones that are pure easing-curve tricks: each returns the track
 * to exactly where it started, so they can be fired at any time without
 * disturbing the scene's resting state.
 */

import { resolveTheme } from "../themes/theme.js";
import type { Animatable } from "../tween/index.js";
import { auto, thereAndBack, thereAndBackWithPause } from "../tween/index.js";
import { sequence } from "./sequence.js";
import type { Animation, AnimOptions } from "./types.js";
import { driveProgress } from "./types.js";

/** @category Animation presets */
export interface IndicateOptions extends AnimOptions {
	/**
	 * Peak scale multiplier relative to the resting scale.
	 * @default 1.2
	 */
	factor?: number;
	/** Colour track to flash to `highlight` and back; omit for a scale-only swell. */
	color?: Animatable<string>;
	/** CSS colour to flash to. Defaults to the theme's `palette.highlight`. */
	highlight?: string;
}

/**
 * `Indicate`: a quick swell and return, optionally with a colour flash.
 *
 * Scales up to `factor` times the resting scale and back, so the track ends
 * where it began and the animation can be fired at any time. Duration defaults
 * to 0.8 seconds.
 *
 * @param scale - Scale track to swell.
 * @param options - Timing options plus {@link IndicateOptions} fields.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function indicate(
	scale: Animatable<number>,
	options: IndicateOptions = {},
): Animation {
	const factor = options.factor ?? 1.2;
	const duration = options.duration ?? 0.8;
	const curve = thereAndBack();

	let rest = 1;
	let restColor = "";
	let tint: (t: number) => string = () => restColor;
	return driveProgress(
		(t, raw) => {
			scale.set(rest + (rest * factor - rest) * t);
			if (options.color) {
				// Land on the exact original string, not an interpolated rendering of it.
				options.color.set(raw >= 1 ? restColor : tint(t));
			}
		},
		{
			...options,
			duration,
			easing: curve,
			begin() {
				rest = scale.peek();
				if (!options.color) return;
				restColor = options.color.peek();
				tint = auto(
					restColor,
					options.highlight ?? resolveTheme().palette.highlight,
				);
			},
		},
	);
}

/**
 * `Flash`: a ring that expands outward while fading to transparent.
 *
 * Drive a circle whose radius and opacity are these two tracks. Opacity goes
 * from 1 to 0; it is not restored afterwards.
 *
 * @param radius - Radius track in scene units.
 * @param opacity - Opacity track, 0..1.
 * @param options - Timing options (duration 0.6 s, easing `"out"` by
 *   default) plus `from` (start radius, default the track's value) and `to`
 *   (end radius, default 2.2 times the start).
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function flash(
	radius: Animatable<number>,
	opacity: Animatable<number>,
	options: AnimOptions & { to?: number; from?: number } = {},
): Animation {
	const duration = options.duration ?? 0.6;
	let start = 0;
	let end = 0;
	return driveProgress(
		(t) => {
			radius.set(start + (end - start) * t);
			opacity.set(1 - t);
		},
		{
			...options,
			duration,
			easing: options.easing ?? "out",
			begin() {
				start = options.from ?? radius.peek();
				end = options.to ?? start * 2.2;
			},
		},
	);
}

/**
 * `Wiggle`: a damped rotational shake that settles back to rest.
 *
 * @param rotation - Rotation track, radians.
 * @param options - Timing options (duration 0.7 s, linear) plus `amplitude`,
 *   the peak swing in radians (default 0.12), and `cycles`, the number of
 *   oscillations (default 3).
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function wiggle(
	rotation: Animatable<number>,
	options: AnimOptions & { amplitude?: number; cycles?: number } = {},
): Animation {
	const amplitude = options.amplitude ?? 0.12;
	const cycles = options.cycles ?? 3;
	let rest = 0;
	return driveProgress(
		(t) => {
			// Amplitude decays to zero at t=1 so the last frame lands on rest.
			const decay = 1 - t;
			rotation.set(
				rest + Math.sin(t * cycles * Math.PI * 2) * amplitude * decay,
			);
		},
		{
			...options,
			duration: options.duration ?? 0.7,
			easing: "linear",
			begin() {
				rest = rotation.peek();
			},
		},
	);
}

/**
 * A slow breathing pulse; useful as ambient emphasis under {@link forever}.
 *
 * @param scale - Scale track; returns to its starting value.
 * @param options - Timing options (duration 1.6 s) plus `factor`, the peak
 *   multiplier (default 1.06).
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function pulse(
	scale: Animatable<number>,
	options: AnimOptions & { factor?: number } = {},
): Animation {
	const factor = options.factor ?? 1.06;
	let rest = 1;
	return driveProgress((t) => scale.set(rest + (rest * factor - rest) * t), {
		...options,
		duration: options.duration ?? 1.6,
		easing: thereAndBackWithPause(0.1),
		begin() {
			rest = scale.peek();
		},
	});
}

/**
 * `Circumscribe`: draws a highlight shape around something, then erases it.
 *
 * Point it at the progress track of a rectangle or circle you keep hidden. The
 * duration (default 1.2 seconds) is split evenly between drawing and erasing.
 *
 * @param progress - Progress track (0..1) of the highlight shape.
 * @param options - Timing options; `easing` defaults to `"inOut"`.
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function circumscribe(
	progress: Animatable<number>,
	options: AnimOptions = {},
): Animation {
	const duration = options.duration ?? 1.2;
	const { delay, ...rest } = options;
	const half = {
		...rest,
		duration: duration / 2,
		easing: options.easing ?? "inOut",
	};
	// A delay leads the whole animation once, not each half.
	return sequence(
		driveProgress((t) => progress.set(t), { ...half, delay }),
		driveProgress((t) => progress.set(1 - t), half),
	);
}
