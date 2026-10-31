/**
 * Creation animations — `draw` (Manim `Create`), `erase` (`Uncreate`), `write`, `drawBorderThenFill`.
 *
 * All of them drive a shape's `progress` track from 0 to 1; the renderer turns
 * that into an arc-length reveal. A shape's polylines share one budget, spent in
 * order, so a multi-part shape draws part by part rather than all at once.
 */

import type { Animatable } from "../tween";
import { lagged, sequence } from "./sequence";
import type { Animation, AnimOptions } from "./types";
import { driveTrack } from "./types";

/** `lagRatio` wins when given and `lag` is then ignored; otherwise `lag`, defaulting to 0.12 s. */
function lagOptions(lag?: number, lagRatio?: number) {
	return lagRatio !== undefined ? { lagRatio } : { lag: lag ?? 0.12 };
}

/** @category Animation presets */
export interface DrawOptions extends AnimOptions {
	/** Progress (0..1) to reset the track to before drawing; defaults to the track's current value. */
	from?: number;
}

/**
 * Draws a shape on by tweening its `progress` track to 1, tip-first.
 *
 * Bind the track to a shape's `progress` prop; the renderer reveals the
 * outline by arc length. Easing defaults to `"linear"` so the pen moves at a
 * constant speed. Start the track at 0 (or pass `from`) for a full draw-on.
 *
 * @param progress - The shape's progress track, 0..1.
 * @param options - Timing options plus `from`.
 * @returns An {@link Animation}.
 * @see {@link erase}
 * @see {@link write}
 *
 * @category Animation presets
 */
export function draw(
	progress: Animatable<number>,
	options: DrawOptions = {},
): Animation {
	return driveTrack(progress, 1, { easing: "linear", ...options });
}

/**
 * Erases a shape by tweening its `progress` track to 0.
 *
 * @param progress - The shape's progress track, 0..1.
 * @param options - Timing options; `easing` defaults to `"linear"`.
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function erase(
	progress: Animatable<number>,
	options: AnimOptions = {},
): Animation {
	return driveTrack(progress, 0, { easing: "linear", ...options });
}

/**
 * Options for {@link write}: {@link DrawOptions} plus the stagger between tracks.
 *
 * @category Animation presets
 */
export interface WriteOptions extends DrawOptions {
	/**
	 * Seconds between consecutive starts. Ignored when `lagRatio` is given.
	 * @default 0.12
	 */
	lag?: number;
	/** Manim's `lag_ratio`: start each when the previous is this fraction through. Takes precedence over `lag`. */
	lagRatio?: number;
}

/**
 * `Write`: a staggered {@link draw} across several tracks, the way Manim
 * draws one glyph after another.
 *
 * Pass one progress track per stroke or label, in drawing order. Each starts
 * `lag` seconds after the previous one and runs for the full `duration`.
 *
 * @param progresses - One progress track (0..1) per element.
 * @param options - Timing options plus the stagger: `lag`, seconds between starts (default 0.12), or `lagRatio` (see {@link lagged}). If both are given, `lagRatio` wins and `lag` is ignored.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function write(
	progresses: Animatable<number>[],
	options: WriteOptions = {},
): Animation {
	const { lag, lagRatio, ...rest } = options;
	return lagged(
		progresses.map((progress) => draw(progress, rest)),
		lagOptions(lag, lagRatio),
	);
}

/** @category Animation presets */
export interface UnwriteOptions extends AnimOptions {
	/**
	 * Seconds between consecutive starts. Ignored when `lagRatio` is given.
	 * @default 0.12
	 */
	lag?: number;
	/** Manim's `lag_ratio`: start each when the previous is this fraction through; takes precedence over `lag`. */
	lagRatio?: number;
	/**
	 * Erase from the end backwards, as Manim's `Unwrite` does. Writing runs left
	 * to right, so unwriting the same way looks like the text is being eaten
	 * from the front; going backwards reads as undoing it. Defaults to true.
	 */
	reverse?: boolean;
}

/**
 * `Unwrite` — `write` in reverse: a staggered `erase` across several tracks.
 *
 * The stagger runs from the last track to the first by default, so the stroke
 * that was drawn last is the first to go.
 *
 * @category Animation presets
 */
export function unwrite(
	progresses: Animatable<number>[],
	options: UnwriteOptions = {},
): Animation {
	const { lag, lagRatio, reverse, ...rest } = options;
	const order = reverse === false ? progresses : [...progresses].reverse();
	return lagged(
		order.map((progress) => erase(progress, rest)),
		lagOptions(lag, lagRatio),
	);
}

/**
 * `DrawBorderThenFill`: traces the outline, then fades the fill in.
 *
 * The total `duration` (default 1.5 seconds) is split 65% on the outline and
 * 35% on the fill. Bind the tracks to a shape's `progress` and `fillOpacity`.
 *
 * @param progress - Outline progress track, 0..1.
 * @param fillOpacity - Fill opacity track, 0..1.
 * @param options - Timing options plus `fillTo`, the final fill opacity (default 1).
 * @returns An {@link Animation}.
 *
 * @category Animation presets
 */
export function drawBorderThenFill(
	progress: Animatable<number>,
	fillOpacity: Animatable<number>,
	options: AnimOptions & { fillTo?: number } = {},
): Animation {
	const duration = options.duration ?? 1.5;
	const { delay, ...rest } = options;
	return sequence(
		draw(progress, { ...rest, delay, duration: duration * 0.65 }),
		driveTrack(fillOpacity, options.fillTo ?? 1, {
			...rest,
			duration: duration * 0.35,
			easing: options.easing ?? "out",
		}),
	);
}
