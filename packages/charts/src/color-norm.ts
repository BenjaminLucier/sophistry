/**
 * Colour norms: how a colour-mapped layer turns a value into a place on its
 * ramp (0..1), and the {@link Scale} its colour bar reads the same mapping
 * from, so cells and colour bar always agree.
 */

import type { DivergingKind, Range, Scale } from "@sophistry/core/geometry";
import { divergingScale, resolveScale } from "@sophistry/core/geometry";
import type { Colormap } from "@sophistry/core/themes";
import type { RampExtent } from "./frame/types.js";

/**
 * How a colour layer spreads values over its colormap: `"linear"` even
 * steps; `"log"` even ratios (zero, negative and non-finite values are not
 * drawn, and the automatic range is the positive extent); `"symlog"`
 * logarithmic away from zero, linear through it; `"sqrt"` square-root
 * steps, lifting small values.
 *
 * @see https://sophistry.dev/guides/charts/#color
 * @category Charts
 */
export type RampScaleName = DivergingKind;

/**
 * The colour-norm props of the colour-mapped layers (`<Imshow>`,
 * `<Pcolormesh>`, `<Cells>`/`<Heatmap>`, `<Tripcolor>`, the contours).
 * `<Hist2D>` and `<HexBin>` take `rampScale` alone.
 *
 * @see https://sophistry.dev/guides/charts/#color
 * @category Charts
 */
export interface RampScaleProps {
	/** How values spread over the colormap; see {@link RampScaleName}. @default "linear" */
	rampScale?: RampScaleName;
	/**
	 * A diverging centre: this value takes the colormap's middle, each half
	 * spread on its own, so a diverging colormap's neutral colour sits on "no
	 * change". Without `rampMin`/`rampMax`, the range is symmetric about it
	 * (in ratio under `"log"`).
	 */
	rampMidpoint?: number;
}

/**
 * A layer's resolved colour norm.
 *
 * @internal
 */
export interface ColorNorm {
	/** The values the colormap spans, `[low, high]`, ascending. */
	domain: readonly [number, number];
	/** The mapping over `domain`, for the colour bar: its ticks and their places. */
	scale: Scale;
	/** A value's place on the ramp: 0 at `domain[0]`, 1 at `domain[1]`, beyond for values past them; `NaN` for values with no place. */
	unit(value: number): number;
	/** True for the default linear mapping, which needs no colour-bar scale of its own. */
	linear: boolean;
}

/**
 * Options for {@link colorNorm}: the layer's norm props and its `rampMin`/`rampMax`.
 *
 * @internal
 */
export interface RampScaleOptions extends RampScaleProps {
	rampMin?: number;
	rampMax?: number;
	/** Return a norm even for the default linear mapping. */
	always?: boolean;
}

/** Whether a layer asked for anything but the default linear norm. */
function hasColorNorm(options: RampScaleProps): boolean {
	return (
		(options.rampScale !== undefined && options.rampScale !== "linear") ||
		options.rampMidpoint !== undefined
	);
}

/**
 * The colour norm a layer colours `values` through.
 *
 * @param values - Only their finite (positive, under `"log"`) extent is read.
 * @returns The norm; without `always`, undefined unless a non-linear `rampScale` or a `rampMidpoint` is given.
 * @internal
 */
export function colorNorm(
	values: Iterable<number>,
	options: RampScaleOptions & { always: true },
): ColorNorm;
export function colorNorm(
	values: Iterable<number>,
	options: RampScaleOptions,
): ColorNorm | undefined;
export function colorNorm(
	values: Iterable<number>,
	options: RampScaleOptions,
): ColorNorm | undefined {
	const linear = !hasColorNorm(options);
	if (!options.always && linear) return undefined;
	const kind: RampScaleName = options.rampScale ?? "linear";
	const log = kind === "log";
	const usable = (value: number | undefined): value is number =>
		value !== undefined && Number.isFinite(value) && (!log || value > 0);

	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const value of values) {
		if (!usable(value)) continue;
		if (value < min) min = value;
		if (value > max) max = value;
	}
	if (!(min <= max)) [min, max] = log ? [1, 10] : [0, 1];

	const rampMin = usable(options.rampMin) ? options.rampMin : undefined;
	const rampMax = usable(options.rampMax) ? options.rampMax : undefined;
	const center = usable(options.rampMidpoint)
		? options.rampMidpoint
		: undefined;
	let lo = rampMin ?? min;
	let hi = rampMax ?? max;

	if (center === undefined) {
		const scale = resolveScale(kind, [lo, hi]);
		return { domain: [lo, hi], scale, unit: unitOf(scale, log), linear };
	}

	/** `value` reflected through the centre: additively, or in ratio under log. */
	const mirror = (value: number) =>
		log ? (center * center) / value : 2 * center - value;
	if (rampMin === undefined && rampMax === undefined) {
		// CenteredNorm: symmetric about the centre, out to the farther end.
		if (log) {
			const ratio = Math.max(max / center, center / min);
			const r = ratio > 1 ? ratio : 10;
			[lo, hi] = [center / r, center * r];
		} else {
			const reach = Math.max(max - center, center - min);
			const h = reach > 0 ? reach : 1;
			[lo, hi] = [center - h, center + h];
		}
	} else {
		if (!(lo < center) && hi > center) lo = mirror(hi);
		if (!(hi > center) && lo < center) hi = mirror(lo);
	}
	const range: Range = [lo, hi];
	const scale = divergingScale(range, center, { kind });
	return { domain: [lo, hi], scale, unit: unitOf(scale, log), linear };
}

function unitOf(scale: Scale, log: boolean): (value: number) => number {
	return (value) =>
		!Number.isFinite(value) || (log && !(value > 0))
			? Number.NaN
			: scale.toUnit(value);
}

/**
 * Contour levels evenly spaced along a norm (geometric under `"log"`, split
 * evenly either side of a `rampMidpoint`).
 *
 * @param ends - `"between"` for iso-lines strictly inside the domain, `"cover"` for band boundaries including both ends.
 * @internal
 */
export function normLevels(
	norm: ColorNorm,
	count: number,
	ends: "between" | "cover",
): number[] {
	const n = Math.floor(count);
	if (!(n > 0)) return [];
	const [lo, hi] = norm.domain;
	if (!(hi > lo)) return [];
	if (ends === "between") {
		return Array.from({ length: n }, (_, i) =>
			norm.scale.fromUnit((i + 1) / (n + 1)),
		);
	}
	if (n === 1) return [lo];
	return Array.from({ length: n }, (_, i) =>
		i === 0 ? lo : i === n - 1 ? hi : norm.scale.fromUnit(i / (n - 1)),
	);
}

/**
 * What a layer reports to its frame's colour bar: its norm's domain and
 * scale when it has a non-linear one, else `domain` (linear).
 *
 * @internal
 */
export function rampOf(
	norm: ColorNorm | undefined,
	domain: readonly [number, number],
	colormap: Colormap,
): RampExtent {
	return norm && !norm.linear
		? { domain: norm.domain, scale: norm.scale, colormap }
		: { domain, colormap };
}
