/**
 * `functionGraph`, `parametricGraph` and `polarGraph`: curves in data
 * coordinates, mapped through the enclosing coordinate system.
 *
 * Samples are split into separate polylines at non-finite values, at inputs
 * listed in `discontinuities` (never evaluated), and at jumps larger than
 * `jumpThreshold` of the axis extent (a heuristic). Samples outside the plotting
 * area are dropped, with the edge crossing found by bisection (`clip: false`
 * turns it off).
 *
 * Each graph is a composite drawing one shape: the composite reads the
 * coordinate system from context (a shape cannot), samples the curve whenever
 * the function, the domain or the system changes, and hands the shape its
 * outline. Style props (`stroke`, `progress`, ...) are bound straight through
 * to the shape, so animating one never re-samples the curve.
 */

import type { Point, Range } from "../geometry/index.js";
import { polylineToCurvePath } from "../geometry/index.js";
import { isFinitePoint } from "../geometry/num.js";
import type { Changes, CompositeNode } from "../scene/composite.js";
import { defineComposite } from "../scene/composite.js";
import { Invalidate } from "../scene/context.js";
import type {
	ShapeInstanceable,
	ShapeNode,
	ShapeProps,
} from "../scene/shape.js";
import { defineShape, shapeProps } from "../scene/shape.js";
import type { Definition, PropsDescriptor, SceneNode } from "../scene/types.js";
import {
	forwardedProps,
	forwardHandlers,
	forwardProps,
} from "../shapes/forward.js";
import type { ShapeGeometry } from "../spec/bake.js";
import type { CoordinateSystem } from "./coords.js";
import { requireCoords } from "./coords.js";
import type { PolarCoordinateSystem } from "./polar-plane.js";

const DEFAULT_SAMPLES = 160;
/** A step of half the axis extent between neighbours is not a curve, it's a cliff. */
const DEFAULT_JUMP_THRESHOLD = 0.5;
/** Overshoot past the plotting area before a sample counts as outside. */
const DEFAULT_CLIP_PADDING = 0.02;
/** Bisection steps for a boundary crossing: 12 halvings of one sample interval. */
const CROSSING_REFINEMENTS = 12;
/** Clearance either side of a named discontinuity, as a fraction of the domain. */
const DISCONTINUITY_CLEARANCE = 1e-9;

/**
 * Sampling controls shared by every curve in data space.
 *
 * @category Coordinate systems & graphs
 */
export interface CurveSampling {
	/**
	 * Evaluations across the whole domain (sampling is by input, not by screen distance).
	 * @default 160
	 */
	samples?: number;
	/** Inputs (data units) where the function is known to break. The curve is split there exactly — no heuristic. */
	discontinuities?: number[];
	/**
	 * Step between neighbouring samples, as a fraction of the axis extent, above
	 * which the run is split. Defaults to 0.5. See the note at the top of the
	 * file: this is a heuristic and it is wrong in both directions.
	 */
	jumpThreshold?: number;
	/**
	 * Drop samples outside the plotting area.
	 * @default true
	 */
	clip?: boolean;
	/**
	 * How far past the area a sample may stray before it is dropped, as a fraction of the axis extent.
	 * @default 0.02
	 */
	clipPadding?: number;
}

/** Data-space extent of a range. A degenerate axis reports 1, never 0. */
function extentOf(range: Range): number {
	const span = Math.abs(range[1] - range[0]);
	return span > 0 ? span : 1;
}

/** The padded plotting area, in *data* coordinates. */
interface Band {
	xLow: number;
	xHigh: number;
	yLow: number;
	yHigh: number;
}

/**
 * A degenerate axis is not clipped at all — a `numberLine` publishes
 * `yRange` `[0, 0]`, and clipping a graph to a band of zero height would erase
 * it rather than tidy it.
 */
function limits(range: Range, padding: number): [number, number] {
	const span = Math.abs(range[1] - range[0]);
	if (span === 0) return [-Infinity, Infinity];
	const pad = span * padding;
	return [
		Math.min(range[0], range[1]) - pad,
		Math.max(range[0], range[1]) + pad,
	];
}

function clipBand(coords: CoordinateSystem, padding: number): Band {
	const [xLow, xHigh] = limits(coords.xRange(), padding);
	const [yLow, yHigh] = limits(coords.yRange(), padding);
	return { xLow, xHigh, yLow, yHigh };
}

function within(band: Band, at: Point): boolean {
	return (
		at.x >= band.xLow &&
		at.x <= band.xHigh &&
		at.y >= band.yLow &&
		at.y <= band.yHigh
	);
}

/**
 * Whether two neighbouring samples are too far apart to be one curve, measured
 * in axis extents so the answer doesn't change when the units do.
 */
function jumped(
	a: Point,
	b: Point,
	extent: { x: number; y: number },
	threshold: number,
): boolean {
	return Math.hypot((b.x - a.x) / extent.x, (b.y - a.y) / extent.y) > threshold;
}

/**
 * The parameter at which the curve leaves the band, by bisection between a
 * known-inside and a known-outside sample. Returns a parameter still *inside*,
 * so the caller can evaluate it without meeting the singularity it is chasing.
 */
function crossing(
	curve: (t: number) => Point,
	band: Band,
	insideT: number,
	outsideT: number,
): number {
	let inside = insideT;
	let outside = outsideT;
	for (let i = 0; i < CROSSING_REFINEMENTS; i++) {
		const middle = (inside + outside) / 2;
		const at = curve(middle);
		if (isFinitePoint(at) && within(band, at)) inside = middle;
		else outside = middle;
	}
	return inside;
}

/**
 * `[from, to]` split at the named discontinuities, with a hair of clearance
 * either side so the singular input itself is never evaluated. Sampling
 * direction is preserved — a graph plotted right to left reveals right to left.
 */
function domains(
	from: number,
	to: number,
	discontinuities: readonly number[] | undefined,
): [number, number][] {
	const low = Math.min(from, to);
	const high = Math.max(from, to);
	const clearance = Math.max(
		(high - low) * DISCONTINUITY_CLEARANCE,
		Number.EPSILON,
	);
	const breaks = (discontinuities ?? [])
		.filter((value) => value > low && value < high)
		.sort((a, b) => a - b);

	const spans: [number, number][] = [];
	let start = low;
	for (const value of breaks) {
		if (value - clearance > start) spans.push([start, value - clearance]);
		start = value + clearance;
	}
	if (high > start) spans.push([start, high]);
	if (spans.length === 0) spans.push([low, high]);

	if (from <= to) return spans;
	return spans.reverse().map(([a, b]) => [b, a]);
}

/**
 * Samples a data-space curve into continuous runs, in **data** coordinates.
 *
 * The shared engine behind `functionGraph`, `parametricGraph`, `polarGraph`
 * and the graph annotations. It returns data points rather than scene points
 * so an annotation can close a run against a baseline before mapping.
 *
 * @example
 * ```ts
 * import { createCartesianCoords, sampleRuns } from "@sophistry/core";
 *
 * const coords = createCartesianCoords({
 * 	xRange: [-3, 3],
 * 	yRange: [-2, 2],
 * 	width: 6,
 * 	height: 4,
 * 	center: { x: 0, y: 0 },
 * });
 * const runs = sampleRuns(coords, (x) => ({ x, y: 1 / x }), -3, 3, { discontinuities: [0] });
 * // two runs, one either side of the pole
 * ```
 *
 * @param coords - The coordinate system (its ranges set the clip band and the jump scale).
 * @param curve - Parameter to data point.
 * @param from - Start of the parameter domain.
 * @param to - End of the parameter domain.
 * @param options - See {@link CurveSampling}.
 * @returns The continuous runs, each with at least two points, in data coordinates.
 *
 * @category Coordinate systems & graphs
 */
export function sampleRuns(
	coords: CoordinateSystem,
	curve: (t: number) => Point,
	from: number,
	to: number,
	options: CurveSampling = {},
): Point[][] {
	const total = Math.max(2, Math.round(options.samples ?? DEFAULT_SAMPLES));
	const threshold = options.jumpThreshold ?? DEFAULT_JUMP_THRESHOLD;
	const band =
		options.clip === false
			? null
			: clipBand(coords, options.clipPadding ?? DEFAULT_CLIP_PADDING);
	const extent = {
		x: extentOf(coords.xRange()),
		y: extentOf(coords.yRange()),
	};
	const span = Math.abs(to - from);

	const runs: Point[][] = [];
	let run: Point[] = [];
	const flush = () => {
		if (run.length > 1) runs.push(run);
		run = [];
	};

	for (const [a, b] of domains(from, to, options.discontinuities)) {
		// Sample density follows each sub-domain's share of the whole, so naming a
		// discontinuity doesn't quietly multiply the work.
		const count =
			span === 0
				? total
				: Math.max(2, Math.round((Math.abs(b - a) / span) * total));
		let previous: { t: number; at: Point; inside: boolean } | null = null;

		for (let i = 0; i <= count; i++) {
			const t = a + ((b - a) * i) / count;
			const at = curve(t);
			if (!isFinitePoint(at)) {
				flush();
				previous = null;
				continue;
			}
			const inside = !band || within(band, at);

			if (inside) {
				if (band && previous && !previous.inside) {
					run.push(curve(crossing(curve, band, t, previous.t)));
				} else if (
					previous?.inside &&
					jumped(previous.at, at, extent, threshold)
				) {
					flush();
				}
				run.push(at);
			} else if (band && previous?.inside) {
				run.push(curve(crossing(curve, band, previous.t, t)));
				flush();
			} else {
				flush();
			}
			previous = { t, at, inside };
		}
		flush();
	}
	return runs;
}

/** Data runs mapped into scene units. */
function toScene(coords: CoordinateSystem, runs: Point[][]): Point[][] {
	return runs.map((run) => run.map((at) => coords.coordsToPoint(at.x, at.y)));
}

/** Scene-unit runs as an open curve outline, one subpath per run. */
function curveOutline(lines: Point[][]): ShapeGeometry {
	return {
		curvePaths: lines.map((run) => polylineToCurvePath(run, false)),
		closed: false,
	};
}

/* ------------------------------------------------ shared composite plumbing */

/**
 * Props of {@link outline}: the shape props plus a ready-made outline.
 *
 * @internal
 */
export interface OutlineProps extends ShapeProps {
	/** The outline, already in the shape's own units. Absent draws nothing. */
	outline?: ShapeGeometry;
}

const EMPTY_OUTLINE: ShapeGeometry = { polylines: [], closed: false };

/**
 * @internal The one shape the graphs, annotations and fields draw: whatever
 * outline its composite computed. The
 * outline is handed over as a prop, so it keeps its identity until the
 * composite computes a new one.
 */
export const outline: Definition<
	OutlineProps,
	ShapeNode<OutlineProps>,
	ShapeInstanceable
> = defineShape<OutlineProps, ShapeInstanceable>({
	name: "Outline",
	props: {
		...shapeProps,
		outline: { invalidates: Invalidate.GEOMETRY },
	},
	geometry: (props) => props.outline ?? EMPTY_OUTLINE,
});

/**
 * @internal The {@link ShapeProps} as a composite forwarding them to the
 * shape it draws sees them (see `shapes/forward.ts`).
 */
export const forwardedShapeProps: PropsDescriptor<ShapeProps> =
	forwardedProps(shapeProps);

/** @internal Every {@link ShapeProps} key. */
export const SHAPE_KEYS = Object.freeze(
	Object.keys(shapeProps),
) as readonly (keyof ShapeProps)[];

/** @internal The {@link ShapeProps} keys of kind `"event"`. */
const SHAPE_EVENT_KEYS: readonly string[] = Object.freeze(
	SHAPE_KEYS.filter((key) => shapeProps[key].kind === "event"),
);

/**
 * @internal Whether anything other than a forwarded handler changed: a prop
 * the composite computes from, or a context key it read.
 */
export function needsRebuild<P extends object>(
	changed: Changes<P>,
	eventKeys: readonly string[] = SHAPE_EVENT_KEYS,
): boolean {
	for (const key of changed) {
		if (typeof key !== "string" || !eventKeys.includes(key)) return true;
	}
	return false;
}

/** @internal The first child, which a one-shape composite created in `setup`. */
export function onlyChild<N extends SceneNode>(ctx: {
	node: { children: readonly SceneNode[] };
}): N {
	return ctx.node.children[0] as N;
}

/* ------------------------------------------------------------- handles */

/**
 * The curve-indexed view of a graph node: where `node.pointAt(direction)` is
 * a point on the bounding box, `pointAt(input)` is the point on the curve.
 * Made by {@link graphHandle}.
 *
 * A shape is indexed by *direction* — `pointAt(UP)` is the top of its box. A
 * graph is indexed by its *input*, and that is overwhelmingly what a scene
 * wants from one, so `pointAt(x)` is the curve point and the box lookup keeps
 * going under `pointOnBounds`. Both are in the scene's units.
 *
 * @category Coordinate systems & graphs
 */
export interface FunctionGraphHandle {
	/** The point on the curve at data input `x` (or `t`, or `θ`), in scene units. */
	pointAt(input: number): Point;
	/** A point on the bounding box — `node.pointAt` under its own name. */
	pointOnBounds(direction: Point): Point | null;
}

type PointOnCurve = (node: SceneNode, input: number) => Point;
const pointOnCurveByDefinition = new WeakMap<object, PointOnCurve>();

/**
 * The {@link FunctionGraphHandle} of a `functionGraph`, `parametricGraph` or
 * `polarGraph` node. It reads the node's current function
 * and coordinate system on every call.
 *
 * @example
 * ```ts
 * import { axes, createScene, functionGraph, graphHandle } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const axesNode = scene.add(
 * 	axes.create({ xRange: [-3, 3, 1], yRange: [-2, 2, 1], width: 6, height: 4 }),
 * );
 * const parabola = axesNode.add(functionGraph.create({ function: (x) => x * x }));
 * const top = graphHandle(parabola).pointAt(2); // scene point of (2, 4)
 * ```
 *
 * @param node - A graph node.
 * @returns Its handle.
 * @throws For a node that is not one of the three graphs.
 * @category Coordinate systems & graphs
 */
export function graphHandle(node: SceneNode): FunctionGraphHandle {
	const pointOnCurve = pointOnCurveByDefinition.get(node.definition);
	if (!pointOnCurve) {
		throw new TypeError(`graphHandle: ${node.type} is not a graph.`);
	}
	return {
		pointAt: (input) => pointOnCurve(node, input),
		pointOnBounds: (direction) => node.pointAt(direction),
	};
}

/** The props of a graph node, read raw (`get` would apply descriptor defaults). */
function propsOf<P>(node: SceneNode): P {
	return (node as unknown as { props: P }).props;
}

/* -------------------------------------------------------- functionGraph */

const samplingProps: PropsDescriptor<CurveSampling> = Object.freeze({
	samples: { default: DEFAULT_SAMPLES, invalidates: Invalidate.UPDATE },
	discontinuities: { invalidates: Invalidate.UPDATE },
	jumpThreshold: {
		default: DEFAULT_JUMP_THRESHOLD,
		invalidates: Invalidate.UPDATE,
	},
	clip: { default: true, invalidates: Invalidate.UPDATE },
	clipPadding: {
		default: DEFAULT_CLIP_PADDING,
		invalidates: Invalidate.UPDATE,
	},
});

/**
 * Builds one graph: a composite drawing one {@link outline}, re-sampled by
 * `geometry` whenever a non-style prop or the coordinate system changes.
 */
function graphComposite<P extends ShapeProps>(
	name: string,
	props: PropsDescriptor<P>,
	geometry: (props: Readonly<P>, coords: CoordinateSystem) => ShapeGeometry,
	pointOnCurve: (
		props: Readonly<P>,
		coords: CoordinateSystem,
		input: number,
	) => Point,
): Definition<P, CompositeNode<P>> {
	const definition = defineComposite<P>({
		name,
		props,
		setup: (ctx) => {
			const curve = outline.create({
				outline: geometry(ctx.props, requireCoords(ctx, name)),
			});
			forwardProps(ctx, curve, SHAPE_KEYS);
			return [curve];
		},
		update: (changed, ctx) => {
			const curve = onlyChild<ShapeNode<OutlineProps>>(ctx);
			forwardHandlers(changed, ctx, curve);
			if (needsRebuild(changed)) {
				curve.set("outline", geometry(ctx.props, requireCoords(ctx, name)));
			}
			return undefined;
		},
	});
	pointOnCurveByDefinition.set(definition, (node, input) =>
		pointOnCurve(propsOf<P>(node), requireCoords(node, name), input),
	);
	return definition;
}

/**
 * Props for {@link functionGraph}: the shape style props, the {@link CurveSampling} controls, and the function.
 *
 * @category Coordinate systems & graphs
 */
export interface FunctionGraphProps extends ShapeProps, CurveSampling {
	/** `y = f(x)` in data coordinates. May return `NaN`/`±Infinity`; those samples break the curve. */
	function: (x: number) => number;
	/** Start of the domain in data coordinates. Defaults to the axes' own `xRange[0]`. */
	from?: number;
	/** End of the domain in data coordinates. Defaults to the axes' own `xRange[1]`. */
	to?: number;
}

/**
 * `y = f(x)` over a data-space domain — Manim's `axes.plot`.
 *
 * Must sit inside an `axes`, `numberPlane` or `numberLine`; the domain then
 * defaults to that system's own `xRange`, so the common case is `function`
 * alone. Using it elsewhere throws (on the first commit).
 *
 * The curve is sampled in data space (`samples` evaluations), split at
 * non-finite values, named `discontinuities` and implausible jumps, clipped to
 * the plotting area, and only then mapped to scene units. Style props
 * (`stroke`, `strokeWidth`, `progress`, ...) are the usual shape props, so
 * `progress` reveals the curve by arc length. A new `function` (or a new
 * coordinate system from the axes) re-samples the curve; read the node's
 * curve points with {@link graphHandle}.
 *
 * @example
 * ```ts
 * import { axes, createScene, functionGraph } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const axesNode = scene.add(
 * 	axes.create({ xRange: [-3, 3, 1], yRange: [-2, 2, 1], width: 6, height: 4 }),
 * );
 * axesNode.add(functionGraph.create({ function: (x) => Math.sin(x), stroke: "tomato" }));
 * ```
 *
 * @see {@link parametricGraph} for curves defined by a parameter.
 * @see {@link areaUnderGraph} and {@link tangentToGraph} for annotations that
 * take the same `function`.
 * @category Coordinate systems & graphs
 */
export const functionGraph = graphComposite<FunctionGraphProps>(
	"FunctionGraph",
	{
		...forwardedShapeProps,
		...samplingProps,
		function: { invalidates: Invalidate.UPDATE },
		from: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
	},
	(props, coords) => {
		const at = (x: number): Point => ({ x, y: props.function(x) });
		const from = props.from ?? coords.xRange()[0];
		const to = props.to ?? coords.xRange()[1];
		return curveOutline(
			toScene(coords, sampleRuns(coords, at, from, to, props)),
		);
	},
	(props, coords, x) => coords.coordsToPoint(x, props.function(x)),
);

/* ------------------------------------------------------ parametricGraph */

/**
 * Props for {@link parametricGraph}.
 *
 * @category Coordinate systems & graphs
 */
export interface ParametricGraphProps extends ShapeProps, CurveSampling {
	/** `t ↦ (x, y)`, returning a point in data coordinates (not scene units). */
	function: (t: number) => Point;
	/** Start of the parameter domain. */
	from: number;
	/** End of the parameter domain. */
	to: number;
}

/**
 * `plot` in data space — Manim's `axes.plot_parametric_curve`.
 *
 * There is no sensible default domain for a parameter nobody else knows about,
 * so `from`/`to` are required here where `functionGraph` can fall back to
 * `xRange`. Clipping applies to both axes, which is the difference that
 * matters: a parametric curve can leave the plotting area sideways.
 *
 * @example
 * ```ts
 * import { axes, createScene, parametricGraph } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const axesNode = scene.add(
 * 	axes.create({ xRange: [-3, 3, 1], yRange: [-2, 2, 1], width: 6, height: 4 }),
 * );
 * axesNode.add(
 * 	parametricGraph.create({
 * 		function: (t) => ({ x: Math.cos(3 * t), y: Math.sin(2 * t) }),
 * 		from: 0,
 * 		to: 2 * Math.PI,
 * 	}),
 * );
 * ```
 *
 * @see {@link functionGraph} for `y = f(x)`.
 * @category Coordinate systems & graphs
 */
export const parametricGraph = graphComposite<ParametricGraphProps>(
	"ParametricGraph",
	{
		...forwardedShapeProps,
		...samplingProps,
		function: { invalidates: Invalidate.UPDATE },
		from: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
	},
	(props, coords) =>
		curveOutline(
			toScene(
				coords,
				sampleRuns(coords, props.function, props.from, props.to, props),
			),
		),
	(props, coords, t) => {
		const point = props.function(t);
		return coords.coordsToPoint(point.x, point.y);
	},
);

/* ----------------------------------------------------------- polarGraph */

/** One sample a degree over a full turn: a rose's petals stay round. */
const DEFAULT_POLAR_SAMPLES = 360;

/** The system as a polar one (a `polarPlane`'s), when it places polar coordinates. */
function polarOf(coords: CoordinateSystem): PolarCoordinateSystem | undefined {
	return "polarToPoint" in coords
		? (coords as PolarCoordinateSystem)
		: undefined;
}

/**
 * Props for {@link polarGraph}.
 *
 * @category Coordinate systems & graphs
 */
export interface PolarGraphProps extends ShapeProps, CurveSampling {
	/** `r = f(θ)`, with `θ` in **radians**. A negative `r` plots on the opposite side of the pole, as in Manim. */
	function: (theta: number) => number;
	/**
	 * Start of the angle domain, in radians.
	 * @default 0
	 */
	from?: number;
	/**
	 * End of the angle domain, in radians.
	 * @default 2 * Math.PI
	 */
	to?: number;
}

/** `(r cos θ, r sin θ)` for `r = f(θ)`: the curve in the axes' data space. */
function polarPoint(props: Readonly<PolarGraphProps>, theta: number): Point {
	const radius = props.function(theta);
	return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
}

/**
 * `r = f(θ)` — Manim's `PolarPlane.plot_polar_graph`.
 *
 * Inside a `polarPlane` the curve lands where the plane's `polarToPoint`
 * puts each `(r, θ)` (and {@link graphHandle}'s `pointAt` calls it); inside an
 * `axes` or `numberPlane` it is the same change of variables,
 * `(r cos θ, r sin θ)` in the axes' data space, which is all `polarToPoint`
 * is. Either way it is sampled, split and clipped exactly like
 * {@link parametricGraph} — so `discontinuities` and `jumpThreshold` are in θ
 * and data units — and `progress` reveals it in the order θ runs. `samples`
 * defaults to 360 rather than 160, one a degree over the default full turn.
 *
 * @example
 * ```ts
 * import { createScene, polarGraph, polarPlane } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const planeNode = scene.add(polarPlane.create({ size: 6, maxRadius: 1 }));
 * planeNode.add(polarGraph.create({ function: (theta) => Math.cos(3 * theta) }));
 * ```
 *
 * @see {@link polarPlane} for the grid it is usually drawn on.
 * @category Coordinate systems & graphs
 */
export const polarGraph = graphComposite<PolarGraphProps>(
	"PolarGraph",
	{
		...forwardedShapeProps,
		...samplingProps,
		samples: { default: DEFAULT_POLAR_SAMPLES, invalidates: Invalidate.UPDATE },
		function: { invalidates: Invalidate.UPDATE },
		from: { default: 0, invalidates: Invalidate.UPDATE },
		to: { default: 2 * Math.PI, invalidates: Invalidate.UPDATE },
	},
	(props, coords) =>
		curveOutline(
			toScene(
				coords,
				sampleRuns(
					coords,
					(theta) => polarPoint(props, theta),
					props.from ?? 0,
					props.to ?? 2 * Math.PI,
					{
						samples: props.samples ?? DEFAULT_POLAR_SAMPLES,
						discontinuities: props.discontinuities,
						jumpThreshold: props.jumpThreshold,
						clip: props.clip,
						clipPadding: props.clipPadding,
					},
				),
			),
		),
	(props, coords, theta) => {
		const polar = polarOf(coords);
		if (polar) return polar.polarToPoint(props.function(theta), theta);
		const point = polarPoint(props, theta);
		return coords.coordsToPoint(point.x, point.y);
	},
);
