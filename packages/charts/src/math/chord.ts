/**
 * Chord diagram layout over a square flow matrix: `matrix[i][j]` is the
 * flow from group `i` to `j`. Each group is an arc as long as its outflow;
 * a chord joins sub-arc `i → j` to `j → i`, each end as wide as its flow.
 * Angles are radians from +x, y up, starting at 12 o'clock clockwise.
 */

import type { Point } from "@sophistry/core/geometry";
import { polarPoint } from "@sophistry/core/internal";
import type { PolarSweepOptions } from "./shared/polar";
import { resolvePolarSweep, TAU } from "./shared/polar";

/** @category Math */
export interface ChordOptions extends PolarSweepOptions {
	/** Gap between neighbouring groups, in radians. @default 0.04 */
	padAngle?: number;
	/** Order each group's sub-arcs by descending flow instead of by column. @default false */
	sortSubgroups?: boolean;
	/**
	 * Every non-zero `matrix[i][j]` becomes its own chord, equally wide at both
	 * ends, and a group's arc holds outflow then inflow (so receive-only groups
	 * get an arc). Off, one chord per pair with arcs sized by outflow.
	 * @default false
	 */
	directed?: boolean;
}

/**
 * One group's arc.
 *
 * @category Math & helpers
 */
export interface ChordGroup {
	/** Row (and column) of the matrix. */
	index: number;
	/** Radians from +x, where the arc begins. */
	startAngle: number;
	/** Radians from +x, where it ends: `endAngle - startAngle` is the signed sweep. */
	endAngle: number;
	/** The row's total: everything leaving the group (plus, when `directed`, everything arriving). */
	value: number;
}

/**
 * One end of a chord: a sub-arc of a group.
 *
 * @category Math & helpers
 */
export interface ChordEnd {
	/** The group the end sits on. */
	index: number;
	/** The group at the chord's other end. */
	subindex: number;
	startAngle: number;
	endAngle: number;
	/** The flow this end stands for: `matrix[index][subindex]` (a directed chord's target end: `matrix[subindex][index]`). */
	value: number;
}

/**
 * A chord between two groups (or a group and itself).
 *
 * @category Math & helpers
 */
export interface ChordLink {
	/** The end with the larger flow. */
	source: ChordEnd;
	/** The other end. */
	target: ChordEnd;
}

/** @category Math */
export interface ChordLayout {
	/** One arc per matrix row, in index order. */
	groups: ChordGroup[];
	/** One chord per pair of groups with any flow between them, by source row then column. */
	chords: ChordLink[];
}

const DEFAULT_PAD_ANGLE = 0.04;

const clean = (value: number | undefined) =>
	value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Lays a square flow matrix out as a chord diagram's groups and chords.
 *
 * @param matrix - `matrix[i][j]` is the flow from `i` to `j`; negative and non-finite entries count as 0, ragged rows are padded with 0.
 * @returns The groups and chords; no chords and zero-length groups when there is no flow.
 * @category Math & helpers
 */
export function chordLayout(
	matrix: readonly (readonly number[])[],
	options: ChordOptions = {},
): ChordLayout {
	const n = matrix.length;
	const flow = (i: number, j: number) => clean(matrix[i]?.[j]);
	const directed = options.directed === true;
	/** Sub-arcs of group `i`, in order: `[from, to, value]`, outgoing then (directed) incoming. */
	const subgroups = (i: number) => {
		const out: { from: number; to: number; value: number }[] = [];
		for (let j = 0; j < n; j++) out.push({ from: i, to: j, value: flow(i, j) });
		if (options.sortSubgroups)
			out.sort((a, b) => b.value - a.value || a.to - b.to);
		if (!directed) return out;
		const into: { from: number; to: number; value: number }[] = [];
		for (let j = 0; j < n; j++)
			into.push({ from: j, to: i, value: flow(j, i) });
		if (options.sortSubgroups)
			into.sort((a, b) => b.value - a.value || a.from - b.from);
		return [...out, ...into];
	};
	const plan = Array.from({ length: n }, (_, i) => subgroups(i));
	const sums = plan.map((subs) => subs.reduce((sum, s) => sum + s.value, 0));
	const total = sums.reduce((a, b) => a + b, 0);
	const pad = Math.max(0, clean(options.padAngle ?? DEFAULT_PAD_ANGLE));
	const { startAngle, direction } = resolvePolarSweep(options);
	// Gaps only where there is something to separate.
	const live = sums.filter((s) => s > 0).length;
	const usable = Math.max(0, TAU - pad * live);
	const k = total > 0 ? usable / total : 0;

	const groups: ChordGroup[] = [];
	/** `outgoing[i][j]`: the sub-arc on `i` for `i → j`; `incoming[i][j]`: on `i` for `j → i` (directed only). */
	const outgoing: ChordEnd[][] = Array.from({ length: n }, () => []);
	const incoming: ChordEnd[][] = Array.from({ length: n }, () => []);
	let angle = startAngle;
	for (let i = 0; i < n; i++) {
		const start = angle;
		for (const sub of plan[i]) {
			const end = angle + direction * sub.value * k;
			const leaving =
				sub.from === i && (!directed || outgoing[i][sub.to] === undefined);
			const other = leaving ? sub.to : sub.from;
			const piece: ChordEnd = {
				index: i,
				subindex: other,
				startAngle: angle,
				endAngle: end,
				value: sub.value,
			};
			if (leaving) outgoing[i][other] = piece;
			else incoming[i][other] = piece;
			angle = end;
		}
		groups.push({
			index: i,
			startAngle: start,
			endAngle: angle,
			value: sums[i],
		});
		if (sums[i] > 0) angle += direction * pad;
	}

	const chords: ChordLink[] = [];
	for (let i = 0; i < n; i++) {
		if (directed) {
			for (let j = 0; j < n; j++) {
				const source = outgoing[i][j];
				if (source.value > 0) chords.push({ source, target: incoming[j][i] });
			}
			continue;
		}
		for (let j = i; j < n; j++) {
			const a = outgoing[i][j];
			const b = outgoing[j][i];
			if (!(a.value > 0 || b.value > 0)) continue;
			chords.push(
				a.value < b.value ? { source: b, target: a } : { source: a, target: b },
			);
		}
	}
	return { groups, chords };
}

/** @category Math */
export interface ChordRibbonOptions {
	/** Centre. Defaults to the origin. */
	center?: Point;
	/** Points per radian along each end's arc. @default 24 */
	arcDensity?: number;
	/** Points along each curve through the middle. @default 24 */
	curveSamples?: number;
	/**
	 * Draw the target end as an arrowhead: the ribbon stops this far short of
	 * the circle and narrows to a point on it. For directed chords; in
	 * `radius`'s units.
	 * @default 0
	 */
	headRadius?: number;
}

/**
 * A chord's ribbon as one open ring: along the source arc, a quadratic
 * curve through the centre to the target, along its arc (or an arrowhead
 * with `headRadius`), and back.
 *
 * @param radius - Radius the ends sit on.
 * @category Math & helpers
 */
export function chordRibbon(
	chord: ChordLink,
	radius: number,
	options: ChordRibbonOptions = {},
): Point[] {
	const { x: cx, y: cy } = options.center ?? { x: 0, y: 0 };
	const density = Math.max(1, options.arcDensity ?? 24);
	const steps = Math.max(2, Math.floor(options.curveSamples ?? 24));
	const at = (angle: number): Point => polarPoint(cx, cy, radius, angle);
	const ring: Point[] = [];
	const arc = (from: number, to: number) => {
		const n = Math.max(1, Math.ceil(Math.abs(to - from) * density));
		for (let i = 0; i <= n; i++) ring.push(at(from + ((to - from) * i) / n));
	};
	/** Quadratic from the last point to `to`, controlled by the centre; endpoints excluded. */
	const curve = (to: Point) => {
		const from = ring[ring.length - 1];
		for (let i = 1; i < steps; i++) {
			const t = i / steps;
			const u = 1 - t;
			ring.push({
				x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
				y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
			});
		}
	};
	const { source: s, target: t } = chord;
	const head = Math.min(
		Math.max(
			0,
			Number.isFinite(options.headRadius) ? (options.headRadius as number) : 0,
		),
		radius,
	);
	arc(s.startAngle, s.endAngle);
	const same = s.startAngle === t.startAngle && s.endAngle === t.endAngle;
	if (head > 0) {
		// The ribbon's sides land `head` short of the circle, then meet at the
		// tip, on the circle in the middle of the target end.
		const short = (angle: number): Point =>
			polarPoint(cx, cy, radius - head, angle);
		const start = short(t.startAngle);
		curve(start);
		ring.push(start);
		ring.push(at((t.startAngle + t.endAngle) / 2));
		ring.push(short(t.endAngle));
	} else if (!same) {
		curve(at(t.startAngle));
		arc(t.startAngle, t.endAngle);
	}
	curve(at(s.startAngle));
	return ring;
}
