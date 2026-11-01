/**
 * Grid lines that stand on an axis's ticks: which values get a line, how
 * strongly each shows while a range transition runs, and the value-keyed
 * `line`s that draw them. Shared by `numberPlane` and `chart` (and `thin` and
 * the defaults by `polarPlane`), so a grid is computed one way.
 *
 * Internal — not in the barrel. Owned by `coords/`; `charts` imports it.
 */

import type { ColorInput } from "../color/index.js";
import type {
	Bounds,
	Point,
	Range,
	RangeTransition,
	WeightedTick,
} from "../geometry/index.js";
import {
	isRangeTransition,
	spacedTicks,
	transitionTicks,
} from "../geometry/index.js";
import type { Readable } from "../reactive/index.js";
import type { CompositeContext } from "../scene/composite.js";
import { instances } from "../scene/instances.js";
import type { SceneNode } from "../scene/types.js";
import { line } from "../shapes/line.js";
import type { AxisTickSource } from "./axis-composition.js";
import { axisTicksAt } from "./axis-composition.js";

/** Spacing, in scene units, at which a grid line fading in or out mid-rescale is gone (whole at twice it). */
const GRID_MIN_GAP = 0.15;

/**
 * Cap on grid lines *per axis* (and on a polar plane's rings and spokes).
 *
 * A grid is one `line` item per line, and a range and a step are two
 * independent numbers — `[0, 100]` with a step of 0.01 is a typo that would
 * otherwise ask the renderer for twenty thousand lines. Past this the grid is
 * thinned by stride: coarser than asked for, but still a grid, and still
 * interactive.
 */
export const MAX_GRID_LINES = 120;
/** Behind the axes, and behind whatever the caller adds at the default z of 0. */
export const DEFAULT_GRID_Z_INDEX = -1;
export const DEFAULT_GRID_OPACITY = 0.45;
export const DEFAULT_MINOR_GRID_OPACITY = 0.22;
export const DEFAULT_GRID_STROKE_WIDTH = 0.02;

/**
 * Thins a sequence to at most `MAX_GRID_LINES`, keeping it evenly spaced.
 * One implementation means one cap, rather than several that drift.
 */
export function thin<T>(values: T[]): T[] {
	if (values.length <= MAX_GRID_LINES) return values;
	const stride = Math.ceil(values.length / MAX_GRID_LINES);
	return values.filter((_, index) => index % stride === 0);
}

/** Options for `gridLineValues`. */
export interface GridLineOptions {
	/**
	 * Lines between consecutive majors (a scale with its own ticks only reads 0 = none).
	 * @default 0
	 */
	minorCount?: number;
	/**
	 * Cap each sequence at `MAX_GRID_LINES` with {@link thin}.
	 * @default false
	 */
	thin?: boolean;
}

/** An axis's grid: major lines and the minor ones between them, by data value. */
export interface GridLineValues {
	majors: number[];
	minors: number[];
}

/** An axis's grid lines, each with its fade. */
export interface WeightedGridLines {
	majors: WeightedTick[];
	minors: WeightedTick[];
}

/**
 * The grid lines for an axis over `range`: exactly the axis's ticks
 * (`axisTicks` through its own scale), so on a log, time, sqrt or symlog
 * axis the lines sit where the axis's ticks do.
 *
 * @param source - The axis's scale and step.
 * @param range - `[min, max, step?]`.
 * @param options - Minor lines and the thinning cap.
 */
export function gridLineValues(
	source: AxisTickSource,
	range: Range,
	options: GridLineOptions = {},
): GridLineValues {
	const { majors, minors } = axisTicksAt(source, range, options.minorCount);
	const capped = options.thin ? thin : (values: number[]) => values;
	return { majors: capped(majors), minors: capped(minors) };
}

/** Every line at full strength: a plain range's grid. */
function fullGridLines(lines: GridLineValues): WeightedGridLines {
	const full = (value: number) => ({ value, weight: 1 });
	return { majors: lines.majors.map(full), minors: lines.minors.map(full) };
}

/**
 * `next`, or `previous` when it is the same point: a kept child rewritten
 * with an equal point keeps its outline (prop writes compare by identity).
 */
export function stablePoint(previous: Point | undefined, next: Point): Point {
	return previous && previous.x === next.x && previous.y === next.y
		? previous
		: next;
}

/** Whether two ranges have the same ends and step. */
export function sameRange(a: Range, b: Range): boolean {
	return a === b || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
}

/** Whether two tick sources would give the same ticks. */
function sameSource(a: AxisTickSource, b: AxisTickSource): boolean {
	return (
		a.scale === b.scale &&
		a.base === b.base &&
		a.timeZone === b.timeZone &&
		a.step === b.step
	);
}

/**
 * One axis's grid lines, each with its fade: 1 on a plain range; during a
 * transition, both ends' lines cross-faded by value (`transitionTicks`),
 * exactly as the axis's own ticks are — shared lines slide, the old end's
 * fade out, the new end's fade in.
 *
 * Returns a function with a cache: each end's lines are laid out once per
 * transition (compared by value, since a caller usually writes the
 * transition inline), not once per frame. Make one per axis in `setup`.
 *
 * @returns `(given, shown, source, options) => lines`: the range as given,
 * the range shown now, the axis's scale and step, and the minor/thinning
 * options.
 */
export function createGridLines(): (
	given: Range | RangeTransition,
	shown: Range,
	source: AxisTickSource,
	options: GridLineOptions,
) => WeightedGridLines {
	let cached: {
		from: Range;
		to: Range;
		source: AxisTickSource;
		minorCount: number | undefined;
		thin: boolean | undefined;
		lines: { from: GridLineValues; to: GridLineValues };
	} | null = null;
	return (given, shown, source, options) => {
		if (!isRangeTransition(given)) {
			cached = null;
			return fullGridLines(gridLineValues(source, shown, options));
		}
		if (
			!cached ||
			!sameRange(cached.from, given.from) ||
			!sameRange(cached.to, given.to) ||
			!sameSource(cached.source, source) ||
			cached.minorCount !== options.minorCount ||
			cached.thin !== options.thin
		) {
			cached = {
				from: given.from,
				to: given.to,
				source,
				minorCount: options.minorCount,
				thin: options.thin,
				lines: {
					from: gridLineValues(source, given.from, options),
					to: gridLineValues(source, given.to, options),
				},
			};
		}
		const at = cached.lines;
		return {
			majors: transitionTicks(at.from.majors, at.to.majors, given.t, shown),
			minors: transitionTicks(at.from.minors, at.to.minors, given.t, shown),
		};
	};
}

/**
 * Options for {@link gridLineNodes}.
 */
export interface GridLinesOptions {
	/** The lines, by data value, each with its fade. */
	ticks: readonly WeightedTick[];
	/** `"x"`: vertical lines at x values; `"y"`: horizontal lines at y values. */
	axis: "x" | "y";
	/** A value's scene coordinate along the axis (scene x for `"x"`, scene y for `"y"`). */
	place: (value: number) => number;
	/** The plotting area the lines span, in scene units. */
	area: Bounds;
	/** Full-strength opacity, multiplied by each line's weight. */
	opacity: number;
	stroke: ColorInput;
	strokeWidth: number;
	zIndex?: number;
	visible?: boolean;
	/** The lines' reveal: a number, or a `Readable` they bind to. */
	progress?: number | Readable<number>;
}

/** What a grid family's channels read: the latest options, written each update. */
interface GridFamily {
	options: GridLinesOptions;
	/** The shared props last handed to the node, to hand the same object while none changed. */
	shared: Record<string, unknown> | null;
}

/** The shared props of a family's lines: the style that does not vary by line. */
function sharedOf(family: GridFamily): Record<string, unknown> {
	const { stroke, strokeWidth, zIndex, visible, progress } = family.options;
	const last = family.shared;
	if (
		last &&
		last.stroke === stroke &&
		last.strokeWidth === strokeWidth &&
		last.zIndex === zIndex &&
		last.visible === visible &&
		last.progress === progress
	)
		return last;
	family.shared = { stroke, strokeWidth, zIndex, visible, progress };
	return family.shared;
}

/**
 * One axis's grid: all its lines as one `instances(line)` node, keyed by
 * value (one node per `slot`), so a line both ends of a transition share is
 * one item that slides, faded by its weight, and one that leaves or enters
 * is an item that does. Each line draws as a `line` node would
 * (same ends, stroke, width, opacity and reveal); what changes is that a
 * family of up to {@link MAX_GRID_LINES} lines is one batched spec instead
 * of that many nodes, which is what a dense grid costs on every mount, pan
 * and tick change.
 *
 * @param ctx - The owning composite's context (its keyed lists).
 * @param slot - The list's name, unique within the composite.
 * @param options - The lines and their style.
 * @returns The one node that draws the family (kept across updates).
 */
export function gridLineNodes(
	ctx: Pick<CompositeContext<unknown>, "list">,
	slot: string,
	given: GridLinesOptions,
): SceneNode[] {
	// Mid-rescale, lines partway in or out make way where they bunch up.
	const ticks = spacedTicks(given.ticks, given.place, GRID_MIN_GAP);
	const options = ticks === given.ticks ? given : { ...given, ticks };
	return ctx.list(slot, [options], {
		// One node for the family, for the composite's life.
		key: () => slot,
		create: (latest) => {
			const family: GridFamily = { options: latest, shared: null };
			const node = instances(line, {
				data: latest.ticks,
				key: (tick: WeightedTick) => tick.value,
				// Made once and reading `family`, so a kept line's value is
				// re-read whenever the node is handed new data.
				channels: {
					from: (tick) => {
						const { axis, place, area } = family.options;
						const at = place(tick.value);
						return axis === "x"
							? { x: at, y: area.minY }
							: { x: area.minX, y: at };
					},
					to: (tick) => {
						const { axis, place, area } = family.options;
						const at = place(tick.value);
						return axis === "x"
							? { x: at, y: area.maxY }
							: { x: area.maxX, y: at };
					},
					opacity: (tick) => family.options.opacity * tick.weight,
				},
				shared: sharedOf(family),
			});
			families.set(node, family);
			return node;
		},
		update: (node, latest) => {
			const family = families.get(node) as GridFamily;
			family.options = latest;
			// A new array: the node re-reads its channels (the placement and
			// area may have moved under the same ticks).
			node.update({ data: latest.ticks.slice(), shared: sharedOf(family) });
		},
	});
}

/** Each family node's latest options. */
const families = new WeakMap<object, GridFamily>();
