/**
 * The coordinate context. `axes`, `numberPlane`, `numberLine`, `polarPlane`
 * and `complexPlane` publish a `CoordinateSystem` down the tree
 * (`coordsContext`) and sideways through `coords(node)` / `coordsOf(node)`.
 *
 * ## Contract
 *
 * A coordinate system object is **immutable**: its methods are pure functions
 * of the values it was made from. A composite that publishes one provides a
 * *new* object (`ctx.provide(coordsContext, next)`) whenever its mapping
 * changes (a range, the plotting-area size, a scale), and keeps the same
 * object while nothing changed. Readers call `ctx.context(coordsContext)` (or
 * {@link requireCoords}) inside `setup`/`update`; because the composite
 * context compares by identity, a new system reruns exactly the readers'
 * `update`, and an unchanged one costs nothing. Never cache a system across
 * updates without re-reading it.
 *
 * Code outside the tree reads a coordinate-publishing node's current system
 * with {@link coordsOf} (or follows it with {@link coordsReadable}).
 */

import type { Bounds, Point, Range, Scale, ScaleSpec } from "../geometry";
import { resolveScale } from "../geometry";
import { progressIn } from "../geometry/lerp";
import type { Readable, Track } from "../reactive";
import { derive, track } from "../reactive";
import { createContextKey } from "../scene/context";
import type { ContextKey, SceneNode } from "../scene/types";

/**
 * The mapping between **data** coordinates (the numbers on the axes) and
 * **scene units** (the stage's own space) that {@link axes},
 * {@link numberPlane}, {@link numberLine} and {@link polarPlane} publish.
 *
 * Obtain one with `ctx.context(coordsContext)` (or {@link requireCoords})
 * inside the tree, or with `coordsOf(node)` from outside. The object is
 * immutable: a range change publishes a new one, so read it again in every
 * `update`. Scene y points up.
 *
 * @category Coordinate systems & graphs
 */
export interface CoordinateSystem {
	/**
	 * Data coordinates → scene units. `y` defaults to 0. Values outside the
	 * range are not clamped; they land outside {@link CoordinateSystem.area}.
	 */
	coordsToPoint(x: number, y?: number): Point;
	/** Scene units → data coordinates. The inverse of `coordsToPoint`. */
	pointToCoords(point: Point): { x: number; y: number };
	/** The x range as given, `[min, max, step?]`. */
	xRange(): Range;
	/** The y range as given, `[min, max, step?]`. A number line reports `[0, 0]`. */
	yRange(): Range;
	/** Scene-unit extent of the plotting area, for clipping decisions and layout. */
	area(): Bounds;
	/**
	 * Data coordinates where the axes cross — see `crossingValue`. Every
	 * baseline in the system agrees with it: where a drop line stops, where a
	 * Riemann rectangle stands, where a bar grows from — and where the axes are
	 * drawn, unless an axis's `position` moves its line to an edge (the
	 * baseline stays here).
	 */
	crossing(): { x: number; y: number };
}

/**
 * Where an axis line is drawn across the other axis: `"zero"` where the axes
 * cross (pinned into range), `"edge"` at the low edge, or a value of the other
 * axis. Ticks, numbers and title move with it; `crossing()` does not.
 *
 * @category Coordinate systems & graphs
 */
export type AxisPosition = "zero" | "edge" | number;

/**
 * {@link AxisPosition} for an x axis, plus the plot's two horizontal edges by
 * name: `"bottom"` (the same as `"edge"`) and `"top"`. A top axis writes its
 * numbers above the line.
 *
 * @category Coordinate systems & graphs
 */
export type XAxisPosition = AxisPosition | "bottom" | "top";

/**
 * {@link AxisPosition} for a y axis, plus the plot's two vertical edges by
 * name: `"left"` (the same as `"edge"`) and `"right"`. A right axis writes its
 * numbers to the right of the line.
 *
 * @category Coordinate systems & graphs
 */
export type YAxisPosition = AxisPosition | "left" | "right";

/**
 * The value of the other axis an axis line is drawn at, resolving an
 * {@link XAxisPosition} or {@link YAxisPosition} against the other range (the
 * low edge is `other[0]`).
 *
 * @param position - Where the axis goes; omitted, `"zero"`.
 * @param other - The range the axis line crosses: the y range for an x axis.
 * @returns A value in `[min(other), max(other)]`.
 *
 * @category Coordinate systems & graphs
 */
export function axisPositionValue(
	position: XAxisPosition | YAxisPosition | undefined,
	other: Range,
): number {
	const min = Math.min(other[0], other[1]);
	const max = Math.max(other[0], other[1]);
	if (typeof position === "number") {
		return Number.isFinite(position)
			? Math.min(max, Math.max(min, position))
			: crossingValue(other);
	}
	switch (position) {
		case "edge":
		case "bottom":
		case "left":
			return other[0];
		case "top":
		case "right":
			return other[1];
		default:
			return crossingValue(other);
	}
}

/**
 * Whether an axis at `position` writes its numbers on the far side: above a
 * `"top"` x axis, right of a `"right"` y axis — away from the plot. Every
 * other position keeps the usual side (below, left).
 *
 * Internal — not in the barrel; shared by `axes` and `chart`.
 */
export function axisFacesFar(
	position: XAxisPosition | YAxisPosition | undefined,
): boolean {
	return position === "top" || position === "right";
}

/**
 * Where the other axis crosses this range: zero when in range, otherwise the
 * nearest end (as Manim does).
 *
 * @param range - A data range; only its ends are used.
 * @returns The value in `[min(range), max(range)]` closest to 0.
 *
 * @category Scene registry & specs
 */
export function crossingValue(range: Range): number {
	const min = Math.min(range[0], range[1]);
	const max = Math.max(range[0], range[1]);
	return Math.min(max, Math.max(min, 0));
}

/**
 * Default paint layer for content that covers the plotting area itself (an
 * image, a field of arrows) rather than marking points in it: above the grid
 * at −1, below the axes, their ticks and their numbers at 0. A graph drawn at
 * the default z of 0 still lands on top of the axes, as in Manim; something
 * that fills the plane would otherwise bury them.
 *
 * @category Extending
 */
export const UNDER_AXES_Z_INDEX = -0.5;

/**
 * The enclosing coordinate system, or `null` outside one. The axes
 * composites provide it; read it in a composite with
 * `ctx.context(coordsContext)` (which reruns its `update` whenever the axes
 * publish a new system) to plot in data space inside an {@link axes} and
 * fall back to scene units elsewhere. Components that cannot work without
 * one use {@link requireCoords}.
 *
 * To publish your own, provide a new immutable object whenever the mapping
 * changes: `ctx.provide(coordsContext, createCartesianCoords({...}))`.
 *
 * @example
 * ```ts
 * import { coordsContext, defineComposite, dot, Invalidate } from "@sophistry/core";
 *
 * export const origin = defineComposite<{}>({
 * 	name: "Origin",
 * 	props: {},
 * 	setup: (ctx) => {
 * 		const coords = ctx.context(coordsContext);
 * 		return [dot.create({ center: coords?.coordsToPoint(0, 0) ?? { x: 0, y: 0 } })];
 * 	},
 * });
 * ```
 *
 * @category Extending
 */
export const coordsContext: ContextKey<CoordinateSystem | null> =
	createContextKey<CoordinateSystem | null>("coords", null);

/**
 * `ctx.context(coordsContext)` for components that need a coordinate
 * system; throws an error naming `component` when there is none. Pass the
 * composite context so the read is tracked (the caller's `update` reruns
 * when the axes publish a new system).
 *
 * @param ctx - Anything with a `context(key)` reader: a composite context, or a node.
 * @param component - The calling component's name, used in the error message.
 * @returns The enclosing {@link CoordinateSystem}.
 * @throws If there is no enclosing `axes`, `numberPlane` or `numberLine`.
 *
 * @category Extending
 */
export function requireCoords(
	ctx: { context<T>(key: ContextKey<T>): T },
	component: string,
): CoordinateSystem {
	const coords = ctx.context(coordsContext);
	if (!coords) {
		throw new Error(
			`<${component}> must be rendered inside an <Axes>, <NumberPlane>, or <NumberLine>.`,
		);
	}
	return coords;
}

/** The system each publishing node last provided, for {@link coordsOf}. */
const published = new WeakMap<object, Track<CoordinateSystem | null>>();

function publishedTrack(node: object): Track<CoordinateSystem | null> {
	let current = published.get(node);
	if (!current) {
		current = track<CoordinateSystem | null>(null);
		published.set(node, current);
	}
	return current;
}

/**
 * Publishes `coords` from a composite: provides it to the subtree under
 * {@link coordsContext} and records it for {@link coordsOf} /
 * {@link coordsReadable}. Call it in `setup` and in every `update` with the
 * current system; publishing the same object again costs nothing.
 *
 * @param ctx - The publishing composite's context.
 * @param coords - Its current, immutable coordinate system.
 *
 * @category Extending
 */
export function publishCoords<S extends CoordinateSystem>(
	ctx: {
		readonly node: SceneNode;
		provide<T>(key: ContextKey<T>, value: T): void;
	},
	coords: S,
): void {
	ctx.provide(coordsContext, coords);
	publishedTrack(ctx.node).set(coords);
}

/**
 * The coordinate system a node publishes (an {@link axes},
 * {@link numberPlane}, {@link numberLine}, {@link polarPlane} or
 * {@link complexPlane}), for imperative `coordsToPoint`/`pointToCoords` from
 * outside the tree. Brings the node up to date first, so it works right
 * after `create`. The system is immutable: read it again after changing the
 * node's props. `null` for a node that publishes none.
 *
 * Cast to the node's richer system where there is one
 * (`coordsOf(plane) as PolarCoordinateSystem`), or use the typed helpers
 * `polarCoordsOf` / `complexCoordsOf`.
 *
 * @example
 * ```ts
 * import { axes, coordsOf, createScene } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const plot = scene.add(axes.create({ xRange: [-5, 5], yRange: [-3, 3], width: 10, height: 6 }));
 * const point = coordsOf(plot)?.coordsToPoint(1, 2);
 * ```
 *
 * @param node - The publishing node.
 * @returns Its current system, or `null`.
 *
 * @category Coordinate systems & graphs
 */
export function coordsOf(node: SceneNode): CoordinateSystem | null {
	(node as { refresh?(): void }).refresh?.();
	return published.get(node)?.peek() ?? null;
}

/**
 * {@link coordsOf} as a `Readable`: it changes whenever the node publishes a
 * new system (a range or size change), so `watch` or `derive` from it to
 * keep something outside the tree in step. `null` until the node first runs
 * (it does on its first commit, or on {@link coordsOf}).
 *
 * @param node - The publishing node.
 * @returns A `Readable` of its current system.
 *
 * @category Coordinate systems & graphs
 */
export function coordsReadable(
	node: SceneNode,
): Readable<CoordinateSystem | null> {
	return publishedTrack(node);
}

/**
 * Everything a rectangular plotting area needs, as plain values: the system
 * made from them is immutable, so make a new one when any of them changes.
 *
 * @category Coordinate systems & graphs
 */
export interface CartesianOptions {
	/** Data range of x. */
	xRange: Range;
	/** Data range of y. */
	yRange: Range;
	/** Scene-unit width of the plotting area. */
	width: number;
	/** Scene-unit height of the plotting area. */
	height: number;
	/** Centre of the plotting area, *not* the data origin. */
	center: Point;
	/**
	 * Per-axis mapping. Defaults to linear.
	 *
	 * This has to live on the coordinate system rather than only on the axis
	 * component: the ticks a `numberLine` draws and the points `coordsToPoint` returns must
	 * come from the *same* `Scale`, or a log axis would label its decades in one
	 * place and plot its graph in another.
	 */
	xScale?: ScaleSpec;
	yScale?: ScaleSpec;
	/** Log base per axis, when the corresponding scale is `"log"`. */
	xBase?: number;
	yBase?: number;
	/**
	 * Per-axis clamping: `coordsToPoint` pins a value outside the range to the range's
	 * end instead of placing it past the plotting area (d3's `clamp`).
	 * `pointToCoords` is unaffected. Defaults to off.
	 */
	xClamp?: boolean;
	yClamp?: boolean;
}

/**
 * The standard rectangular coordinate system, centred on `center` (the range
 * midpoint, as Manim does). Values outside the range are not clamped unless
 * `xClamp`/`yClamp` ask. For custom plane-like components; scenes use
 * {@link axes}.
 *
 * The scales are resolved once, here: `coordsToPoint` runs once per
 * projected point, and the system never changes after it is made.
 *
 * @example
 * ```ts
 * import { createCartesianCoords } from "@sophistry/core";
 *
 * const coords = createCartesianCoords({
 * 	xRange: [-5, 5],
 * 	yRange: [-3, 3],
 * 	width: 10,
 * 	height: 6,
 * 	center: { x: 0, y: 0 },
 * });
 * coords.coordsToPoint(1, 2); // { x: 1, y: 2 }
 * ```
 *
 * @param options - Ranges, plotting-area size and centre (and optional scales).
 * @returns An immutable {@link CoordinateSystem}.
 *
 * @category Extending
 */
export function createCartesianCoords(
	options: CartesianOptions,
): CoordinateSystem {
	const { xRange, yRange, width, height, center } = options;
	const xScale: Scale = resolveScale(
		options.xScale,
		[xRange[0], xRange[1]],
		options.xBase,
	);
	const yScale: Scale = resolveScale(
		options.yScale,
		[yRange[0], yRange[1]],
		options.yBase,
	);
	const pin = (unit: number, clamp: boolean | undefined) =>
		clamp ? Math.min(1, Math.max(0, unit)) : unit;
	const crossing = { x: crossingValue(xRange), y: crossingValue(yRange) };
	const area: Bounds = {
		minX: center.x - width / 2,
		minY: center.y - height / 2,
		maxX: center.x + width / 2,
		maxY: center.y + height / 2,
	};

	return Object.freeze({
		coordsToPoint: (x: number, y = 0): Point => ({
			x: center.x + (pin(xScale.toUnit(x), options.xClamp) - 0.5) * width,
			y: center.y + (pin(yScale.toUnit(y), options.yClamp) - 0.5) * height,
		}),
		pointToCoords: (point: Point) => ({
			x: xScale.fromUnit(width === 0 ? 0 : (point.x - center.x) / width + 0.5),
			y: yScale.fromUnit(
				height === 0 ? 0 : (point.y - center.y) / height + 0.5,
			),
		}),
		xRange: () => xRange,
		yRange: () => yRange,
		crossing: () => ({ ...crossing }),
		area: () => ({ ...area }),
	});
}

/**
 * One composite's `progress` split into `count` consecutive phases (axis line,
 * ticks, numbers), returning phase `index`'s share.
 *
 * @param progress - The composite's overall reveal, 0..1.
 * @param index - Which phase (0-based) to report.
 * @param count - Total number of phases.
 * @returns `clamp(progress * count - index)`.
 *
 * @category Scene registry & specs
 */
export function phaseProgress(
	progress: number,
	index: number,
	count: number,
): number {
	// In phase-lengths, so a phase boundary is exact rather than a rounded share.
	return progressIn(progress * count, index, index + 1);
}

/**
 * {@link phaseProgress} for every phase, each a `Readable` derived from the
 * composite's `progress` (bind a child's `progress` to it), so a child whose
 * phase is finished sees no change while the reveal runs on. Call once per
 * composite, in `setup`.
 *
 * @example
 * ```ts
 * import { createPhases, defineComposite, line, Invalidate } from "@sophistry/core";
 *
 * // Draws the first leg, then the second, as `progress` runs 0..1.
 * export const corner = defineComposite<{ progress?: number }>({
 * 	name: "Corner",
 * 	props: { progress: { default: 1, invalidates: Invalidate.NONE } },
 * 	setup: (ctx) => {
 * 		const phases = createPhases(ctx.prop("progress"), 2);
 * 		return [
 * 			line.create({ from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, progress: phases(0) }),
 * 			line.create({ from: { x: 1, y: 0 }, to: { x: 1, y: 1 }, progress: phases(1) }),
 * 		];
 * 	},
 * });
 * ```
 *
 * @param progress - The composite's overall reveal, 0..1 (undefined is 1).
 * @param count - Total number of phases.
 * @returns A function from phase index to that phase's own progress, 0..1.
 *
 * @category Scene registry & specs
 */
export function createPhases(
	progress: Readable<number | undefined>,
	count: number,
): (index: number) => Readable<number> {
	const phases: Readable<number>[] = [];
	return (index) => {
		phases[index] ??= derive(progress, (value) =>
			phaseProgress(value ?? 1, index, count),
		);
		return phases[index] as Readable<number>;
	};
}
