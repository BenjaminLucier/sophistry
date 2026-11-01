/**
 * `fillBetween`: the shaded region between two channels (or one and the
 * baseline), one region per `series`, drawn as one path batch (a closed
 * item per region) in a group whose clip the `"x"` reveal sweeps;
 * `reveal="length"` traces each region's outline instead (the item's
 * `progress`), its fill coming up with it.
 */

import type {
	CompositeContext,
	CoordinateSystem,
	PaintSpec,
	PathBatchItem,
	SceneNode,
} from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	UNDER_AXES_Z_INDEX,
} from "@sophistry/core";
import type {
	BandKey,
	CurveKind,
	CurvePath,
	Point,
} from "@sophistry/core/geometry";
import { clipClosedCurvePathToX } from "@sophistry/core/geometry";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel, DateSink, PositionValue } from "../data/channels.js";
import {
	channelValues,
	dateSinkContext,
	identity,
	indexOf,
	numberValues,
} from "../data/channels.js";
import type { EndSpace, Mapper } from "../end-space.js";
import { endSpace, sceneAreaRuns } from "../end-space.js";
import type { JoinEnd } from "../join.js";
import {
	createGroupJoin,
	layerTransition,
	sweepIn,
	transitionColor,
} from "../join.js";
import { fillBetweenCurve, fillBetweenRings } from "../math/fillBetween.js";
import type { AreaPoint } from "../math/morph.js";
import { morphAreaRuns } from "../math/morph.js";
import { revealClipAlongX, revealCutoff, xExtent } from "../math/reveal.js";
import type { AnyDatum, CurveReveal, SeriesTransitionProps } from "../props.js";
import type { Category, GroupKey } from "../series.js";
import { createSeries, groupIndices } from "../series.js";
import { keyedMemo } from "../util.js";
import type { CurveBatch } from "./shared.js";
import { createCurveBatch, groupColors } from "./shared.js";

const DEFAULT_FILL_OPACITY = 0.3;

/**
 * Props of {@link fillBetween}: `x` and `y1` default to the index and the
 * datum when `data` is `number[]`; name them otherwise.
 *
 * @category Charts
 */
export interface FillBetweenProps<T = unknown>
	extends SeriesTransitionProps<T> {
	/** One sample per datum along x; the region splits wherever `x`, `y1` or `y2` is non-finite. */
	data: readonly T[];
	/**
	 * X position, in data units (a `Date` reads as epoch ms). Defaults to the index when `data` is
	 * `number[]`; required otherwise.
	 */
	x?: Channel<T, PositionValue>;
	/**
	 * One boundary, in data units. Defaults to the datum when `data` is `number[]`; required
	 * otherwise.
	 */
	y1?: Channel<T, number>;
	/** The other boundary, in data units. Defaults to a flat line at the axis baseline. */
	y2?: Channel<T, number>;
	/**
	 * How `progress` reveals the region: `"x"` fills it left to right behind a straight front;
	 * `"length"` traces its outline and fades the fill up.
	 * @default "x"
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	reveal?: CurveReveal;
	/**
	 * How both boundaries run between points: `"linear"` or any {@link CurveKind}. A `linePlot`
	 * with the same `curve` traces the region's edge.
	 * @default "linear"
	 */
	curve?: CurveKind;
	/**
	 * The category of each datum: one region per category (a band per group), filled through the
	 * chart's shared colour scale and legend. `fill` wins.
	 */
	series?: Channel<T, BandKey>;
	/**
	 * The data to transition to, regions matched by `series`: shared regions morph (both bounds
	 * blended per x), new ones sweep in, leaving ones fade out. See {@link SeriesTransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	/** Region fill for every region. Defaults to the `series` colour, else the theme's first series colour. */
	fill?: string;
	/** Fill opacity 0..1. @default 0.3 */
	fillOpacity?: number;
	/** Region outline. @default "none" */
	stroke?: PaintSpec;
	/** Outline width. */
	strokeWidth?: number;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/** Reveal 0..1 (see `reveal`). @default 1 */
	progress?: number;
	/** Paint order (the fill paints under the axes of that order). */
	zIndex?: number;
	/** Set to false to hide the regions. */
	visible?: boolean;
}

/**
 * The continuous runs of an area, split wherever `x`, `y1` or `y2` is non-finite; a run needs two
 * points.
 */
function areaRuns(points: readonly AreaPoint[]): AreaPoint[][] {
	const runs: AreaPoint[][] = [];
	let run: AreaPoint[] = [];
	for (const p of points) {
		if (Number.isFinite(p.x) && Number.isFinite(p.y1) && Number.isFinite(p.y2))
			run.push(p);
		else {
			if (run.length > 1) runs.push(run);
			run = [];
		}
	}
	if (run.length > 1) runs.push(run);
	return runs;
}

/** One dataset's channels, in data units. */
interface Columns {
	xs: number[];
	upper: number[];
	lower: number[] | undefined;
}

function columnsOf(
	data: readonly unknown[],
	props: FillBetweenProps<AnyDatum>,
	dates: DateSink | null,
): Columns {
	const xs = numberValues(
		data,
		props.x as Channel<unknown, PositionValue>,
		indexOf,
		"x",
		dates,
	);
	const upper = numberValues(
		data,
		props.y1 as Channel<unknown, number>,
		identity,
		"y1",
		dates,
	);
	const lower = props.y2
		? numberValues(
				data,
				props.y2 as Channel<unknown, number>,
				undefined,
				"y2",
				dates,
			)
		: undefined;
	return { xs, upper, lower };
}

/** What a fill-between keeps between updates. */
interface FillBetweenState {
	layer: ChartLayer;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	join: ReturnType<typeof createGroupJoin>;
	from: (deps: readonly unknown[], make: () => Columns) => Columns;
	to: (deps: readonly unknown[], make: () => Columns) => Columns;
	toOf: (
		deps: readonly unknown[],
		make: () => Category[] | undefined,
	) => Category[] | undefined;
	regions: (
		deps: readonly unknown[],
		make: () => Map<GroupKey, Point[][]>,
	) => Map<GroupKey, Point[][]>;
	batch: CurveBatch;
}

const states = new WeakMap<object, FillBetweenState>();

/** One dataset's regions in data units, per group: one area per continuous run (on its end's baseline). */
function runsOf(
	columns: Columns,
	of: readonly Category[] | undefined,
	baseline: number,
): Map<GroupKey, AreaPoint[][]> {
	const { xs, upper, lower } = columns;
	const out = new Map<GroupKey, AreaPoint[][]>();
	for (const [key, indices] of groupIndices(xs.length, of))
		out.set(
			key,
			areaRuns(
				indices.map((i) => ({
					x: xs[i] as number,
					y1: upper[i] as number,
					y2: lower ? (lower[i] as number) : baseline,
				})),
			),
		);
	return out;
}

/** One area's rings in scene units through `system`, as `fillBetweenRings` builds them. */
function ringsOf(
	runs: readonly (readonly AreaPoint[])[],
	system: Mapper,
): Point[][] {
	return runs.flatMap((run) =>
		fillBetweenRings(
			run.map((p) => p.x),
			run.map((p) => p.y1),
			run.map((p) => p.y2),
		).map((ring) => ring.map((at) => system.coordsToPoint(at.x, at.y))),
	);
}

function regionsOf(
	from: Columns,
	of: readonly Category[] | undefined,
	to: Columns | undefined,
	toOf: readonly Category[] | undefined,
	join: ReturnType<ReturnType<typeof createGroupJoin>>,
	coords: CoordinateSystem,
	space: EndSpace,
	curved: boolean,
): Map<GroupKey, Point[][]> {
	const out = new Map<GroupKey, Point[][]>();
	if (!to) {
		const baseline = coords.crossing().y;
		// Drawn plainly at rest: each group's rings straight from its
		// samples (split wherever a sample is non-finite).
		const lower = from.lower ?? from.xs.map(() => baseline);
		for (const [key, indices] of groupIndices(from.xs.length, of))
			out.set(
				key,
				fillBetweenRings(
					indices.map((i) => from.xs[i] as number),
					indices.map((i) => from.upper[i] as number),
					indices.map((i) => lower[i] as number),
				).map((ring) => ring.map((at) => coords.coordsToPoint(at.x, at.y))),
			);
		return out;
	}
	const baseOf = (columns: Columns, end: JoinEnd) =>
		columns.lower ? 0 : space.coords(end).crossing().y;
	const own = runsOf(from, of, baseOf(from, "from"));
	const far = runsOf(to, toOf, baseOf(to, "to"));
	for (const key of join.groups) {
		const a = own.get(key);
		const b = far.get(key);
		// Mid-swap, each end's region through its own plot, morphed in scene
		// units along the axis changing kind, data units along the other.
		if (a && b)
			out.set(
				key,
				space.morph(a, b, join.update, {
					scene: sceneAreaRuns,
					morph: morphAreaRuns,
					build: ringsOf,
				}),
			);
		else if (a) out.set(key, ringsOf(a, space.coords("from")));
		else if (b && curved) out.set(key, ringsOf(b, space.coords("to")));
		else if (b)
			out.set(
				key,
				sweepIn(
					{ lines: [], rings: ringsOf(b, space.coords("to")) },
					join.enterOf(key as BandKey),
				).rings,
			);
	}
	return out;
}

function draw(ctx: CompositeContext<FillBetweenProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as FillBetweenState;
	const props = ctx.props;
	const { layer } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords)
		throw new Error("FillBetween must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const theme = ctx.theme;
	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: props.fill !== undefined,
		mark: { fill: true },
		dates,
	});
	const from = state.from(
		[props.data, props.x, props.y1, props.y2, dates],
		() => columnsOf(props.data, props, dates),
	);
	const far = props.to;
	const to = far
		? state.to([far, props.x, props.y1, props.y2, dates], () =>
				columnsOf(far, props, dates),
			)
		: undefined;
	const toOf = state.toOf([far, props.series, dates], () =>
		far === undefined || props.series === undefined
			? undefined
			: channelValues(far, props.series, undefined, "series", dates),
	);
	// The groups come from the data alone: the regions read the axis
	// baseline, which moves with the transition this join reports.
	const join = state.join({
		fromGroups: [...groupIndices(props.data.length, series.of).keys()],
		toGroups: far ? [...groupIndices(far.length, toOf).keys()] : undefined,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
	});
	const extentOf = (columns: Columns) => ({
		x: { values: columns.xs },
		y: {
			values: [...columns.upper, ...(columns.lower ?? [])],
			zero: !props.y2,
		},
	});
	layer.report({
		...extentOf(from),
		color: transitionColor(series.extent, join.toCategories),
		transition: layerTransition(join, props.staging, to ? extentOf(to) : {}),
	});
	const curve = props.curve ?? "linear";
	/** Curved, an entering region is cut after curving, so it keeps its curved edges. */
	const curved = curve !== "linear";
	const space = endSpace(frame, coords);
	/** Each group's region, in scene units: one ring per continuous run. */
	const regions = state.regions(
		[
			from,
			series.of,
			to,
			toOf,
			coords,
			frame?.ends,
			frame?.join,
			join.active ? join.t : -1,
			join.active ? props.enterStagger : 0,
			curved,
		],
		() => regionsOf(from, series.of, to, toOf, join, coords, space, curved),
	);

	const progress = layer.progress(props.progress);
	const alongX = props.reveal !== "length";
	/** The x reveal's front, as a clip over the whole region. */
	const sweep = alongX
		? revealClipAlongX([...regions.values()].flat(), progress ?? 1)
		: undefined;
	const groupColor = groupColors(layer, series, join);
	/** The regions' own arc-length reveal: whole behind the x front. */
	const traced = alongX ? 1 : (progress ?? 1);
	const items: [GroupKey, PathBatchItem][] = [];
	if (!alongX || progress === undefined || progress > 0) {
		for (const key of join.groups) {
			// A leaving region fades on the exit stage.
			const fade = join.fade(key);
			if (!(fade > 0)) continue;
			const rings = regions.get(key) ?? [];
			let curvePaths: CurvePath[] | undefined;
			if (curved) {
				// Each ring as a closed curve, an entering one cut at its sweep's front.
				const paths = rings.map((ring) => fillBetweenCurve(ring, curve));
				const enter =
					far !== undefined && join.entering(key)
						? join.enterOf(key as BandKey)
						: 1;
				const extent = xExtent(rings);
				if (enter >= 1) curvePaths = paths;
				else if (!(enter > 0) || !extent) curvePaths = [];
				else {
					const cut = revealCutoff(enter, extent);
					curvePaths = paths.flatMap((path) => {
						const kept = clipClosedCurvePathToX(path, cut);
						return kept ? [kept] : [];
					});
				}
			}
			if (rings.length === 0 || (curvePaths && curvePaths.length === 0))
				continue;
			const item: PathBatchItem = {
				closed: true,
				// Curved, the batch flattens the curves for picking.
				...(curvePaths ? { curvePaths } : { polylines: rings }),
				fill:
					props.fill ??
					groupColor(key) ??
					theme.palette.series[0] ??
					theme.palette.foreground,
				...(fade < 1 ? { opacity: fade } : {}),
				...(traced < 1 ? { progress: traced } : {}),
			};
			items.push([key, item]);
		}
	}
	state.batch.update(
		items,
		{
			stroke: props.stroke ?? "none",
			strokeWidth: props.strokeWidth,
			fillOpacity: props.fillOpacity ?? DEFAULT_FILL_OPACITY,
			opacity: props.opacity,
			zIndex: (props.zIndex ?? 0) + UNDER_AXES_Z_INDEX,
			visible: props.visible,
		},
		sweep ?? undefined,
	);
	return [state.batch.node];
}

/**
 * The shaded region between two channels of the same data, or between one
 * and the baseline when `y2` is omitted: a translucent band behind a
 * {@link linePlot}. Gaps in the data split it. Inside a `chart` or `axes`.
 * For a function, use `areaUnderGraph`. See {@link fillBetweenRings} for the
 * geometry alone.
 *
 * @example
 * ```ts
 * import { chart, fillBetween } from "@sophistry/charts";
 *
 * const rows = [
 * 	{ t: 0, low: 1, high: 3 },
 * 	{ t: 1, low: 2, high: 5 },
 * 	{ t: 2, low: 1.5, high: 4 },
 * ];
 * chart.create({
 * 	width: 8,
 * 	height: 4,
 * 	children: [fillBetween.create({ data: rows, x: "t", y1: "high", y2: "low" })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#lines-scatter-and-error-bars
 * @category Charts
 */
export const fillBetween = defineComposite<FillBetweenProps<AnyDatum>>({
	name: "FillBetween",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y1: { invalidates: Invalidate.UPDATE },
		y2: { invalidates: Invalidate.UPDATE },
		reveal: { invalidates: Invalidate.UPDATE },
		curve: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		fill: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		stroke: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
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
			toOf: keyedMemo(),
			regions: keyedMemo(),
			batch: createCurveBatch(),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
