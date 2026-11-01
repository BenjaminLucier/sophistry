/**
 * `stem`: a drop line from the baseline to each value, capped with a
 * marker. Two instances nodes per layer: the drop lines (`line`, see
 * `segment-marks.ts`) and the markers (`circle`), registered in that order
 * so every marker paints over every line.
 *
 * A gradient `stroke` keeps one `line` and one `circle` node per stem: a gradient paints in its own shape's frame, which a batched
 * item does not have (the core rejects gradient fills on instances).
 */

import type { CircleProps, CompositeContext, SceneNode } from "@sophistry/core";
import {
	circle,
	defineComposite,
	Invalidate,
	isGradientSpec,
	line,
} from "@sophistry/core";
import type { BandKey, Point } from "@sophistry/core/geometry";
import { growsFromZero } from "../band.js";
import type { MarkTransition } from "../batch.js";
import { createBatchedMark } from "../batch.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel, ColorChannel, PositionValue } from "../data/channels.js";
import {
	dateSinkContext,
	identity,
	indexOf,
	numberValues,
	resolveColor,
} from "../data/channels.js";
import { endSpace } from "../end-space.js";
import type { JoinFrame } from "../join.js";
import {
	createKeyedData,
	joinFrames,
	layerTransition,
	transitionColor,
} from "../join.js";
import { mixPaint } from "../mix.js";
import type {
	AnyDatum,
	KeyedTransitionProps,
	RevealProps,
	StaggerOrder,
} from "../props.js";
import { createSeries } from "../series.js";
import { orderRanks, staggered } from "../stagger.js";
import { keyedMemo, mix } from "../util.js";
import type { SegmentItem, SegmentMark } from "./segment-marks.js";
import { createSegmentMark } from "./segment-marks.js";
import { stableShared } from "./shared.js";

const DEFAULT_MARKER_RADIUS = 0.09;

/**
 * Props of {@link stem}.
 *
 * @category Charts
 */
export interface StemProps<T = unknown>
	extends KeyedTransitionProps<T>,
		RevealProps {
	/** One drop line and marker per datum; data with a non-finite `x` or `y` are skipped. */
	data: readonly T[];
	/** X position, in data units (a `Date` reads as epoch ms). Defaults to the index when `data` is `number[]`. */
	x?: Channel<T, PositionValue>;
	/** Y position, in data units. Defaults to the datum when `data` is `number[]`. */
	y?: Channel<T, number>;
	/** Data-space y the drop lines start from. Defaults to the axis baseline. */
	baseline?: number;
	/** The series each stem belongs to: colours stems through the chart's shared colour scale and legend. `color` and `stroke` win. */
	series?: Channel<T, BandKey>;
	/**
	 * Colour of the drop line and marker, constant or `(d, i) => colour`. Defaults to `stroke`,
	 * else the `series` colour, else the theme's first series colour.
	 */
	color?: ColorChannel<T>;
	/** Line paint, a colour or a gradient; `color` wins. */
	stroke?: CircleProps["stroke"];
	/** Line width. */
	strokeWidth?: number;
	opacity?: number;
	/**
	 * Marker radius.
	 * @default 0.09
	 */
	markerRadius?: number;
	/** The order `stagger` and `enterStagger` take. @default "position" */
	staggerOrder?: StaggerOrder;
	/**
	 * Reveal, 0..1: each line grows from the baseline, the marker riding its tip (fading in
	 * instead when the axis has no zero).
	 * @default 1
	 */
	progress?: number;
	/** How stems move when `data` changes outside a `to` blend; see {@link MarkTransition}. */
	transition?: MarkTransition;
	zIndex?: number;
	visible?: boolean;
}

/** A stem in data units: where it stands, its value, and its colour (or gradient). */
interface StemState {
	x: number;
	y: number;
	color: unknown;
}

function blendStem(a: StemState, b: StemState, u: number): StemState {
	return {
		x: mix(a.x, b.x, u),
		y: mix(a.y, b.y, u),
		color: a.color === b.color ? a.color : mixPaint(a.color, b.color, u),
	};
}

/** One stem as drawn: its line from foot to head, and its marker at the head. */
interface StemItem extends SegmentItem {
	center: Point;
	fill: string;
	radius: number;
	/** The marker's reveal: tracing (and filling) as it rides the tip, else whole. */
	headProgress: number;
}

interface StemNodes {
	line: SceneNode;
	head: SceneNode;
}

interface StemLayerState {
	layer: ChartLayer;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	lines: SegmentMark<StemItem>;
	heads: ReturnType<
		typeof createBatchedMark<
			StemItem,
			CircleProps,
			SceneNode<CircleProps>,
			keyof CircleProps
		>
	>;
	sides: {
		from: ReturnType<typeof keyedMemo<StemSide>>;
		to: ReturnType<typeof keyedMemo<StemSide>>;
	};
	sharedLines: (next: Record<string, unknown>) => Record<string, unknown>;
	sharedHeads: (next: Record<string, unknown>) => Record<string, unknown>;
	/** Per-stem nodes, for a gradient stroke. */
	nodes: Map<BandKey, StemNodes>;
}

interface StemSide {
	data: readonly unknown[];
	xs: number[];
	ys: number[];
	drawn: number[];
}

const states = new WeakMap<object, StemLayerState>();

function draw(ctx: CompositeContext<StemProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as StemLayerState;
	const props = ctx.props;
	const { layer } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords) throw new Error("Stem must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const theme = ctx.theme;

	const sideOf = (data: readonly unknown[], end: "from" | "to") =>
		state.sides[end]([data, props.x, props.y, dates], () => {
			const xs = numberValues(
				data,
				props.x as Channel<unknown, PositionValue>,
				indexOf,
				"x",
				dates,
			);
			const ys = numberValues(
				data,
				props.y as Channel<unknown, number>,
				identity,
				"y",
				dates,
			);
			const drawn = xs.flatMap((x, i) =>
				Number.isFinite(x) && Number.isFinite(ys[i]) ? [i] : [],
			);
			return { data, xs, ys, drawn };
		});
	const from = sideOf(props.data, "from");
	const to = props.to ? sideOf(props.to, "to") : undefined;
	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: props.color !== undefined || props.stroke !== undefined,
		mark: { line: true, symbol: "circle" },
		counted: from.drawn,
		dates,
	});
	const keyed = state.keyed({
		data: props.data,
		to: props.to,
		key: props.key,
		series: props.series,
		of: series.of,
		drawn: (data) =>
			data === from.data ? from.drawn : data === to?.data ? to.drawn : [],
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
		// Entering stems in `staggerOrder`: left to right where they land, or by key hash.
		enterRanks: (entering, _join, toIndex) =>
			orderRanks(
				entering,
				props.staggerOrder,
				(key) => to?.xs[toIndex(key)] ?? Number.NaN,
			),
		dates,
	});
	const yExtent = (side: StemSide) => ({
		values: [
			...side.drawn.map((i) => side.ys[i] as number),
			...(props.baseline === undefined ? [] : [props.baseline]),
		],
		zero: props.baseline === undefined,
	});
	const toOf = keyed.toOf;
	layer.report({
		x: { values: from.drawn.map((i) => from.xs[i] as number) },
		y: yExtent(from),
		color: transitionColor(
			series.extent,
			to && toOf ? to.drawn.map((i) => toOf[i]) : undefined,
		),
		transition: layerTransition(
			keyed,
			props.staging,
			to
				? {
						x: { values: to.drawn.map((i) => to.xs[i] as number) },
						y: yExtent(to),
					}
				: {},
		),
	});

	// `color` (constant or per-datum) wins; otherwise `stroke` is passed
	// through untouched, so a gradient stroke reaches the line and marker.
	const read = resolveColor(props.color as ColorChannel<unknown>);
	const base = props.stroke ?? theme.palette.series[0];
	const colorOf = (datum: unknown, index: number, of: typeof series.of) =>
		read?.(datum, index) ?? series.colorOf(of?.[index]) ?? base;
	const space = endSpace(frame, coords);
	/** The baseline the drops stand on at one end, in data units. */
	const baseline = (end: "from" | "to") =>
		props.baseline ?? space.coords(end).crossing().y;
	/** Grow from the baseline, unless it is a stand-in for a zero the axis lacks. */
	const grows = props.baseline !== undefined || growsFromZero(coords.yRange());
	const frames = joinFrames<StemState>(
		keyed,
		(end, index) => {
			const side = end === "from" ? from : to;
			if (!side) return undefined;
			return {
				x: side.xs[index] as number,
				y: side.ys[index] as number,
				color: colorOf(
					side.data[index],
					index,
					end === "from" ? series.of : keyed.toOf,
				),
			};
		},
		blendStem,
		space.swapping,
	);
	const keys = keyed.keys;
	const order = orderRanks(
		keys,
		props.staggerOrder,
		(key) => frames.get(key)?.state.x ?? Number.NaN,
	);
	const progress = layer.progress(props.progress) ?? 1;
	const opacity = props.opacity ?? 1;
	const radius = props.markerRadius ?? DEFAULT_MARKER_RADIUS;
	const items: StemItem[] = [];
	keys.forEach((key, i) => {
		const own = frames.get(key) as JoinFrame<StemState> | undefined;
		if (!own || !(own.presence > 0)) return;
		const shown =
			staggered(progress, order[i] ?? 0, keys.length, props.stagger ?? 0) *
			own.presence;
		if (!(shown > 0)) return;
		const t = Math.min(1, shown);
		const foot = space.place(own, (stem, end) => ({
			x: stem.x,
			y: baseline(end),
		}));
		const top = space.place(own, (stem) => stem);
		// Growing from the baseline, the head rides the tip, its marker
		// revealing as it goes; else the stem fades in place.
		const head = grows
			? { x: foot.x + (top.x - foot.x) * t, y: foot.y + (top.y - foot.y) * t }
			: top;
		const color = own.state.color as string;
		items.push({
			key,
			from: foot,
			to: head,
			stroke: color,
			opacity: grows ? opacity : opacity * t,
			center: head,
			fill: color,
			radius,
			headProgress: grows ? t : 1,
		});
	});

	if (isGradientSpec(props.stroke) && props.color === undefined)
		return gradientNodes(state, items, props);
	clearNodes(state);
	const shared = {
		zIndex: props.zIndex,
		visible: props.visible,
	};
	const motion = {
		transition: props.transition,
		animate: !keyed.active && progress >= 1,
	};
	state.lines.update(
		items,
		state.sharedLines({ ...shared, strokeWidth: props.strokeWidth }) as never,
		motion,
	);
	state.heads.update(
		items,
		state.sharedHeads({ ...shared, stroke: "none" }) as never,
		motion,
	);
	return [state.lines.node, state.heads.node];
}

/** One `line` and `circle` per stem, for a gradient stroke (see the file header). */
function gradientNodes(
	state: StemLayerState,
	items: readonly StemItem[],
	props: StemProps<AnyDatum>,
): SceneNode[] {
	const out: SceneNode[] = [];
	const seen = new Set<BandKey>();
	for (const item of items) {
		seen.add(item.key);
		let nodes = state.nodes.get(item.key);
		if (!nodes) {
			nodes = {
				line: line.create({ from: item.from, to: item.to }),
				head: circle.create({ radius: item.radius }),
			};
			state.nodes.set(item.key, nodes);
		}
		nodes.line.update({
			from: item.from,
			to: item.to,
			stroke: props.stroke,
			strokeWidth: props.strokeWidth,
			opacity: item.opacity,
			zIndex: props.zIndex,
			visible: props.visible,
		} as never);
		nodes.head.update({
			center: item.center,
			radius: item.radius,
			fill: props.stroke,
			stroke: "none",
			opacity: item.opacity,
			progress: item.headProgress,
			zIndex: props.zIndex,
			visible: props.visible,
		} as never);
		out.push(nodes.line, nodes.head);
	}
	for (const key of [...state.nodes.keys()])
		if (!seen.has(key)) state.nodes.delete(key);
	return out;
}

function clearNodes(state: StemLayerState) {
	state.nodes.clear();
}

/**
 * A stem plot: a drop line from the baseline to each value, capped with a
 * marker. `progress` grows each line from the baseline, the marker riding
 * its tip (fading in instead when the axis has no zero). Two instances
 * nodes: lines, then markers.
 *
 * @example
 * ```ts
 * import { chart, stem } from "@sophistry/charts";
 *
 * chart.create({ width: 8, height: 4, children: [stem.create({ data: [3, 1, 4, 1, 5] })] });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#lines-scatter-and-error-bars
 * @category Charts
 */
export const stem = defineComposite<StemProps<AnyDatum>>({
	name: "Stem",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		baseline: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		key: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		stroke: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		markerRadius: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		staggerOrder: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		transition: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		const state: StemLayerState = {
			layer,
			keyed: createKeyedData<AnyDatum>(),
			series: createSeries<AnyDatum>(layer),
			lines: createSegmentMark<StemItem>({ opacity: true }),
			heads: createBatchedMark<
				StemItem,
				CircleProps,
				SceneNode<CircleProps>,
				keyof CircleProps
			>(circle as never, {
				channels: {
					center: (item) => item.center,
					radius: (item) => item.radius,
					fill: (item) => item.fill,
					opacity: (item) => item.opacity ?? 1,
					progress: (item) => item.headProgress,
				},
				enter: { radius: 0 },
				exit: { radius: 0 },
			}),
			sides: { from: keyedMemo(), to: keyedMemo() },
			sharedLines: stableShared(),
			sharedHeads: stableShared(),
			nodes: new Map(),
		};
		states.set(ctx.node, state);
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
