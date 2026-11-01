/**
 * Fitting one axis of a `chart` to its layers' reports: resolving,
 * comparing, and transitioning axes, and {@link createAxisFit}, made once
 * per axis (`x`, `y`, `x2`, `y2`) in the chart's `setup`.
 *
 * Each step is a function of the chart's current inputs with a last-value
 * cache, so a step whose inputs
 * kept their identity returns its last result (and a result equal by value
 * to the last keeps the last one's identity, so the coordinate systems and
 * guides downstream see nothing new).
 */

import type {
	BandKey,
	BandScale,
	Range,
	RangeTransition,
	ScaleSpec,
	TimeZone,
} from "@sophistry/core/geometry";
import {
	axisTicks,
	bandScale,
	currentRange,
	interpolateBandScale,
	isRangeTransition,
	resolveScale,
	slotBandScale,
} from "@sophistry/core/geometry";
import type { JoinStages, StageWindow } from "../math/join.js";
import { rescaleKind, rescaleWindow } from "../math/join.js";
import type { FitRangeOptions } from "../math/range.js";
import { alignedRange, fitRange } from "../math/range.js";
import { keyedMemo, shallowEqual, stableValue } from "../util.js";
import type {
	AxisExtent,
	ChartLayerExtent,
	ChartXAxisOptions,
	ChartYAxisOptions,
	LayerTransition,
} from "./types.js";

/** One axis's options once `axis` and `xAxis`/`yAxis` are merged. */
export type MergedAxisOptions = ChartXAxisOptions | ChartYAxisOptions;

/** A range as given: fixed, or a transition between two. */
export type GivenRange = Range | RangeTransition | undefined;

/** How far a stage of the frame's keyed transition has got (0 without one). */
export type StageAt = (pick: (stages: JoinStages) => StageWindow) => number;

/** An axis as the plot maps through it: a band scale, or a continuous scale's range. */
export type ResolvedAxis =
	| { kind: "band"; band: BandScale; range: Range }
	| {
			kind: "continuous";
			scale: ScaleSpec;
			range: Range;
			base?: number;
			timeZone?: TimeZone;
	  };

function fitType(scale: ScaleSpec | undefined): FitRangeOptions["type"] {
	return typeof scale === "string" ? scale : "linear";
}

/** Whether an axis's scale is plain linear (the default). */
export function linearScale(scale: ScaleSpec | "band" | undefined): boolean {
	return scale === undefined || scale === "linear";
}

export function resolveAxis(
	options: MergedAxisOptions,
	fixed: Range | undefined,
	reports: readonly AxisExtent[],
	vertical: boolean,
): ResolvedAxis {
	const reported: BandKey[] = [];
	let suggested: number | undefined;
	for (const report of reports) {
		// A loop, not `push(...)`: a spread throws past ~100k arguments.
		for (const key of report.categories ?? []) reported.push(key);
		suggested ??= report.padding;
	}
	const band =
		options.scale === "band" ||
		(options.scale === undefined &&
			(options.categories !== undefined || reported.length > 0));

	if (band) {
		const scale = bandScale(options.categories ?? reported, {
			padding: options.padding ?? suggested,
			// Categories read top-down, the way a list does; `reverse` flips that.
			reverse: options.reverse ? !vertical : vertical,
		});
		// A given range on a band axis is a window onto the slots (slot `i`
		// spans `i..i + 1`): how `chartZoom` zooms categories.
		return { kind: "band", band: scale, range: fixed ?? scale.range };
	}

	const scale = (options.scale ?? "linear") as ScaleSpec;
	const flip = (range: Range): Range =>
		options.reverse
			? ([range[1], range[0], ...range.slice(2)] as Range)
			: range;
	if (fixed)
		return {
			kind: "continuous",
			scale,
			range: flip(fixed),
			base: options.base,
			timeZone: options.timeZone,
		};
	const values: number[] = [];
	let zero = false;
	for (const report of reports) {
		if (report.values) for (const v of report.values) values.push(v);
		if (report.zero) zero = true;
	}
	return {
		kind: "continuous",
		scale,
		base: options.base,
		timeZone: options.timeZone,
		range: flip(
			fitRange(values, {
				type: fitType(scale),
				zero: options.zero ?? zero,
				nice: options.nice,
				base: options.base,
				timeZone: options.timeZone,
				margin: options.margin,
			}),
		),
	};
}

/** A secondary axis when no layer maps through it (and the stand-in for a band one). */
export const NO_SECONDARY_AXIS: ResolvedAxis = {
	kind: "continuous",
	scale: "linear",
	range: [0, 1],
};

/** Both ends of an axis fitted for a keyed transition. */
export interface AxisEnds {
	from: ResolvedAxis;
	to: ResolvedAxis;
}

/** How an axis changes over a keyed transition (see `rescaleKind`). */
export type RescaleChange = "none" | "expand" | "contract" | "shift";

/** A fitted axis's own transition while a keyed one runs. */
export type FittedTransition =
	| { kind: "continuous"; range: RangeTransition }
	| { kind: "band"; band: BandScale; from: BandScale; to: BandScale }
	| AxisSwap;

/**
 * A fitted axis that changes kind over a keyed transition (band ↔
 * continuous): the two axes cross-fade over the update stage, the plot
 * mapping through the near end's axis until its midpoint.
 */
export interface AxisSwap {
	kind: "swap";
	from: ResolvedAxis;
	to: ResolvedAxis;
	u: number;
}

export function sameAxis(a: ResolvedAxis, b: ResolvedAxis): boolean {
	if (a.kind === "band" || b.kind === "band")
		return (
			a.kind === "band" &&
			b.kind === "band" &&
			a.band.bandwidth === b.band.bandwidth &&
			shallowEqual(a.band.domain, b.band.domain) &&
			shallowEqual(a.range, b.range)
		);
	return (
		a.scale === b.scale &&
		a.base === b.base &&
		a.timeZone === b.timeZone &&
		shallowEqual(a.range, b.range)
	);
}

/**
 * How long an axis's range is in its own units: bands on a band axis, the
 * logarithm's span on a log axis, the plain difference otherwise.
 */
export function axisSpan(axis: ResolvedAxis): number {
	const [a, b] = axis.range;
	const span =
		axis.kind === "continuous" && axis.scale === "log"
			? Math.abs(Math.log(b) - Math.log(a))
			: Math.abs(b - a);
	return Number.isFinite(span) ? span : 0;
}

/** {@link sameAxis}, and for a band axis every category in the same place (a blended or slotted band moves them). */
export function samePlacement(a: ResolvedAxis, b: ResolvedAxis): boolean {
	if (a === b) return true;
	if (!sameAxis(a, b)) return false;
	if (a.kind !== "band" || b.kind !== "band") return true;
	return a.band.domain.every(
		(key) =>
			a.band.start(key) === b.band.start(key) &&
			a.band.index(key) === b.band.index(key),
	);
}

/** Two optional axes placing everything alike. */
export function sameOptionalPlacement(
	a: ResolvedAxis | undefined,
	b: ResolvedAxis | undefined,
): boolean {
	return a === b || (!!a && !!b && samePlacement(a, b));
}

export function sameRangeEnds(
	a: { from: Range; to: Range } | undefined,
	b: { from: Range; to: Range } | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return shallowEqual(a.from, b.from) && shallowEqual(a.to, b.to);
}

export function sameEnds(
	a: AxisEnds | undefined,
	b: AxisEnds | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return sameAxis(a.from, b.from) && sameAxis(a.to, b.to);
}

/** Two frames of a fitted axis's transition that place everything alike. */
function sameFitted(
	a: FittedTransition | undefined,
	b: FittedTransition | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b || a.kind !== b.kind) return false;
	if (a.kind === "swap" && b.kind === "swap")
		return a.from === b.from && a.to === b.to && a.u === b.u;
	if (a.kind === "continuous" && b.kind === "continuous")
		return (
			a.range.from === b.range.from &&
			a.range.to === b.range.to &&
			a.range.t === b.range.t
		);
	if (a.kind === "band" && b.kind === "band")
		return (
			a.from === b.from &&
			a.to === b.to &&
			samePlacement(
				{ kind: "band", band: a.band, range: a.band.range },
				{ kind: "band", band: b.band, range: b.band.range },
			)
		);
	return false;
}

/** How an axis's fitted range (or category count) changes between the ends. */
export function endsKind(ends: AxisEnds | undefined): RescaleChange {
	// An axis changing kind has no range to rescale: it cross-fades instead.
	if (!ends || ends.from.kind !== ends.to.kind) return "none";
	return rescaleKind(ends.from.range, ends.to.range);
}

/** A fixed range as shown now: itself, or a transition's blend. */
export function shownRange(
	range: GivenRange,
	options: MergedAxisOptions,
): Range | undefined {
	return range === undefined
		? undefined
		: currentRange(
				range,
				options.scale === "band" ? undefined : options.scale,
				options.base,
			);
}

/** Both ends of an axis fitted during a keyed transition; undefined when nothing transitions or the range is given. */
export function fittedEnds(
	transitioning: boolean,
	options: MergedAxisOptions,
	given: GivenRange,
	list: readonly ChartLayerExtent[],
	pick: (report: ChartLayerExtent) => AxisExtent | undefined,
	pickTo: (transition: LayerTransition) => AxisExtent | undefined,
	vertical: boolean,
): AxisEnds | undefined {
	if (!transitioning || given !== undefined) return undefined;
	const from: AxisExtent[] = [];
	const to: AxisExtent[] = [];
	for (const report of list) {
		const own = pick(report);
		if (own) from.push(own);
		const far = report.transition ? (pickTo(report.transition) ?? own) : own;
		if (far) to.push(far);
	}
	return {
		from: resolveAxis(options, undefined, from, vertical),
		to: resolveAxis(options, undefined, to, vertical),
	};
}

/** A fitted axis's own transition during a keyed one: a range transition on its rescale stage, or a band axis's blended layouts. */
function fittedTransition(
	ends: AxisEnds | undefined,
	change: RescaleChange,
	stage: StageAt,
): FittedTransition | undefined {
	if (!ends) return undefined;
	const { from, to } = ends;
	if (from.kind === "continuous" && to.kind === "continuous") {
		if (change === "none") return undefined;
		return {
			kind: "continuous",
			range: {
				from: from.range,
				to: to.range,
				t: stage((stages) => rescaleWindow(stages, change)),
			},
		};
	}
	if (from.kind === "band" && to.kind === "band") {
		if (shallowEqual(from.band.domain, to.band.domain)) return undefined;
		return {
			kind: "band",
			band: interpolateBandScale(
				from.band,
				to.band,
				stage((stages) => rescaleWindow(stages, change)),
				stage((stages) => stages.update),
			),
			from: from.band,
			to: to.band,
		};
	}
	return {
		kind: "swap",
		from,
		to,
		u: stage((stages) => stages.update),
	};
}

/**
 * The axis the plot maps through now: mid-swap the near end's, on a fitted
 * transition its blend, else resolved from `extents`. A band axis's `slot`
 * applies last.
 */
export function axisNow(
	options: MergedAxisOptions,
	given: GivenRange,
	fit: FittedTransition | undefined,
	extents: readonly AxisExtent[],
	vertical: boolean,
	resolve: typeof resolveAxis = resolveAxis,
): ResolvedAxis {
	let axis: ResolvedAxis;
	if (fit?.kind === "swap") {
		axis = fit.u < 0.5 ? fit.from : fit.to;
	} else if (fit?.kind === "continuous") {
		const scale = (options.scale ?? "linear") as ScaleSpec;
		axis = {
			kind: "continuous",
			scale,
			base: options.base,
			timeZone: options.timeZone,
			range: currentRange(fit.range, scale, options.base),
		};
	} else if (fit?.kind === "band") {
		axis = {
			kind: "band",
			band: fit.band,
			range: shownRange(given, options) ?? fit.band.range,
		};
	} else {
		axis = resolve(options, shownRange(given, options), extents, vertical);
	}
	const slot = options.slot;
	if (axis.kind === "band" && slot) {
		const band = slotBandScale(
			axis.band,
			slot,
			options.reverse ? !vertical : vertical,
		);
		// A window (a given range) stays put while the slots move under it.
		const window = axis.range !== axis.band.range ? axis.range : undefined;
		return { kind: "band", band, range: window ?? band.range };
	}
	return axis;
}

/** A category's strength on a band axis mid-transition: leaving ones fade with the exits, new ones with the enters. */
export function bandWeight(
	fit: FittedTransition | undefined,
	stage: StageAt,
): ((key: BandKey) => number) | undefined {
	if (fit?.kind !== "band") return undefined;
	const { from, to } = fit;
	const enter = stage((stages) => stages.enter);
	const exit = stage((stages) => stages.exit);
	return (key: BandKey) =>
		from.index(key) < 0 ? enter : to.index(key) < 0 ? 1 - exit : 1;
}

/** An axis changing kind through a keyed transition, as its guides draw it. */
export interface AxisSwapView {
	/** The opacity of the axis mapped through now. */
	fade: number;
	/** The other end, drawn at the rest; undefined outside the update stage. */
	ghost: ResolvedAxis | undefined;
}

/**
 * An axis changing kind through a keyed transition: `fade` is the opacity of
 * the axis mapped through now, `ghost` the other end drawn at the rest. Make
 * one per axis; the ghost keeps its identity while it places alike.
 */
export function createAxisSwap(): (
	fit: FittedTransition | undefined,
) => AxisSwapView {
	const ghostOf = stableValue<ResolvedAxis | undefined>(sameOptionalPlacement);
	return (fit) => {
		const own = fit?.kind === "swap" ? fit : undefined;
		const fade = own ? (own.u < 0.5 ? 1 - own.u : own.u) : 1;
		// Nothing to draw before the stage starts or once it is done.
		const ghost = ghostOf(
			own && own.u > 0 && own.u < 1
				? own.u < 0.5
					? own.to
					: own.from
				: undefined,
		);
		return { fade, ghost };
	};
}

/** A secondary axis's range aligned with its primary's ticks, or fitted on its own when no alignment fits. */
export function alignedToPrimary(
	range: Range,
	list: readonly AxisExtent[],
	mine: MergedAxisOptions,
	primary: MergedAxisOptions,
): Range {
	const values: number[] = [];
	let zero = false;
	for (const extent of list) {
		for (const value of extent.values ?? []) values.push(value);
		if (extent.zero) zero = true;
	}
	const majors = axisTicks(resolveScale("linear", range), range, {
		step: primary.step,
		minorTickCount: 0,
	}).majors;
	const fit = { zero: mine.zero ?? zero, margin: mine.margin };
	const opposite = !!primary.reverse !== !!mine.reverse;
	const aligned =
		alignedRange(range, majors, values, { ...fit, opposite }) ??
		fitRange(values, { ...fit, nice: mine.nice });
	return mine.reverse
		? ([aligned[1], aligned[0], ...aligned.slice(2)] as Range)
		: aligned;
}

/** What one update of an axis's fit reads. Every field keeps its identity while unchanged. */
export interface AxisFitInput {
	options: MergedAxisOptions;
	/** The range given for the axis, if any. */
	given: GivenRange;
	/** The reports the axis is fitted to (blends held out). */
	reports: readonly ChartLayerExtent[];
	/** Whether a keyed transition runs (steady while its blend moves). */
	transitioning: boolean;
	/** A secondary axis's state (see `secondaryFit`). */
	secondary?: {
		has: boolean;
		aligns: boolean;
		alignedEnds: { from: Range; to: Range } | undefined;
	};
}

/** One axis as drawn on one update. */
export interface PlacedAxis {
	/** The fitted axis's own transition while a keyed one runs. */
	fitted: FittedTransition | undefined;
	/** The range as given, or the fitted transition while one runs: what the number line is given. */
	given: GivenRange;
	/** The axis the plot maps through now (identity kept while it places alike). */
	axis: ResolvedAxis;
	/** Its range (identity kept while equal). */
	range: Range;
}

/** What {@link createAxisFit} fits an axis from. */
export interface AxisFitDeps {
	/** A report's extent on this axis. */
	pick(report: ChartLayerExtent): AxisExtent | undefined;
	/** A transitioning report's far end's extent on this axis. */
	pickTo(transition: LayerTransition): AxisExtent | undefined;
	/** The extents the axis is fitted to at rest; every report's `pick` by default. */
	extents?: (reports: readonly ChartLayerExtent[]) => AxisExtent[];
	vertical: boolean;
	/** A secondary axis: continuous only, ranged by `alignedEnds` with `alignTicks`. */
	secondary?: boolean;
}

/** One axis's fit; see {@link createAxisFit}. */
export interface AxisFit {
	/** Both ends during a keyed transition (steady while the blend moves); identity kept while equal. */
	ends(input: AxisFitInput): AxisEnds | undefined;
	/** How the axis rescales between the ends. */
	change(input: AxisFitInput): RescaleChange;
	/** The axis as drawn now. `primaryGiven` is the primary's given range, for a secondary axis. */
	place(
		input: AxisFitInput,
		stage: StageAt,
		primaryGiven?: GivenRange,
	): PlacedAxis;
}

/**
 * One axis's fit, in two steps around the frame's transition stages:
 * `ends` and `change` read only steady inputs and feed the stages;
 * `place(stage)` gives the axis as drawn each update, compared by placement
 * so unchanged frames keep every identity. Make one per axis in `setup`.
 */
export function createAxisFit(deps: AxisFitDeps): AxisFit {
	const { vertical, secondary } = deps;
	const extentsOf =
		deps.extents ??
		((reports: readonly ChartLayerExtent[]) => {
			const out: AxisExtent[] = [];
			for (const report of reports) {
				const extent = deps.pick(report);
				if (extent) out.push(extent);
			}
			return out;
		});
	const extentsMemo = keyedMemo<AxisExtent[]>();
	const endsMemo = keyedMemo<AxisEnds | undefined>();
	const endsStable = stableValue<AxisEnds | undefined>(sameEnds);
	const fittedStable = stableValue<FittedTransition | undefined>(sameFitted);
	const resolvedMemo = keyedMemo<ResolvedAxis>();
	const axisStable = stableValue<ResolvedAxis>(samePlacement);
	const rangeStable = stableValue<Range>(shallowEqual);
	const alignedGiven = stableValue<GivenRange>((a, b) =>
		isRangeTransition(a) && isRangeTransition(b)
			? a.from === b.from && a.to === b.to && a.t === b.t
			: a === b,
	);

	const ends = (input: AxisFitInput): AxisEnds | undefined => {
		const own = input.secondary;
		const active = !secondary || (!!own?.has && !own.aligns);
		return endsStable(
			endsMemo(
				[
					active,
					input.transitioning,
					input.options,
					input.given,
					input.reports,
				],
				() =>
					active
						? fittedEnds(
								input.transitioning,
								input.options,
								input.given,
								input.reports,
								deps.pick,
								deps.pickTo,
								vertical,
							)
						: undefined,
			),
		);
	};
	const change = (input: AxisFitInput): RescaleChange => {
		const aligned = input.secondary?.alignedEnds;
		return aligned
			? rescaleKind(aligned.from, aligned.to)
			: endsKind(ends(input));
	};
	/** A resolve that reuses its last answer while its inputs are the same. */
	const resolve: typeof resolveAxis = (options, fixed, extents, isVertical) =>
		resolvedMemo([options, fixed?.[0], fixed?.[1], fixed?.[2], extents], () =>
			resolveAxis(options, fixed, extents, isVertical),
		);
	const place = (
		input: AxisFitInput,
		stage: StageAt,
		primaryGiven?: GivenRange,
	): PlacedAxis => {
		const own = input.secondary;
		const changeNow = change(input);
		const fitted = fittedStable(
			fittedTransition(ends(input), changeNow, stage),
		);
		/** The aligned range: plain at rest, else a transition between the two ends' alignments. */
		const aligned = (): GivenRange => {
			const range = own?.alignedEnds;
			if (!range) return undefined;
			if (shallowEqual(range.from, range.to)) return range.from;
			return alignedGiven({
				from: range.from,
				to: range.to,
				t: isRangeTransition(primaryGiven)
					? primaryGiven.t
					: stage((stages) => rescaleWindow(stages, changeNow)),
			});
		};
		let given: GivenRange = input.given;
		if (given === undefined) {
			if (own?.aligns) given = aligned();
			else if (fitted?.kind === "continuous") given = fitted.range;
		}
		let axis: ResolvedAxis;
		if (secondary && !own?.has) axis = NO_SECONDARY_AXIS;
		else {
			const range = secondary ? aligned() : undefined;
			if (range) {
				const scale = (input.options.scale ?? "linear") as ScaleSpec;
				axis = {
					kind: "continuous",
					scale,
					range: currentRange(range, scale),
				};
			} else {
				const extents = extentsMemo([input.reports], () =>
					extentsOf(input.reports),
				);
				const resolved = axisNow(
					input.options,
					input.given,
					fitted,
					extents,
					vertical,
					resolve,
				);
				axis =
					secondary && resolved.kind === "band" ? NO_SECONDARY_AXIS : resolved;
			}
		}
		axis = axisStable(axis);
		return { fitted, given, axis, range: rangeStable(axis.range) };
	};
	return { ends, change, place };
}
