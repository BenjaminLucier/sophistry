/**
 * Colour ramps: a list of stops read as one continuous 0..1 scale, interpolated
 * through `colorInterpolator` (RGB by default, `colorSpace: "oklch"` on request).
 */

import {
	type ColorInput,
	type ColorSpace,
	colorInterpolator,
	cssColor,
	parseColor,
	toCss,
} from "../color";

/**
 * Options for {@link colorRamp}.
 *
 * @category Colormaps & ramps
 */
export interface ColorRampOptions {
	/**
	 * Which space to interpolate each segment in; `"oklch"` avoids a grey
	 * midpoint on ramps spanning distant hues.
	 * @default "rgb"
	 */
	colorSpace?: ColorSpace;
}

/**
 * Turns stops into a sampler over `[0, 1]`, clamped at both ends.
 *
 * Stops are parsed once, up front, and closed over — a ramp is typically
 * sampled once per band per frame, so re-parsing a CSS string on every call
 * would be the expensive half of colouring a field. Only the interpolation
 * math (cheap) runs per sample.
 *
 * Degenerate inputs answer rather than throw: one stop is a constant colour, and
 * no stops at all is `"none"` — the scene layer's spelling for "do not draw" —
 * so a mis-specified palette produces nothing rather than a crash.
 *
 * @param stops - Colours (CSS strings or `Color`s), evenly spaced across `[0, 1]`.
 * @param options - See {@link ColorRampOptions}.
 * @returns A function mapping `t` in `[0, 1]` (clamped; `NaN` reads as 0) to a CSS `rgba(...)` string.
 * @see {@link sampleRamp}
 * @see {@link colormaps}
 *
 * @category Colormaps & ramps
 */
export function colorRamp(
	stops: readonly ColorInput[],
	options: ColorRampOptions = {},
): (t: number) => string {
	if (stops.length === 0) return () => "none";
	if (stops.length === 1) {
		const only = cssColor(stops[0]);
		return () => only;
	}

	const colorSpace = options.colorSpace ?? "rgb";
	const parsed = stops.map(parseColor);
	const segmentCount = parsed.length - 1;
	// One precomputed sampler per segment: endpoint conversion into the
	// interpolation space (`oklch` especially) happens here, once, not on
	// every sample.
	const segments = Array.from({ length: segmentCount }, (_, i) =>
		colorInterpolator(parsed[i], parsed[i + 1], { colorSpace }),
	);

	return (t) => {
		const clamped = t < 0 || Number.isNaN(t) ? 0 : t > 1 ? 1 : t;
		const scaled = clamped * segmentCount;
		const index = Math.min(segmentCount - 1, Math.floor(scaled));
		return toCss(segments[index](scaled - index));
	};
}

/**
 * One-shot {@link colorRamp} for a caller sampling a ramp a single time.
 *
 * @param stops - Colours (CSS strings or `Color`s), evenly spaced across `[0, 1]`.
 * @param t - Position in `[0, 1]`; clamped.
 * @param options - See {@link ColorRampOptions}.
 * @returns A CSS `rgba(...)` string.
 *
 * @category Colormaps & ramps
 */
export function sampleRamp(
	stops: string[],
	t: number,
	options: ColorRampOptions = {},
): string {
	return colorRamp(stops, options)(t);
}
