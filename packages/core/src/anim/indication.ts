/**
 * Indication presets — Manim's `Blink`, `FocusOn`, `ShowPassingFlash` and
 * `ApplyWave`.
 *
 * Like the emphasis presets next door, each drives tracks the scene already
 * reads and leaves them at rest when it ends, so it can be fired at any time.
 * `showPassingFlash` is the odd one: a stroke sliver travelling along a path
 * is not a value but a *dash*, so the animation drives a plain 0..1 track and
 * {@link passingFlash} turns that into the stroke's `dash`/`dashOffset`.
 */

import type { Point, Polyline } from "../geometry/index.js";
import type { Animatable } from "../tween/index.js";
import { splitLongEdges } from "./points.js";
import type { Animation, AnimOptions } from "./types.js";
import { driveProgress } from "./types.js";

/** @category Animation presets */
export interface BlinkOptions extends Omit<AnimOptions, "easing"> {
	/**
	 * How many times to blink.
	 * @default 1
	 */
	blinks?: number;
	/**
	 * Seconds shown in each blink.
	 * @default 0.5
	 */
	timeOn?: number;
	/**
	 * Seconds hidden in each blink.
	 * @default 0.5
	 */
	timeOff?: number;
	/**
	 * End hidden rather than shown again.
	 * @default false
	 */
	hideAtEnd?: boolean;
}

/**
 * `Blink`: shown, then hidden, `blinks` times over, then shown again (or left
 * hidden with `hideAtEnd`).
 *
 * The duration is `blinks × (timeOn + timeOff)`; a `duration` given instead
 * rescales both. Opacity snaps rather than fades, so there is no easing.
 *
 * @param opacity - Opacity track; shown means its starting value.
 * @param options - {@link BlinkOptions}.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function blink(
	opacity: Animatable<number>,
	options: BlinkOptions = {},
): Animation {
	const blinks = Math.max(1, Math.floor(options.blinks ?? 1));
	const on = Math.max(0, options.timeOn ?? 0.5);
	const off = Math.max(0, options.timeOff ?? 0.5);
	const cycle = on + off;
	const shownShare = cycle > 0 ? on / cycle : 1;
	let rest = 1;
	return driveProgress(
		(_, raw) => {
			if (raw >= 1) {
				opacity.set(options.hideAtEnd ? 0 : rest);
				return;
			}
			const within = (raw * blinks) % 1;
			opacity.set(within < shownShare ? rest : 0);
		},
		{
			...options,
			duration: options.duration ?? blinks * cycle,
			easing: "linear",
			begin() {
				rest = opacity.peek();
			},
		},
	);
}

/** @category Animation presets */
export interface FocusOnOptions extends AnimOptions {
	/** Radius the spotlight starts at. Defaults to the radius track's value. */
	from?: number;
	/**
	 * Radius it closes to.
	 * @default 0
	 */
	to?: number;
	/**
	 * Opacity it reaches as it closes. The default matches Manim's.
	 * @default 0.2
	 */
	peakOpacity?: number;
}

/**
 * `FocusOn`: a wide, faint disc that closes in on a point, drawing the eye to
 * it. Point it at the radius and opacity of a filled circle centred where the
 * eye should go and start it wide and invisible (say `r = 8`, opacity 0).
 *
 * The radius shrinks from `from` to `to` while the opacity rises from 0 to
 * `peakOpacity`; at the end the disc vanishes and its radius is put back, so
 * it can focus again. Duration defaults to 2 seconds, as Manim's.
 *
 * @param radius - Radius track, scene units.
 * @param opacity - Opacity track, 0..1.
 * @param options - Timing options plus {@link FocusOnOptions}.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function focusOn(
	radius: Animatable<number>,
	opacity: Animatable<number>,
	options: FocusOnOptions = {},
): Animation {
	const peak = options.peakOpacity ?? 0.2;
	let start = 0;
	let end = 0;
	return driveProgress(
		(t, raw) => {
			if (raw >= 1) {
				opacity.set(0);
				radius.set(start);
				return;
			}
			radius.set(start + (end - start) * t);
			opacity.set(peak * t);
		},
		{
			...options,
			duration: options.duration ?? 2,
			begin() {
				start = options.from ?? radius.peek();
				end = options.to ?? 0;
			},
		},
	);
}

/**
 * The stroke props that show a {@link showPassingFlash} at progress `t`:
 * a sliver `width` of the path long, its head at `t` of the way along (plus
 * the sliver, so it enters from nothing and leaves to nothing). Nothing shows
 * at `t = 0` or `t = 1`, which makes those the resting states.
 *
 * Built on the stroke's dash pattern, so it is exact and costs nothing, with
 * two things to know. `length` is the path's arc length in scene units
 * (`measure(points).total` from `@sophistry/core/geometry`). And a dash
 * restarts on each ring of a shape, so on several rings each carries its own
 * flash, measured against the same `length`.
 *
 * @param length - Arc length of the path, scene units.
 * @param t - Progress of the flash, 0..1.
 * @param width - Length of the sliver as a share of the path. Defaults to 0.1, Manim's `time_width`.
 * @returns `dash`, `dashOffset` and `visible`, to pass to the path.
 *
 * @category Animation presets
 */
export function passingFlash(
	length: number,
	t: number,
	width = 0.1,
): { dash: number[]; dashOffset: number; visible: boolean } {
	const sliver = Math.max(0, width) * length;
	const visible = length > 0 && sliver > 0 && t > 0 && t < 1;
	if (!visible) return { dash: [1, 1], dashOffset: 0, visible: false };
	// One dash per period, and the period longer than the path plus the
	// sliver, so only the one dash is ever on it.
	const head = t * (length + sliver);
	return {
		dash: [sliver, length + sliver],
		dashOffset: sliver - head,
		visible,
	};
}

/**
 * `ShowPassingFlash`: a short stretch of stroke runs along a path and off the
 * end. Drives `progress` from 0 to 1; feed it to {@link passingFlash} for the
 * stroke props. Usually drawn over a copy of the path in a highlight colour.
 * Duration 1 second and `"smooth"` easing by default.
 *
 * @param progress - The flash's 0..1 track.
 * @param options - Timing options.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function showPassingFlash(
	progress: Animatable<number>,
	options: AnimOptions = {},
): Animation {
	return driveProgress((t, raw) => progress.set(raw >= 1 ? 1 : t), options);
}

/** @category Animation presets */
export interface ApplyWaveOptions extends AnimOptions {
	/**
	 * Which way the points are pushed. Up by default.
	 * @default `{ x: 0, y: 1 }`
	 */
	direction?: Point;
	/**
	 * Peak displacement, scene units.
	 * @default 0.2
	 */
	amplitude?: number;
	/**
	 * Width of the wave as a share of the shape's extent along its travel.
	 * @default 1
	 */
	timeWidth?: number;
	/**
	 * Humps in the wave, alternating sides.
	 * @default 1
	 */
	ripples?: number;
}

/** Longest edge, as a share of the wave's width, before it is split so the wave can bend it. */
const WAVE_EDGE_SHARE = 1 / 32;

/**
 * `ApplyWave`: a wave runs across a shape, pushing its points sideways and
 * letting them go, so the shape ripples and settles back exactly as it was.
 *
 * The wave travels at right angles to `direction` (left to right for the
 * default up), entering from before the shape and leaving past it. Each hump
 * has a smooth envelope, so the outline never kinks at the wave's edges.
 * Long straight edges are split for the duration so they can bend; the
 * original points come back at the end. After Manim's `ApplyWave`, whose
 * defaults it takes (duration 2 s, linear), though the wave's profile is its
 * own.
 *
 * @param points - Points track of a `path()` or `polygram()`: one polyline or several.
 * @param options - Timing options plus {@link ApplyWaveOptions}.
 * @returns An {@link Animation}.
 * @category Animation presets
 */
export function applyWave<T extends Polyline | Polyline[]>(
	points: Animatable<T>,
	options: ApplyWaveOptions = {},
): Animation {
	const amplitude = options.amplitude ?? 0.2;
	const width = Math.max(1e-6, options.timeWidth ?? 1);
	const ripples = Math.max(1, Math.round(options.ripples ?? 1));
	const raw = options.direction ?? { x: 0, y: 1 };
	const norm = Math.hypot(raw.x, raw.y) || 1;
	const push = { x: raw.x / norm, y: raw.y / norm };
	// Travel is the push turned a quarter clockwise: up pushes, left to right travels.
	const along = { x: push.y, y: -push.x };

	let rest: T = [] as unknown as T;
	let nested = false;
	let rings: Polyline[] = [];
	/** Each point's place along the travel, 0 at the shape's near edge, 1 at its far one. */
	let places: number[][] = [];

	const begin = () => {
		rest = points.peek();
		nested = Array.isArray(rest[0]);
		const source = (nested ? rest : [rest]) as Polyline[];
		const project = (p: Point) => p.x * along.x + p.y * along.y;
		let low = Number.POSITIVE_INFINITY;
		let high = Number.NEGATIVE_INFINITY;
		for (const ring of source)
			for (const p of ring) {
				const u = project(p);
				if (u < low) low = u;
				if (u > high) high = u;
			}
		const extent = high - low;
		rings = splitLongEdges(source, extent * width * WAVE_EDGE_SHARE);
		places = rings.map((ring) =>
			ring.map((p) => (extent > 0 ? (project(p) - low) / extent : 0.5)),
		);
	};

	return driveProgress(
		(t, raw) => {
			if (raw >= 1 || t <= 0) {
				points.set(rest);
				return;
			}
			// The wave's near edge runs from the shape's near edge minus its own
			// width (all of it before the shape) to the far edge (all past it).
			const front = -width + t * (1 + width);
			const waved = rings.map((ring, r) =>
				ring.map((p, i) => {
					const s = (places[r][i] - front) / width;
					if (!(s > 0 && s < 1)) return p;
					const lift =
						amplitude * Math.sin(Math.PI * s) * Math.sin(Math.PI * ripples * s);
					return { x: p.x + push.x * lift, y: p.y + push.y * lift };
				}),
			);
			points.set((nested ? waved : waved[0]) as T);
		},
		{
			...options,
			duration: options.duration ?? 2,
			easing: options.easing ?? "linear",
			begin,
		},
	);
}
