/**
 * Radar geometry: one vertex per value, evenly spaced round a full turn by
 * index, with the value mapped to radius.
 */

import type { BandKey, Point } from "@sophistry/core/geometry";
import { clampNonNegative, maxOf, wrapAngle } from "@sophistry/core/internal";
import { keyedJoin } from "./join";
import type { PolarSweepOptions } from "./shared/polar";
import { resolvePolarSweep, TAU } from "./shared/polar";

/** @category Math */
export interface RadarVertex extends Point {
	/** Position in the input `values`, keeping per-axis labels aligned. */
	index: number;
	/** The (clamped) value this vertex represents. */
	value: number;
	/** Radians from +x this axis points along. */
	angle: number;
}

/** @category Math */
export interface RadarOptions extends PolarSweepOptions {
	/**
	 * The value that reaches the outer radius. Pass it when overlaying several
	 * series so they share one scale. Defaults to the greatest finite value in `values`.
	 */
	maxValue?: number;
}

/**
 * One vertex per value on the unit circle, scaled by the value's share of
 * `maxValue`, returned open (`<Polygon>` closes it). A zero still gets a
 * vertex at the origin, keeping `index` aligned with the axis labels.
 *
 * @param values - One value per axis; negative and non-finite entries clamp to 0.
 * @returns One {@link RadarVertex} per value; `[]` for fewer than 3 values.
 * @category Math & helpers
 */
export function radarVertices(
	values: readonly number[],
	options: RadarOptions = {},
): RadarVertex[] {
	const n = values.length;
	if (n < 3) return [];

	const clamped = values.map(clampNonNegative);
	const maxValue = options.maxValue ?? maxOf(clamped, 0);

	const { startAngle, direction } = resolvePolarSweep(options);
	const step = (direction * TAU) / n;

	return clamped.map((value, index) => {
		const angle = startAngle + index * step;
		const radius = maxValue > 0 ? value / maxValue : 0;
		return {
			index,
			value,
			angle,
			x: radius * Math.cos(angle),
			y: radius * Math.sin(angle),
		};
	});
}

/**
 * Checks that every non-empty group has exactly one value per axis label.
 *
 * @throws If a non-empty group's length differs from `axisLabels.length`.
 */
export function assertRadarShape(
	groups: readonly (readonly number[])[],
	axisLabels?: readonly string[],
): void {
	if (!axisLabels) return;
	groups.forEach((group, i) => {
		if (group.length > 0 && group.length !== axisLabels.length) {
			throw new Error(
				`RadarChart: group ${i} has ${group.length} values but axisLabels has ${axisLabels.length}; each group needs exactly one value per axis`,
			);
		}
	});
}

/**
 * One axis of a radar chart on one frame of a keyed transition between two
 * axis sets. See {@link radarAxisFrames}.
 *
 * @category Math & helpers
 */
export interface RadarAxisFrame {
	/** The axis's identity: its name, or its position when the axes are unnamed. */
	key: BandKey;
	/** Its place in the union of both ends' axes (`from`'s in order, then those only in `to`). */
	slot: number;
	/** Its index among `from`'s axes, or -1 when only `to` has it. */
	from: number;
	/** Its index among `to`'s axes, or -1 when only `from` has it (or without a `to`). */
	to: number;
	/** Whether both ends have it (always, without a `to`): it never folds away. */
	anchor: boolean;
	/** Radians from +x it points along on this frame. */
	angle: number;
	/** 0..1: how far it is unfolded (1 for an anchor, `1 − exit` leaving, `enter` arriving). */
	weight: number;
}

/**
 * Options for {@link radarAxisFrames}: the sweep, and each stage's progress.
 *
 * @category Math & helpers
 */
export interface RadarAxisFrameOptions extends PolarSweepOptions {
	/** Progress of the exit stage, 0..1. */
	exit?: number;
	/** Progress of the update stage, 0..1. */
	update?: number;
	/** Progress of the enter stage, 0..1. */
	enter?: number;
}

/** The angle from `a` to `b` in (−π, π]. */
function turnBetween(a: number, b: number): number {
	let d = (b - a) % TAU;
	if (d > Math.PI) d -= TAU;
	if (d <= -Math.PI) d += TAU;
	return d;
}

/**
 * A radar chart's axes on one frame of a keyed transition between two axis
 * sets, matched by name (or position). Axes in both ends turn the short way
 * on the update stage; others fold away (exit) or unfold (enter) between
 * their neighbours. All stages at 0 gives `from`'s axes, at 1 `to`'s.
 *
 * @param to - The axis keys at the end; undefined without a transition.
 * @returns Every axis of either end, in drawing order.
 * @category Math & helpers
 */
export function radarAxisFrames(
	from: readonly BandKey[],
	to: readonly BandKey[] | undefined,
	options: RadarAxisFrameOptions = {},
): RadarAxisFrame[] {
	const { startAngle, direction } = resolvePolarSweep(options);
	const angleIn = (i: number, n: number) =>
		startAngle + i * ((direction * TAU) / n);
	if (to === undefined) {
		return from.map((key, i) => ({
			key,
			slot: i,
			from: i,
			to: -1,
			anchor: true,
			angle: angleIn(i, from.length),
			weight: 1,
		}));
	}
	const join = keyedJoin(from, to);
	const exit = options.exit ?? 0;
	const update = options.update ?? 0;
	const enter = options.enter ?? 0;
	/** An anchor's angle on this frame. */
	const anchorAngle = (a: number, b: number) => {
		const p = angleIn(a, from.length);
		const q = angleIn(b, to.length);
		return update <= 0 ? p : update >= 1 ? q : p + turnBetween(p, q) * update;
	};
	/** An axis only one end has, placed between that end's neighbouring anchors as they turn. */
	const between = (keys: readonly BandKey[], i: number) => {
		const n = keys.length;
		const own = angleIn(i, n);
		const anchorAt = (j: number) => {
			const key = keys[j];
			const a = join.from.get(key);
			const b = join.to.get(key);
			return a !== undefined && b !== undefined ? { j, a, b } : undefined;
		};
		let prev: { j: number; a: number; b: number } | undefined;
		let next: typeof prev;
		for (let step = 1; step < n && !prev; step++)
			prev = anchorAt((i - step + n) % n);
		for (let step = 1; step < n && !next; step++)
			next = anchorAt((i + step) % n);
		if (!prev || !next) return own;
		const shift = (anchor: { j: number; a: number; b: number }) =>
			turnBetween(angleIn(anchor.j, n), anchorAngle(anchor.a, anchor.b));
		const p = shift(prev);
		const q = shift(next);
		if (p === 0 && q === 0) return own;
		// Evenly spaced at its end, so the way from one anchor to the next is
		// counted in places.
		const f = ((i - prev.j + n) % n) / ((next.j - prev.j + n) % n || n);
		return own + p + (q - p) * f;
	};
	const frames = join.keys.map((key, slot): RadarAxisFrame => {
		const a = join.from.get(key);
		const b = join.to.get(key);
		if (a !== undefined && b !== undefined)
			return {
				key,
				slot,
				from: a,
				to: b,
				anchor: true,
				angle: anchorAngle(a, b),
				weight: 1,
			};
		if (a !== undefined)
			return {
				key,
				slot,
				from: a,
				to: -1,
				anchor: false,
				angle: between(from, a),
				weight: 1 - exit,
			};
		const j = b as number;
		return {
			key,
			slot,
			from: -1,
			to: j,
			anchor: false,
			angle: between(to, j),
			weight: enter,
		};
	});
	const offset = (frame: RadarAxisFrame) =>
		wrapAngle((frame.angle - startAngle) * direction);
	return frames
		.map((frame) => ({ frame, at: offset(frame) }))
		.sort((p, q) => p.at - q.at)
		.map(({ frame }) => frame);
}

/**
 * A radar polygon over {@link radarAxisFrames}' axes, in unit-circle
 * coordinates. A folding axis, or one with no value, pulls its vertex onto
 * the chord between its neighbours, so corners grow out of or flatten into
 * the edge; with every axis whole this is {@link radarVertices}' polygon.
 *
 * @param valueAt - The series' value on an axis, or undefined where it has none.
 * @returns The vertices; `[]` for fewer than 3.
 * @category Math & helpers
 */
export function radarFramePolygon(
	axes: readonly RadarAxisFrame[],
	valueAt: (axis: RadarAxisFrame) => number | undefined,
	maxValue: number,
): Point[] {
	const own = axes.map((axis): Point | undefined => {
		const value = valueAt(axis);
		if (value === undefined) return undefined;
		const radius = maxValue > 0 ? clampNonNegative(value) / maxValue : 0;
		return {
			x: radius * Math.cos(axis.angle),
			y: radius * Math.sin(axis.angle),
		};
	});
	const anchors = axes.flatMap((axis, i) => (axis.anchor && own[i] ? [i] : []));
	const n = axes.length;
	const out: Point[] = [];
	axes.forEach((axis, i) => {
		const point = own[i];
		const weight = point ? (axis.anchor ? 1 : axis.weight) : 0;
		if (!(weight > 0) || !point) return;
		if (weight >= 1) {
			out.push(point);
			return;
		}
		let chord: Point = { x: 0, y: 0 };
		if (anchors.length >= 2) {
			let prev = -1;
			let next = -1;
			for (let step = 1; step < n && prev < 0; step++) {
				const j = (i - step + n) % n;
				if (axes[j].anchor && own[j]) prev = j;
			}
			for (let step = 1; step < n && next < 0; step++) {
				const j = (i + step) % n;
				if (axes[j].anchor && own[j]) next = j;
			}
			const p = own[prev] as Point;
			const q = own[next] as Point;
			// How far round from the anchor before to this axis, of the way to
			// the anchor after, gap by gap (each under half a turn).
			const gaps = (start: number, end: number) => {
				let sum = 0;
				for (let k = start; k !== end; k = (k + 1) % n)
					sum += Math.abs(turnBetween(axes[k].angle, axes[(k + 1) % n].angle));
				return sum;
			};
			const reach = gaps(prev, i);
			const span = reach + gaps(i, next);
			const f = span > 0 ? reach / span : 0.5;
			chord = { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
		}
		out.push({
			x: chord.x + (point.x - chord.x) * weight,
			y: chord.y + (point.y - chord.y) * weight,
		});
	});
	return out.length < 3 ? [] : out;
}

/** How close to vertical or horizontal (as a sine, 15°) a spoke must be before its name starts centring across it. */
const LABEL_CENTRING = Math.sin(Math.PI / 12);

/**
 * Where an axis name's box centre sits relative to its spoke's outer end, so
 * the box clears the ring by `gap` with its inner side facing the chart.
 * Alignment blends smoothly within 15° of vertical and horizontal, so names
 * on turning axes move without jumps.
 *
 * @param angle - The spoke's angle, radians from +x (y up).
 * @param size - The name's box, in the units of the result.
 * @category Math & helpers
 */
export function radarLabelOffset(
	angle: number,
	size: { width: number; height: number },
	gap: number,
): Point {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const side = (v: number) => Math.max(-1, Math.min(1, v / LABEL_CENTRING));
	return {
		x: cos * gap + (side(cos) * size.width) / 2,
		y: sin * gap + (side(sin) * size.height) / 2,
	};
}
