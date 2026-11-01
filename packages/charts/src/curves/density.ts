/**
 * `density`: a kernel density estimate per `series`, drawn as one path
 * batch (per curve a closed fill item, then its open line) in a group whose
 * clip the `"x"` reveal sweeps. With `row`, curves stand in a band axis's
 * rows: a ridgeline.
 */

import type {
	CompositeContext,
	PathBatchItem,
	SceneNode,
} from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	UNDER_AXES_Z_INDEX,
} from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, Point } from "@sophistry/core/geometry";
import { cssColor, maxOf } from "@sophistry/core/internal";
import { bandSpan } from "../band.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel, DateSink } from "../data/channels.js";
import {
	channelValues,
	dateSinkContext,
	identity,
	numberValues,
} from "../data/channels.js";
import type { EndSpace, Mapper } from "../end-space.js";
import { endSpace, SCENE_UNITS } from "../end-space.js";
import type { JoinEnd } from "../join.js";
import {
	createGroupJoin,
	layerTransition,
	sweepIn,
	transitionColor,
} from "../join.js";
import { morphPolyline } from "../math/morph.js";
import { revealClipAlongX } from "../math/reveal.js";
import type { KdePoint } from "../math/violin.js";
import { gaussianKde } from "../math/violin.js";
import type {
	AnyDatum,
	DensityReveal,
	SeriesTransitionProps,
} from "../props.js";
import type { Category, GroupKey } from "../series.js";
import { createSeries, groupIndices, WHOLE } from "../series.js";
import { keyedMemo } from "../util.js";
import type { CurveBatch } from "./shared.js";
import { createCurveBatch, groupColors, slotOf } from "./shared.js";

const DEFAULT_FILL_OPACITY = 0.3;
const DEFAULT_ROW_HEIGHT = 1.4;

/**
 * Props of {@link density}: `x` defaults to the datum when `data` is
 * `number[]`; name it otherwise.
 *
 * @category Charts
 */
export interface DensityProps<T = unknown> extends SeriesTransitionProps<T> {
	/** The sample: one value per datum. */
	data: readonly T[];
	/**
	 * The sample value, in data units. Defaults to the datum when `data` is `number[]`; required
	 * otherwise. Non-finite values are dropped.
	 */
	x?: Channel<T, number>;
	/** Gaussian kernel bandwidth, in data units. Defaults to Silverman's rule of thumb. */
	bandwidth?: number;
	/**
	 * How many points the curve is evaluated at.
	 * @default 80
	 */
	samples?: number;
	/** The x span to evaluate over. Defaults to the data's extent padded by three bandwidths. */
	domain?: [number, number];
	/**
	 * The category of each datum: one curve per category (each with area 1), coloured through the
	 * chart's shared colour scale and legend. `color` wins.
	 */
	series?: Channel<T, BandKey>;
	/**
	 * With a `series`: scale each curve by its share of the data, so all areas add up to 1.
	 * @default false
	 */
	commonNorm?: boolean;
	/**
	 * `"vertical"`: values along x, density up y. `"horizontal"`: values up y, density to the right
	 * (a marginal beside a y axis).
	 * @default "vertical"
	 */
	orientation?: "vertical" | "horizontal";
	/**
	 * Sit the curve in a category's band on a band axis instead of on a density axis: a ridgeline,
	 * one `density` per row. `true` with a `series` puts each category on its own row.
	 */
	row?: BandKey | true;
	/**
	 * With `row`: the peak height, in band slots (above 1 overlaps the next row).
	 * @default 1.4
	 */
	rowHeight?: number;
	/**
	 * With `row`: what reaches `rowHeight`: `"own"` each curve's own peak, `"shared"` the tallest
	 * among this layer's curves, or a density shared across several layers.
	 * @default "own"
	 */
	rowScale?: "own" | "shared" | number;
	/**
	 * Curve and fill colour. Defaults to the `series` colour, else the theme's first series colour.
	 */
	color?: ColorInput;
	/**
	 * Fill opacity under the curve, 0..1 (0 for the curve alone).
	 * @default 0.3
	 */
	fillOpacity?: number;
	/** Width of the curve. */
	strokeWidth?: number;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/**
	 * Reveal, 0..1: `reveal="x"` sweeps the curve in along the values; `"grow"` raises it from its
	 * baseline.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/** How `progress` reveals. @default "x" */
	reveal?: DensityReveal;
	/**
	 * The sample to transition to, curves matched by `series`: shared curves morph in place, new
	 * ones sweep (or grow) in, leaving ones fade out. See {@link SeriesTransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	/** Paint order (both curve and fill paint under the axes of that order). */
	zIndex?: number;
	/** Set to false to hide the curves. */
	visible?: boolean;
}

type Curves = Map<GroupKey, KdePoint[]>;
interface CurveShape {
	line: Point[];
	ring: Point[];
}

/** One sample's curves in data units (x and density), one per group. */
function curvesOf(
	data: readonly unknown[],
	of: readonly Category[] | undefined,
	props: DensityProps<AnyDatum>,
	dates: DateSink | null,
): Curves {
	const all = numberValues(
		data,
		props.x as Channel<unknown, number>,
		identity,
		"x",
		dates,
	);
	const groups = groupIndices(all.length, of);
	const finite = (indices: readonly number[]) =>
		indices.reduce((n, i) => n + (Number.isFinite(all[i]) ? 1 : 0), 0);
	// seaborn's common_norm: each curve weighted by its share of the data.
	const total = props.commonNorm
		? [...groups.values()].reduce((n, indices) => n + finite(indices), 0)
		: 0;
	const out: Curves = new Map();
	for (const [key, indices] of groups) {
		const kde = gaussianKde(
			indices.map((i) => all[i] as number),
			{
				bandwidth: props.bandwidth,
				samples: props.samples,
				domain: props.domain,
			},
		);
		const share = total > 0 ? finite(indices) / total : 1;
		out.set(
			key,
			share === 1
				? kde
				: kde.map((p) => ({ x: p.x, density: p.density * share })),
		);
	}
	return out;
}

/** A curve and its baseline mapped point by point through `system`. */
function mapShape(shape: CurveShape, system: Mapper): CurveShape {
	return {
		line: shape.line.map((p) => system.coordsToPoint(p.x, p.y)),
		ring: shape.ring.map((p) => system.coordsToPoint(p.x, p.y)),
	};
}

/**
 * Two curves (each with its baseline) morphed at `u` along the values, resampled on one grid so the
 * fill closes on the morphed line.
 */
function morphScene(
	a: CurveShape,
	b: CurveShape,
	u: number,
	sideways: boolean,
): CurveShape {
	const flip = (run: readonly Point[]): Point[] =>
		sideways ? run.map((p) => ({ x: p.y, y: p.x })) : [...run];
	const base = (shape: CurveShape) =>
		shape.ring.slice(shape.line.length).reverse();
	const line = flip(morphPolyline(flip(a.line), flip(b.line), u));
	const foot = flip(morphPolyline(flip(base(a)), flip(base(b)), u));
	return { line, ring: [...line, ...foot.reverse()] };
}

/** What a density keeps between updates. */
interface DensityState {
	layer: ChartLayer;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	join: ReturnType<typeof createGroupJoin>;
	from: (deps: readonly unknown[], make: () => Curves) => Curves;
	to: (deps: readonly unknown[], make: () => Curves) => Curves;
	geometry: (
		deps: readonly unknown[],
		make: () => Map<GroupKey, CurveShape>,
	) => Map<GroupKey, CurveShape>;
	batch: CurveBatch;
}

const states = new WeakMap<object, DensityState>();

/** Everything the geometry of one frame reads. */
interface GeometrySpec {
	props: DensityProps<AnyDatum>;
	space: EndSpace;
	sideways: boolean;
	/** The height scale of a `"grow"` reveal (1 otherwise). */
	growth: number;
	growing: boolean;
}

/**
 * A curve and its baseline in scene units: a ridge stands on its row band's lower edge and
 * rises `rowHeight` slots at density `top`, scaled about its baseline by `grow`. Given {@link
 * SCENE_UNITS} as `system`, in that plot's data units instead.
 */
function geometryOf(
	spec: GeometrySpec,
	points: readonly KdePoint[],
	row: BandKey | undefined,
	top: number,
	grow = 1,
	end: JoinEnd = "from",
	system?: Mapper,
): CurveShape | null {
	if (points.length === 0) return null;
	const { space, sideways } = spec;
	const plot = space.coords(end);
	const coords = system ?? plot;
	/** A (value, density) pair in data units, to scene units. */
	const place = (value: number, density: number): Point =>
		sideways
			? coords.coordsToPoint(density, value)
			: coords.coordsToPoint(value, density);
	const t = spec.growth * grow;
	if (row === undefined) {
		const crossing = plot.crossing();
		const foot = sideways ? crossing.x : crossing.y;
		const line = points.map((p) => place(p.x, foot + (p.density - foot) * t));
		const base = points.map((p) => place(p.x, foot));
		return { line, ring: [...line, ...base.reverse()] };
	}
	const span = bandSpan(space.band(end, sideways ? "x" : "y"), row);
	if (!span || !(top > 0)) return null;
	const across = (v: number) =>
		sideways ? coords.coordsToPoint(v, 0).x : coords.coordsToPoint(0, v).y;
	const along = (v: number) =>
		sideways ? coords.coordsToPoint(0, v).y : coords.coordsToPoint(v, 0).x;
	const pitch = Math.abs(across(1) - across(0));
	const foot = Math.min(across(span[0]), across(span[1]));
	const height = (spec.props.rowHeight ?? DEFAULT_ROW_HEIGHT) * pitch * t;
	const at = (value: number, rise: number): Point =>
		sideways
			? { x: foot + rise, y: along(value) }
			: { x: along(value), y: foot + rise };
	const line = points.map((p) => at(p.x, (p.density / top) * height));
	const base = points.map((p) => at(p.x, 0));
	return { line, ring: [...line, ...base.reverse()] };
}

function draw(ctx: CompositeContext<DensityProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as DensityState;
	const props = ctx.props;
	const { layer } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords)
		throw new Error("Density must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const theme = ctx.theme;
	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: props.color !== undefined,
		mark: { line: true },
		dates,
	});
	const kdeDeps = [
		props.x,
		props.bandwidth,
		props.samples,
		props.domain,
		props.commonNorm,
		dates,
	];
	const curves = state.from([props.data, series.of, ...kdeDeps], () =>
		curvesOf(props.data, series.of, props, dates),
	);
	const far = props.to;
	const toCurves = far
		? state.to([far, props.series, ...kdeDeps], () =>
				curvesOf(
					far,
					props.series === undefined
						? undefined
						: channelValues(far, props.series, undefined, "series", dates),
					props,
					dates,
				),
			)
		: undefined;
	const join = state.join({
		fromGroups: [...curves.keys()],
		toGroups: toCurves ? [...toCurves.keys()] : undefined,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
	});
	/** The row a group's curve stands in, or undefined on a density axis. */
	const rowOf = (key: GroupKey): BandKey | undefined => {
		const row = props.row;
		if (row === true) return key === WHOLE ? undefined : key;
		return row;
	};
	/** Turned on its side (`orientation="horizontal"`): values up y, density along x. */
	const sideways = props.orientation === "horizontal";
	/** One end's report: values along, densities (or rows) across. */
	const extentOf = (side: Curves) => {
		const points = [...side.values()].flat();
		const ridges = [...side.keys()].flatMap((key) => {
			const row = rowOf(key);
			return row === undefined ? [] : [row];
		});
		const along = { values: points.map((p) => p.x) };
		const across =
			ridges.length === 0
				? { values: points.map((p) => p.density), zero: true }
				: { categories: ridges, padding: 0 };
		return sideways ? { x: across, y: along } : { x: along, y: across };
	};
	layer.report({
		...extentOf(curves),
		color: transitionColor(series.extent, join.toCategories),
		transition: layerTransition(
			join,
			props.staging,
			toCurves ? extentOf(toCurves) : {},
		),
	});
	const progress = layer.progress(props.progress) ?? 1;
	const growing = props.reveal === "grow";
	const space = endSpace(frame, coords);
	const spec: GeometrySpec = {
		props,
		space,
		sideways,
		growth: growing ? progress : 1,
		growing,
	};

	/** The density a ridge's `rowHeight` stands for at one end, or undefined for each curve's own peak. */
	const sharedPeakOf = (side: Curves): number | undefined => {
		const scale = props.rowScale;
		if (typeof scale === "number")
			return Number.isFinite(scale) && scale > 0 ? scale : undefined;
		if (scale !== "shared") return undefined;
		const peak = maxOf(
			[...side.values()].flatMap((points) => points.map((p) => p.density)),
			0,
		);
		return peak > 0 ? peak : undefined;
	};
	const sharedPeak = sharedPeakOf(curves);
	const toSharedPeak = toCurves ? sharedPeakOf(toCurves) : undefined;
	/** The density that reaches a ridge's `rowHeight`. */
	const peakOf = (points: readonly KdePoint[], shared: number | undefined) =>
		shared ??
		maxOf(
			points.map((p) => p.density),
			0,
		);

	/**
	 * A curve both ends have, at update progress `u`, in scene units: densities blended per value
	 * on one shared grid, or for a ridge each end's shape scaled to its own peak.
	 */
	const morphedOf = (
		a: readonly KdePoint[],
		b: readonly KdePoint[],
		row: BandKey | undefined,
		u: number,
	): CurveShape | null => {
		if (u <= 0) return geometryOf(spec, a, row, peakOf(a, sharedPeak));
		if (u >= 1)
			return geometryOf(spec, b, row, peakOf(b, toSharedPeak), 1, "to");
		// Mid-swap: each end's curve in its own plot's data units, morphed
		// along the values per axis (`EndSpace.morph`).
		if (space.swapping) {
			const whole = (end: JoinEnd, system?: Mapper) =>
				end === "from"
					? geometryOf(spec, a, row, peakOf(a, sharedPeak), 1, "from", system)
					: geometryOf(spec, b, row, peakOf(b, toSharedPeak), 1, "to", system);
			// An end with no curve holds the other (as `morphPolyline` does);
			// a ridge with no peak at one end cuts midway, as below.
			if (b.length === 0) return whole("from");
			if (a.length === 0) return whole("to");
			const from = whole("from", SCENE_UNITS);
			const to = whole("to", SCENE_UNITS);
			if (!from || !to) return whole(u < 0.5 ? "from" : "to");
			return space.morph(from, to, u, {
				scene: mapShape,
				morph: (p, q, v) => morphScene(p, q, v, sideways),
				build: mapShape,
			});
		}
		const lineOf = (points: readonly KdePoint[], top: number) =>
			points.map((p) => ({ x: p.x, y: p.density / top }));
		const topA = row === undefined ? 1 : peakOf(a, sharedPeak);
		const topB = row === undefined ? 1 : peakOf(b, toSharedPeak);
		// A ridge with no peak at one end has no shape to blend: cut midway.
		if (!(topA > 0) || !(topB > 0))
			return u < 0.5
				? geometryOf(spec, a, row, topA)
				: geometryOf(spec, b, row, peakOf(b, toSharedPeak), 1, "to");
		const blended = morphPolyline(lineOf(a, topA), lineOf(b, topB), u).map(
			(p) => ({ x: p.x, density: p.y }),
		);
		return geometryOf(spec, blended, row, 1);
	};

	/** Each group's curve on this frame, in scene units. */
	const geometry = state.geometry(
		[
			curves,
			toCurves,
			coords,
			frame?.xBand,
			frame?.yBand,
			frame?.ends,
			frame?.join,
			join.active ? join.t : -1,
			join.active ? props.enterStagger : 0,
			spec.growth,
			props.row,
			props.rowHeight,
			props.rowScale,
			sideways,
		],
		() => {
			const out = new Map<GroupKey, CurveShape>();
			if (!toCurves) {
				for (const [key, points] of curves) {
					const shape = geometryOf(
						spec,
						points,
						rowOf(key),
						peakOf(points, sharedPeak),
					);
					if (shape) out.set(key, shape);
				}
				return out;
			}
			for (const key of join.groups) {
				const a = curves.get(key);
				const b = toCurves.get(key);
				const row = rowOf(key);
				if (a && b) {
					const shape = morphedOf(a, b, row, join.update);
					if (shape) out.set(key, shape);
				} else if (a) {
					const shape = geometryOf(spec, a, row, peakOf(a, sharedPeak));
					if (shape) out.set(key, shape);
				} else if (b) {
					const enter = join.enterOf(key as BandKey);
					// Enters as the reveal does: grown out of its baseline, or swept in.
					const top = peakOf(b, toSharedPeak);
					const shape = geometryOf(
						spec,
						b,
						row,
						top,
						growing ? enter : 1,
						"to",
					);
					if (!shape || growing) {
						if (shape && enter > 0) out.set(key, shape);
						continue;
					}
					const cut = sweepIn(
						{ lines: [shape.line], rings: [shape.ring] },
						enter,
						sideways,
					);
					if (cut.lines.length > 0 || cut.rings.length > 0)
						out.set(key, { line: cut.lines.flat(), ring: cut.rings.flat() });
				}
			}
			return out;
		},
	);

	/** The x reveal's front: one clip over every curve and fill (along y when horizontal). */
	let sweep: ReturnType<typeof revealClipAlongX> | undefined;
	const shapes = [...geometry.values()];
	if (!growing && shapes.length > 0) {
		const rings = shapes.map((shape) => shape.ring);
		if (!sideways) sweep = revealClipAlongX(rings, progress);
		else {
			// Sweep the transposed geometry along x, then transpose the box back.
			const box = revealClipAlongX(
				rings.map((ring) => ring.map((p) => ({ x: p.y, y: p.x }))),
				progress,
			);
			sweep = box
				? { minX: box.minY, maxX: box.maxY, minY: box.minX, maxY: box.maxX }
				: undefined;
		}
	}
	const groupColor = groupColors(layer, series, join);
	const fallback = cssColor(
		props.color ?? theme.palette.series[0] ?? theme.palette.foreground,
	);
	const items: [unknown, PathBatchItem][] = [];
	for (const key of join.groups) {
		const shape = geometry.get(key);
		// A leaving curve fades on the exit stage.
		const fade = join.fade(key);
		if (!shape || !(fade > 0)) continue;
		const color = groupColor(key) ?? fallback;
		const opacity = fade < 1 ? { opacity: fade } : {};
		if (shape.ring.length > 0)
			items.push([
				slotOf(key, "fill"),
				{
					closed: true,
					polylines: [shape.ring],
					fill: color,
					stroke: "none",
					...opacity,
				},
			]);
		if (shape.line.length > 0)
			items.push([
				slotOf(key, "line"),
				{ closed: false, polylines: [shape.line], stroke: color, ...opacity },
			]);
	}
	state.batch.update(
		items,
		{
			stroke: fallback,
			strokeWidth: props.strokeWidth,
			fillOpacity: props.fillOpacity ?? DEFAULT_FILL_OPACITY,
			opacity: props.opacity,
			progress: progress > 0 ? 1 : 0,
			// Its tails run along the baseline: under the axis line too.
			zIndex: (props.zIndex ?? 0) + UNDER_AXES_Z_INDEX,
			visible: props.visible,
		},
		sweep ?? undefined,
	);
	return [state.batch.node];
}

/**
 * A kernel density estimate of a sample, drawn as an area whose y axis reads
 * probability density. With `row`, curves sit in a band axis's rows: a
 * ridgeline. Inside a `chart` or `axes`. See `gaussianKde` for the estimate
 * alone.
 *
 * @example
 * ```ts
 * import { chart, density } from "@sophistry/charts";
 *
 * const rows = [
 * 	{ group: "a", height: 162 },
 * 	{ group: "a", height: 171 },
 * 	{ group: "b", height: 175 },
 * 	{ group: "b", height: 183 },
 * ];
 * chart.create({
 * 	width: 8,
 * 	height: 4,
 * 	children: [density.create({ data: rows, x: "height", series: "group", row: true })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#distributions
 * @category Charts
 */
export const density = defineComposite<DensityProps<AnyDatum>>({
	name: "Density",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		bandwidth: { invalidates: Invalidate.UPDATE },
		samples: { invalidates: Invalidate.UPDATE },
		domain: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		commonNorm: { invalidates: Invalidate.UPDATE },
		orientation: { invalidates: Invalidate.UPDATE },
		row: { invalidates: Invalidate.UPDATE },
		rowHeight: { invalidates: Invalidate.UPDATE },
		rowScale: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		reveal: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		states.set(ctx.node, {
			layer,
			series: createSeries<AnyDatum>(layer),
			join: createGroupJoin(),
			from: keyedMemo(),
			to: keyedMemo(),
			geometry: keyedMemo(),
			batch: createCurveBatch(),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
