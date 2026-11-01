/**
 * How a `chart` reads its layers' reports: the steady (blend-free) view of
 * them, given ranges with dates, the zone an axis reads plain Temporal
 * values in, and the shape of the keyed transition the layers report. The
 * registry itself is `registry.ts`.
 */

import type {
	Range,
	RangeTransition,
	ScaleSpec,
	TimeZone,
} from "@sophistry/core/geometry";
import { toEpochMs } from "@sophistry/core/geometry";
import { axisTimeZone } from "@sophistry/core/internal";
import type { DateAxis } from "../data/channels.js";
import type { JoinStages, JoinStaging } from "../math/join.js";
import { shallowEqual } from "../util.js";
import type {
	ChartAxisOptions,
	ChartLayerExtent,
	ChartProps,
	ChartRange,
	LayerTransition,
} from "./types.js";

/** A given range with `Date` or Temporal ends read as epoch milliseconds (plain ones in `timeZone`); anything else as is. */
export function numericRange(
	range: ChartRange | RangeTransition | undefined,
	timeZone: TimeZone,
): Range | RangeTransition | undefined {
	if (!Array.isArray(range)) return range as RangeTransition | undefined;
	if (!range.some((end) => typeof end === "object")) return range as Range;
	return range.map((end) =>
		typeof end === "object" ? toEpochMs(end as never, timeZone) : end,
	) as Range;
}

/** The zone an axis reads plain Temporal values in: its own, else its scale's (local for `"time"`), else UTC. */
export function optionsTimeZone(options: {
	scale?: ScaleSpec | "band";
	timeZone?: TimeZone;
}): TimeZone {
	return axisTimeZone(
		options.scale === "time" ? "time" : "utc",
		options.timeZone,
	);
}

/** An axis's options as given to `props`, merged over `axis`. */
export function givenOptions(
	props: Readonly<ChartProps>,
	axis: DateAxis,
): ChartAxisOptions {
	const own =
		axis === "x"
			? props.xAxis
			: axis === "y"
				? props.yAxis
				: axis === "x2"
					? props.x2Axis
					: props.y2Axis;
	return { ...props.axis, ...own } as ChartAxisOptions;
}

/**
 * A layer's report with a keyed transition's blend held out: the same
 * object when it has no transition, else a copy whose `transition.t` is 0.
 */
export function steadyReport(report: ChartLayerExtent): ChartLayerExtent {
	if (!report.transition) return report;
	const transition = { t: 0 } as LayerTransition;
	const fields = transition as unknown as Record<string, unknown>;
	const own = report.transition as unknown as Record<string, unknown>;
	for (const key of Object.keys(own)) if (key !== "t") fields[key] = own[key];
	return { ...report, transition };
}

/**
 * Whether two values say the same thing: compared by value through plain
 * objects and arrays, anything else (a colormap function, say) by identity.
 */
export function sameData(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
			return false;
		for (let i = 0; i < a.length; i++) if (!sameData(a[i], b[i])) return false;
		return true;
	}
	const plain = (value: object) => {
		const proto = Object.getPrototypeOf(value);
		return proto === Object.prototype || proto === null;
	};
	if (!plain(a) || !plain(b)) return false;
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	for (const key of keys)
		if (!Object.hasOwn(right, key) || !sameData(left[key], right[key]))
			return false;
	return true;
}

/** Whether two joins are staged the same. */
export function sameStages(
	a: JoinStages | undefined,
	b: JoinStages | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.eased === b.eased &&
		shallowEqual(a.exit, b.exit) &&
		shallowEqual(a.expand, b.expand) &&
		shallowEqual(a.update, b.update) &&
		shallowEqual(a.contract, b.contract) &&
		shallowEqual(a.enter, b.enter)
	);
}

/**
 * The reports with the blend held out, compared by value: the same array
 * while no layer changed anything but its blend. Make one per chart.
 */
export function createSteadyReports(): (
	live: readonly ChartLayerExtent[],
) => readonly ChartLayerExtent[] {
	let lastLive: readonly ChartLayerExtent[] | null = null;
	let last: readonly ChartLayerExtent[] = [];
	return (live) => {
		if (live === lastLive) return last;
		lastLive = live;
		// Each report keeps its own steady object while it is unchanged, so
		// the list compares cheaply.
		const next = live.map((report, i) => {
			const steady = steadyReport(report);
			const before = last[i];
			return before && sameData(before, steady) ? before : steady;
		});
		if (
			next.length !== last.length ||
			next.some((report, i) => report !== last[i])
		)
			last = next;
		return last;
	};
}

/** The blend of the first transitioning layer, if any. */
export function firstBlend(
	live: readonly ChartLayerExtent[],
): number | undefined {
	for (const report of live) if (report.transition) return report.transition.t;
	return undefined;
}

/** The shape of a keyed transition: its staging and whether any join enters or exits. */
export interface TransitionShape {
	staging: JoinStaging | undefined;
	enters: boolean;
	exits: boolean;
}

/** The keyed transition the layers report, steady while its blend moves; undefined without one. */
export function transitionShapeOf(
	reports: readonly ChartLayerExtent[],
): TransitionShape | undefined {
	let first: LayerTransition | undefined;
	let enters = false;
	let exits = false;
	for (const report of reports) {
		const own = report.transition;
		if (!own) continue;
		first ??= own;
		enters ||= !!own.enters;
		exits ||= !!own.exits;
	}
	return first ? { staging: first.staging, enters, exits } : undefined;
}

/** Two transition shapes alike. */
export function sameShape(
	a: TransitionShape | undefined,
	b: TransitionShape | undefined,
): boolean {
	return a === b || (!!a && !!b && shallowEqual(a, b));
}

/**
 * Whether a layer has noted dates on `axis` and no layer reports categories
 * there (categories keep an axis a band axis).
 */
export function datesOn(
	dated: ReadonlySet<DateAxis>,
	live: readonly ChartLayerExtent[],
	axis: DateAxis,
): boolean {
	if (!dated.has(axis)) return false;
	return !live.some((report) => report[axis]?.categories?.length);
}
