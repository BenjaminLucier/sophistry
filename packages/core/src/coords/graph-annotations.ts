/**
 * Graph annotations (Manim's `CoordinateSystem` graph methods) as composites:
 * area under a curve, Riemann rectangles, drop lines, secants and tangents.
 * Each takes `function` in data coordinates and reads the enclosing `axes`, so
 * it cannot disagree with the `functionGraph` it annotates; numeric props are
 * ordinary props a `track()` can drive. `angleOfTangent` is a central
 * difference.
 *
 * Every annotation recomputes its points when its own props, the coordinate
 * system or the theme change; the style props it hands on unchanged are bound
 * straight through to the shapes it draws.
 */

import type { ColorInput } from "../color/index.js";
import type { Point, Range } from "../geometry/index.js";
import { clamp } from "../geometry/lerp.js";
import type { Readable } from "../reactive/index.js";
import { derive } from "../reactive/index.js";
import type { Changes, CompositeContext } from "../scene/composite.js";
import { defineComposite } from "../scene/composite.js";
import { Invalidate } from "../scene/context.js";
import type { ShapeProps } from "../scene/shape.js";
import { shapeProps } from "../scene/shape.js";
import { label } from "../scene/text.js";
import type { PropsDescriptor, SceneNode } from "../scene/types.js";
import { dot } from "../shapes/dot.js";
import {
	forwardedProps,
	forwardHandlers,
	forwardProps,
	rawProp,
} from "../shapes/forward.js";
import { dashedLine, line } from "../shapes/line.js";
import { path } from "../shapes/path.js";
import { flatColor } from "../spec/gradient.js";
import type { Vec2 } from "../spec/layout.js";
import { DOWN, RIGHT } from "../spec/layout.js";
import { anchoredLabelProps } from "./axis-labels.js";
import type { CoordinateSystem } from "./coords.js";
import { requireCoords, UNDER_AXES_Z_INDEX } from "./coords.js";
import { needsRebuild, sampleRuns } from "./function-graph.js";

const DEFAULT_SAMPLES = 160;
const DEFAULT_RECT_COUNT = 6;
const DEFAULT_AREA_FILL_OPACITY = 0.3;
const DEFAULT_RECT_FILL_OPACITY = 0.45;
const DEFAULT_RECT_STROKE_WIDTH = 0.02;
const DEFAULT_LINE_STROKE_WIDTH = 0.03;
const DEFAULT_LABEL_FONT_SIZE = 0.28;
const DEFAULT_LABEL_GAP = 0.14;
const DEFAULT_DX = 0.5;
/**
 * Half-width of the tangent's central difference, as a fraction of the x
 * extent. Small enough to be a tangent, large enough that `function` is evaluated at
 * two genuinely different doubles either side of `x`.
 */
const DEFAULT_TANGENT_DX = 1e-4;

function clampToRange(range: Range, value: number): number {
	return clamp(
		value,
		Math.min(range[0], range[1]),
		Math.max(range[0], range[1]),
	);
}

/**
 * The scene-unit point on the curve `y = f(x)` — Manim's `input_to_graph_point`.
 *
 * @example
 * ```ts
 * import { createCartesianCoords, inputToGraphPoint } from "@sophistry/core";
 *
 * const coords = createCartesianCoords({
 * 	xRange: [-3, 3],
 * 	yRange: [-2, 2],
 * 	width: 6,
 * 	height: 4,
 * 	center: { x: 0, y: 0 },
 * });
 * const top = inputToGraphPoint(coords, (x) => x * x, 2); // scene point of (2, 4)
 * ```
 *
 * @param coords - The coordinate system (for example `coordsOf(axesNode)`).
 * @param f - The curve, in data coordinates.
 * @param x - The input, in data units.
 * @returns `coords.coordsToPoint(x, f(x))`, in scene units.
 *
 * @category Bounds & hit math
 */
export function inputToGraphPoint(
	coords: CoordinateSystem,
	f: (x: number) => number,
	x: number,
): Point {
	return coords.coordsToPoint(x, f(x));
}

/**
 * The difference quotient over `[x, x + dx]`, in **data** units — the slope a
 * scene means when it writes Δy/Δx on a triangle. Independent of the axes, so
 * it takes no coordinate system.
 *
 * @example
 * ```ts
 * import { slopeOfSecant } from "@sophistry/core";
 *
 * slopeOfSecant((x) => x * x, 1, 0.5); // 2.5
 * ```
 *
 * @param f - The function, in data coordinates.
 * @param x - Left input.
 * @param dx - Step in data units.
 * @returns `(f(x + dx) - f(x)) / dx`, or `NaN` when `dx` is 0.
 *
 * @category Bounds & hit math
 */
export function slopeOfSecant(
	f: (x: number) => number,
	x: number,
	dx: number,
): number {
	return dx === 0 ? Number.NaN : (f(x + dx) - f(x)) / dx;
}

/**
 * The tangent's angle at `x`, in scene units (Manim's `angle_of_tangent`), from
 * a central difference; `NaN` in gives `NaN` out.
 *
 * @example
 * ```ts
 * import { angleOfTangent, createCartesianCoords } from "@sophistry/core";
 *
 * const coords = createCartesianCoords({
 * 	xRange: [-3, 3],
 * 	yRange: [-2, 2],
 * 	width: 6,
 * 	height: 4,
 * 	center: { x: 0, y: 0 },
 * });
 * const angle = angleOfTangent(coords, Math.sin, 0); // π/4 on square axes
 * ```
 *
 * @param coords - The coordinate system the curve is drawn in.
 * @param f - The curve, in data coordinates.
 * @param x - Input at which to take the tangent, in data units.
 * @param dx - Width of the central difference in data units. Defaults to 1e-4 of the x extent.
 * @returns The angle in radians, anticlockwise from scene +x.
 *
 * @category Bounds & hit math
 */
export function angleOfTangent(
	coords: CoordinateSystem,
	f: (x: number) => number,
	x: number,
	dx?: number,
): number {
	const range = coords.xRange();
	const h = dx ?? Math.abs(range[1] - range[0]) * DEFAULT_TANGENT_DX;
	const before = inputToGraphPoint(coords, f, x - h / 2);
	const after = inputToGraphPoint(coords, f, x + h / 2);
	return Math.atan2(after.y - before.y, after.x - before.x);
}

/** A ring closed the way the renderer's reveal wants: first point repeated. */
function ring(points: Point[]): Point[] {
	if (points.length === 0) return points;
	return [...points, { ...(points[0] as Point) }];
}

/** Whether two sets of rings hold the same points. */
function sameRings(a: readonly Point[][], b: readonly Point[][]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const left = a[i] as Point[];
		const right = b[i] as Point[];
		if (left.length !== right.length) return false;
		for (let j = 0; j < left.length; j++) {
			const p = left[j] as Point;
			const q = right[j] as Point;
			if (p.x !== q.x || p.y !== q.y) return false;
		}
	}
	return true;
}

/* -------------------------------------------------------- shared plumbing */

/** The {@link ShapeProps} keys not in `omit`: what an annotation hands on as it is. */
function shapeKeysWithout(
	omit: readonly (keyof ShapeProps)[],
): (keyof ShapeProps)[] {
	return (Object.keys(shapeProps) as (keyof ShapeProps)[]).filter(
		(key) => !omit.includes(key),
	);
}

/** A composite's prop as set, with `fallback` deciding an unset one. */
function defaulted<P, K extends keyof P, T>(
	ctx: CompositeContext<P>,
	key: K,
	fallback: (value: P[K]) => T,
): Readable<T> {
	return derive(rawProp(ctx, key), fallback);
}

/** `(zIndex ?? 0) + UNDER_AXES_Z_INDEX`, live: areas paint under the axes they fill against. */
function underAxes<P extends ShapeProps>(
	ctx: CompositeContext<P>,
): Readable<number> {
	return defaulted(ctx, "zIndex", (z) => (z ?? 0) + UNDER_AXES_Z_INDEX);
}

/**
 * Keyed reconciliation of one optional child: the node while `present`,
 * nothing otherwise, kept across updates.
 */
function optional<N extends SceneNode>(
	ctx: CompositeContext<object>,
	slot: string,
	present: unknown,
	create: () => N,
	update: (node: N) => void,
): N[] {
	return ctx.list(slot, present ? [slot] : [], {
		create: () => {
			const node = create();
			update(node);
			return node;
		},
		update: (node) => update(node),
	});
}

/** Sets the changed handlers on every child of an annotation. */
function forwardHandlersToChildren<P>(
	changed: Changes<P>,
	ctx: CompositeContext<P>,
): void {
	for (const child of ctx.node.children) forwardHandlers(changed, ctx, child);
}

/* -------------------------------------------------------- areaUnderGraph */

/**
 * Props for {@link areaUnderGraph}. Style props apply to the filled region.
 *
 * @category Coordinate systems & graphs
 */
export interface AreaUnderGraphProps extends ShapeProps {
	/** The curve, in data coordinates. */
	function: (x: number) => number;
	/** The other boundary — Manim's `bounded_graph`. Defaults to the x axis. */
	bounded?: (x: number) => number;
	/** Left edge of the region in data units. Defaults to the axes' `xRange[0]`. */
	from?: number;
	/** Right edge of the region in data units. Defaults to the axes' `xRange[1]`. */
	to?: number;
	/**
	 * Evaluations of `function` across the domain.
	 * @default 160
	 */
	samples?: number;
	/** Inputs where `function` breaks; the region is split there rather than bridged. */
	discontinuities?: number[];
}

const AREA_DEFAULTED = ["zIndex", "fill", "fillOpacity", "stroke"] as const;

/** One ring per continuous run of the curve, closed against the lower boundary. */
function areaRings(
	props: Readonly<AreaUnderGraphProps>,
	coords: CoordinateSystem,
): Point[][] {
	const yRange = coords.yRange();
	const baseline = coords.crossing().y;
	const lower = (x: number): number => {
		if (!props.bounded) return baseline;
		const y = props.bounded(x);
		return Number.isFinite(y) ? clampToRange(yRange, y) : baseline;
	};

	const runs = sampleRuns(
		coords,
		(x) => ({ x, y: props.function(x) }),
		props.from ?? coords.xRange()[0],
		props.to ?? coords.xRange()[1],
		{
			samples: props.samples ?? DEFAULT_SAMPLES,
			discontinuities: props.discontinuities,
		},
	);

	return runs.map((run) =>
		ring([
			...run,
			...run.map((at) => ({ x: at.x, y: lower(at.x) })).reverse(),
		]).map((at) => coords.coordsToPoint(at.x, at.y)),
	);
}

/**
 * The filled region between a curve and the x axis, or between two curves with
 * `bounded` (Manim's `get_area`). Each continuous run of the curve is its own
 * ring; the region is clamped to the y range. Must be inside a coordinate system.
 * `progress` sweeps the area in.
 *
 * @example
 * ```ts
 * import { areaUnderGraph, axes, createScene } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const axesNode = scene.add(
 * 	axes.create({ xRange: [-3, 3, 1], yRange: [-2, 2, 1], width: 6, height: 4 }),
 * );
 * axesNode.add(areaUnderGraph.create({ function: (x) => x * x, from: 0, to: 1 }));
 * ```
 *
 * @see {@link riemannRectangles}
 * @category Coordinate systems & graphs
 */
export const areaUnderGraph = defineComposite<AreaUnderGraphProps>({
	name: "AreaUnderGraph",
	props: {
		...forwardedProps(shapeProps),
		fill: { invalidates: Invalidate.UPDATE },
		fillOpacity: {
			default: DEFAULT_AREA_FILL_OPACITY,
			invalidates: Invalidate.NONE,
		},
		stroke: { default: "none", invalidates: Invalidate.NONE },
		function: { invalidates: Invalidate.UPDATE },
		bounded: { invalidates: Invalidate.UPDATE },
		from: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		samples: { default: DEFAULT_SAMPLES, invalidates: Invalidate.UPDATE },
		discontinuities: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const region = path.create({
			points: areaRings(ctx.props, requireCoords(ctx, "AreaUnderGraph")),
			closed: true,
			// Under the axes it fills against, as any area does.
			zIndex: underAxes(ctx),
			fill: ctx.props.fill ?? ctx.theme.palette.series[0],
			fillOpacity: defaulted(
				ctx,
				"fillOpacity",
				(value) => value ?? DEFAULT_AREA_FILL_OPACITY,
			),
			stroke: defaulted(ctx, "stroke", (value) => value ?? "none"),
		});
		forwardProps(ctx, region, shapeKeysWithout(AREA_DEFAULTED));
		return [region];
	},
	update: (changed, ctx) => {
		forwardHandlersToChildren(changed, ctx);
		if (!needsRebuild(changed)) return undefined;
		const region = ctx.node.children[0] as SceneNode<
			ShapeProps & { points?: Point[][] }
		>;
		region.update({
			points: areaRings(ctx.props, requireCoords(ctx, "AreaUnderGraph")),
			fill: ctx.props.fill ?? ctx.theme.palette.series[0],
		});
		return undefined;
	},
});

/* ----------------------------------------------------- riemannRectangles */

/**
 * Props for {@link riemannRectangles}. Style props apply to the rectangles.
 *
 * @category Coordinate systems & graphs
 */
export interface RiemannRectanglesProps extends ShapeProps {
	/** The function, in data coordinates. */
	function: (x: number) => number;
	/** Left edge of the summed interval in data units. Defaults to the axes' `xRange[0]`. */
	from?: number;
	/** Right edge of the summed interval in data units. Defaults to the axes' `xRange[1]`. */
	to?: number;
	/** Rectangle width in data units. Ignored when `count` is given. */
	dx?: number;
	/**
	 * Rectangle count (rounded, minimum 1), which is usually the thing a scene animates. Defaults
	 * to 6 when neither `count` nor `dx` is given.
	 */
	count?: number;
	/** Where in each interval `function` is read. Defaults to the left endpoint. */
	sample?: "left" | "right" | "midpoint";
	/** Fill for rectangles below the axis. Defaults to `fill`. */
	negativeFill?: ColorInput;
}

/** The rectangles above and below the baseline, as rings in scene units. */
function riemannBars(
	props: Readonly<RiemannRectanglesProps>,
	coords: CoordinateSystem,
): { positive: Point[][]; negative: Point[][] } {
	const yRange = coords.yRange();
	const baseline = coords.crossing().y;
	const from = props.from ?? coords.xRange()[0];
	const to = props.to ?? coords.xRange()[1];
	const span = to - from;

	const count = Math.max(
		1,
		Math.round(
			props.count ??
				(props.dx ? Math.abs(span / props.dx) : DEFAULT_RECT_COUNT),
		),
	);
	const width = span / count;
	const where = props.sample ?? "left";

	const positive: Point[][] = [];
	const negative: Point[][] = [];
	for (let i = 0; i < count; i++) {
		const left = from + width * i;
		const right = left + width;
		const at =
			where === "right"
				? right
				: where === "midpoint"
					? left + width / 2
					: left;
		const value = props.function(at);
		if (!Number.isFinite(value)) continue;
		const top = clampToRange(yRange, value);
		if (top === baseline) continue;

		const corners = [
			coords.coordsToPoint(left, baseline),
			coords.coordsToPoint(right, baseline),
			coords.coordsToPoint(right, top),
			coords.coordsToPoint(left, top),
		];
		(top > baseline ? positive : negative).push(ring(corners));
	}
	return { positive, negative };
}

const RIEMANN_DEFAULTED = [
	"zIndex",
	"fill",
	"fillOpacity",
	"strokeWidth",
] as const;

/**
 * The Riemann sum as rectangles (Manim's `get_riemann_rectangles`), from the
 * axis to `function` either way, so negative ones hang down (`negativeFill`
 * colours them). Positives and negatives are one node each, so a `progress`
 * reveal draws all positive rectangles first.
 *
 * @example
 * ```ts
 * import { axes, createScene, riemannRectangles } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const axesNode = scene.add(
 * 	axes.create({ xRange: [-3, 3, 1], yRange: [-2, 2, 1], width: 6, height: 4 }),
 * );
 * const sum = axesNode.add(riemannRectangles.create({ function: Math.sin, count: 8 }));
 * sum.set("count", 32);
 * ```
 *
 * @see {@link areaUnderGraph}
 * @category Coordinate systems & graphs
 */
export const riemannRectangles = defineComposite<RiemannRectanglesProps>({
	name: "RiemannRectangles",
	props: {
		...forwardedProps(shapeProps),
		fill: { invalidates: Invalidate.UPDATE },
		fillOpacity: {
			default: DEFAULT_RECT_FILL_OPACITY,
			invalidates: Invalidate.NONE,
		},
		strokeWidth: {
			default: DEFAULT_RECT_STROKE_WIDTH,
			invalidates: Invalidate.NONE,
		},
		function: { invalidates: Invalidate.UPDATE },
		from: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		dx: { invalidates: Invalidate.UPDATE },
		count: { invalidates: Invalidate.UPDATE },
		sample: { default: "left", invalidates: Invalidate.UPDATE },
		negativeFill: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const bars = riemannBars(
			ctx.props,
			requireCoords(ctx, "RiemannRectangles"),
		);
		const fill = ctx.props.fill ?? ctx.theme.palette.series[0];
		const side = (points: Point[][], sideFill: unknown) => {
			const node = path.create({
				points,
				closed: true,
				zIndex: underAxes(ctx),
				fill: sideFill as ShapeProps["fill"],
				fillOpacity: defaulted(
					ctx,
					"fillOpacity",
					(value) => value ?? DEFAULT_RECT_FILL_OPACITY,
				),
				strokeWidth: defaulted(
					ctx,
					"strokeWidth",
					(value) => value ?? DEFAULT_RECT_STROKE_WIDTH,
				),
			});
			forwardProps(ctx, node, shapeKeysWithout(RIEMANN_DEFAULTED));
			return node;
		};
		return [
			side(bars.positive, fill),
			side(bars.negative, ctx.props.negativeFill ?? fill),
		];
	},
	update: (changed, ctx) => {
		forwardHandlersToChildren(changed, ctx);
		if (!needsRebuild(changed)) return undefined;
		const bars = riemannBars(
			ctx.props,
			requireCoords(ctx, "RiemannRectangles"),
		);
		const fill = ctx.props.fill ?? ctx.theme.palette.series[0];
		const [positive, negative] = ctx.node.children as SceneNode<
			ShapeProps & { points?: Point[][] }
		>[];
		// Each side is gated on its own contents: an update that leaves one
		// side as it was (an empty `negative` for a curve above the baseline,
		// say) must not hand that side's path a new outline.
		const place = (
			node: SceneNode<ShapeProps & { points?: Point[][] }> | undefined,
			points: Point[][],
			sideFill: ShapeProps["fill"],
		) => {
			if (!node) return;
			const previous = node.get("points");
			if (!previous || !sameRings(previous, points)) node.set("points", points);
			node.set("fill", sideFill);
		};
		place(positive, bars.positive, fill);
		place(negative, bars.negative, ctx.props.negativeFill ?? fill);
		return undefined;
	},
});

/* --------------------------------------------- vertical/horizontal lines */

/**
 * What both drop-line composites ({@link verticalLineToGraph}, {@link horizontalLineToGraph}) take.
 *
 * @category Coordinate systems & graphs
 */
export interface LineToGraphProps extends ShapeProps {
	/** The curve, in data coordinates. */
	function: (x: number) => number;
	/** The input (data units) the line is dropped from; the curve point is `(x, f(x))`. */
	x: number;
	/** Draw it solid instead of dashed. */
	solid?: boolean;
	/** Passed to `dashedLine`. */
	dashRatio?: number;
	/** Passed to `dashedLine`. */
	dashCount?: number;
	/** Passed to `dashedLine`. */
	dashLength?: number;
	/** A marker where the line meets the curve. */
	dot?: boolean;
	/** Marker radius. Defaults to the `dot` default. */
	dotRadius?: number;
	/** A caption at the axis end — Manim's `get_T_label`. */
	label?: string;
	/**
	 * Caption font size.
	 * @default 0.28
	 */
	labelFontSize?: number;
	/**
	 * Gap between the axis end and the caption.
	 * @default 0.14
	 */
	labelGap?: number;
	/**
	 * Which side of the foot the caption sits on. Defaults to below (vertical line) or right
	 * (horizontal line).
	 */
	labelDirection?: Vec2;
}

/**
 * The drop lines' descriptor. `x` is the shape props' placement offset
 * there; here it is the input, so it is not forwarded.
 */
const lineToGraphProps: PropsDescriptor<LineToGraphProps> = {
	...forwardedProps(shapeProps),
	// Read for the line's and the marker's defaults, so not forwarded as is.
	stroke: { invalidates: Invalidate.UPDATE },
	strokeWidth: { invalidates: Invalidate.UPDATE },
	function: { invalidates: Invalidate.UPDATE },
	x: { invalidates: Invalidate.UPDATE },
	solid: { default: false, invalidates: Invalidate.UPDATE },
	dashRatio: { invalidates: Invalidate.UPDATE },
	dashCount: { invalidates: Invalidate.UPDATE },
	dashLength: { invalidates: Invalidate.UPDATE },
	dot: { default: false, invalidates: Invalidate.UPDATE },
	dotRadius: { invalidates: Invalidate.UPDATE },
	label: { invalidates: Invalidate.UPDATE },
	labelFontSize: {
		default: DEFAULT_LABEL_FONT_SIZE,
		invalidates: Invalidate.UPDATE,
	},
	labelGap: { default: DEFAULT_LABEL_GAP, invalidates: Invalidate.UPDATE },
	labelDirection: { invalidates: Invalidate.UPDATE },
};

/** Forwarded to the drop line as they are: everything but its own and the defaulted. */
const LINE_TO_GRAPH_FORWARDED = shapeKeysWithout([
	"stroke",
	"strokeWidth",
	"x",
]);

/**
 * The shared body of the two drop lines: a dashed segment from `foot` to the
 * curve, optionally a dot on the curve and a label at the foot.
 */
function lineToGraphChildren(
	ctx: CompositeContext<LineToGraphProps>,
	foot: Point,
	head: Point,
	defaultLabelDirection: Vec2,
): SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	const stroke = props.stroke ?? theme.palette.muted;
	const strokeWidth = props.strokeWidth ?? DEFAULT_LINE_STROKE_WIDTH;
	const solid = props.solid === true;

	const segment = ctx.list("line", [solid ? "solid" : "dashed"], {
		create: (kind): SceneNode => {
			const node =
				kind === "solid"
					? line.create({ from: foot, to: head })
					: dashedLine.create({ from: foot, to: head });
			forwardProps(ctx, node, LINE_TO_GRAPH_FORWARDED);
			return node;
		},
		update: () => {},
	});
	for (const node of segment) {
		const target = node as SceneNode<Record<string, unknown>>;
		target.update({ from: foot, to: head, stroke, strokeWidth });
		if (!solid) {
			target.update({
				dashRatio: props.dashRatio,
				dashCount: props.dashCount,
				dashLength: props.dashLength,
			});
		}
	}

	const marker = optional(
		ctx as CompositeContext<object>,
		"dot",
		props.dot,
		() =>
			dot.create({
				zIndex: rawProp(ctx, "zIndex"),
				opacity: rawProp(ctx, "opacity"),
				progress: rawProp(ctx, "progress"),
			}),
		(node) =>
			node.update({
				center: head,
				radius: props.dotRadius,
				color: flatColor(props.stroke, theme.palette.accent),
			}),
	);

	const caption = optional(
		ctx as CompositeContext<object>,
		"label",
		props.label,
		() => label.create({ text: "" }),
		(node) => {
			node.update(
				anchoredLabelProps(
					{
						text: props.label ?? "",
						at: foot,
						direction: props.labelDirection ?? defaultLabelDirection,
						gap: props.labelGap ?? DEFAULT_LABEL_GAP,
						fontSize: props.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE,
						color: theme.palette.foreground,
					},
					theme.defaults.fontFamily,
					node.get("place"),
				),
			);
			node.update({
				zIndex: rawProp(ctx, "zIndex"),
				opacity: rawProp(ctx, "opacity"),
				progress: rawProp(ctx, "progress"),
			});
		},
	);

	return [...segment, ...marker, ...caption];
}

/** A drop-line composite whose foot and head `ends` places. */
function defineLineToGraph(
	name: string,
	ends: (
		props: Readonly<LineToGraphProps>,
		coords: CoordinateSystem,
	) => { foot: Point; head: Point },
	defaultLabelDirection: Vec2,
) {
	const build = (ctx: CompositeContext<LineToGraphProps>) => {
		const { foot, head } = ends(ctx.props, requireCoords(ctx, name));
		return lineToGraphChildren(ctx, foot, head, defaultLabelDirection);
	};
	return defineComposite<LineToGraphProps>({
		name,
		props: lineToGraphProps,
		setup: build,
		update: (changed, ctx) => {
			forwardHandlersToChildren(changed, ctx);
			return needsRebuild(changed) ? build(ctx) : undefined;
		},
	});
}

/**
 * A dashed line from the x axis (as drawn) up to the curve: Manim's
 * `get_vertical_line_to_graph`, and with `label` its `get_T_label`.
 *
 * @example
 * ```ts
 * import { axes, createScene, verticalLineToGraph } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const axesNode = scene.add(
 * 	axes.create({ xRange: [-3, 3, 1], yRange: [-2, 2, 1], width: 6, height: 4 }),
 * );
 * axesNode.add(verticalLineToGraph.create({ function: (x) => x * x, x: 1.5, dot: true, label: "t" }));
 * ```
 *
 * @see {@link horizontalLineToGraph}
 * @category Coordinate systems & graphs
 */
export const verticalLineToGraph = defineLineToGraph(
	"VerticalLineToGraph",
	(props, coords) => ({
		foot: coords.coordsToPoint(props.x, coords.crossing().y),
		head: inputToGraphPoint(coords, props.function, props.x),
	}),
	DOWN,
);

/**
 * The sibling that falls out for free: a dashed line from the y axis across to
 * the curve, still indexed by the *input* `x` rather than by a height, so the
 * two read the same at a call site.
 *
 * @example
 * ```ts
 * import { axes, createScene, horizontalLineToGraph } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const axesNode = scene.add(
 * 	axes.create({ xRange: [-3, 3, 1], yRange: [-2, 2, 1], width: 6, height: 4 }),
 * );
 * axesNode.add(horizontalLineToGraph.create({ function: (x) => x * x, x: 1.5 }));
 * ```
 *
 * @see {@link verticalLineToGraph}
 * @category Coordinate systems & graphs
 */
export const horizontalLineToGraph = defineLineToGraph(
	"HorizontalLineToGraph",
	(props, coords) => ({
		foot: coords.coordsToPoint(coords.crossing().x, props.function(props.x)),
		head: inputToGraphPoint(coords, props.function, props.x),
	}),
	RIGHT,
);

/* ------------------------------------------------------ secantSlopeGroup */

/**
 * Props for {@link secantSlopeGroup}. Style props apply to the secant line (and the triangle legs' width).
 *
 * @category Coordinate systems & graphs
 */
export interface SecantSlopeGroupProps extends ShapeProps {
	/** The curve, in data coordinates. */
	function: (x: number) => number;
	/** The left-hand input, in data units. */
	x: number;
	/**
	 * The step in data units. Animate it towards zero and the secant becomes the tangent.
	 * @default 0.5
	 */
	dx?: number;
	/** Length of the secant. Defaults to the plot's width. */
	length?: number;
	/**
	 * The Δx / Δy legs between the two points.
	 * @default true
	 */
	triangle?: boolean;
	/**
	 * Markers on the two points.
	 * @default true
	 */
	dots?: boolean;
	/** Caption for the horizontal leg, e.g. "Δx". Omitted by default. */
	dxLabel?: string;
	/** Caption for the vertical leg, e.g. "Δy". Omitted by default. */
	dyLabel?: string;
	/**
	 * Caption font size.
	 * @default 0.28
	 */
	labelFontSize?: number;
	/** Colour for the legs and their labels. Defaults to the theme accent. */
	triangleStroke?: ColorInput;
}

/** Forwarded to the secant and the legs as they are. */
const SECANT_FORWARDED = shapeKeysWithout(["stroke", "strokeWidth", "x"]);

function midpoint(a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function secantChildren(
	ctx: CompositeContext<SecantSlopeGroupProps>,
): SceneNode[] {
	const props = ctx.props;
	const coords = requireCoords(ctx, "SecantSlopeGroup");
	const theme = ctx.theme;

	const dx = props.dx ?? DEFAULT_DX;
	const start = inputToGraphPoint(coords, props.function, props.x);
	const end = inputToGraphPoint(coords, props.function, props.x + dx);
	/** The right angle of the triangle: along to `x + dx`, before rising to `function`. */
	const corner = coords.coordsToPoint(props.x + dx, props.function(props.x));

	const distance = Math.hypot(end.x - start.x, end.y - start.y);
	const angle =
		distance > 0
			? Math.atan2(end.y - start.y, end.x - start.x)
			: angleOfTangent(coords, props.function, props.x);
	const area = coords.area();
	const half = (props.length ?? area.maxX - area.minX) / 2;
	const centre = midpoint(start, end);
	const secant = {
		from: {
			x: centre.x - Math.cos(angle) * half,
			y: centre.y - Math.sin(angle) * half,
		},
		to: {
			x: centre.x + Math.cos(angle) * half,
			y: centre.y + Math.sin(angle) * half,
		},
	};

	const legStroke = props.triangleStroke ?? theme.palette.accent;
	const legWidth = props.strokeWidth ?? DEFAULT_LINE_STROKE_WIDTH;
	const triangle = props.triangle !== false;
	const anyContext = ctx as CompositeContext<object>;

	const leg = (slot: string, from: Point, to: Point) =>
		optional(
			anyContext,
			slot,
			triangle,
			() => {
				const node = line.create({ from, to });
				forwardProps(ctx, node, SECANT_FORWARDED);
				return node;
			},
			(node) =>
				node.update({ from, to, stroke: legStroke, strokeWidth: legWidth }),
		);

	const legLabel = (
		slot: string,
		text: string | undefined,
		at: Point,
		direction: Vec2,
	) =>
		optional(
			anyContext,
			slot,
			triangle && text,
			() => label.create({ text: "" }),
			(node) => {
				node.update(
					anchoredLabelProps(
						{
							text: text ?? "",
							at,
							direction,
							gap: DEFAULT_LABEL_GAP,
							fontSize: props.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE,
							color: legStroke,
						},
						theme.defaults.fontFamily,
						node.get("place"),
					),
				);
				node.update({
					zIndex: rawProp(ctx, "zIndex"),
					opacity: rawProp(ctx, "opacity"),
					progress: rawProp(ctx, "progress"),
				});
			},
		);

	const secantLine = ctx.list("secant", ["secant"], {
		create: () => {
			const node = line.create({ from: secant.from, to: secant.to });
			forwardProps(ctx, node, SECANT_FORWARDED);
			return node;
		},
	});
	for (const node of secantLine) {
		node.update({
			from: secant.from,
			to: secant.to,
			stroke: props.stroke,
			strokeWidth: props.strokeWidth,
		});
	}

	const marker = (slot: string, center: Point) =>
		optional(
			anyContext,
			slot,
			props.dots !== false,
			() =>
				dot.create({
					zIndex: rawProp(ctx, "zIndex"),
					opacity: rawProp(ctx, "opacity"),
					progress: rawProp(ctx, "progress"),
				}),
			(node) =>
				node.update({
					center,
					color: flatColor(props.stroke, theme.palette.foreground),
				}),
		);

	return [
		...leg("run", start, corner),
		...leg("rise", corner, end),
		...legLabel("dxLabel", props.dxLabel, midpoint(start, corner), DOWN),
		...legLabel("dyLabel", props.dyLabel, midpoint(corner, end), RIGHT),
		...secantLine,
		...marker("startDot", start),
		...marker("endDot", end),
	];
}

/**
 * The secant through `x` and `x + dx` with its Δx/Δy triangle (Manim's
 * `get_secant_slope_group`). As `dx` reaches 0 it becomes the tangent rather than
 * losing its direction.
 *
 * @example
 * ```ts
 * import { axes, createScene, secantSlopeGroup, track, valueTo } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const axesNode = scene.add(
 * 	axes.create({ xRange: [-3, 3, 1], yRange: [-2, 2, 1], width: 6, height: 4 }),
 * );
 * const dx = track(1);
 * axesNode.add(
 * 	secantSlopeGroup.create({ function: (x) => x * x, x: 1, dx, dxLabel: "Δx", dyLabel: "Δy" }),
 * );
 * scene.play(valueTo(dx, 0.01, { duration: 2 })); // the secant turns into the tangent
 * ```
 *
 * @see {@link tangentToGraph}
 * @see {@link slopeOfSecant}
 * @category Coordinate systems & graphs
 */
export const secantSlopeGroup = defineComposite<SecantSlopeGroupProps>({
	name: "SecantSlopeGroup",
	props: {
		...forwardedProps(shapeProps),
		stroke: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		function: { invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		dx: { default: DEFAULT_DX, invalidates: Invalidate.UPDATE },
		length: { invalidates: Invalidate.UPDATE },
		triangle: { default: true, invalidates: Invalidate.UPDATE },
		dots: { default: true, invalidates: Invalidate.UPDATE },
		dxLabel: { invalidates: Invalidate.UPDATE },
		dyLabel: { invalidates: Invalidate.UPDATE },
		labelFontSize: {
			default: DEFAULT_LABEL_FONT_SIZE,
			invalidates: Invalidate.UPDATE,
		},
		triangleStroke: { invalidates: Invalidate.UPDATE },
	},
	setup: secantChildren,
	update: (changed, ctx) => {
		forwardHandlersToChildren(changed, ctx);
		return needsRebuild(changed) ? secantChildren(ctx) : undefined;
	},
});

/* -------------------------------------------------------- tangentToGraph */

/**
 * Props for {@link tangentToGraph}. Style props apply to the line.
 *
 * @category Coordinate systems & graphs
 */
export interface TangentToGraphProps extends ShapeProps {
	/** The curve, in data coordinates. */
	function: (x: number) => number;
	/** Point of tangency, as an input in data units. */
	x: number;
	/** Length, centred on the point. Defaults to a third of the plot width. */
	length?: number;
	/** Width of the central difference, in data units. Defaults to 1e-4 of the x extent. */
	dx?: number;
}

/** The tangent segment's ends, in scene units. */
function tangentEnds(
	props: Readonly<TangentToGraphProps>,
	coords: CoordinateSystem,
): { from: Point; to: Point } {
	const at = inputToGraphPoint(coords, props.function, props.x);
	const angle = angleOfTangent(coords, props.function, props.x, props.dx);
	const area = coords.area();
	const half = (props.length ?? (area.maxX - area.minX) / 3) / 2;
	return {
		from: {
			x: at.x - Math.cos(angle) * half,
			y: at.y - Math.sin(angle) * half,
		},
		to: {
			x: at.x + Math.cos(angle) * half,
			y: at.y + Math.sin(angle) * half,
		},
	};
}

/**
 * The tangent to `function` at `x`, in data space, from a central difference.
 *
 * @example
 * ```ts
 * import { axes, createScene, tangentToGraph, track } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const axesNode = scene.add(
 * 	axes.create({ xRange: [-3, 3, 1], yRange: [-2, 2, 1], width: 6, height: 4 }),
 * );
 * const x = track(0);
 * axesNode.add(tangentToGraph.create({ function: Math.sin, x }));
 * ```
 *
 * @see {@link secantSlopeGroup}
 * @category Coordinate systems & graphs
 */
export const tangentToGraph = defineComposite<TangentToGraphProps>({
	name: "TangentToGraph",
	props: {
		...forwardedProps(shapeProps),
		function: { invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		length: { invalidates: Invalidate.UPDATE },
		dx: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const ends = tangentEnds(ctx.props, requireCoords(ctx, "TangentToGraph"));
		const node = line.create(ends);
		forwardProps(ctx, node, shapeKeysWithout(["x"]));
		return [node];
	},
	update: (changed, ctx) => {
		forwardHandlersToChildren(changed, ctx);
		if (!needsRebuild(changed)) return undefined;
		const node = ctx.node.children[0] as SceneNode<{ from: Point; to: Point }>;
		node.update(tangentEnds(ctx.props, requireCoords(ctx, "TangentToGraph")));
		return undefined;
	},
});
