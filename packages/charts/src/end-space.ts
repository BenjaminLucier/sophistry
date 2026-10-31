/**
 * Where a keyed mark draws each end of its transition when a fitted axis
 * changes kind between them (band ↔ continuous). Internal.
 */

import type { CoordinateSystem } from "@sophistry/core";
import type { BandScale, Point } from "@sophistry/core/geometry";
import type { ChartEnds, ChartFrame } from "./frame/types";
import type { JoinEnd, JoinFrame } from "./join";
import type { AreaPoint } from "./math/morph";
import { mix, mixPoint } from "./util";

/**
 * What a mark's geometry maps through: a plot's `coordsToPoint`, {@link SCENE_UNITS},
 * or mid-swap one of {@link EndSpace.morph}'s mixed-unit mappings.
 */
export interface Mapper extends Pick<CoordinateSystem, "coordsToPoint"> {
	/** Which coordinates `coordsToPoint` takes already in scene units (the swapping axes, mid-swap); the rest it maps from data units. */
	scene?: { x: boolean; y: boolean };
}

/** A mapping for geometry already in scene units: `coordsToPoint` returns its point as given. */
export const SCENE_UNITS: Mapper = {
	coordsToPoint: (x, y = 0) => ({ x, y }),
	scene: { x: true, y: true },
};

/** Into a mid-swap morph's units from one end's data: swapping axes into scene units through that end's plot, others left in data units. */
function swapUnits(ends: ChartEnds, end: JoinEnd): Mapper {
	const system = ends[end].coords;
	if (ends.x && ends.y) return system;
	return {
		coordsToPoint: (x, y = 0) => {
			const at = system.coordsToPoint(x, y);
			return { x: ends.x ? at.x : x, y: ends.y ? at.y : y };
		},
	};
}

/** Out of a mid-swap morph's units to scene units: swapping axes as given, others through `coords`. */
function blendUnits(ends: ChartEnds, coords: CoordinateSystem): Mapper {
	if (ends.x && ends.y) return SCENE_UNITS;
	return {
		coordsToPoint: (x, y = 0) => {
			const at = coords.coordsToPoint(x, y);
			return { x: ends.x ? x : at.x, y: ends.y ? y : at.y };
		},
		scene: { x: ends.x, y: ends.y },
	};
}

/** Area runs through `coords`, for a mid-swap area morph; runs reversed by the mapping are turned around so the morph still blends per x. */
export function sceneAreaRuns(
	runs: readonly (readonly AreaPoint[])[],
	coords: Mapper,
): AreaPoint[][] {
	return runs.map((run) => {
		const out = run.map((p) => {
			const top = coords.coordsToPoint(p.x, p.y1);
			return { x: top.x, y1: top.y, y2: coords.coordsToPoint(p.x, p.y2).y };
		});
		return out.length > 1 && out[0].x > out[out.length - 1].x
			? out.reverse()
			: out;
	});
}

/** Where a mark draws each end of its keyed transition: see {@link endSpace}. */
export interface EndSpace {
	/** The plot at each end while a fitted axis changes kind (see {@link ChartEnds}); undefined otherwise. */
	ends: ChartEnds | undefined;
	/** The coordinates a datum of `end` maps through: that end's plot mid-swap, else the mark's own. */
	coords(end: JoinEnd): CoordinateSystem;
	/** A band axis's scale at `end`: that end's mid-swap, else the chart's now. */
	band(end: JoinEnd, axis: "x" | "y"): BandScale | undefined;
	/**
	 * A key in both ends, in scene units at update progress `u`, from `a` (its
	 * `data` datum) to `b` (its `to` datum). Mid-swap, the swapping axis blends
	 * in scene units between the two ends' plots. Exact at `u` 0 and 1.
	 */
	point(a: Point, b: Point, u: number): Point;
	/** Whether a kind swap runs; marks building their own geometry then build each end through its own `coords` and blend in scene units. */
	swapping: boolean;
	/**
	 * A per-datum mark's anchor on one key's frame, in scene units. `anchor`
	 * reads one end's state as a data-unit point. Mid-swap, a key in both ends
	 * blends between its two ends' anchors; any other maps through its own end.
	 */
	place<S>(
		frame: JoinFrame<S>,
		anchor: (state: S, end: JoinEnd) => Point,
	): Point;
	/**
	 * A per-datum mark's own geometry on one key's frame: `build` maps one
	 * end's state through given coordinates. Mid-swap, a key in both ends
	 * builds each end through its own plot and `blend`s them in scene units.
	 */
	shape<S, G>(
		frame: JoinFrame<S>,
		build: (state: S, end: JoinEnd, coords: CoordinateSystem) => G | null,
		blend: (a: G, b: G, u: number) => G,
	): G | null;
	/**
	 * A grouped mark's shape for a group in both ends at update progress `u`.
	 * Without a swap, `morph` blends in data units and `build` maps through the
	 * mark's coordinates. Mid-swap, only the swapping axis blends in scene
	 * units (via `scene`), so an axis that keeps its kind (log, sqrt) morphs
	 * exactly as without a swap. Exact at `u` 0 and 1.
	 */
	morph<S, G>(
		a: S,
		b: S,
		u: number,
		spec: {
			scene: (state: S, coords: Mapper, end: JoinEnd) => S;
			morph: (a: S, b: S, u: number) => S;
			build: (state: S, coords: Mapper, end: JoinEnd) => G;
		},
	): G;
	/** Where the axes are drawn at `end`, in data units: that end's own mid-swap, else the chart's; outside a chart, the crossing. */
	axesAt(end: JoinEnd): { x: number; y: number };
}

/**
 * Plumbing for a keyed mark in a {@link Chart} whose fitted axis changes
 * kind between the ends (a bar chart's categories becoming a number line).
 * Keys in both ends move from where end A draws them to where end B does,
 * leaving keys draw through end A, entering keys through end B, so nothing
 * jumps when the plot switches axes. Without a swap every method is the
 * plain path. Call in each `update` with the frame and coordinates it read.
 *
 * @param coords - The coordinates the mark otherwise draws through.
 */
export function endSpace(
	frame: ChartFrame | null,
	coords: CoordinateSystem,
): EndSpace {
	const plot = frame;
	const ends = (): ChartEnds | undefined => plot?.ends;
	const at = (end: JoinEnd) => ends()?.[end].coords ?? coords;
	const point = (a: Point, b: Point, u: number): Point => {
		const own = ends();
		if (!own) return coords.coordsToPoint(mix(a.x, b.x, u), mix(a.y, b.y, u));
		if (u <= 0) return own.from.coords.coordsToPoint(a.x, a.y);
		if (u >= 1) return own.to.coords.coordsToPoint(b.x, b.y);
		// The axis that keeps its kind blends as it always does.
		const at = mixPoint(
			swapUnits(own, "from").coordsToPoint(a.x, a.y),
			swapUnits(own, "to").coordsToPoint(b.x, b.y),
			u,
		);
		return blendUnits(own, coords).coordsToPoint(at.x, at.y);
	};
	return {
		ends: ends(),
		coords: at,
		band: (end, axis) => {
			const own = ends();
			if (own) return axis === "x" ? own[end].xBand : own[end].yBand;
			return axis === "x" ? plot?.xBand : plot?.yBand;
		},
		point,
		swapping: ends() !== undefined,
		place: (frame, anchor) => {
			const pair = frame.pair;
			if (pair && ends())
				return point(anchor(pair.a, "from"), anchor(pair.b, "to"), pair.u);
			const own = anchor(frame.state, frame.end);
			return at(frame.end).coordsToPoint(own.x, own.y);
		},
		shape: (frame, build, blend) => {
			const pair = frame.pair;
			if (!pair || !ends()) return build(frame.state, frame.end, at(frame.end));
			const a = build(pair.a, "from", at("from"));
			const b = build(pair.b, "to", at("to"));
			if (a === null || b === null) return pair.u < 0.5 ? a : b;
			return blend(a, b, pair.u);
		},
		morph: (a, b, u, spec) => {
			const own = ends();
			if (!own) return spec.build(spec.morph(a, b, u), coords, "from");
			if (u <= 0) return spec.build(a, own.from.coords, "from");
			if (u >= 1) return spec.build(b, own.to.coords, "to");
			// Per axis: the swapping one in scene units, the other in data units.
			return spec.build(
				spec.morph(
					spec.scene(a, swapUnits(own, "from"), "from"),
					spec.scene(b, swapUnits(own, "to"), "to"),
					u,
				),
				blendUnits(own, coords),
				u < 0.5 ? "from" : "to",
			);
		},
		axesAt: (end) => ends()?.[end].axesAt ?? plot?.axesAt ?? coords.crossing(),
	};
}
