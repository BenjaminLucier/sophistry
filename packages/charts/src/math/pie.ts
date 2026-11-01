/** Pie geometry: consecutive angular slices sized by each value's share of the total, plus sweep and grow reveals. */

import type { BandKey, Point } from "@sophistry/core/geometry";
import { clampNonNegative, mix, polarPoint } from "@sophistry/core/internal";
import type { PolarSweepOptions } from "./shared/polar.js";
import { resolvePolarSweep, TAU } from "./shared/polar.js";

/** @category Math */
export interface PieSlice {
	/** Position in the input `values`; parallel `colors`/`labels` arrays index by this. */
	index: number;
	/** The (clamped) value this slice represents. */
	value: number;
	/** Radians from +x, as `Sector`'s `startAngle`. */
	startAngle: number;
	/** Radians from +x; `endAngle - startAngle` is the signed sweep for `Sector`'s `angle`. */
	endAngle: number;
	/** `value / total`: the slice's share of the pie. */
	fraction: number;
}

/** @category Math */
export type PieOptions = PolarSweepOptions;

/**
 * One slice per value, consecutive and summing to a full turn. A zero still
 * gets a zero-sweep slice, so parallel `colors`/`labels` stay aligned.
 *
 * @param values - One value per slice; negative and non-finite entries clamp to 0.
 * @returns One {@link PieSlice} per value, or `[]` when the total is not positive.
 * @category Math & helpers
 */
export function pieSlices(
	values: readonly number[],
	options: PieOptions = {},
): PieSlice[] {
	// Negative values make no geometric sense for a pie slice's sweep, and a
	// non-finite value has no sensible share of the total either — clamp
	// both to 0 rather than throwing, since one bad value in the input
	// shouldn't crash the whole chart.
	const clamped = values.map(clampNonNegative);
	const total = clamped.reduce((sum, value) => sum + value, 0);
	if (total <= 0) return [];

	const { startAngle, direction } = resolvePolarSweep(options);

	const slices: PieSlice[] = [];
	let angle = startAngle;
	for (let index = 0; index < clamped.length; index++) {
		const value = clamped[index];
		const fraction = value / total;
		const start = angle;
		const end = start + direction * TAU * fraction;
		slices.push({ index, value, startAngle: start, endAngle: end, fraction });
		angle = end;
	}
	return slices;
}

/**
 * How much of each slice a clockwise sweep from the first slice's start has
 * uncovered at `progress`: slices appear in data order, each complete before
 * the next begins.
 *
 * @param progress - The sweep, 0..1 of a full turn.
 * @returns One fraction per slice, 0 (not reached) to 1 (fully swept).
 * @category Math & helpers
 */
export function pieSweep(
	slices: readonly PieSlice[],
	progress: number,
): number[] {
	let before = 0;
	return slices.map((slice) => {
		const start = before;
		before += slice.fraction;
		if (slice.fraction <= 0) return progress >= start ? 1 : 0;
		const shown = (progress - start) / slice.fraction;
		return shown > 0 ? (shown < 1 ? shown : 1) : 0;
	});
}

/**
 * The slices growing together: every sweep scaled by `progress`, all opening
 * from `startAngle` at once and keeping their true shares, until they close
 * the circle at 1.
 *
 * @returns The slices with scaled angles; `index`, `value` and `fraction` unchanged.
 * @category Math & helpers
 */
export function pieGrow(
	slices: readonly PieSlice[],
	progress: number,
): PieSlice[] {
	const origin = slices[0]?.startAngle ?? 0;
	return slices.map((slice) => ({
		...slice,
		startAngle: origin + (slice.startAngle - origin) * progress,
		endAngle: origin + (slice.endAngle - origin) * progress,
	}));
}

/** @category Math */
export interface SweepWedgeOptions extends PolarSweepOptions {
	/** Centre. Defaults to the origin. */
	center?: Point;
	/** How far the wedge reaches; make it clear everything it uncovers. */
	radius: number;
}

/**
 * The wedge one angular sweep has uncovered, as a polygon from the centre:
 * `progress` of a full turn from `startAngle`. A clip region for radial
 * sweep reveals.
 *
 * @param progress - The sweep, 0..1.
 * @returns The wedge, a lone centre point at 0, or undefined at `progress >= 1`.
 * @category Math & helpers
 */
export function sweepWedge(
	progress: number,
	options: SweepWedgeOptions,
): Point[] | undefined {
	if (progress >= 1) return undefined;
	const centre = options.center ?? { x: 0, y: 0 };
	if (!(progress > 0)) return [centre];
	const { startAngle, direction } = resolvePolarSweep(options);
	const turn = direction * TAU * progress;
	// About 3° a side: the chord between samples cuts inside the arc by
	// under 0.04% of the radius.
	const sides = Math.max(2, Math.ceil(128 * progress));
	const wedge: Point[] = [centre];
	for (let i = 0; i <= sides; i++) {
		const angle = startAngle + (turn * i) / sides;
		wedge.push(polarPoint(centre.x, centre.y, options.radius, angle));
	}
	return wedge;
}

/*
 * Rings across a keyed transition (internal to the charts: `PieChart` and
 * `PolarAreaChart` with `to`; not re-exported from the package).
 */

/** One slice of a ring on one frame: its angles, its share of the turn, and where that share starts. */
export interface RingSlice {
	/** Radians from +x. */
	startAngle: number;
	/** Radians from +x. */
	endAngle: number;
	/** Its share of the turn, 0..1. */
	fraction: number;
	/** The turn before it, 0..1 from `startAngle`. */
	offset: number;
}

/**
 * The order a ring lays out both ends' keys of a keyed transition so that
 * nothing crosses: entering keys open beside the key they follow in `to`,
 * leaving keys stay after the one they follow in `from`. When shared keys
 * are reordered, they follow `follow`'s end and {@link ringLayout} blends.
 *
 * @param follow - Whose order the shared keys keep.
 */
export function ringOrder(
	from: readonly BandKey[],
	to: readonly BandKey[],
	follow: "from" | "to",
): BandKey[] {
	const inFrom = new Set(from);
	const inTo = new Set(to);
	if (follow === "from") {
		const out = [...from];
		to.forEach((key, j) => {
			if (inFrom.has(key)) return;
			let at = j === 0 ? 0 : out.indexOf(to[j - 1]) + 1;
			while (at < out.length && !inTo.has(out[at])) at++;
			out.splice(at, 0, key);
		});
		return out;
	}
	const out = [...to];
	from.forEach((key, i) => {
		if (inTo.has(key)) return;
		out.splice(i === 0 ? 0 : out.indexOf(from[i - 1]) + 1, 0, key);
	});
	return out;
}

/**
 * A ring of slices (a pie's, a rose's) laid out by weight in each end's
 * {@link ringOrder}; when the orders differ, angles blend between the two
 * layouts by `u`. Keys with no weight get a zero-sweep slice.
 *
 * @param weight - Each key's weight on this frame (negative and non-finite count as 0).
 * @param u - The update stage's progress, 0..1.
 * @returns Each key's slice; empty when no key has weight.
 */
export function ringLayout(
	orders: { from: readonly BandKey[]; to: readonly BandKey[] },
	weight: (key: BandKey) => number,
	u: number,
	options: PieOptions = {},
): Map<BandKey, RingSlice> {
	const lay = (order: readonly BandKey[]) => {
		const out = new Map<BandKey, RingSlice>();
		let offset = 0;
		pieSlices(order.map(weight), options).forEach((slice, i) => {
			out.set(order[i], {
				startAngle: slice.startAngle,
				endAngle: slice.endAngle,
				fraction: slice.fraction,
				offset,
			});
			offset += slice.fraction;
		});
		return out;
	};
	const same =
		orders.from === orders.to ||
		(orders.from.length === orders.to.length &&
			orders.from.every((key, i) => key === orders.to[i]));
	if (same || u <= 0) return lay(orders.from);
	const b = lay(orders.to);
	if (u >= 1) return b;
	const a = lay(orders.from);
	const out = new Map<BandKey, RingSlice>();
	for (const [key, p] of a) {
		const q = b.get(key) ?? p;
		out.set(key, {
			startAngle: mix(p.startAngle, q.startAngle, u),
			endAngle: mix(p.endAngle, q.endAngle, u),
			fraction: mix(p.fraction, q.fraction, u),
			offset: mix(p.offset, q.offset, u),
		});
	}
	return out;
}

/**
 * How much of one slice a sweep has uncovered at `progress`, as {@link pieSweep}.
 *
 * @param progress - The sweep, 0..1 of a full turn.
 */
export function sweepShare(
	slice: { offset: number; fraction: number },
	progress: number,
): number {
	if (slice.fraction <= 0) return progress >= slice.offset ? 1 : 0;
	const shown = (progress - slice.offset) / slice.fraction;
	return shown > 0 ? (shown < 1 ? shown : 1) : 0;
}
