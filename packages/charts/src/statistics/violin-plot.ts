/**
 * `violinPlot`: a violin plot, its own chart with one mirrored kernel
 * density silhouette per group and its median marked.
 *
 * The preset reads groups as `boxPlot` does (`groups.ts`). Its inner layer
 * draws every violin and every median tick as **one path batch** (each
 * violin's outline is its own; one batch keeps the order, a violin then
 * its tick). Hover resolves per item (`event.item`).
 *
 * The reveal is geometry: each violin widens out of its centre line (every
 * x pulled `t` of the way out from it), its tick with it. Keyed transitions
 * blend densities on a shared grid (`blendViolinProfiles`) and move medians
 * in data units.
 */

import type {
	CompositeContext,
	CoordinateSystem,
	PathBatchItem,
	SceneNode,
} from "@sophistry/core";
import { defineComposite, Invalidate, pathBatch } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, Point, Range } from "@sophistry/core/geometry";
import { chart } from "../chart";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import type { Channel, ColorChannel } from "../data/channels";
import { colorResolver, dateSinkContext } from "../data/channels";
import { endSpace } from "../end-space";
import type { ChartProps, ChartYAxisOptions } from "../frame/types";
import type { JoinEnd, JoinFrame } from "../join";
import {
	createKeyedData,
	joinFrames,
	layerTransition,
	transitionColor,
} from "../join";
import { dodgeSpan } from "../math/dodge";
import type { JoinStaging } from "../math/join";
import { uniqueKeys } from "../math/ordinal";
import type { ViolinProfile } from "../math/violin";
import {
	blendViolinProfiles,
	violinProfile,
	violinProfileRing,
} from "../math/violin";
import { blendCss } from "../mix";
import type { AnyDatum, RevealProps, TransitionProps } from "../props";
import type { Category } from "../series";
import { createSeries, dodgeSlotsFor } from "../series";
import { ranks, staggered } from "../stagger";
import { mix, shallowEqual } from "../util";
import type { GroupTransition } from "./groups";
import {
	categoryName,
	createGroupData,
	DODGE_GAP,
	presetChartProps,
	updateChanged,
} from "./groups";

const DEFAULT_FILL_OPACITY = 0.7;
const DEFAULT_SCALE = 0.4;
const DEFAULT_NAME_FONT_SIZE = 0.28;
const DEFAULT_NUMBER_GAP = 0.16;
const MEDIAN_LINE_HALF_WIDTH = 0.18;

/** Median of `values`, dropping non-finite entries. */
function median(values: readonly number[]): number | undefined {
	const finite = values.filter((value) => Number.isFinite(value));
	if (finite.length === 0) return undefined;
	const sorted = [...finite].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
		: (sorted[mid] as number);
}

/**
 * Props of {@link violinPlot}. `values` is required unless `data` is
 * `number[][]`.
 *
 * @category Charts
 */
export interface ViolinPlotProps<T = unknown>
	extends TransitionProps<T>,
		RevealProps {
	/** One violin per datum, each holding (or yielding via `values`) one group's raw sample. */
	data: readonly T[];
	/**
	 * The group's raw sample, in data units. Defaults to the datum when `data` is `number[][]`;
	 * required otherwise. Groups with fewer than 2 finite values draw no violin.
	 */
	values?: Channel<T, readonly number[]>;
	/** The name drawn under each violin. With a `series`, violins sharing a name share its slot. */
	label?: Channel<T, string>;
	/**
	 * The series each violin belongs to: colours violins through the chart's colour scale and
	 * legend; with a `label`, violins sharing a name stand side by side in its slot. `color` wins.
	 */
	series?: Channel<T, BandKey>;
	/**
	 * The legend for `series`: `"right"`, `"top"`, or `false`. As `chart`'s `legend`. Defaults to
	 * `"right"` with a series.
	 */
	legend?: boolean | "right" | "top";
	/**
	 * Gaussian kernel bandwidth, in data units. Defaults to Silverman's rule of thumb, per group.
	 */
	bandwidth?: number;
	/**
	 * How many points each violin's density is evaluated at.
	 * @default 80
	 */
	samples?: number;
	/**
	 * Half-width of a violin at its widest, as a fraction of the slot pitch. Every violin shares
	 * it, so shapes compare but absolute densities don't.
	 * @default 0.4
	 */
	scale?: number;
	/** `[min, max, step?]` in data units. Omitted, fitted to the data (including 0). */
	yRange?: Range;
	/** Width of the plotting area. */
	width: number;
	/** Height of the plotting area. */
	height: number;
	/** Centre of the plotting area. Defaults to the origin. */
	center?: Point;
	/**
	 * One colour for every violin, or `(d, i) => colour`. Wins over `colors` and `series` (whose
	 * legend then goes).
	 */
	color?: ColorChannel<T>;
	/**
	 * Colours cycled across the violins by index, or across the `series` categories. Defaults to
	 * the theme's categorical colours.
	 */
	colors?: readonly ColorInput[];
	/**
	 * Fill opacity, 0..1.
	 * @default 0.7
	 */
	fillOpacity?: number;
	/**
	 * Draw a short tick at each group's median.
	 * @default true
	 */
	median?: boolean;
	/**
	 * The value axis: `false` hides it; an object styles it and sets its ticks.
	 * @default true
	 */
	yAxis?: boolean | ChartYAxisOptions;
	/**
	 * Reveal, 0..1: the frame first, then each violin widens out of its centre line.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Fraction of the violins' reveal spent staggering violin after violin, left to right, 0..0.95.
	 * @default 0
	 */
	stagger?: number;
	/**
	 * The data to transition to, groups matched by `label` and `series` (else by place): densities
	 * blend on a shared grid and medians move; new groups widen in, removed ones narrow out. See
	 * {@link TransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	zIndex?: number;
	visible?: boolean;
	/** Drawn inside the chart's coordinate context. */
	children?: readonly SceneNode[];
}

/* ------------------------------------------------------------------ layer */

interface ViolinsProps<T = unknown> {
	data: readonly T[];
	groups: readonly (readonly number[])[];
	slots: (index: number) => BandKey;
	/** Violins sharing a slot stand side by side, one sub-slot per series. */
	dodge: boolean;
	series?: Channel<T, BandKey>;
	stagger: number;
	bandwidth?: number;
	samples?: number;
	scale: number;
	median: boolean;
	color?: ColorChannel<T>;
	colors?: readonly ColorInput[];
	fillOpacity?: number;
	zIndex?: number;
	visible?: boolean;
	transition?: GroupTransition<T>;
	blend?: number;
	staging?: JoinStaging;
	enterStagger?: number;
}

/** One group's violin before it is placed: its density's profile and median. */
interface ViolinShape {
	profile: ViolinProfile | null;
	median: number | undefined;
}

/** A violin in data units: where it stands, its density's profile, its median and colour. */
interface ViolinState {
	center: number;
	half: number;
	/** Null for a group too small for a density (its median may still show). */
	profile: ViolinProfile | null;
	median: number | undefined;
	color: string;
}

/** Two violins blended at `u`: place in data units, densities on a shared grid, the median in data units, colours in OKLCH. */
function blendViolin(a: ViolinState, b: ViolinState, u: number): ViolinState {
	return {
		center: mix(a.center, b.center, u),
		half: mix(a.half, b.half, u),
		profile: blendViolinProfiles(a.profile, b.profile, u),
		median:
			a.median === undefined || b.median === undefined
				? u < 0.5
					? a.median
					: b.median
				: mix(a.median, b.median, u),
		color: blendCss(a.color, b.color, u),
	};
}

/** One end's violins before they are placed, cached by groups and KDE options: the KDE runs only when data changes. */
function shapesCache() {
	let last:
		| {
				args: unknown[];
				value: (ViolinShape | null)[] | undefined;
		  }
		| undefined;
	return (
		groups: readonly (readonly number[])[] | undefined,
		bandwidth: number | undefined,
		samples: number | undefined,
		withMedian: boolean,
	) => {
		const args = [groups, bandwidth, samples, withMedian];
		if (last && shallowEqual(last.args, args)) return last.value;
		const value = groups?.map((group) => {
			const profile = violinProfile(group, { bandwidth, samples });
			const middle = withMedian ? median(group) : undefined;
			return profile || middle !== undefined
				? { profile, median: middle }
				: null;
		});
		last = { args, value };
		return value;
	};
}

interface ViolinsState {
	layer: ChartLayer;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	shapes: ReturnType<typeof shapesCache>;
	toShapes: ReturnType<typeof shapesCache>;
	batch: SceneNode;
}

const violinsStates = new WeakMap<object, ViolinsState>();

function drawViolins(
	ctx: CompositeContext<ViolinsProps<AnyDatum>>,
): SceneNode[] {
	const state = violinsStates.get(ctx.node) as ViolinsState;
	const props = ctx.props;
	const { layer } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords) return [state.batch];
	const theme = ctx.theme;
	const dates = ctx.context(dateSinkContext);
	const transition = props.transition;

	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: props.color !== undefined,
		mark: { fill: true },
		dates,
	});
	const keyed = state.keyed({
		data: props.data,
		to: transition?.to,
		key: transition?.key,
		series: props.series,
		of: series.of,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
		dates,
	});
	const dodging =
		props.dodge && series.of
			? dodgeSlotsFor(series.of, series.categories, series.scale)
			: undefined;
	const toDodging =
		props.dodge && keyed.toOf
			? dodgeSlotsFor(keyed.toOf, uniqueKeys(keyed.toOf), series.scale)
			: undefined;

	const shapes =
		state.shapes(props.groups, props.bandwidth, props.samples, props.median) ??
		[];
	const toShapes = state.toShapes(
		transition?.groups,
		props.bandwidth,
		props.samples,
		props.median,
	);
	/** Whether a key's group draws at each end: a violin only one end draws enters or exits. */
	let enters = false;
	let exits = false;
	if (toShapes) {
		for (const key of keyed.keys) {
			const fi = keyed.fromIndex(key);
			const ti = keyed.toIndex(key);
			const a = fi >= 0 && !!shapes[fi];
			const b = ti >= 0 && !!toShapes[ti];
			enters ||= b && !a;
			exits ||= a && !b;
		}
	}
	const color = series.extent;
	layer.report(
		transition
			? {
					x: { categories: transition.slots.from.categories },
					y: { values: props.groups.flat(), zero: true },
					color: transitionColor(color, keyed.toOf),
					transition: layerTransition(keyed, props.staging, {
						x: { categories: transition.slots.to.categories },
						y: { values: transition.groups.flat(), zero: true },
						enters,
						exits,
					}),
				}
			: { color },
	);

	const space = endSpace(frame, coords);
	/**
	 * One end's violin centre lines and widest half-widths, in data units: the slot's centre and
	 * `scale`, or a sub-slot when dodging.
	 */
	const placesOf = (
		end: JoinEnd,
		data: readonly unknown[],
		slotOf: (index: number) => BandKey,
		dodge: typeof dodging,
	) => {
		const band = space.band(end, "x");
		return data.map((_, index) => {
			const key = slotOf(index);
			const start = band?.start(key);
			const middle =
				band && start !== undefined ? start + band.bandwidth / 2 : index + 0.5;
			const slot = dodge?.of(index);
			if (!dodge || slot === undefined || dodge.count <= 1)
				return { center: middle, half: props.scale };
			const [from, to] = dodgeSpan(slot, dodge.count, DODGE_GAP);
			const left = middle - props.scale;
			return {
				center: left + props.scale * (from + to),
				half: props.scale * (to - from),
			};
		});
	};
	const places = placesOf("from", props.data, props.slots, dodging);
	const toPlaces = transition
		? placesOf("to", transition.to, transition.slots.to.of, toDodging)
		: undefined;

	const palette = colorResolver(
		props.color,
		props.colors ?? theme.palette.series,
		theme.palette.foreground,
	);
	const colorOf = (
		data: readonly unknown[],
		of: readonly Category[] | undefined,
		index: number,
	) => series.colorOf(of?.[index]) ?? palette(data[index], index);

	const stateOf = (end: JoinEnd, index: number): ViolinState | undefined => {
		const own = end === "from" ? shapes[index] : toShapes?.[index];
		const place = end === "from" ? places[index] : toPlaces?.[index];
		if (!own || !place) return undefined;
		const data = end === "from" ? props.data : (transition?.to ?? []);
		const of = end === "from" ? series.of : keyed.toOf;
		return {
			...place,
			profile: own.profile,
			median: own.median,
			color: colorOf(data, of, index),
		};
	};
	const frames = joinFrames(keyed, stateOf, blendViolin);

	/** Left to right: the stagger order, by where each key's violin stands (or would, with no sample). */
	const keys = keyed.keys;
	const order =
		props.stagger > 0
			? ranks(
					keys.map((key) => {
						const own = frames.get(key);
						if (own) return own.state.center;
						const fi = keyed.fromIndex(key);
						if (fi >= 0) return places[fi]?.center ?? Number.NaN;
						return toPlaces?.[keyed.toIndex(key)]?.center ?? Number.NaN;
					}),
				)
			: undefined;
	const progress = layer.progress(undefined) ?? 1;
	const foreground = theme.palette.foreground;

	const items: PathBatchItem[] = [];
	keys.forEach((key, i) => {
		const own = frames.get(key) as JoinFrame<ViolinState> | undefined;
		if (!own || own.presence <= 0) return;
		/** How wide this violin has opened, 0..1, its presence in the join folded in. */
		const t =
			staggered(progress, order?.[i] ?? 0, keys.length, props.stagger) *
			own.presence;
		if (!(t > 0)) return;
		for (const item of violinItems(
			coords,
			own.state,
			t,
			props.scale,
			foreground,
		))
			items.push(item);
	});

	state.batch.update({
		items,
		stroke: "none",
		fillOpacity: props.fillOpacity ?? DEFAULT_FILL_OPACITY,
		zIndex: props.zIndex,
		visible: props.visible,
	} as never);
	return [state.batch];
}

/** One violin's items in scene units, widened `t` out of its centre line: its body, then its median tick. */
function violinItems(
	coords: CoordinateSystem,
	violin: ViolinState,
	t: number,
	scale: number,
	foreground: string,
): PathBatchItem[] {
	const centre = violin.center;
	/** A data-space x, `t` of the way out from the centre line. */
	const widen = (x: number) => centre + (x - centre) * t;
	const items: PathBatchItem[] = [];
	if (violin.profile) {
		const ring = violinProfileRing(violin.profile, centre, violin.half);
		if (ring.length > 0)
			items.push({
				closed: true,
				fill: violin.color,
				stroke: "none",
				polylines: [ring.map((at) => coords.coordsToPoint(widen(at.x), at.y))],
			});
	}
	if (violin.median !== undefined) {
		/** The median tick's half-width: in proportion to the violin's. */
		const tick =
			scale > 0
				? (MEDIAN_LINE_HALF_WIDTH * violin.half) / scale
				: MEDIAN_LINE_HALF_WIDTH;
		items.push({
			closed: false,
			stroke: foreground,
			polylines: [
				[
					coords.coordsToPoint(widen(centre - tick), violin.median),
					coords.coordsToPoint(widen(centre + tick), violin.median),
				],
			],
		});
	}
	return items;
}

/**
 * The violins of a {@link violinPlot}, centred in their slots or sub-slots;
 * with a `transition`, one per join key. Internal: the preset is the API.
 */
const violinPlotViolins = defineComposite<ViolinsProps<AnyDatum>>({
	name: "ViolinPlotViolins",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		groups: { default: [], invalidates: Invalidate.UPDATE },
		slots: {
			default: (index: number) => index,
			invalidates: Invalidate.UPDATE,
		},
		dodge: { default: false, invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		stagger: { default: 0, invalidates: Invalidate.UPDATE },
		bandwidth: { invalidates: Invalidate.UPDATE },
		samples: { invalidates: Invalidate.UPDATE },
		scale: { default: DEFAULT_SCALE, invalidates: Invalidate.UPDATE },
		median: { default: true, invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
		transition: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		violinsStates.set(ctx.node, {
			layer,
			keyed: createKeyedData<AnyDatum>(),
			series: createSeries<AnyDatum>(layer),
			shapes: shapesCache(),
			toShapes: shapesCache(),
			batch: pathBatch.create({ items: [] }),
		});
		return drawViolins(ctx);
	},
	update: (_changed, ctx) => drawViolins(ctx),
});

/* ----------------------------------------------------------------- preset */

interface ViolinPlotState {
	read: ReturnType<typeof createGroupData<AnyDatum>>;
	latest: ReturnType<ReturnType<typeof createGroupData<AnyDatum>>> | null;
	categoryLabel: (key: BandKey, index: number) => string;
	violins: SceneNode<ViolinsProps<AnyDatum>>;
	plot: SceneNode<ChartProps>;
	lastChart: Partial<ChartProps> | undefined;
	lastLayer: Partial<ViolinsProps<AnyDatum>> | undefined;
	children: readonly SceneNode[];
}

const presetStates = new WeakMap<object, ViolinPlotState>();

function drawPreset(
	ctx: CompositeContext<ViolinPlotProps<AnyDatum>>,
): SceneNode[] {
	const state = presetStates.get(ctx.node) as ViolinPlotState;
	const props = ctx.props;
	const read = state.read(props);
	state.latest = read;
	state.lastLayer = updateChanged(
		state.violins,
		{
			data: props.data,
			groups: read.groups,
			slots: read.ends?.from.of ?? read.slots.of,
			dodge: read.ends?.dodge ?? read.slots.named,
			series: props.series,
			stagger: props.stagger ?? 0,
			bandwidth: props.bandwidth,
			samples: props.samples,
			scale: props.scale ?? DEFAULT_SCALE,
			median: props.median !== false,
			color: props.color,
			colors: props.colors,
			fillOpacity: props.fillOpacity,
			zIndex: props.zIndex,
			visible: props.visible,
			transition: read.transition,
			blend: props.blend,
			staging: props.staging,
			enterStagger: props.enterStagger,
		},
		state.lastLayer,
		Object.is,
	);
	state.lastChart = updateChanged(
		state.plot,
		presetChartProps(props, read, {
			numberFontSize: DEFAULT_NAME_FONT_SIZE,
			numberGap: DEFAULT_NUMBER_GAP,
			// A violin floats at its values; there is no baseline to stand on.
			line: false,
			categoryLabel: state.categoryLabel,
		}),
		state.lastChart,
	);
	const children = [state.violins, ...ctx.children];
	if (!shallowEqual(children, state.children)) {
		state.children = children;
		state.plot.set("children", children as never);
	}
	return [state.plot];
}

/**
 * A violin plot: one mirrored kernel density silhouette per group, with its
 * median marked. It is its own plot, sized by `width`/`height`; don't put it
 * inside an `axes` or `chart`. Violins and median ticks draw as one path
 * batch. See {@link violinRing} for the geometry alone.
 *
 * @example
 * ```ts
 * import { violinPlot } from "@sophistry/charts";
 *
 * violinPlot.create({
 * 	data: [
 * 		{ arm: "control", scores: [3, 4, 4, 5, 6, 7, 12] },
 * 		{ arm: "treated", scores: [5, 6, 7, 7, 8, 9, 10] },
 * 	],
 * 	values: "scores",
 * 	label: "arm",
 * 	width: 6,
 * 	height: 4,
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#box-and-violin-plots
 * @category Charts
 */
export const violinPlot = defineComposite<ViolinPlotProps<AnyDatum>>({
	name: "ViolinPlot",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		values: { invalidates: Invalidate.UPDATE },
		label: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		legend: { invalidates: Invalidate.UPDATE },
		bandwidth: { invalidates: Invalidate.UPDATE },
		samples: { invalidates: Invalidate.UPDATE },
		scale: { invalidates: Invalidate.UPDATE },
		yRange: { invalidates: Invalidate.UPDATE },
		width: { default: 8, invalidates: Invalidate.UPDATE },
		height: { default: 4, invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		median: { invalidates: Invalidate.UPDATE },
		yAxis: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
		children: { kind: "children", invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const state: ViolinPlotState = {
			read: createGroupData<AnyDatum>(),
			latest: null,
			categoryLabel: (key, index) =>
				state.latest ? categoryName(state.latest, key, index) : String(key),
			violins: violinPlotViolins.create({} as never),
			plot: chart.create({ width: 8, height: 4 }),
			lastChart: undefined,
			lastLayer: undefined,
			children: [],
		};
		presetStates.set(ctx.node, state);
		return drawPreset(ctx);
	},
	update: (_changed, ctx) => drawPreset(ctx),
});
