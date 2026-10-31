/**
 * `strip` and `beeswarm`: one dot per value, spread across its category's
 * band (by seeded jitter, or packed without overlap). One `circle`
 * instances node per layer.
 */

import type { CircleProps, CompositeContext, SceneNode } from "@sophistry/core";
import { circle, defineComposite, Invalidate } from "@sophistry/core";
import type { BandKey, Point } from "@sophistry/core/geometry";
import { bandSpan } from "../band";
import type { MarkTransition } from "../batch";
import { createBatchedMark } from "../batch";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import type { Channel, ColorChannel, DateSink } from "../data/channels";
import {
	colorResolver,
	dateSinkContext,
	identity,
	indexOf,
	numberValues,
	resolveChannel,
} from "../data/channels";
import type { EndSpace } from "../end-space";
import { endSpace } from "../end-space";
import type { ChartFrame } from "../frame/types";
import type { JoinEnd, JoinFrame } from "../join";
import {
	createKeyedData,
	joinFrames,
	layerTransition,
	transitionColor,
} from "../join";
import { beeswarmOffsets, dodgeSpan } from "../math/dodge";
import { jitterOffsets } from "../math/jitter";
import { uniqueKeys } from "../math/ordinal";
import { blendCss } from "../mix";
import type {
	AnyDatum,
	KeyedTransitionProps,
	RevealProps,
	StaggerOrder,
} from "../props";
import { createSeries, dodgeSlotsFor } from "../series";
import { orderRanks, staggered } from "../stagger";
import type { TooltipSpec, TooltipState } from "../tooltip";
import { datumValue, tooltipContext, tooltipText } from "../tooltip";
import { keyedMemo, mix, mixPoint } from "../util";
import { createItemHandlers, stableShared, tooltipsOn } from "./shared";

const DEFAULT_RADIUS = 0.07;
const DEFAULT_JITTER_WIDTH = 0.6;

/**
 * What {@link strip} and {@link beeswarm} share.
 *
 * @category Charts
 */
export interface DotDistributionProps<T>
	extends KeyedTransitionProps<T>,
		RevealProps {
	/** One dot per datum. */
	data: readonly T[];
	/** The value, in data units. Defaults to the datum when `data` is `number[]`. Non-finite values draw no dot. */
	value?: Channel<T, number>;
	/** Which group a dot belongs to: a category on the band axis. Omitted, every dot shares one line through the middle. */
	category?: Channel<T, BandKey>;
	/**
	 * `"vertical"` puts categories along x and values up y; `"horizontal"` puts values along x.
	 * @default "vertical"
	 */
	orientation?: "vertical" | "horizontal";
	/**
	 * Dot radius.
	 * @default 0.07
	 */
	radius?: number;
	/** The series each dot belongs to: colours dots through the chart's shared colour scale and legend. `color` wins. */
	series?: Channel<T, BandKey>;
	/**
	 * With a `series`: give each series its own sub-band, side by side, within its category's band.
	 * @default false
	 */
	dodge?: boolean;
	/** Dot fill, constant or `(d, i) => colour`. Defaults to the `series` colour, else the theme's first series colour. */
	color?: ColorChannel<T>;
	/**
	 * Fill opacity, 0..1.
	 * @default 1
	 */
	fillOpacity?: number;
	opacity?: number;
	/**
	 * Reveal, 0..1: each dot fades in place as its radius grows.
	 * @default 1
	 */
	progress?: number;
	/** The order `stagger` and `enterStagger` take. @default "position" */
	staggerOrder?: StaggerOrder;
	/** Hover tooltip: `true` for a row per channel (`category`, `series`, `value`), or a template, function or options. */
	tooltip?: TooltipSpec<T>;
	/** How dots move when `data` changes outside a `to` blend; see {@link MarkTransition}. */
	transition?: MarkTransition;
	zIndex?: number;
	visible?: boolean;
}

/**
 * Props of {@link strip}.
 *
 * @category Charts
 */
export interface StripProps<T = unknown> extends DotDistributionProps<T> {
	/**
	 * How far dots spread across their band, as a fraction of it.
	 * @default 0.6
	 */
	width?: number;
	/**
	 * What each dot's jitter hashes: something stable about the datum, so dots keep their place
	 * when others come and go. Defaults to its `key` if given, else its index.
	 */
	jitterKey?: Channel<T, string | number>;
	/**
	 * Varies the jitter pattern.
	 * @default 0
	 */
	seed?: number;
}

/**
 * Props of {@link beeswarm}.
 *
 * @category Charts
 */
export interface BeeswarmProps<T = unknown> extends DotDistributionProps<T> {
	/**
	 * Extra room between neighbouring dots.
	 * @default 0.01
	 */
	gap?: number;
	/**
	 * `"both"` packs the swarm around the band's centre line; `"positive"` stacks it up (or right)
	 * from the band's lower edge, like a dot plot.
	 * @default "both"
	 */
	side?: "both" | "positive";
}

type AnyDotProps = StripProps<AnyDatum> & BeeswarmProps<AnyDatum>;

/** A band across the values, in scene units along the cross axis. */
interface CrossBand {
	center: number;
	size: number;
	low: number;
}

/** One dataset's dots in data units, one entry per datum. */
interface DotSide {
	data: readonly unknown[];
	values: number[];
	categories: (BandKey | undefined)[] | undefined;
}

/** A dot on one frame: its value in data units, where across the values it sits (scene units), and its fill. */
interface DotState {
	value: number;
	cross: number;
	fill: string;
}

function blendDot(a: DotState, b: DotState, u: number): DotState {
	return {
		value: mix(a.value, b.value, u),
		cross: mix(a.cross, b.cross, u),
		fill: a.fill === b.fill ? a.fill : blendCss(a.fill, b.fill, u),
	};
}

type DodgeSlots = ReturnType<typeof dodgeSlotsFor>;

/** Where across its band each dot sits: one cross-axis scene coordinate per datum. */
type Place = (
	props: AnyDotProps,
	alongs: readonly number[],
	groups: readonly (readonly [number[], CrossBand])[],
	radius: number,
	end: JoinEnd,
	side: DotSide,
	dates: DateSink | null,
) => number[];

interface DotItem {
	key: BandKey;
	center: Point;
	radius: number;
	fill: string;
	opacity: number;
	frame: JoinFrame<DotState>;
}

interface DotLayerState {
	layer: ChartLayer;
	tooltip: TooltipState | null;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	dots: ReturnType<
		typeof createBatchedMark<
			DotItem,
			CircleProps,
			SceneNode<CircleProps>,
			keyof CircleProps
		>
	>;
	sides: {
		from: ReturnType<typeof keyedMemo<DotSide>>;
		to: ReturnType<typeof keyedMemo<DotSide>>;
	};
	shared: (next: Record<string, unknown>) => Record<string, unknown>;
	handlers: ReturnType<typeof createItemHandlers>;
	current: { props: AnyDotProps; frame: ChartFrame | null };
}

function drawDots(
	ctx: CompositeContext<AnyDotProps>,
	state: DotLayerState,
	name: string,
	place: Place,
): SceneNode[] {
	const props = ctx.props;
	const { layer, tooltip } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords)
		throw new Error(`${name} must be placed inside a chart or axes.`);
	const dates = ctx.context(dateSinkContext);
	const theme = ctx.theme;
	state.current = { props, frame };
	const vertical = props.orientation !== "horizontal";

	const sideOf = (data: readonly unknown[], end: JoinEnd) =>
		state.sides[end]([data, props.value, props.category, dates], () => {
			const read = resolveChannel(
				props.category as Channel<unknown, BandKey> | undefined,
				undefined,
				"category",
				dates,
			);
			return {
				data,
				values: numberValues(
					data,
					props.value as Channel<unknown, number>,
					identity,
					"value",
					dates,
				),
				categories: read
					? data.map((d, i) => read(d, i) as BandKey | undefined)
					: undefined,
			};
		});
	const from = sideOf(props.data, "from");
	const to = props.to ? sideOf(props.to, "to") : undefined;
	const finite = (side: DotSide) =>
		side.values.flatMap((v, i) => (Number.isFinite(v) ? [i] : []));
	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: props.color !== undefined,
		mark: { symbol: "circle" },
		dates,
	});
	const keyed = state.keyed({
		data: props.data,
		to: props.to,
		key: props.key,
		series: props.series,
		of: series.of,
		drawn: drawnFor(state, from, to, finite),
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
		// Entering dots in `staggerOrder`: low values first, or by key hash.
		enterRanks: (entering, _join, toIndex) =>
			orderRanks(
				entering,
				props.staggerOrder,
				(key) => to?.values[toIndex(key)] ?? Number.NaN,
			),
		dates,
	});
	/** A side's extents: the values along one axis, the categories across. */
	const extentOf = (side: DotSide) => {
		const along = { values: side.values };
		const across = side.categories
			? {
					categories: side.categories.filter(
						(k): k is BandKey => k !== undefined && k !== null,
					),
				}
			: undefined;
		return vertical ? { x: across, y: along } : { x: along, y: across };
	};
	layer.report({
		...extentOf(from),
		color: transitionColor(series.extent, keyed.toOf),
		transition: layerTransition(keyed, props.staging, to ? extentOf(to) : {}),
	});

	/** Each dot's sub-band when dodging. */
	const dodging: DodgeSlots | undefined =
		props.dodge === true && series.of
			? dodgeSlotsFor(series.of, series.categories, series.scale)
			: undefined;
	const toOf = keyed.toOf;
	const toDodging: DodgeSlots | undefined =
		props.dodge === true && toOf
			? dodgeSlotsFor(toOf, uniqueKeys(toOf), series.scale)
			: undefined;
	const space = endSpace(frame, coords);
	const radius = props.radius ?? DEFAULT_RADIUS;

	/** One side's dots across the values, in scene units, by datum index (NaN for a dot not drawn). */
	const crossesOf = (
		side: DotSide,
		slots: DodgeSlots | undefined,
		end: JoinEnd,
	): number[] => {
		const system = space.coords(end);
		const alongs = side.values.map((v) => {
			if (!Number.isFinite(v)) return Number.NaN;
			return vertical
				? system.coordsToPoint(0, v).y
				: system.coordsToPoint(v, 0).x;
		});
		// One group per band: a category, or a category's series when dodging.
		const groups = new Map<unknown, Map<unknown, [number[], CrossBand]>>();
		const all: [number[], CrossBand][] = [];
		alongs.forEach((along, i) => {
			if (!Number.isFinite(along)) return;
			const key = side.categories?.[i];
			const sub = slots?.of(i);
			const inner =
				groups.get(key) ?? new Map<unknown, [number[], CrossBand]>();
			groups.set(key, inner);
			let entry = inner.get(sub);
			if (!entry) {
				entry = [[], bandOf(space, vertical, side, slots, i, end)];
				inner.set(sub, entry);
				all.push(entry);
			}
			entry[0].push(i);
		});
		return place(props, alongs, all, radius, end, side, dates);
	};
	// Each side's places depend on the plot, so they re-run when it moves;
	// the join below only when they changed.
	const fromCrosses = crossesOf(from, dodging, "from");
	const toCrosses = to ? crossesOf(to, toDodging, "to") : undefined;

	const fillOf = colorResolver(
		props.color as ColorChannel<unknown>,
		theme.palette.series.slice(0, 1),
		theme.palette.foreground,
	);
	const frames = joinFrames<DotState>(
		keyed,
		(end, index) => {
			const side = end === "from" ? from : to;
			const crosses = end === "from" ? fromCrosses : toCrosses;
			if (!side || !crosses) return undefined;
			const cross = crosses[index] as number;
			if (!Number.isFinite(cross)) return undefined;
			const of = end === "from" ? series.of : keyed.toOf;
			return {
				value: side.values[index] as number,
				cross,
				fill: series.colorOf(of?.[index]) ?? fillOf(side.data[index], index),
			};
		},
		blendDot,
		space.swapping,
	);
	const keys = keyed.keys;
	const stagger = props.stagger ?? 0;
	const order =
		stagger > 0
			? orderRanks(
					keys,
					props.staggerOrder,
					(key) => frames.get(key)?.state.value ?? Number.NaN,
				)
			: undefined;
	const count = keyed.active ? keys.length : props.data.length;
	const progress = layer.progress(props.progress) ?? 1;
	const opacity = props.opacity ?? 1;
	const items: DotItem[] = [];
	keys.forEach((key, i) => {
		const own = frames.get(key);
		if (!own || !(own.presence > 0)) return;
		const t =
			staggered(progress, order?.[i] ?? 0, count, stagger) * own.presence;
		if (!(t > 0)) return;
		const center = space.shape(
			own,
			(dot, _end, system) =>
				vertical
					? { x: dot.cross, y: system.coordsToPoint(0, dot.value).y }
					: { x: system.coordsToPoint(dot.value, 0).x, y: dot.cross },
			mixPoint,
		);
		if (!center) return;
		// The radius grows as the dot fades in.
		items.push({
			key,
			center,
			radius: radius * t,
			fill: own.state.fill,
			opacity: opacity * t,
			frame: own,
		});
	});
	state.dots.update(
		items,
		state.shared({
			stroke: "none",
			fillOpacity: props.fillOpacity,
			zIndex: props.zIndex,
			visible: props.visible,
			...state.handlers(
				tooltipsOn(tooltip, props.tooltip),
				`${name}, ${items.length} dots`,
			),
		}) as never,
		{ transition: props.transition, animate: !keyed.active && progress >= 1 },
	);
	return [state.dots.node];
}

/** The band a dot sits in, in scene units across the values; a sub-band of it when dodging. */
function bandOf(
	space: EndSpace,
	vertical: boolean,
	side: DotSide,
	slots: DodgeSlots | undefined,
	index: number,
	end: JoinEnd,
): CrossBand {
	const band = categoryBandOf(
		space,
		vertical,
		side.categories?.[index],
		!!side.categories,
		end,
	);
	const slot = slots?.of(index);
	if (!slots || slot === undefined) return band;
	const [lo, hi] = dodgeSpan(slot, slots.count, 0);
	const low = band.low + lo * band.size;
	const size = (hi - lo) * band.size;
	return { center: low + size / 2, size, low };
}

/** A category's band at one end, in scene units across the values (the whole plot without categories). */
function categoryBandOf(
	space: EndSpace,
	vertical: boolean,
	category: BandKey | undefined,
	categorised: boolean,
	end: JoinEnd,
): CrossBand {
	const system = space.coords(end);
	const area = system.area();
	const [lo, hi] = vertical ? [area.minX, area.maxX] : [area.minY, area.maxY];
	const whole = { center: (lo + hi) / 2, size: hi - lo, low: lo };
	if (!categorised) return whole;
	const span = bandSpan(space.band(end, vertical ? "x" : "y"), category);
	if (!span) return whole;
	const a = vertical
		? system.coordsToPoint(span[0], 0).x
		: system.coordsToPoint(0, span[0]).y;
	const b = vertical
		? system.coordsToPoint(span[1], 0).x
		: system.coordsToPoint(0, span[1]).y;
	return { center: (a + b) / 2, size: Math.abs(b - a), low: Math.min(a, b) };
}

/** The `drawn` function the join reads, stable while the sides are. */
const drawnFns = new WeakMap<
	object,
	{ a: DotSide; b?: DotSide; fn: unknown }
>();
function drawnFor(
	state: object,
	from: DotSide,
	to: DotSide | undefined,
	finite: (side: DotSide) => number[],
): (data: readonly unknown[]) => number[] {
	const last = drawnFns.get(state);
	if (last && last.a === from && last.b === to)
		return last.fn as (data: readonly unknown[]) => number[];
	const a = finite(from);
	const b = to ? finite(to) : [];
	const fn = (data: readonly unknown[]) =>
		data === from.data ? a : data === to?.data ? b : [];
	drawnFns.set(state, { a: from, b: to, fn });
	return fn;
}

/** A dot's tooltip: a row per channel. */
function tipText(state: DotLayerState, own: JoinFrame<DotState>) {
	const { props, frame } = state.current;
	const vertical = props.orientation !== "horizontal";
	const data = own.end === "to" ? props.to : props.data;
	const datum = data?.[own.index];
	return tooltipText(
		props.tooltip,
		() => [
			{
				channel: "category",
				of: props.category,
				value: datumValue(props.category, datum, own.index),
				format: frame?.format(vertical ? "x" : "y"),
			},
			{
				channel: "series",
				of: props.series,
				value: datumValue(props.series, datum, own.index),
				format: frame?.format("series"),
				color: own.state.fill,
			},
			{
				channel: "value",
				of: props.value,
				value: own.state.value,
				format: frame?.format(vertical ? "y" : "x"),
			},
		],
		datum,
		own.index,
		state.tooltip ?? undefined,
	);
}

const dotProps = {
	data: { default: [], invalidates: Invalidate.UPDATE },
	value: { invalidates: Invalidate.UPDATE },
	category: { invalidates: Invalidate.UPDATE },
	orientation: { invalidates: Invalidate.UPDATE },
	radius: { invalidates: Invalidate.UPDATE },
	series: { invalidates: Invalidate.UPDATE },
	dodge: { invalidates: Invalidate.UPDATE },
	key: { invalidates: Invalidate.UPDATE },
	to: { invalidates: Invalidate.UPDATE },
	blend: { invalidates: Invalidate.UPDATE },
	staging: { invalidates: Invalidate.UPDATE },
	enterStagger: { invalidates: Invalidate.UPDATE },
	color: { invalidates: Invalidate.UPDATE },
	fillOpacity: { invalidates: Invalidate.UPDATE },
	opacity: { invalidates: Invalidate.UPDATE },
	progress: { default: 1, invalidates: Invalidate.UPDATE },
	stagger: { invalidates: Invalidate.UPDATE },
	staggerOrder: { invalidates: Invalidate.UPDATE },
	tooltip: { invalidates: Invalidate.UPDATE },
	transition: { invalidates: Invalidate.UPDATE },
	zIndex: { invalidates: Invalidate.UPDATE },
	visible: { invalidates: Invalidate.UPDATE },
} as const;

/** `setup` and `update` of one dot layout. */
function dotDefinition(name: string, place: Place) {
	const states = new WeakMap<object, DotLayerState>();
	const run = (ctx: CompositeContext<AnyDotProps>) =>
		drawDots(ctx, states.get(ctx.node) as DotLayerState, name, place);
	return {
		setup: (ctx: CompositeContext<AnyDotProps>) => {
			const layer = chartLayer(ctx);
			const tooltip = ctx.context(tooltipContext);
			const state: DotLayerState = {
				layer,
				tooltip,
				keyed: createKeyedData<AnyDatum>(),
				series: createSeries<AnyDatum>(layer),
				dots: createBatchedMark<
					DotItem,
					CircleProps,
					SceneNode<CircleProps>,
					keyof CircleProps
				>(circle as never, {
					channels: {
						center: (item) => item.center,
						radius: (item) => item.radius,
						fill: (item) => item.fill,
						opacity: (item) => item.opacity,
					},
					enter: { radius: 0 },
					exit: { radius: 0 },
				}),
				sides: { from: keyedMemo(), to: keyedMemo() },
				shared: stableShared(),
				handlers: () => ({}),
				current: { props: ctx.props, frame: null },
			};
			state.handlers = createItemHandlers(
				tooltip,
				(item) => {
					const own = state.dots.itemAt(item);
					return own ? tipText(state, own.frame) : undefined;
				},
				(item) => state.dots.itemAt(item)?.center,
			);
			states.set(ctx.node, state);
			return run(ctx);
		},
		update: (_changed: unknown, ctx: CompositeContext<AnyDotProps>) => run(ctx),
	};
}

/** A strip's jitter offsets for one dataset, one per datum, from its own keys. */
function jitterOf(
	props: AnyDotProps,
	side: DotSide,
	dates: DateSink | null,
): number[] {
	const read = resolveChannel<unknown, string | number>(
		(props.jitterKey ?? props.key) as Channel<unknown, string | number>,
		indexOf,
		props.jitterKey === undefined ? "key" : "jitterKey",
		dates,
	);
	return jitterOffsets(
		side.data.map((d, i) => read(d, i) as string | number),
		{ width: props.width ?? DEFAULT_JITTER_WIDTH, seed: props.seed },
	);
}

const stripState = dotDefinition(
	"Strip",
	(props, alongs, groups, _r, end, side, dates) => {
		// Jitter is a fraction of the band, so it scales with the plot. The
		// offsets are read from the data alone (cached per side).
		const own = jitterCache(props, side, end, dates);
		const across = alongs.map(() => Number.NaN);
		for (const [members, band] of groups)
			for (const i of members)
				across[i] = band.center + (own[i] ?? 0) * band.size;
		return across;
	},
);

/** Jitter offsets, cached on the side and the jitter props. */
const jitterCaches = new WeakMap<
	DotSide,
	{ deps: unknown[]; value: number[] }
>();
function jitterCache(
	props: AnyDotProps,
	side: DotSide,
	_end: JoinEnd,
	dates: DateSink | null,
): number[] {
	const deps = [props.jitterKey, props.key, props.width, props.seed, dates];
	const last = jitterCaches.get(side);
	if (last?.deps.every((d, i) => d === deps[i])) return last.value;
	const value = jitterOf(props, side, dates);
	jitterCaches.set(side, { deps, value });
	return value;
}

const beeswarmState = dotDefinition(
	"Beeswarm",
	(props, alongs, groups, radius) => {
		const side = props.side ?? "both";
		const across = alongs.map(() => Number.NaN);
		for (const [members, box] of groups) {
			const offsets = beeswarmOffsets(
				members.map((i) => alongs[i] as number),
				radius,
				{ side, gap: props.gap ?? 0.01 },
			);
			const origin = side === "positive" ? box.low + radius : box.center;
			members.forEach((i, k) => {
				across[i] = origin + (offsets[k] as number);
			});
		}
		return across;
	},
);

/**
 * A strip plot: one dot per value, spread across its category's band by seeded jitter so dots
 * don't pile into a line. The jitter is stable, so scrubbing never reshuffles it. Use
 * {@link beeswarm} to pack dots without overlap instead. One instances node.
 *
 * @example
 * ```ts
 * import { chart, strip } from "@sophistry/charts";
 *
 * const rows = [
 * 	{ group: "a", score: 3 },
 * 	{ group: "a", score: 5 },
 * 	{ group: "b", score: 4 },
 * 	{ group: "b", score: 7 },
 * ];
 * chart.create({ width: 8, height: 4, children: [strip.create({ data: rows, value: "score", category: "group" })] });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#distributions
 * @category Charts
 */
export const strip = defineComposite<StripProps<AnyDatum>>({
	name: "Strip",
	props: {
		...dotProps,
		width: { invalidates: Invalidate.UPDATE },
		jitterKey: { invalidates: Invalidate.UPDATE },
		seed: { invalidates: Invalidate.UPDATE },
	},
	setup: stripState.setup as never,
	update: stripState.update as never,
});

/**
 * A beeswarm: one dot per value, each pushed across its band just far enough not to overlap,
 * so the outline traces the distribution. Dots are packed in scene units, so a swarm re-packs
 * when the plot is resized. One instances node.
 *
 * @example
 * ```ts
 * import { beeswarm, chart } from "@sophistry/charts";
 *
 * const rows = [
 * 	{ group: "a", score: 3 },
 * 	{ group: "a", score: 5 },
 * 	{ group: "b", score: 4 },
 * 	{ group: "b", score: 7 },
 * ];
 * chart.create({ width: 8, height: 4, children: [beeswarm.create({ data: rows, value: "score", category: "group" })] });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#distributions
 * @category Charts
 */
export const beeswarm = defineComposite<BeeswarmProps<AnyDatum>>({
	name: "Beeswarm",
	props: {
		...dotProps,
		gap: { invalidates: Invalidate.UPDATE },
		side: { invalidates: Invalidate.UPDATE },
	},
	setup: beeswarmState.setup as never,
	update: beeswarmState.update as never,
});
