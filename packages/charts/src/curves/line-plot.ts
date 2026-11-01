/**
 * `linePlot`: a line through data points, one per `series`, drawn as one
 * path batch (an open outline per line, each with its own stroke and fade).
 *
 * A keyed transition (`to` + `blend`) matches lines by `series`: shared lines
 * morph on one x grid (`morphRuns`), entering ones sweep in along x, leaving
 * ones fade. `progress` cuts every line at one front along x (the cut
 * geometry is drawn whole), or with `reveal="length"` draws each line along
 * its arc length (the item's `progress`).
 * A line far longer than the plot is wide is decimated to the plot's
 * columns at rest.
 */

import type {
	CompositeContext,
	CoordinateSystem,
	PaintSpec,
	PathBatchItem,
	SceneNode,
	Space,
} from "@sophistry/core";
import { defineComposite, Invalidate, SpaceChange } from "@sophistry/core";
import type {
	BandKey,
	CurveKind,
	CurvePath,
	Point,
} from "@sophistry/core/geometry";
import { clipCurvePathToX, curvePath } from "@sophistry/core/geometry";
import { clipBounds } from "@sophistry/core/internal";
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
import type { Mapper } from "../end-space.js";
import { endSpace } from "../end-space.js";
import type { ChartFrame } from "../frame/types.js";
import { createGroupJoin, layerTransition, transitionColor } from "../join.js";
import {
	DECIMATION_MIN_PER_COLUMN,
	dataRuns,
	decimateRun,
	isNonDecreasingX,
} from "../math/line.js";
import { morphRuns } from "../math/morph.js";
import { clipPolylineToX, revealCutoff, xExtent } from "../math/reveal.js";
import type { AnyDatum, CurveReveal, SeriesTransitionProps } from "../props.js";
import { projectRun } from "../raster.js";
import type { GroupKey } from "../series.js";
import { groupIndices, WHOLE } from "../series.js";
import type {
	SharedTooltipDatum,
	TooltipPoint,
	TooltipState,
} from "../tooltip.js";
import { sharedTooltipPoints, tooltipContext } from "../tooltip.js";
import { keyedMemo } from "../util.js";
import type { CurveBatch } from "./shared.js";
import { createCurveBatch } from "./shared.js";

/**
 * Columns a long line is decimated to across the plot's width (see `decimateRun`), meant as one
 * per device pixel or finer. A mark cannot see the canvas's device-pixel size, so this is a
 * fixed resolution instead: fine enough for a plot up to 4096 device pixels wide (2048 CSS
 * pixels at 2x), and decimation only starts above four points per column.
 */
const DECIMATION_COLUMNS = 4096;

/**
 * Props of {@link linePlot}: `x` and `y` default to the index and the datum
 * when `data` is `number[]`; name them otherwise.
 *
 * @category Charts
 */
export interface LinePlotProps<T = unknown> extends SeriesTransitionProps<T> {
	/** One point per datum, in order; a datum with a non-finite `x` or `y` lifts the pen. */
	data: readonly T[];
	/**
	 * X position, in data units (a `Date` reads as epoch ms). Defaults to the index when `data` is
	 * `number[]`; required otherwise.
	 */
	x?: Channel<T, PositionValue>;
	/**
	 * Y position, in data units (a `Date` reads as epoch ms). Defaults to the datum when `data` is
	 * `number[]`; required otherwise.
	 */
	y?: Channel<T, PositionValue>;
	/**
	 * How `progress` reveals the line: `"x"` sweeps it in left to right at a constant rate along x;
	 * `"length"` draws it by arc length (better for a connected scatter).
	 * @default "x"
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	reveal?: CurveReveal;
	/**
	 * How the line runs between points: `"linear"`, `"monotone"` (smooth, never overshoots),
	 * `"natural"`, `"catmull-rom"`, or `"step"`/`"step-before"`/`"step-after"`. See {@link
	 * CurveKind}.
	 * @default "linear"
	 */
	curve?: CurveKind;
	/**
	 * The category of each datum: one line per category, coloured through the chart's shared colour
	 * scale and legend. `stroke` wins.
	 */
	series?: Channel<T, BandKey>;
	/**
	 * The data to transition to, lines matched by `series`: shared lines morph (y blended per x),
	 * new ones sweep in, leaving ones fade out. See {@link SeriesTransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	/** Line colour (or gradient) for every line. Defaults to the `series` colour, else the theme's foreground. */
	stroke?: PaintSpec;
	/** Line width. Defaults to the theme's stroke width. */
	strokeWidth?: number;
	/** Dash pattern, in scene units. Solid when omitted. */
	dash?: number[];
	/** Offset into `dash`. @default 0 */
	dashOffset?: number;
	/** How line ends are capped. @default "round" */
	lineCap?: CanvasLineCap;
	/** How corners are joined. @default "round" */
	lineJoin?: CanvasLineJoin;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/** Reveal 0..1 (see `reveal`). @default 1 */
	progress?: number;
	/** Paint order. */
	zIndex?: number;
	/** Set to false to hide the lines. */
	visible?: boolean;
}

/** One dataset's lines in data units: per line its runs, lines in order of first appearance. */
interface LineSide {
	x: number[];
	y: number[];
	runs: Map<GroupKey, Point[][]>;
	keys: GroupKey[];
}

function sideOf(
	data: readonly unknown[],
	props: LinePlotProps<AnyDatum>,
	dates: DateSink | null,
): LineSide {
	const x = numberValues(
		data,
		props.x as Channel<unknown, PositionValue>,
		indexOf,
		"x",
		dates,
	);
	const y = numberValues(
		data,
		props.y as Channel<unknown, PositionValue>,
		identity,
		"y",
		dates,
	);
	const series =
		props.series === undefined
			? undefined
			: channelValues(
					data,
					props.series as Channel<unknown, BandKey>,
					undefined,
					"series",
					dates,
				);
	const groups = groupIndices(data.length, series);
	const runs = new Map<GroupKey, Point[][]>();
	for (const [key, indices] of groups) {
		runs.set(
			key,
			dataRuns(
				indices.map((i) => x[i] as number),
				indices.map((i) => y[i] as number),
			),
		);
	}
	return { x, y, runs, keys: [...groups.keys()] };
}

/** What a line plot keeps between updates. */
interface LinePlotState {
	layer: ChartLayer;
	join: ReturnType<typeof createGroupJoin>;
	from: (deps: readonly unknown[], make: () => LineSide) => LineSide;
	to: (deps: readonly unknown[], make: () => LineSide) => LineSide;
	decimation: (
		deps: readonly unknown[],
		make: () => { edges: number[]; dropOutside: boolean } | undefined,
	) => { edges: number[]; dropOutside: boolean } | undefined;
	sortedRuns: WeakMap<readonly Point[], boolean>;
	runs: (
		deps: readonly unknown[],
		make: () => Map<GroupKey, Point[][]>,
	) => Map<GroupKey, Point[][]>;
	tips: (
		deps: readonly unknown[],
		make: () => readonly TooltipPoint[],
	) => readonly TooltipPoint[];
	owner: object;
	/** The tooltip the points were last offered to (read again on dispose, when the context is gone). */
	offeredTo: TooltipState | null;
	lines: CurveBatch;
}

const states = new WeakMap<object, LinePlotState>();

/**
 * The column boundaries, in data x, a long line is thinned to (see `decimateRun`):
 * `DECIMATION_COLUMNS` across the plot's width, over the plot, or, when a clip (the chart's
 * `clip`, its reveal sweep) bounds what shows, over the clip, whose far side's points can then
 * go. Undefined when there is nothing to thin to.
 *
 * @param space - The line's space: the clip is in scene units, and maps back onto the plot's
 *   own x only through a transform that keeps x apart from y.
 */
function decimationOf(
	coords: CoordinateSystem,
	space: Space,
): { edges: number[]; dropOutside: boolean } | undefined {
	const area = coords.area();
	const width = area.maxX - area.minX;
	let left = area.minX;
	let right = area.maxX;
	const clip = clipBounds(space.clip);
	const matrix = space.matrix;
	const clipped =
		clip !== null && matrix.b === 0 && matrix.c === 0 && matrix.a !== 0;
	if (clipped) {
		const one = (clip.minX - matrix.e) / matrix.a;
		const other = (clip.maxX - matrix.e) / matrix.a;
		left = Math.min(one, other);
		right = Math.max(one, other);
	}
	if (!(width > 0) || !(right > left) || !Number.isFinite(right - left))
		return undefined;
	// Columns as wide as the plot's, whatever the window.
	const columns = Math.ceil((DECIMATION_COLUMNS * (right - left)) / width);
	if (columns > 4 * DECIMATION_COLUMNS) return undefined;
	const y = (area.minY + area.maxY) / 2;
	const edges: number[] = [];
	for (let k = 0; k <= columns; k++) {
		const at = coords.pointToCoords({
			x: left + ((right - left) * k) / columns,
			y,
		}).x;
		if (!Number.isFinite(at)) return undefined;
		edges.push(at);
	}
	// A reversed axis runs its columns right to left in data.
	edges.sort((a, b) => a - b);
	return { edges, dropOutside: clipped };
}

function draw(ctx: CompositeContext<LinePlotProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as LinePlotState;
	const props = ctx.props;
	const { layer } = state;
	const frame: ChartFrame | null = layer.frame();
	const coords = layer.coords();
	if (!coords)
		throw new Error("LinePlot must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const tooltip = ctx.context(tooltipContext);
	const theme = ctx.theme;

	const from = state.from(
		[props.data, props.x, props.y, props.series, dates],
		() => sideOf(props.data, props, dates),
	);
	const far = props.to;
	const to = far
		? state.to([far, props.x, props.y, props.series, dates], () =>
				sideOf(far, props, dates),
			)
		: undefined;
	const join = state.join({
		fromGroups: from.keys,
		toGroups: to?.keys,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
	});
	const categories = join.groups.filter((key): key is BandKey => key !== WHOLE);
	/** Colours come from the scale unless `stroke` says otherwise. */
	const scaled = props.series !== undefined && props.stroke === undefined;
	layer.report({
		x: { values: from.x },
		y: { values: from.y },
		color: scaled
			? transitionColor(
					{
						categories: from.keys.filter(
							(key): key is BandKey => key !== WHOLE,
						),
						mark: { line: true },
					},
					to?.keys.filter((key): key is BandKey => key !== WHOLE),
				)
			: undefined,
		transition: layerTransition(
			join,
			props.staging,
			to ? { x: { values: to.x }, y: { values: to.y } } : {},
		),
	});
	const colorScale = layer.colorScale(categories);
	const progress = layer.progress(props.progress);
	const alongX = props.reveal !== "length";
	const curve = props.curve ?? "linear";
	/** Curved, a line is cut after curving (so a cut never straightens it). */
	const curved = curve !== "linear";
	const project = (
		runs: readonly (readonly Point[])[],
		system: Mapper = coords,
	): Point[][] => runs.map((run) => projectRun(system, run));
	/** Where each end draws while an axis changes kind across the transition. */
	const space = endSpace(frame, coords);
	// Only a line long enough to be thinned reads its space (a clip narrows
	// the window it is thinned over); the composite then reruns when an
	// ancestor's clip or matrix changes, and no other line plot ever does.
	const thinning =
		!to &&
		[...from.runs.values()].some((lines) =>
			lines.some(
				(run) => run.length > DECIMATION_MIN_PER_COLUMN * DECIMATION_COLUMNS,
			),
		)
			? ctx.space(SpaceChange.MATRIX | SpaceChange.CLIP)
			: undefined;

	/**
	 * A side's lines with the long runs decimated to the plot's columns. Runs too short to need it
	 * (most data) are passed through without reading the plot's columns.
	 */
	const thinned = (lines: readonly (readonly Point[])[]) =>
		lines.map((run) => {
			if (run.length <= DECIMATION_MIN_PER_COLUMN * DECIMATION_COLUMNS)
				return run;
			let sorted = state.sortedRuns.get(run);
			if (sorted === undefined) {
				sorted = isNonDecreasingX(run);
				state.sortedRuns.set(run, sorted);
			}
			const at =
				sorted && thinning
					? state.decimation([coords, thinning.matrix, thinning.clip], () =>
							decimationOf(coords, thinning),
						)
					: undefined;
			return at ? decimateRun(run, at.edges, at.dropOutside) : run;
		});

	/**
	 * Each line's runs in scene units on this frame: shared lines morph on one x grid, entering
	 * ones sweep in, exiting ones keep their place (they fade). At rest, a line far longer than
	 * the plot is wide is decimated first. Recomputed only when the data, the plot or the blend
	 * moved, not for a reveal.
	 */
	const runs = state.runs(
		[
			from,
			to,
			coords,
			frame?.ends,
			frame?.join,
			join.active ? join.t : -1,
			join.active ? props.enterStagger : 0,
			curved,
			thinning?.matrix,
			thinning?.clip,
		],
		() => {
			const out = new Map<GroupKey, Point[][]>();
			if (!to) {
				for (const [key, lines] of from.runs)
					out.set(key, project(thinned(lines)));
				return out;
			}
			// An axis changing kind: each end's line through its own plot,
			// morphed in scene units along that axis (a slot and a value
			// share no units) and in data units along the other.
			const fromCoords = space.coords("from");
			const toCoords = space.coords("to");
			for (const key of join.groups) {
				const a = from.runs.get(key);
				const b = to.runs.get(key);
				if (a && b) {
					out.set(
						key,
						space.morph(a, b, join.update, {
							scene: project,
							morph: morphRuns,
							build: project,
						}),
					);
				} else if (a) {
					out.set(key, project(a, fromCoords));
				} else if (b) {
					const enter = join.enterOf(key as BandKey);
					const lines = project(b, toCoords);
					const extent = xExtent(lines);
					out.set(
						key,
						!(enter > 0) || !extent
							? []
							: enter >= 1 || curved
								? lines
								: lines.flatMap((run) =>
										clipPolylineToX(run, revealCutoff(enter, extent)),
									),
					);
				}
			}
			return out;
		},
	);

	/** Where the reveal's cut stands, in scene x: one front for every line. Undefined when nothing is cut. */
	let cutoff: number | null | undefined;
	{
		const own = progress ?? 1;
		if (!alongX || own >= 1) cutoff = undefined;
		else if (!(own > 0)) cutoff = null;
		else {
			const extent = xExtent([...runs.values()].flat());
			cutoff = extent ? revealCutoff(own, extent) : null;
		}
	}

	const items: [GroupKey, PathBatchItem][] = [];
	for (const key of join.groups) {
		const fade = join.fade(key);
		if (!(fade > 0) || cutoff === null) continue;
		const lineRuns = runs.get(key) ?? [];
		let outline: { polylines?: Point[][]; curvePaths?: CurvePath[] };
		if (curved) {
			// Curved, an entering line's sweep front (straight, it is cut in `runs`).
			let entering: number | undefined;
			if (to && !from.runs.has(key)) {
				const enter = join.enterOf(key as BandKey);
				const extent = xExtent(lineRuns);
				if (enter > 0 && enter < 1 && extent)
					entering = revealCutoff(enter, extent);
			}
			const front =
				cutoff === undefined
					? entering
					: entering === undefined
						? cutoff
						: Math.min(cutoff, entering);
			const paths = lineRuns.map((run) => curvePath(run, curve));
			outline = {
				curvePaths:
					front === undefined
						? paths
						: paths.flatMap((path) => clipCurvePathToX(path, front)),
			};
		} else {
			// Straight segments draw as the polylines they are: no cubics to
			// build, and none for the renderer to flatten back.
			outline = {
				polylines:
					cutoff === undefined
						? lineRuns
						: lineRuns.flatMap((run) => clipPolylineToX(run, cutoff)),
			};
		}
		if ((outline.curvePaths ?? outline.polylines ?? []).length === 0) continue;
		/** Drawn by arc length: the whole line, traced to `progress` of its length. */
		const traced =
			!alongX && progress !== undefined && progress < 1 ? progress : 1;
		items.push([
			key,
			{
				closed: false,
				...outline,
				...(traced < 1 ? { progress: traced } : {}),
				...(props.stroke === undefined && key !== WHOLE
					? { stroke: colorScale(key) }
					: {}),
				...(fade < 1 ? { opacity: fade } : {}),
			},
		]);
	}

	// The chart's shared nearest-x tip (`chart({ tooltip: { mode: "x" } })`):
	// every point of every line, once the layer is drawn whole, from the
	// nearer end of a transition.
	if (tooltip) {
		const whole = props.visible !== false && (progress ?? 1) >= 1;
		const side = to && (props.blend ?? 0) >= 0.5 ? to : from;
		const points = state.tips(
			[whole, side, coords, colorScale, props.stroke, tooltip.config(), frame],
			() =>
				sharedTooltipPoints(
					tooltip,
					() => {
						if (!whole) return [];
						const out: SharedTooltipDatum[] = [];
						for (const [key, lines] of side.runs) {
							const series = key === WHOLE ? undefined : key;
							const color =
								typeof props.stroke === "string"
									? props.stroke
									: series === undefined
										? undefined
										: colorScale(series);
							for (const run of lines)
								for (const point of run)
									out.push({
										x: point.x,
										y: point.y,
										at: coords.coordsToPoint(point.x, point.y),
										series,
										color,
									});
						}
						return out;
					},
					{ y: props.y, format: frame?.format },
				),
		);
		if (state.offeredTo && state.offeredTo !== tooltip)
			state.offeredTo.offerPoints(state.owner, null);
		state.offeredTo = tooltip;
		tooltip.offerPoints(state.owner, points);
	}

	state.lines.update(items, {
		stroke: props.stroke ?? theme.palette.foreground,
		strokeWidth: props.strokeWidth,
		dash: props.dash,
		dashOffset: props.dashOffset,
		lineCap: props.lineCap,
		lineJoin: props.lineJoin,
		opacity: props.opacity,
		zIndex: props.zIndex,
		visible: props.visible,
	});
	return [state.lines.node];
}

/**
 * A line through data points, in data coordinates; one line per `series`.
 * Non-finite points split the line into runs. Inside a `chart` (or any
 * `axes`). For a function `y = f(x)`, use `functionGraph`. Drawn as one path
 * batch: one item per line.
 *
 * @example
 * ```ts
 * import { chart, linePlot } from "@sophistry/charts";
 *
 * // number[] data: x is the index, y the value. With records, name the
 * // channels: linePlot.create({ data: rows, x: "year", y: (d) => d.sales / 1000 }).
 * chart.create({
 * 	width: 8,
 * 	height: 5,
 * 	children: [linePlot.create({ data: [1, 4, 3, 7, 6, 9] })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#lines-scatter-and-error-bars
 * @category Charts
 */
export const linePlot = defineComposite<LinePlotProps<AnyDatum>>({
	name: "LinePlot",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		reveal: { invalidates: Invalidate.UPDATE },
		curve: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		stroke: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		dash: { invalidates: Invalidate.UPDATE },
		dashOffset: { invalidates: Invalidate.UPDATE },
		lineCap: { invalidates: Invalidate.UPDATE },
		lineJoin: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		const owner = {};
		const state: LinePlotState = {
			layer,
			join: createGroupJoin(),
			from: keyedMemo(),
			to: keyedMemo(),
			decimation: keyedMemo(),
			sortedRuns: new WeakMap(),
			runs: keyedMemo(),
			tips: keyedMemo(),
			owner,
			offeredTo: null,
			lines: createCurveBatch(),
		};
		states.set(ctx.node, state);
		ctx.onDispose(() => {
			state.offeredTo?.offerPoints(owner, null);
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
