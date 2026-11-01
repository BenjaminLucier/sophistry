/**
 * A `chart`'s secondary axes: `x2` on the top edge for the layers inside a
 * `secondaryX`, `y2` on the right for a `secondaryY`. Continuous only.
 */

import type { Range } from "@sophistry/core/geometry";
import { isRangeTransition } from "@sophistry/core/geometry";
import { keyedMemo, stableValue } from "../util.js";
import type {
	AxisFit,
	AxisFitInput,
	GivenRange,
	MergedAxisOptions,
	ResolvedAxis,
} from "./fit.js";
import {
	alignedToPrimary,
	createAxisFit,
	linearScale,
	resolveAxis,
	sameRangeEnds,
} from "./fit.js";
import type {
	AxisExtent,
	ChartAxisOptions,
	ChartLayerExtent,
	ChartProps,
	LayerTransition,
} from "./types.js";

/** Which secondary axes a context maps through. */
export interface SecondaryFlags {
	x2: boolean;
	y2: boolean;
}

/**
 * A layer's report as a secondary axis sees it: `x` moved to `x2` and/or `y`
 * to `y2`, the far end of a keyed transition too.
 */
export function onSecondary(
	report: ChartLayerExtent,
	flags: SecondaryFlags,
): ChartLayerExtent {
	const { x, y, transition, ...rest } = report;
	const out: ChartLayerExtent = { ...rest };
	if (flags.x2) out.x2 = x ?? { values: [] };
	else if (x !== undefined) out.x = x;
	if (flags.y2) out.y2 = y ?? { values: [] };
	else if (y !== undefined) out.y = y;
	if (transition) {
		const { x: toX, y: toY, ...far } = transition;
		out.transition = Object.assign(
			far as LayerTransition,
			flags.x2 ? { x2: toX } : toX !== undefined ? { x: toX } : {},
			flags.y2 ? { y2: toY } : toY !== undefined ? { y: toY } : {},
		);
	}
	return out;
}

/** What one update of a secondary axis's fit reads; every field keeps its identity while unchanged. */
export interface SecondaryFitInput {
	props: Readonly<ChartProps>;
	/** The range given for this axis, numeric. */
	given: GivenRange;
	/** Whether a layer on this axis has read `Date`s. */
	dates: boolean;
	primaryOptions: MergedAxisOptions;
	primaryGiven: GivenRange;
	/** The primary axis's fitted ends (see `createAxisFit`). */
	primaryFitted: { from: ResolvedAxis; to: ResolvedAxis } | undefined;
	reports: readonly ChartLayerExtent[];
	/** The reports the primary axis is fitted to. */
	fitReports: readonly ChartLayerExtent[];
	transitioning: boolean;
}

/** A secondary axis's state on one update. */
export interface SecondaryState {
	options: MergedAxisOptions;
	/** Whether any layer maps through this axis. */
	has: boolean;
	/** The input its {@link AxisFit} reads. */
	input: AxisFitInput;
}

/** A secondary axis's fit; see {@link secondaryFit}. */
export interface SecondaryFit extends AxisFit {
	/** This update's options, flags and fit input. */
	state(input: SecondaryFitInput): SecondaryState;
}

/**
 * A secondary axis's fit: its options, whether any layer maps through it,
 * and both ends of a keyed transition. With `alignTicks` its range comes
 * from the primary's range and ticks at each end instead of its own fit;
 * everything here reads only steady inputs, never the blended axes. Make
 * one per secondary axis in `setup`.
 */
export function secondaryFit(axis: "x" | "y"): SecondaryFit {
	const key = axis === "x" ? "x2" : "y2";
	const vertical = axis === "y";
	const optionsMemo = keyedMemo<MergedAxisOptions>();
	const alignedMemo = keyedMemo<{ from: Range; to: Range } | undefined>();
	const alignedStable = stableValue<{ from: Range; to: Range } | undefined>(
		sameRangeEnds,
	);
	const primaryEndsMemo = keyedMemo<{ from: Range; to: Range } | undefined>();
	const primaryEndsStable = stableValue<{ from: Range; to: Range } | undefined>(
		sameRangeEnds,
	);
	const inputStable = stableValue<AxisFitInput>(
		(a, b) =>
			a.options === b.options &&
			a.given === b.given &&
			a.reports === b.reports &&
			a.transitioning === b.transitioning &&
			a.secondary?.has === b.secondary?.has &&
			a.secondary?.aligns === b.secondary?.aligns &&
			a.secondary?.alignedEnds === b.secondary?.alignedEnds,
	);
	const fit = createAxisFit({
		pick: (r) => r[key],
		pickTo: (t) => t[key],
		// Categories dropped: it is continuous.
		extents: (reports) => {
			const out: AxisExtent[] = [];
			for (const r of reports) {
				const extent = r[key];
				if (!extent) continue;
				const { categories: _categories, ...rest } = extent;
				out.push(rest);
			}
			return out;
		},
		vertical,
		secondary: true,
	});
	const state = (input: SecondaryFitInput): SecondaryState => {
		const { props } = input;
		const own = axis === "x" ? props.x2Axis : props.y2Axis;
		const options = optionsMemo([props.axis, own, input.dates], () => {
			const { alignTicks, ...rest } = own ?? {};
			const { position: _position, ...merged }: ChartAxisOptions = {
				...props.axis,
				...rest,
			};
			const out = {
				...merged,
				scale:
					merged.scale === "band"
						? undefined
						: (merged.scale ?? (input.dates ? "utc" : undefined)),
				categories: undefined,
				slot: undefined,
				// Aligned ticks take the step the alignment chose (the range's own).
				step: alignTicks && linearScale(merged.scale) ? undefined : merged.step,
			};
			return (
				axis === "x"
					? { ...out, position: "top" }
					: { ...out, position: "right" }
			) as MergedAxisOptions;
		});
		const has = input.reports.some((r) => r[key] !== undefined);
		const primary = input.primaryOptions;
		const aligns =
			!!own?.alignTicks &&
			input.given === undefined &&
			has &&
			linearScale(primary.scale) &&
			linearScale(options.scale) &&
			// A band primary has no ticks to align with.
			primary.categories === undefined &&
			!input.fitReports.some((report) => report[axis]?.categories?.length);
		/** The primary range at each end, as drawn (fitted, flipped, given). */
		const primaryEnds = primaryEndsStable(
			primaryEndsMemo(
				[
					aligns,
					primary,
					input.primaryGiven,
					input.primaryFitted,
					input.fitReports,
				],
				() => {
					if (!aligns) return undefined;
					const range = input.primaryGiven;
					if (isRangeTransition(range))
						return {
							from: resolveAxis(primary, range.from, [], vertical).range,
							to: resolveAxis(primary, range.to, [], vertical).range,
						};
					const ends = input.primaryFitted;
					if (ends) return { from: ends.from.range, to: ends.to.range };
					const extents: AxisExtent[] = [];
					for (const r of input.fitReports) {
						const extent = r[axis];
						if (extent) extents.push(extent);
					}
					const now = resolveAxis(primary, range, extents, vertical).range;
					return { from: now, to: now };
				},
			),
		);
		/** This axis's range aligned with the primary's ticks at each end. */
		const alignedEnds = alignedStable(
			alignedMemo([primaryEnds, input.reports, options, primary], () => {
				if (!primaryEnds) return undefined;
				const from: AxisExtent[] = [];
				const to: AxisExtent[] = [];
				for (const report of input.reports) {
					const extent = report[key];
					if (extent) from.push(extent);
					const far = report.transition
						? (report.transition[key] ?? extent)
						: extent;
					if (far) to.push(far);
				}
				return {
					from: alignedToPrimary(primaryEnds.from, from, options, primary),
					to: alignedToPrimary(primaryEnds.to, to, options, primary),
				};
			}),
		);
		return {
			options,
			has,
			input: inputStable({
				options,
				given: input.given,
				reports: input.reports,
				transitioning: input.transitioning,
				secondary: { has, aligns, alignedEnds },
			}),
		};
	};
	return { ...fit, state };
}
