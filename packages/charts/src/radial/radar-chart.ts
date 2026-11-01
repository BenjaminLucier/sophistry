/**
 * `radarChart`: one polygon per series on evenly spaced axes, over a grid of
 * rings and spokes, with axis names outside.
 *
 * The series polygons draw as one path batch (each item a series' outline
 * with its own fill and stroke colour; fill opacity and stroke width
 * shared). Under `reveal="sweep"` the clip groups are one wedge that
 * clips every series while the series' reveal plays, and a series coming or
 * going (each series, under a staggered sweep) is clipped to its own wedge
 * inside it. A path batch has one clip, so the series split into runs, each
 * run a batch under its own pair of groups: one run (one batch) when no
 * series has a wedge of its own. The grid rings and spokes stay
 * `polygon` / `line` nodes: they reveal by tracing their stroke
 * (`progress`), which a path batch does not do per item, and there are a
 * handful of them. Axis names are `label` nodes.
 */

import type {
	ColorInput,
	CompositeContext,
	LineProps,
	PathBatchItem,
	PathBatchItemsProps,
	PathBatchNode,
	PolygonProps,
	SceneNode,
} from "@sophistry/core";
import {
	defineComposite,
	group,
	Invalidate,
	line,
	pathBatch,
	phaseProgress,
	polygon,
} from "@sophistry/core";
import type { BandKey, ClosedCurveKind, Point } from "@sophistry/core/geometry";
import { closedCurvePath, polylineToCurvePath } from "@sophistry/core/geometry";
import {
	clampNonNegative,
	DEFAULT_FONT_WEIGHT,
	maxOf,
	measureLabel,
} from "@sophistry/core/internal";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type {
	Channel,
	ColorChannel,
	RequiredUnless,
} from "../data/channels.js";
import {
	colorResolver,
	dateSinkContext,
	identity,
	resolveChannel,
} from "../data/channels.js";
import type { JoinFrame } from "../join.js";
import {
	createKeyedData,
	joinFrame,
	layerTransition,
	transitionColor,
} from "../join.js";
import type { KeyedJoin } from "../math/join.js";
import { keyedJoin } from "../math/join.js";
import { datumKeys } from "../math/ordinal.js";
import { sweepWedge } from "../math/pie.js";
import type { RadarAxisFrame } from "../math/radar.js";
import {
	assertRadarShape,
	radarAxisFrames,
	radarFramePolygon,
	radarLabelOffset,
	radarVertices,
} from "../math/radar.js";
import { blendCss } from "../mix.js";
import type {
	AnyDatum,
	KeyedTransitionProps,
	RadialReveal,
	RevealProps,
	StaggerOrder,
} from "../props.js";
import type { Category } from "../series.js";
import { createSeries } from "../series.js";
import { hashRanks, orderRanks, staggered } from "../stagger.js";
import { textWidth } from "../text-width.js";
import { mix, shallowEqual } from "../util.js";
import type { KeyedLabel } from "./shared.js";
import { createFarScale, labelList } from "./shared.js";

const DEFAULT_STROKE_WIDTH = 0.02;
const DEFAULT_FILL_OPACITY = 0.25;
const DEFAULT_GRID_RINGS = 4;
const DEFAULT_GRID_OPACITY = 0.45;
const DEFAULT_GRID_STROKE_WIDTH = 0.02;
const DEFAULT_LABEL_FONT_SIZE = 0.28;
/** Scene units past the outer ring a sweep wedge reaches, so no polygon pokes out of it. */
const SWEEP_REACH = 0.28;
/** Scene units between the outer ring and an axis name's box. */
const DEFAULT_LABEL_GAP = 0.12;
/** The string whose ink sets an axis name's box height: one line height per font, as `AnchoredLabel`. */
const LINE_REFERENCE = "0123456789";

/** @category Charts */
export interface RadarChartBaseProps<T>
	extends KeyedTransitionProps<T>,
		RevealProps {
	/** One polygon per datum (a series), all read against the same axes and `maxValue`. */
	data: readonly T[];
	/**
	 * The series' value on each axis, one entry per axis. Defaults to the datum when `data` is
	 * `number[][]`; required otherwise.
	 */
	axisValues?: Channel<T, readonly number[]>;
	/**
	 * One name per axis, drawn outside the rings; when given, every non-empty group must have
	 * exactly that many values or the chart throws. `false` draws no names; `true` draws them even
	 * when only `toAxisLabels` names the axes.
	 */
	axisLabels?: boolean | readonly string[];
	/** Centre of the chart. Defaults to the origin. */
	center?: Point;
	/**
	 * Radius a value of `maxValue` reaches.
	 * @default 1
	 */
	radius?: number;
	/**
	 * The value that reaches `radius`. Pin it to keep the scale fixed as `data` changes. Defaults
	 * to the greatest value across every series.
	 */
	maxValue?: number;
	/**
	 * Angle of the first axis, in radians from +x. The default is 12 o'clock.
	 * @default Math.PI / 2
	 */
	startAngle?: number;
	/**
	 * Whether axes run clockwise.
	 * @default true
	 */
	clockwise?: boolean;
	/**
	 * The category of each polygon: colours polygons through the chart's shared colour scale and
	 * legend. `color` and `colors` win.
	 */
	series?: Channel<T, BandKey>;
	/**
	 * Each polygon's identity across data changes and transitions. See {@link
	 * KeyedTransitionProps}. Defaults to the datum's place within its `series`, else its index.
	 */
	key?: Channel<T, BandKey>;
	/** One colour for every series, or `(d, i) => colour`. Wins over `colors` and `series`. */
	color?: ColorChannel<T>;
	/**
	 * Colours cycled across the series by index. Wins over `series`. Defaults to the `series`
	 * colours, else the theme's categorical colours.
	 */
	colors?: readonly ColorInput[];
	/**
	 * Fill opacity of each polygon.
	 * @default 0.25
	 */
	fillOpacity?: number;
	/**
	 * Outline width of each polygon.
	 * @default 0.02
	 */
	strokeWidth?: number;
	/**
	 * Number of concentric grid rings under the data.
	 * @default 4
	 */
	gridRings?: number;
	/**
	 * Whether to draw the grid rings and spokes.
	 * @default true
	 */
	grid?: boolean;
	/**
	 * Axis name font size.
	 * @default 0.28
	 */
	labelFontSize?: number;
	/**
	 * Space between the outer ring and each axis name, which is anchored by its side facing the
	 * chart.
	 * @default 0.12
	 */
	labelGap?: number;
	/** Colour of the grid rings and spokes. Defaults to the theme's grid colour. */
	gridColor?: ColorInput;
	/**
	 * Reveal, 0..1: grid and names first, then the series, which grow out of the centre
	 * (`reveal="grow"`) or are uncovered by a clockwise sweep (`"sweep"`).
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	reveal?: RadialReveal;
	/**
	 * How each polygon runs between vertices: `"linear"` straight edges or `"catmull-rom"` a smooth
	 * closed spline. The grid stays polygonal.
	 * @default "linear"
	 */
	curve?: ClosedCurveKind;
	/**
	 * Fraction of the series' reveal spent staggering polygon after polygon in data order, 0..0.95.
	 * @default 0
	 */
	stagger?: number;
	/**
	 * The order `stagger` and `enterStagger` take. See {@link StaggerOrder}.
	 * @default "position"
	 */
	staggerOrder?: StaggerOrder;
	/**
	 * The data to transition to, matched to `data` by `key`: each vertex moves along its axis to
	 * its new value. Axes are joined by name (`axisLabels`/`toAxisLabels`), else by position; axes
	 * that come and go fold in and out. See {@link KeyedTransitionProps}.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	/** `to`'s axis names, one per value of each `to` group. Defaults to `axisLabels`. */
	toAxisLabels?: readonly string[];
	/** Paint order. */
	zIndex?: number;
	/** Set to false to hide the chart. */
	visible?: boolean;
}

/**
 * Props of {@link radarChart}: `axisValues` is required unless `data` is `number[][]`.
 *
 * @category Charts
 */
export type RadarChartProps<T> = RadarChartBaseProps<T> &
	RequiredUnless<T, readonly number[], "axisValues">;

/** A polygon in data units: its value on each axis and its colour. */
interface PolygonState {
	/** Without a transition, the group as given; with one, one value per axis of the axis join (`undefined` where that end lacks the axis). */
	values: readonly (number | undefined)[];
	color: string;
}

/**
 * Two polygons blended at `u`: each axis's value in data units, the colour
 * in OKLCH. A value only one end has (an axis coming or going) is that
 * end's; the axis's fold does the rest.
 */
function blendPolygon(
	a: PolygonState,
	b: PolygonState,
	u: number,
): PolygonState {
	return {
		values: a.values.map((p, i) => {
			const q = b.values[i];
			if (p === undefined) return q;
			if (q === undefined) return p;
			return mix(clampNonNegative(p), clampNonNegative(q), u);
		}),
		color: blendCss(a.color, b.color, u),
	};
}

/** Two frames' axes, compared by value. */
function sameAxes(
	a: readonly RadarAxisFrame[],
	b: readonly RadarAxisFrame[],
): boolean {
	return (
		a === b ||
		(a.length === b.length && a.every((axis, i) => shallowEqual(axis, b[i])))
	);
}

/** Reads each series' per-axis values. */
function groupsOf(
	data: readonly unknown[],
	channel: unknown,
): (readonly number[])[] {
	const read = resolveChannel<unknown, readonly number[]>(
		channel as Channel<unknown, readonly number[]> | undefined,
		identity,
		"axisValues",
	);
	return data.map((d, i) => read(d, i) ?? []);
}

/** One end's axis keys: names (repeats told apart) when `data` names its axes, else positions. */
function axisKeysOf(
	named: boolean,
	labels: readonly string[] | undefined,
	all: readonly (readonly number[])[],
): BandKey[] {
	if (named && labels !== undefined)
		return datumKeys(labels.length, (i) => labels[i]);
	const count = labels?.length ?? all[0]?.length ?? 0;
	return Array.from({ length: count }, (_, i) => i);
}

/** With `staggerOrder="random"`: each end's series ranked by a hash of their keys. */
function hashSlotsOf(
	order: StaggerOrder | undefined,
	fromSlots: Map<BandKey, number>,
	toSlots: Map<BandKey, number> | undefined,
) {
	if (order !== "random") return undefined;
	const of = (slots: Map<BandKey, number>) => {
		const keys = [...slots.keys()];
		const rank = hashRanks(keys);
		return new Map(keys.map((key, i) => [key, rank[i] as number]));
	};
	return { from: of(fromSlots), to: toSlots ? of(toSlots) : undefined };
}

/** What a radar keeps between updates. */
interface RadarState {
	layer: ChartLayer;
	keyed: ReturnType<typeof createKeyedData<AnyDatum>>;
	series: ReturnType<typeof createSeries<AnyDatum>>;
	farScale: ReturnType<typeof createFarScale>;
	/** Each run's inner group and path batch, by its outer group (see the file header). */
	runs: WeakMap<
		SceneNode,
		{ inner: SceneNode; batch: PathBatchNode<PathBatchItemsProps> }
	>;
	/** The last update's sweep wedges by fraction, so a still frame keeps its clips by identity. */
	wedges: Map<number, Point[] | undefined>;
	groups: typeof groupsOf;
	toGroups: typeof groupsOf;
	fromAxisKeys: (keys: BandKey[]) => BandKey[];
	toAxisKeys: (keys: BandKey[] | undefined) => BandKey[] | undefined;
	axisJoin: (
		from: readonly BandKey[],
		to: readonly BandKey[] | undefined,
	) => KeyedJoin | undefined;
	axes: (next: RadarAxisFrame[]) => RadarAxisFrame[];
	hashSlots: typeof hashSlotsOf;
	lineHeight: (fontSize: number, fontFamily: string) => number;
	widths: Map<string, number>;
	widthsFont: string;
	enterRanks: (
		order: StaggerOrder | undefined,
	) => (entering: readonly BandKey[]) => readonly number[];
}

const states = new WeakMap<object, RadarState>();

function draw(ctx: CompositeContext<RadarChartProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as RadarState;
	const props = ctx.props;
	const theme = ctx.theme;
	const { layer } = state;
	const frame = layer.frame();
	const dates = ctx.context(dateSinkContext);

	/** Each series' per-axis values, read once per data/channel change. */
	const groups = state.groups(props.data, props.axisValues);
	/** `data`'s axis names, when `axisLabels` lists them. */
	const axisNames = Array.isArray(props.axisLabels)
		? (props.axisLabels as readonly string[])
		: undefined;
	const toLabels = props.toAxisLabels ?? axisNames;
	const toGroups =
		props.to === undefined
			? undefined
			: state.toGroups(props.to, props.axisValues);
	if (toGroups) assertRadarShape(toGroups, toLabels);
	assertRadarShape(groups, axisNames);
	const named = axisNames !== undefined;
	const fromAxisKeys = state.fromAxisKeys(axisKeysOf(named, axisNames, groups));
	const toAxisKeys = state.toAxisKeys(
		toGroups === undefined ? undefined : axisKeysOf(named, toLabels, toGroups),
	);
	/** The two ends' axes matched by key, while a transition runs. */
	const axisJoin = state.axisJoin(fromAxisKeys, toAxisKeys);

	const series = state.series({
		data: props.data,
		series: props.series,
		overridden: props.color !== undefined || props.colors !== undefined,
		mark: { fill: true },
		dates,
	});
	// Polygons by `key`, else by place in series, else by index; without
	// `to`, `data`'s alone. Axes that come and go stage the transition too.
	const keyed = state.keyed({
		data: props.data,
		to: props.to,
		key: props.key,
		series: props.series,
		of: series.of,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		more: axisJoin && { enters: axisJoin.enters, exits: axisJoin.exits },
		enterStagger: props.enterStagger,
		// Entering polygons in `staggerOrder`: `to`'s order, or by key hash.
		enterRanks: state.enterRanks(props.staggerOrder),
		dates,
	});
	const hashSlots = state.hashSlots(
		props.staggerOrder,
		keyed.fromSlots,
		keyed.toSlots,
	);

	// The value that reaches `radius`: given, else each end's greatest,
	// blended with the update.
	let maxValue = props.maxValue;
	if (maxValue === undefined) {
		const own = maxOf(groups.flat(), 0);
		maxValue =
			toGroups === undefined
				? own
				: mix(own, maxOf(toGroups.flat(), 0), keyed.update);
	}

	const cx = props.center?.x ?? 0;
	const cy = props.center?.y ?? 0;
	const radius = props.radius ?? 1;
	const startAngle = props.startAngle;
	const clockwise = props.clockwise;
	const toScene = (vertex: Point): Point => ({
		x: cx + vertex.x * radius,
		y: cy + vertex.y * radius,
	});

	// Every axis of either end on this frame, in drawing order; compared by
	// value so a stage that moves no axis rebuilds nothing.
	const axes = state.axes(
		radarAxisFrames(fromAxisKeys, keyed.active ? toAxisKeys : undefined, {
			startAngle,
			clockwise,
			exit: keyed.exit,
			update: keyed.update,
			enter: keyed.enter,
		}),
	);
	const axisByKey = new Map(axes.map((axis) => [axis.key, axis]));
	/** Every axis key to keep a spoke and a name for. */
	const axisKeys = axisJoin?.keys ?? fromAxisKeys;
	/** Whether there are axes enough for a polygon: the spokes and names wait for one, as the rings do. */
	const drawable = axes.filter((axis) => axis.weight > 0).length >= 3;

	// No axes to fit: the report is the series, for a frame's legend (both
	// ends' while a transition runs), and the transition, for its staging.
	layer.report({
		color: transitionColor(series.extent, keyed.toOf),
		transition: layerTransition(keyed, props.staging, {}),
	});

	const read = colorResolver(
		props.color,
		props.colors ?? theme.palette.series,
		theme.palette.foreground,
	);
	const toScale = state.farScale(
		frame !== null,
		keyed.toOf,
		series.scale,
		theme,
	);
	const farColor = (category: Category) =>
		series.scaled ? toScale(category) : undefined;
	const at = (
		data: readonly unknown[],
		all: readonly (readonly number[])[],
		index: number,
		colorOf: (category: Category) => string | undefined,
		of: readonly Category[] | undefined,
		axisAt: ReadonlyMap<BandKey, number> | undefined,
	) => {
		if (index < 0) return undefined;
		const group = all[index] ?? [];
		return {
			index,
			state: {
				values:
					axisJoin && axisAt
						? axisJoin.keys.map((key) => {
								const i = axisAt.get(key);
								return i === undefined ? undefined : group[i];
							})
						: group,
				color: colorOf(of?.[index]) ?? read(data[index], index),
			},
		};
	};
	// Each key's polygon on this frame, in data units: values and colour,
	// blended, entering or leaving.
	const frames = new Map<BandKey, JoinFrame<PolygonState>>();
	for (const key of keyed.keys) {
		const next = joinFrame(
			keyed,
			at(
				props.data,
				groups,
				keyed.fromIndex(key),
				series.colorOf,
				series.of,
				axisJoin?.from,
			),
			props.to && toGroups
				? at(
						props.to,
						toGroups,
						keyed.toIndex(key),
						farColor,
						keyed.toOf,
						axisJoin?.to,
					)
				: undefined,
			blendPolygon,
			key,
		);
		if (next) frames.set(key, next);
	}

	/** Where an axis meets the outer ring, in scene units. */
	const outerPoint = (axis: RadarAxisFrame | undefined) =>
		axis
			? toScene({ x: Math.cos(axis.angle), y: Math.sin(axis.angle) })
			: { x: cx, y: cy };
	const gridColor = props.gridColor ?? theme.palette.grid;
	const progress = layer.progress(props.progress) ?? 1;
	/** Grid and labels: the frame half of `progress`; the series take the other half. */
	const framePhase = phaseProgress(progress, 0, 2);
	const dataPhase = phaseProgress(progress, 1, 2);
	const growing = props.reveal !== "sweep";
	/** Whether the series come in one after another (`stagger`). */
	const staggering = (props.stagger ?? 0) > 0;
	/** A sweep wedge, reaching past the labels' ring so nothing pokes out; undefined once whole. */
	const wedges = new Map<number, Point[] | undefined>();
	const wedge = (fraction: number) => {
		if (fraction >= 1) return undefined;
		if (!wedges.has(fraction))
			wedges.set(
				fraction,
				state.wedges.has(fraction)
					? state.wedges.get(fraction)
					: sweepWedge(fraction, {
							center: { x: cx, y: cy },
							radius: radius * 1.5 + SWEEP_REACH,
							startAngle,
							clockwise,
						}),
			);
		return wedges.get(fraction);
	};

	const children: SceneNode[] = [];

	// The grid: rings at uniform fractions of `radius` (every axis reads the
	// same value, so each is a regular n-gon), then a spoke per axis.
	if (props.grid !== false) {
		const count = props.gridRings ?? DEFAULT_GRID_RINGS;
		const rings: PolygonProps[] = [];
		for (let i = 0; i < count; i++) {
			const ring = radarFramePolygon(axes, () => (i + 1) / count, 1).map(
				toScene,
			);
			if (ring.length === 0) continue;
			rings.push({
				points: ring,
				fill: "none",
				stroke: gridColor,
				strokeWidth: DEFAULT_GRID_STROKE_WIDTH,
				opacity: DEFAULT_GRID_OPACITY,
				zIndex: props.zIndex,
				visible: props.visible,
				progress: framePhase,
			});
		}
		children.push(
			...ctx.list("rings", rings, {
				key: (_ring, i) => i,
				create: (ring) => polygon.create(ring),
				update: (node, ring) => {
					// A ring's points are new arrays each update: write them only
					// when they moved.
					const before = node.get("points");
					node.update(
						before && samePoints(before, ring.points ?? [])
							? { ...ring, points: before }
							: ring,
					);
				},
			}),
		);
		const spokes: { key: BandKey; props: LineProps }[] = [];
		if (drawable)
			for (const key of axisKeys) {
				const axis = axisByKey.get(key);
				const weight = axis?.weight ?? 0;
				if (!(weight > 0)) continue;
				spokes.push({
					key,
					props: {
						from: { x: cx, y: cy },
						to: outerPoint(axis),
						stroke: gridColor,
						strokeWidth: DEFAULT_GRID_STROKE_WIDTH,
						opacity: DEFAULT_GRID_OPACITY * weight,
						zIndex: props.zIndex,
						visible: props.visible,
						progress: framePhase,
					},
				});
			}
		children.push(
			...ctx.list("spokes", spokes, {
				key: (spoke) => spoke.key,
				create: (spoke) => line.create(spoke.props),
				update: (node, spoke) => {
					const from = node.get("from");
					const to = node.get("to");
					node.update({
						...spoke.props,
						from:
							from && samePoint(from, spoke.props.from as Point)
								? from
								: spoke.props.from,
						to:
							to && samePoint(to, spoke.props.to as Point)
								? to
								: spoke.props.to,
					});
				},
			}),
		);
	} else {
		ctx.list("rings", [], { create: () => polygon.create({}) });
		ctx.list("spokes", [], {
			create: () => line.create({ from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }),
		});
	}

	// The series: whole behind the sweep, hidden before it. Consecutive
	// series under the same wedge of their own share a run.
	const runs: { clip: Point[] | undefined; items: PathBatchItem[] }[] = [];
	const curve = props.curve ?? "linear";
	if (dataPhase > 0) {
		for (const key of keyed.keys) {
			const own = frames.get(key);
			if (!own) continue;
			const presence = own.presence;
			// Its own share of the series' reveal: in data order (the order of
			// the end it is read from), or by key hash, when staggered.
			let share = dataPhase;
			if (staggering) {
				const near = own.end === "from";
				const slots = near
					? (hashSlots?.from ?? keyed.fromSlots)
					: (hashSlots?.to ?? keyed.toSlots);
				share = staggered(
					dataPhase,
					slots?.get(key) ?? 0,
					slots?.size ?? 1,
					props.stagger ?? 0,
				);
			}
			if (!(presence > 0) || (staggering && !(share > 0))) continue;
			/** How far out each vertex sits: the reveal's growth, and with `"grow"` the presence too. */
			const scale = growing ? share * presence : 1;
			const values = own.state.values;
			const vertices = keyed.active
				? radarFramePolygon(axes, (axis) => values[axis.slot], maxValue)
				: radarVertices(values as readonly number[], {
						maxValue,
						startAngle,
						clockwise,
					});
			if (vertices.length === 0) continue;
			const points = vertices.map((vertex) =>
				toScene({ x: vertex.x * scale, y: vertex.y * scale }),
			);
			const color = own.state.color;
			// With `"sweep"`, a polygon coming or going is swept in or out on
			// its own; staggered, its reveal is its own wedge too (the two
			// wedges share a start, so together they are the narrower).
			const clip = growing
				? undefined
				: wedge(staggering ? Math.min(presence, share) : presence);
			const item: PathBatchItem = {
				curvePaths: [
					curve !== "linear"
						? closedCurvePath(points, curve)
						: polylineToCurvePath(points, true),
				],
				closed: true,
				fill: color,
				stroke: color,
			};
			const last = runs[runs.length - 1];
			if (last && last.clip === clip) last.items.push(item);
			else runs.push({ clip, items: [item] });
		}
	}
	if (runs.length === 0) runs.push({ clip: undefined, items: [] });
	state.wedges = wedges;
	/** The wedge every series is under while the unstaggered sweep plays. */
	const sweepClip = growing || staggering ? undefined : wedge(dataPhase);
	const batchProps = {
		stroke: "none",
		strokeWidth: props.strokeWidth ?? DEFAULT_STROKE_WIDTH,
		fillOpacity: props.fillOpacity ?? DEFAULT_FILL_OPACITY,
		zIndex: props.zIndex ?? 0,
		visible: props.visible ?? true,
	};
	/** Writes a run into its groups and batch. */
	const fillRun = (outer: SceneNode, run: (typeof runs)[number]) => {
		const { inner, batch } = state.runs.get(outer) as {
			inner: SceneNode;
			batch: PathBatchNode<PathBatchItemsProps>;
		};
		outer.update({ clip: sweepClip } as never);
		inner.update({ clip: run.clip } as never);
		batch.update({
			items: run.items,
			...batchProps,
		} as Partial<PathBatchItemsProps>);
	};
	children.push(
		...ctx.list("series", runs, {
			key: (_run, i) => i,
			create: (run) => {
				const batch = pathBatch.create({ items: [] });
				const inner = group.create({ children: [batch] });
				const outer = group.create({ children: [inner] });
				state.runs.set(outer, { inner, batch });
				fillRun(outer, run);
				return outer;
			},
			update: fillRun,
		}),
	);

	// Axis names, clear of the ring by the gap, their inner side facing the chart.
	const names: KeyedLabel[] = [];
	if (drawable && (props.axisLabels === true || named)) {
		const fontSize = props.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE;
		const fontFamily = theme.defaults.fontFamily;
		const lineHeight = state.lineHeight(fontSize, fontFamily);
		const font = `${fontSize}|${fontFamily}`;
		if (state.widthsFont !== font) {
			state.widths = new Map();
			state.widthsFont = font;
		}
		for (const key of axisKeys) {
			const axis = axisByKey.get(key);
			const weight = axis?.weight ?? 0;
			if (!axis || !(weight > 0)) continue;
			// The name: `data`'s for an axis it has, until the update's
			// midpoint; else `to`'s.
			const text =
				axis.from >= 0 && (axis.to < 0 || keyed.update < 0.5)
					? axisNames?.[axis.from]
					: toLabels?.[axis.to];
			if (!text) continue;
			// The name's width, measured once per string.
			let width = state.widths.get(text);
			if (width === undefined) {
				width = textWidth(text, fontSize, fontFamily);
				state.widths.set(text, width);
			}
			const vertex = outerPoint(axis);
			const offset = radarLabelOffset(
				axis.angle,
				{ width, height: lineHeight },
				props.labelGap ?? DEFAULT_LABEL_GAP,
			);
			names.push({
				key,
				props: {
					text,
					x: vertex.x + offset.x,
					y: vertex.y + offset.y,
					fontSize,
					color: theme.palette.foreground,
					opacity: weight,
					zIndex: props.zIndex,
					visible: props.visible,
					progress: framePhase,
				},
			});
		}
	}
	children.push(...labelList(ctx, "names", names));
	return children;
}

function samePoint(a: Point, b: Point): boolean {
	return a.x === b.x && a.y === b.y;
}

function samePoints(a: readonly Point[], b: readonly Point[]): boolean {
	return (
		a.length === b.length && a.every((p, i) => samePoint(p, b[i] as Point))
	);
}

/**
 * A radar (spider) chart: one polygon per series, its values on evenly spaced axes around a
 * full turn, over a grid of rings and spokes. Draws in scene units; needs at least 3 axes.
 * Pass `maxValue` when the data can change, so the scale stays fixed. The polygons are one
 * path batch.
 *
 * @example
 * ```ts
 * import { radarChart } from "@sophistry/charts";
 *
 * radarChart.create({
 * 	data: [
 * 		{ team: "a", v: [3, 4, 5, 2] },
 * 		{ team: "b", v: [4, 2, 3, 5] },
 * 	],
 * 	axisValues: "v",
 * 	series: "team",
 * 	axisLabels: ["Speed", "Power", "Range", "Cost"],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#pie-polar-area-and-radar
 * @category Charts
 */
export const radarChart = defineComposite<RadarChartProps<AnyDatum>>({
	name: "RadarChart",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		axisValues: { invalidates: Invalidate.UPDATE },
		axisLabels: { invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		radius: { invalidates: Invalidate.UPDATE },
		maxValue: { invalidates: Invalidate.UPDATE },
		startAngle: { invalidates: Invalidate.UPDATE },
		clockwise: { invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		key: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		fillOpacity: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		gridRings: { invalidates: Invalidate.UPDATE },
		grid: { invalidates: Invalidate.UPDATE },
		labelFontSize: { invalidates: Invalidate.UPDATE },
		labelGap: { invalidates: Invalidate.UPDATE },
		gridColor: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		reveal: { invalidates: Invalidate.UPDATE },
		curve: { invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		staggerOrder: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		toAxisLabels: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const layer = chartLayer(ctx);
		let fromKeys: BandKey[] | undefined;
		let toKeys: BandKey[] | undefined;
		let axes: RadarAxisFrame[] | undefined;
		const state: RadarState = {
			layer,
			keyed: createKeyedData<AnyDatum>(),
			series: createSeries<AnyDatum>(layer),
			farScale: createFarScale(),
			runs: new WeakMap(),
			wedges: new Map(),
			groups: ctx.memo(groupsOf),
			toGroups: ctx.memo(groupsOf),
			// Each end's axis keys, kept while equal by value, so the axis
			// join (memoised on them) is read once per end.
			fromAxisKeys: (keys) => {
				if (!fromKeys || !shallowEqual(fromKeys, keys)) fromKeys = keys;
				return fromKeys;
			},
			toAxisKeys: (keys) => {
				if (keys === undefined) {
					toKeys = undefined;
					return undefined;
				}
				if (!toKeys || !shallowEqual(toKeys, keys)) toKeys = keys;
				return toKeys;
			},
			axisJoin: ctx.memo(
				(from: readonly BandKey[], to: readonly BandKey[] | undefined) =>
					to === undefined ? undefined : keyedJoin(from, to),
			),
			axes: (next) => {
				if (!axes || !sameAxes(axes, next)) axes = next;
				return axes;
			},
			hashSlots: ctx.memo(hashSlotsOf),
			lineHeight: ctx.memo((fontSize: number, fontFamily: string) => {
				const { ascent, descent } = measureLabel(LINE_REFERENCE, {
					fontSize,
					fontFamily,
					fontWeight: DEFAULT_FONT_WEIGHT,
					italic: false,
					letterSpacing: 0,
				});
				return ascent + descent;
			}),
			widths: new Map(),
			widthsFont: "",
			enterRanks: ctx.memo(
				(order: StaggerOrder | undefined) => (entering: readonly BandKey[]) =>
					orderRanks(entering, order, (_key, i) => i),
			),
		};
		states.set(ctx.node, state);
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
