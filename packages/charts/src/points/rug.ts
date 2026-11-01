/**
 * `rug`: a short tick standing on the axis at every value, drawn as one
 * `line` instances node (see `segment-marks.ts`).
 */

import type { CompositeContext, CoordinateSystem } from "@sophistry/core";
import { defineComposite, Invalidate } from "@sophistry/core";
import type { BandKey, Bounds, Point } from "@sophistry/core/geometry";
import type { MarkTransition } from "../batch.js";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel, ColorChannel } from "../data/channels.js";
import {
	colorResolver,
	dateSinkContext,
	identity,
	numberValues,
} from "../data/channels.js";
import { endSpace } from "../end-space.js";
import type { ChartFrame } from "../frame/types.js";
import type { JoinEnd, JoinFrame } from "../join.js";
import {
	createKeyedData,
	joinFrames,
	layerTransition,
	transitionColor,
} from "../join.js";
import { blendCss, mixPoints } from "../mix.js";
import type { AnyDatum, KeyedTransitionProps, RevealProps } from "../props.js";
import { createSeries } from "../series.js";
import { ranks, staggered } from "../stagger.js";
import type { TooltipSpec, TooltipState } from "../tooltip.js";
import { datumValue, tooltipContext, tooltipText } from "../tooltip.js";
import { keyedMemo, mix } from "../util.js";
import type { SegmentItem, SegmentMark } from "./segment-marks.js";
import { createSegmentMark } from "./segment-marks.js";
import { createItemHandlers, stableShared, tooltipsOn } from "./shared.js";

const DEFAULT_LENGTH = 0.18;
const DEFAULT_OPACITY = 0.7;

/**
 * Props of {@link rug}.
 *
 * @category Charts
 */
export interface RugProps<T = unknown>
	extends KeyedTransitionProps<T>,
		RevealProps {
	/** One tick per datum. */
	data: readonly T[];
	/** The value, in data units. Defaults to the datum when `data` is `number[]`. */
	value?: Channel<T, number>;
	/**
	 * Which axis the rug lines.
	 * @default "x"
	 */
	axis?: "x" | "y";
	/**
	 * Tick length.
	 * @default 0.18
	 */
	length?: number;
	/**
	 * The series each tick belongs to: colours ticks through the chart's shared colour scale and
	 * legend, so a rug matches its per-series densities. `color` wins.
	 */
	series?: Channel<T, BandKey>;
	/** Tick colour, constant or `(d, i) => colour`. Defaults to the `series` colour, else the theme's first series colour. */
	color?: ColorChannel<T>;
	/** Line width. */
	strokeWidth?: number;
	/**
	 * Opacity, so overlapping ticks read darker.
	 * @default 0.7
	 */
	opacity?: number;
	/**
	 * Reveal, 0..1: each tick draws out of the axis.
	 * @default 1
	 */
	progress?: number;
	/** Hover tooltip: `true` for the value and `series`, or a template, function or options. */
	tooltip?: TooltipSpec<T>;
	/** How ticks move when `data` changes outside a `to` blend; see {@link MarkTransition}. */
	transition?: MarkTransition;
	zIndex?: number;
	visible?: boolean;
}

/** A tick in data units: its value and its colour. */
interface TickState {
	value: number;
	color: string;
}

/** Two ticks blended at `u`: the value in data units, the colour in OKLCH. */
function blendTick(a: TickState, b: TickState, u: number): TickState {
	return {
		value: mix(a.value, b.value, u),
		color: a.color === b.color ? a.color : blendCss(a.color, b.color, u),
	};
}

/** One tick as drawn: its foot, its far end (where its tooltip points), and its frame. */
interface RugItem extends SegmentItem {
	tip: Point;
	frame: JoinFrame<TickState>;
}

interface RugState {
	layer: ChartLayer;
	tooltip: TooltipState | null;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	ticks: SegmentMark<RugItem>;
	values: {
		from: ReturnType<typeof keyedMemo<number[]>>;
		to: ReturnType<typeof keyedMemo<number[]>>;
	};
	frames: ReturnType<typeof keyedMemo<Map<BandKey, JoinFrame<TickState>>>>;
	shared: (next: Record<string, unknown>) => Record<string, unknown>;
	handlers: ReturnType<typeof createItemHandlers>;
	current: { props: RugProps<AnyDatum>; frame: ChartFrame | null };
}

const states = new WeakMap<object, RugState>();

function draw(ctx: CompositeContext<RugProps<AnyDatum>>) {
	const state = states.get(ctx.node) as RugState;
	const props = ctx.props;
	const { layer, tooltip } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords) throw new Error("Rug must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const theme = ctx.theme;
	state.current = { props, frame };
	const alongX = props.axis !== "y";

	const valuesOf = (data: readonly unknown[], end: "from" | "to") =>
		state.values[end]([data, props.value, dates], () =>
			numberValues(
				data,
				props.value as Channel<unknown, number>,
				identity,
				"value",
				dates,
			),
		);
	const from = valuesOf(props.data, "from");
	const to = props.to ? valuesOf(props.to, "to") : undefined;
	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: props.color !== undefined,
		mark: { line: true },
		dates,
	});
	const keyed = state.keyed({
		data: props.data,
		to: props.to,
		key: props.key,
		series: props.series,
		of: series.of,
		drawn: drawnFn(state, props.data, from, props.to, to),
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
		// Entering ticks in value order where they land.
		enterRanks: (entering, _join, toIndex) =>
			ranks(entering.map((key) => to?.[toIndex(key)] ?? Number.NaN)),
		dates,
	});
	const extentOf = (values: number[]) =>
		alongX ? { x: { values } } : { y: { values } };
	layer.report({
		...extentOf(from),
		color: transitionColor(series.extent, keyed.toOf),
		transition: layerTransition(keyed, props.staging, to ? extentOf(to) : {}),
	});

	const colorOf = colorResolver(
		props.color as ColorChannel<unknown>,
		theme.palette.series.slice(0, 1),
		theme.palette.foreground,
	);
	const space = endSpace(frame, coords);
	const frames = state.frames(
		[
			from,
			to,
			keyed.keys,
			keyed.t,
			keyed.stages,
			series.scale,
			series.scaled,
			props.color,
			theme,
			frame?.ends,
		],
		() =>
			joinFrames<TickState>(
				keyed,
				(end, index) => {
					const values = end === "from" ? from : to;
					const data = end === "from" ? props.data : props.to;
					if (!values || !data) return undefined;
					const of = end === "from" ? series.of : keyed.toOf;
					return {
						value: values[index] as number,
						color: series.colorOf(of?.[index]) ?? colorOf(data[index], index),
					};
				},
				blendTick,
				space.swapping,
			),
	);

	/** A tick's far end from its foot, pointing into the plot `box`. */
	const length = props.length ?? DEFAULT_LENGTH;
	const tipOf = (foot: Point, box: Bounds): Point => {
		if (alongX) {
			const sign = foot.y >= box.maxY - 1e-9 && box.maxY > box.minY ? -1 : 1;
			return { x: foot.x, y: foot.y + sign * length };
		}
		const sign = foot.x >= box.maxX - 1e-9 && box.maxX > box.minX ? -1 : 1;
		return { x: foot.x + sign * length, y: foot.y };
	};
	/** A tick's foot on the axis as drawn and its far end, in scene units; ticks point into the plot. */
	const ends = (
		value: number,
		end: JoinEnd,
		system: CoordinateSystem,
	): [Point, Point] | null => {
		if (!Number.isFinite(value)) return null;
		const at = space.axesAt(end);
		const foot = alongX
			? system.coordsToPoint(value, at.y)
			: system.coordsToPoint(at.x, value);
		return [foot, tipOf(foot, system.area())];
	};

	// Each key's place in the reveal: in value order, where it stands now.
	const stagger = props.stagger ?? 0;
	const keys = keyed.keys;
	const order =
		stagger > 0
			? ranks(keys.map((key) => frames.get(key)?.state.value ?? Number.NaN))
			: undefined;
	/** How many ticks share the stagger: every datum (as without a transition), else every key. */
	const count = keyed.active ? keys.length : props.data.length;
	const progress = layer.progress(props.progress) ?? 1;
	const items: RugItem[] = [];
	keys.forEach((key, i) => {
		const own = frames.get(key);
		if (!own || !(own.presence > 0)) return;
		const reveal =
			staggered(progress, order?.[i] ?? 0, count, stagger) * own.presence;
		if (!(reveal > 0)) return;
		const line = space.shape(
			own,
			(tick, end, system) => ends(tick.value, end, system),
			mixPoints,
		);
		if (!line) return;
		items.push({
			key,
			from: line[0],
			to: line[1],
			progress: Math.min(1, reveal),
			tip: line[1],
			stroke: own.state.color,
			frame: own,
		});
	});

	state.ticks.update(
		items,
		state.shared({
			strokeWidth: props.strokeWidth,
			opacity: props.opacity ?? DEFAULT_OPACITY,
			zIndex: props.zIndex,
			visible: props.visible,
			...state.handlers(
				tooltipsOn(tooltip, props.tooltip),
				`Rug, ${items.length} ticks`,
			),
		}) as never,
		{
			transition: props.transition,
			animate: !keyed.active && progress >= 1,
		},
	);
	return [state.ticks.node];
}

/** The `drawn` function the join reads, stable while the values are. */
const drawnFns = new WeakMap<object, { deps: unknown[]; fn: unknown }>();
function drawnFn(
	state: object,
	data: readonly unknown[],
	from: number[],
	toData: readonly unknown[] | undefined,
	to: number[] | undefined,
): (data: readonly unknown[]) => number[] {
	const last = drawnFns.get(state);
	const deps = [data, from, toData, to];
	if (last?.deps.every((d, i) => d === deps[i]))
		return last.fn as (data: readonly unknown[]) => number[];
	const finite = (values: number[]) =>
		values.flatMap((v, i) => (Number.isFinite(v) ? [i] : []));
	const a = finite(from);
	const b = to ? finite(to) : [];
	const fn = (d: readonly unknown[]) =>
		d === data ? a : d === toData ? b : [];
	drawnFns.set(state, { deps, fn });
	return fn;
}

/** A tick's tooltip: its value and series. */
function tipText(state: RugState, own: JoinFrame<TickState>) {
	const { props, frame } = state.current;
	const data = own.end === "to" ? props.to : props.data;
	const datum = data?.[own.index];
	return tooltipText(
		props.tooltip,
		() => [
			{
				channel: "value",
				of: props.value,
				value: own.state.value,
				format: frame?.format(props.axis === "y" ? "y" : "x"),
			},
			{
				channel: "series",
				of: props.series,
				value: datumValue(props.series, datum, own.index),
				format: frame?.format("series"),
				color: own.state.color,
			},
		],
		datum,
		own.index,
		state.tooltip ?? undefined,
	);
}

/**
 * A rug: a short tick standing on the axis at every value, the raw sample
 * under a density or histogram. For ticks centred on the axis or spanning a
 * band, use `tickX` / `tickY`. Drawn as one instances node; ticks point
 * into the plot, and `progress` draws each out of the axis.
 *
 * @example
 * ```ts
 * import { chart, rug } from "@sophistry/charts";
 *
 * chart.create({ width: 8, height: 4, children: [rug.create({ data: [1, 2, 2.5, 4] })] });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#distributions
 * @category Charts
 */
export const rug = defineComposite<RugProps<AnyDatum>>({
	name: "Rug",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		axis: { invalidates: Invalidate.UPDATE },
		length: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		key: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		transition: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		const tooltip = ctx.context(tooltipContext);
		const state: RugState = {
			layer,
			tooltip,
			keyed: createKeyedData<AnyDatum>(),
			series: createSeries<AnyDatum>(layer),
			ticks: createSegmentMark<RugItem>(),
			values: { from: keyedMemo(), to: keyedMemo() },
			frames: keyedMemo(),
			shared: stableShared(),
			handlers: () => ({}),
			current: { props: ctx.props, frame: null },
		};
		state.handlers = createItemHandlers(
			tooltip,
			(item) => {
				const own = state.ticks.itemAt(item);
				return own ? tipText(state, own.frame) : undefined;
			},
			(item) => state.ticks.itemAt(item)?.tip,
		);
		states.set(ctx.node, state);
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
