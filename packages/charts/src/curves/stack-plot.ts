/**
 * `stackPlot`: a stacked area chart, drawn as one path batch (a closed item
 * per band) in a group whose clip the `"x"` reveal sweeps; `reveal="length"`
 * traces each band's outline (the item's `progress`), its fill coming up
 * with it.
 *
 * Across a keyed transition each end is stacked on its own, a band one end
 * lacks stands with no thickness on its seam, and the update morphs each
 * band's bounds together, so adjacent bands stay touching on every frame.
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
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, CurveKind, Point } from "@sophistry/core/geometry";
import { finiteOrZero } from "@sophistry/core/internal";
import type { ChartLayer } from "../context.js";
import { chartLayer } from "../context.js";
import type { Channel, DateSink, PositionValue } from "../data/channels.js";
import {
	channelValues,
	colorResolver,
	dateSinkContext,
	identity,
	indexOf,
	numberValues,
} from "../data/channels.js";
import type { EndSpace, Mapper } from "../end-space.js";
import { endSpace, sceneAreaRuns } from "../end-space.js";
import type { JoinEnd } from "../join.js";
import { createGroupJoin, layerTransition } from "../join.js";
import { fillBetweenCurve, fillBetweenRings } from "../math/fillBetween.js";
import type { JoinStaging } from "../math/join.js";
import type { AreaPoint } from "../math/morph.js";
import { morphAreaRuns } from "../math/morph.js";
import { uniqueKeys } from "../math/ordinal.js";
import { revealClipAlongX } from "../math/reveal.js";
import type { StackOffset, StackOrder } from "../math/stack.js";
import { stackOrder } from "../math/stack.js";
import { stackedBands } from "../math/stackplot.js";
import { blendCss } from "../mix.js";
import type { AnyDatum, StackReveal, TransitionProps } from "../props.js";
import { groupIndices, WHOLE } from "../series.js";
import { keyedMemo, shallowEqual } from "../util.js";
import type { CurveBatch } from "./shared.js";
import { createCurveBatch } from "./shared.js";

const DEFAULT_FILL_OPACITY = 0.85;

/**
 * Props of {@link stackPlot}: `x` defaults to the index when `data` is
 * `number[]`; name it otherwise.
 *
 * @category Charts
 */
export interface StackPlotProps<T = unknown> extends TransitionProps<T> {
	/**
	 * Wide format (`y` a list): one row per x position. Long format (`y` one channel, with a
	 * `series`): one row per band per x position.
	 */
	data: readonly T[];
	/**
	 * X position, in data units (a `Date` reads as epoch ms). Defaults to the index when `data` is
	 * `number[]`; required otherwise.
	 */
	x?: Channel<T, PositionValue>;
	/**
	 * One channel per band, stacked in the order given (`y: ["north", "south"]`); or one channel,
	 * for long-format `data`, with `series` naming each row's band. Non-finite heights count as 0.
	 */
	y: readonly Channel<T, number>[] | Channel<T, number>;
	/**
	 * Which series each band is, colouring bands through the chart's shared colour scale and
	 * legend: with a list of `y` channels, one name per channel; with one `y` channel, a channel
	 * naming each row's band (rows missing at an x count as 0).
	 */
	series?: readonly BandKey[] | Channel<T, BandKey>;
	/**
	 * Colours cycled across bands by index. Defaults to the `series` colours, else the theme's
	 * categorical colours.
	 */
	colors?: readonly ColorInput[];
	/**
	 * Data-space y the first band stacks on, under the `"zero"` offset. Defaults to the axis
	 * baseline.
	 */
	baseline?: number;
	/**
	 * Where each x's stack is placed: `"zero"` on the baseline, `"normalize"` as shares of the
	 * total, `"center"` centred on zero, `"wiggle"` a streamgraph (needs ascending, evenly spaced
	 * x). See {@link StackOffset}.
	 * @default "zero"
	 */
	offset?: StackOffset;
	/**
	 * Which band sits at the bottom: `"appearance"`, `"reverse"`, `"sum"` (largest on top),
	 * `"insideOut"` (streamgraph order), or band indices bottom to top. Colours stay with their
	 * band.
	 * @default "appearance"
	 */
	order?: StackOrder;
	/**
	 * How `progress` reveals the stack: `"grow"` every band's height from the baseline together,
	 * `"x"` left to right behind one front, `"length"` each band's outline by arc length.
	 * @default "grow"
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	reveal?: StackReveal;
	/**
	 * How band edges run between rows: `"linear"` or any {@link CurveKind} (`"monotone"` for a
	 * smooth stack). Adjacent bands still share their edge exactly.
	 * @default "linear"
	 */
	curve?: CurveKind;
	/**
	 * The data to transition to, bands matched by `series` (long format) or place in `y` (wide):
	 * each end is stacked on its own and shared bands morph between them, so every frame is a
	 * stack. Leaving bands shrink away, new ones grow in.
	 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
	 */
	to?: readonly T[];
	/**
	 * How the transition spends `blend`.
	 * @default "staged"
	 */
	staging?: JoinStaging;
	/**
	 * With `to`: fraction of the enter stage spent staggering arriving bands, bottom up, 0..0.95.
	 * @default 0
	 */
	enterStagger?: number;
	/** Band fill opacity 0..1. @default 0.85 */
	fillOpacity?: number;
	/** Band outline. @default "none" */
	stroke?: PaintSpec;
	/** Outline width. */
	strokeWidth?: number;
	/** Opacity 0..1. @default 1 */
	opacity?: number;
	/** Reveal 0..1 (see `reveal`). @default 1 */
	progress?: number;
	/** Paint order (the bands paint under the axes of that order). */
	zIndex?: number;
	/** Set to false to hide the bands. */
	visible?: boolean;
}

/** A stack's input: x positions, one array of heights per band, each band's key. */
interface StackTable {
	xs: readonly number[];
	columns: readonly (readonly number[])[];
	keys: readonly BandKey[];
}

/** One end of a stack transition, stacked: each band's bounds over the end's x positions, and the stack's order. */
interface StackEnd {
	xs: readonly number[];
	bounds: Map<BandKey, { bottom: number[]; top: number[] }>;
	/** Band keys, bottom of the stack first. */
	order: BandKey[];
	/** The stack's foot: the lowest band's lower bound, or the baseline with no bands. */
	floor: readonly number[];
}

/** Wide format: `y` is a list of channels, one per band. */
function isChannelList<T>(
	y: readonly Channel<T, number>[] | Channel<T, number>,
): y is readonly Channel<T, number>[] {
	return Array.isArray(y);
}

/** Wide format's `series`: the bands' names, one per `y` channel. */
function isKeyList<T>(
	series: readonly BandKey[] | Channel<T, BandKey>,
): series is readonly BandKey[] {
	return Array.isArray(series);
}

/**
 * One dataset's stack input: shared x positions, one array of heights per band, and each band's
 * key (index in wide format, category in long).
 */
function tableOf(
	data: readonly unknown[],
	props: StackPlotProps<AnyDatum>,
	dates: DateSink | null,
): StackTable {
	const y = props.y as
		| readonly Channel<unknown, number>[]
		| Channel<unknown, number>;
	const x = props.x as Channel<unknown, PositionValue>;
	if (isChannelList(y)) {
		return {
			xs: numberValues(data, x, indexOf, "x", dates),
			columns: y.map((channel) =>
				numberValues(data, channel, undefined, undefined, dates),
			),
			keys: y.map((_, i): BandKey => i),
		};
	}
	const xs = numberValues(data, x, indexOf, "x", dates);
	const heights = numberValues(data, y, identity, "y", dates);
	const named = props.series as
		| readonly BandKey[]
		| Channel<unknown, BandKey>
		| undefined;
	const of =
		named === undefined || isKeyList(named)
			? undefined
			: channelValues(data, named, undefined, "series", dates);
	const positions = [...new Set(xs.filter(Number.isFinite))].sort(
		(a, b) => a - b,
	);
	const slot = new Map(positions.map((at, i) => [at, i]));
	const keys: BandKey[] = [];
	const columns: number[][] = [];
	for (const [key, indices] of groupIndices(xs.length, of)) {
		const column = positions.map(() => 0);
		for (const i of indices) {
			const at = slot.get(xs[i] as number);
			if (at !== undefined && Number.isFinite(heights[i]))
				column[at] = (column[at] as number) + (heights[i] as number);
		}
		keys.push(key === WHOLE ? 0 : key);
		columns.push(column);
	}
	return { xs: positions, columns, keys };
}

/** A stack's band keys, bottom first, in the order its own heights give. */
function stackKeys(
	table: StackTable,
	order: StackOrder | undefined,
): BandKey[] {
	const items = table.xs.map((_, i) =>
		table.columns.map((values, s) => ({
			series: s,
			value: finiteOrZero(values[i] as number),
		})),
	);
	return stackOrder(items, table.columns.length, order ?? "appearance").map(
		(s) => table.keys[s] as BandKey,
	);
}

/**
 * One end stacked with each band's heights scaled by `scale(key)`, in the order its unscaled
 * heights give, so a shrinking band never reorders the stack.
 */
function stackEnd(
	table: StackTable,
	scale: (key: BandKey) => number,
	options: { baseline: number; offset: StackOffset; order?: StackOrder },
): StackEnd {
	const items = table.xs.map((_, i) =>
		table.columns.map((values, s) => ({
			series: s,
			value: finiteOrZero(values[i] as number),
		})),
	);
	const order = stackOrder(
		items,
		table.columns.length,
		options.order ?? "appearance",
	);
	const columns = table.columns.map((values, s) => {
		const factor = scale(table.keys[s] as BandKey);
		return factor === 1 ? values : values.map((v) => finiteOrZero(v) * factor);
	});
	const stacked = stackedBands(table.xs, columns, {
		baseline: options.baseline,
		offset: options.offset,
		order,
	});
	const bounds = new Map<BandKey, { bottom: number[]; top: number[] }>();
	stacked.forEach((band, s) => {
		bounds.set(table.keys[s] as BandKey, {
			bottom: band.bottom,
			top: band.top,
		});
	});
	const keys = order.map((s) => table.keys[s] as BandKey);
	const lowest = keys.length > 0 ? bounds.get(keys[0] as BandKey) : undefined;
	const foot = options.offset === "zero" ? options.baseline : 0;
	return {
		xs: table.xs,
		bounds,
		order: keys,
		floor: lowest ? lowest.bottom : table.xs.map(() => foot),
	};
}

/**
 * Both ends' stack orders merged, bottom first, keeping each end's order where they agree; leaving
 * bands sit below arriving ones, and `from` wins disagreements.
 */
function mergeOrders(
	from: readonly BandKey[],
	to: readonly BandKey[],
): BandKey[] {
	const inFrom = new Set(from);
	const inTo = new Set(to);
	const seen = new Set<BandKey>();
	const out: BandKey[] = [];
	const push = (key: BandKey) => {
		seen.add(key);
		out.push(key);
	};
	let i = 0;
	let j = 0;
	while (i < from.length || j < to.length) {
		const a = from[i] as BandKey;
		const b = to[j] as BandKey;
		if (i < from.length && seen.has(a)) i++;
		else if (j < to.length && seen.has(b)) j++;
		else if (i < from.length && !inTo.has(a)) {
			push(a);
			i++;
		} else if (j < to.length && !inFrom.has(b)) {
			push(b);
			j++;
		} else if (i < from.length) {
			push(a);
			i++;
		} else {
			push(b);
			j++;
		}
	}
	return out;
}

/**
 * Every band of `order` at one end: its own bounds, or for a band the end lacks, zero thickness at
 * its seam.
 */
function boundsAlong(
	end: StackEnd,
	order: readonly BandKey[],
): Map<BandKey, { bottom: readonly number[]; top: readonly number[] }> {
	const out = new Map<
		BandKey,
		{ bottom: readonly number[]; top: readonly number[] }
	>();
	let seam = end.floor;
	for (const key of order) {
		const own = end.bounds.get(key);
		if (own) {
			out.set(key, own);
			seam = own.top;
		} else out.set(key, { bottom: seam, top: seam });
	}
	return out;
}

/** A band's continuous runs as areas, split where x is non-finite (as `fillBetweenRings` splits them). */
function areaRuns(
	xs: readonly number[],
	band: { bottom: readonly number[]; top: readonly number[] },
): AreaPoint[][] {
	const runs: AreaPoint[][] = [];
	let run: AreaPoint[] = [];
	xs.forEach((x, i) => {
		const y1 = band.top[i] as number;
		const y2 = band.bottom[i] as number;
		if (Number.isFinite(x) && Number.isFinite(y1) && Number.isFinite(y2))
			run.push({ x, y1, y2 });
		else {
			if (run.length > 1) runs.push(run);
			run = [];
		}
	});
	if (run.length > 1) runs.push(run);
	return runs;
}

/** One band's rings on a frame, the mapping they go through, and the end they are read from. */
interface FrameBand {
	rings: Point[][];
	through: Mapper;
	end: JoinEnd;
}

/** What a stack plot keeps between updates. */
interface StackPlotState {
	layer: ChartLayer;
	join: ReturnType<typeof createGroupJoin>;
	from: (deps: readonly unknown[], make: () => StackTable) => StackTable;
	to: (deps: readonly unknown[], make: () => StackTable) => StackTable;
	categories: (next: readonly BandKey[]) => readonly BandKey[];
	toCategories: (next: readonly BandKey[]) => readonly BandKey[];
	frameBands: (
		deps: readonly unknown[],
		make: () => Map<BandKey, FrameBand>,
	) => Map<BandKey, FrameBand>;
	batch: CurveBatch;
}

const states = new WeakMap<object, StackPlotState>();

function stable(): (next: readonly BandKey[]) => readonly BandKey[] {
	let last: readonly BandKey[] = [];
	return (next) => {
		if (!shallowEqual(last, next)) last = next;
		return last;
	};
}

function draw(ctx: CompositeContext<StackPlotProps<AnyDatum>>): SceneNode[] {
	const state = states.get(ctx.node) as StackPlotState;
	const props = ctx.props;
	const { layer } = state;
	const frame = layer.frame();
	const coords = layer.coords();
	if (!coords)
		throw new Error("StackPlot must be placed inside a chart or axes.");
	const dates = ctx.context(dateSinkContext);
	const theme = ctx.theme;

	const table = state.from(
		[props.data, props.x, props.y, props.series, dates],
		() => tableOf(props.data, props, dates),
	);
	const far = props.to;
	const toTable = far
		? state.to([far, props.x, props.y, props.series, dates], () =>
				tableOf(far, props, dates),
			)
		: undefined;
	const join = state.join({
		fromGroups: table.keys,
		toGroups: toTable?.keys,
		blend: props.blend,
		staging: props.staging,
		chartStages: frame?.join,
		enterStagger: props.enterStagger,
		// Arriving bands stagger from the bottom of `to`'s stack up.
		enterRanks: (entering) => {
			if (!toTable) return [];
			const bottomUp = stackKeys(toTable, props.order);
			const place = new Map(bottomUp.map((key, i) => [key, i]));
			const ordered = [...entering].sort(
				(a, b) => (place.get(a) ?? 0) - (place.get(b) ?? 0),
			);
			const rank = new Map(ordered.map((key, i) => [key, i]));
			return entering.map((key) => rank.get(key) ?? 0);
		},
	});
	/** The categories one end's bands are coloured by, or none without a `series`. */
	const categoriesOf = (tab: StackTable): readonly BandKey[] => {
		const named = props.series;
		if (named === undefined) return [];
		return isKeyList(named) ? uniqueKeys(named) : uniqueKeys(tab.keys);
	};
	const ownCategories = state.categories(categoriesOf(table));
	const toCategories = toTable
		? state.toCategories(categoriesOf(toTable))
		: undefined;
	/** The categories the bands are coloured by: both ends' while a transition runs. */
	const categories = toCategories
		? uniqueKeys([...ownCategories, ...toCategories])
		: ownCategories;
	const scaled = props.series !== undefined && props.colors === undefined;
	const colorScale = layer.colorScale(categories);
	/** A band's category, when the bands are named. */
	const categoryOf = (key: BandKey): BandKey | undefined => {
		const named = props.series;
		if (named === undefined) return undefined;
		return isKeyList(named) ? named[key as number] : key;
	};

	/** One end's categories as its stack shows them, top band first. */
	const legendOf = (tab: StackTable): BandKey[] =>
		stackKeys(tab, props.order)
			.reverse()
			.flatMap((key) => {
				const category = categoryOf(key);
				return category === undefined ? [] : [category];
			});

	const offset = props.offset ?? "zero";
	const space: EndSpace = endSpace(frame, coords);
	/** What the stack starts from and grows out of: the baseline (at `end`'s plot mid-swap), or zero once an offset has placed it. */
	const base = (end: JoinEnd = "from") =>
		offset === "zero" ? (props.baseline ?? space.coords(end).crossing().y) : 0;

	// The extent stacks on zero, not on `coords.crossing()`: the crossing comes
	// from the range this report is fitting, so reading it here is a cycle.
	// With no explicit baseline the report asks for zero, so the two agree.
	const extentOf = (tab: StackTable) => ({
		x: { values: tab.xs },
		y: {
			values: stackedBands(tab.xs, tab.columns, {
				baseline: props.baseline ?? 0,
				offset: props.offset,
				order: props.order,
			}).flatMap((band) =>
				band.rings.flatMap((ring) => ring.map((at) => at.y)),
			),
			zero:
				props.baseline === undefined &&
				(offset === "zero" || offset === "normalize"),
		},
	});
	layer.report({
		...extentOf(table),
		color: scaled
			? {
					categories,
					mark: { fill: true },
					// Top band first, so the legend reads down as the stack does;
					// each end's own order mid-transition, so the entries slide.
					legendOrder: legendOf(
						toTable && join.active && join.t >= 0.5 ? toTable : table,
					),
					...(toTable
						? {
								legendOrders: {
									from: legendOf(table),
									to: legendOf(toTable),
								},
							}
						: {}),
					...(toCategories
						? { ends: { from: ownCategories, to: toCategories } }
						: {}),
				}
			: undefined,
		transition: layerTransition(
			join,
			props.staging,
			toTable ? extentOf(toTable) : {},
		),
	});

	const slots = new Map(table.keys.map((key, index) => [key, index]));
	const toSlots = toTable
		? new Map(toTable.keys.map((key, index) => [key, index]))
		: undefined;
	/** A band's colour at one end, from its index there. */
	const colorAt = (key: BandKey, index: number) => {
		const category = categoryOf(key);
		if (scaled && category !== undefined) return colorScale(category);
		return colorResolver(
			undefined,
			props.colors ?? theme.palette.series,
			theme.palette.foreground,
		)(undefined, index) as string;
	};
	/** A band's colour on this frame: blended on the update stage when its index (and so its `colors` entry) changes. */
	const colorFor = (key: BandKey) => {
		const from = slots.get(key);
		const to = toSlots?.get(key);
		if (to === undefined) return colorAt(key, from ?? 0);
		if (from === undefined) return colorAt(key, to);
		const a = colorAt(key, from);
		if (from === to) return a;
		const b = colorAt(key, to);
		return a === b ? a : blendCss(a, b, join.update);
	};

	const progress = layer.progress(props.progress);
	const mode = props.reveal ?? "grow";
	/** Height scale for `"grow"`: every band × t about the baseline. */
	const growth = mode === "grow" ? (progress ?? 1) : 1;

	/**
	 * Each band's rings on this frame, in data units (mid-swap, scene units along the axis changing
	 * kind), and the mapping they go through. With a transition, each end is stacked on its own and
	 * the update morphs each band's bounds together so adjacent bands stay adjacent.
	 */
	const frameBands = state.frameBands(
		[
			table,
			toTable,
			coords,
			frame?.ends,
			frame?.join,
			join.active ? join.t : -1,
			join.active ? props.enterStagger : 0,
			props.baseline,
			offset,
			props.order,
		],
		() => {
			const out = new Map<BandKey, FrameBand>();
			const joined = join.join;
			if (!toTable || !joined) {
				const all = stackedBands(table.xs, table.columns, {
					baseline: base(),
					offset,
					order: props.order,
				});
				table.keys.forEach((key, index) => {
					const band = all[index];
					if (band)
						out.set(key, {
							rings: band.rings as Point[][],
							through: coords,
							end: "from",
						});
				});
				return out;
			}
			const options = (end: JoinEnd) => ({
				baseline: base(end),
				offset,
				order: props.order,
			});
			const a = stackEnd(
				table,
				(key) => (joined.to.has(key) ? 1 : 1 - join.exit),
				options("from"),
			);
			// Each arriving band at its own share of the enter stage: the far end
			// is re-stacked on every frame, so the bands above a growing one ride
			// up on it.
			const b = stackEnd(
				toTable,
				(key) => (joined.from.has(key) ? 1 : join.enterOf(key)),
				options("to"),
			);
			const order = mergeOrders(a.order, b.order);
			const fromBounds = boundsAlong(a, order);
			const toBounds = boundsAlong(b, order);
			for (const key of order) {
				const lo = fromBounds.get(key);
				const hi = toBounds.get(key);
				if (!lo || !hi) continue;
				const area = space.morph(
					areaRuns(a.xs, lo),
					areaRuns(b.xs, hi),
					join.update,
					{
						scene: sceneAreaRuns,
						morph: morphAreaRuns,
						build: (runs, through, end) => ({ runs, through, end }),
					},
				);
				out.set(key, {
					rings: area.runs.flatMap((run) =>
						fillBetweenRings(
							run.map((p) => p.x),
							run.map((p) => p.y1),
							run.map((p) => p.y2),
						),
					),
					through: area.through,
					end: area.end,
				});
			}
			return out;
		},
	);

	/** The `"x"` front: one clip over every band, so the stack advances as one. */
	const sweep =
		mode === "x"
			? revealClipAlongX(
					[...frameBands.values()].flatMap(({ rings, through }) =>
						rings.map((ring) =>
							ring.map((at) => through.coordsToPoint(at.x, at.y)),
						),
					),
					progress ?? 1,
				)
			: undefined;
	/** How present a band is: 0 once it has shrunk away, or before it starts to grow. */
	const presence = (key: BandKey) =>
		join.entering(key) ? join.enterOf(key) : join.fade(key);
	const kind = props.curve ?? "linear";
	/** What the shapes' own reveal is: whole once cut or grown, else the arc-length draw. */
	const own =
		mode === "length" || progress === undefined
			? (progress ?? 1)
			: progress > 0
				? 1
				: 0;
	const items: [unknown, PathBatchItem][] = [];
	for (const key of join.groups as readonly BandKey[]) {
		const band = frameBands.get(key);
		if (!band || !(presence(key) > 0)) continue;
		const { rings, through, end } = band;
		// Mid-swap, a y changing kind is in scene units: grown about the
		// baseline as drawn.
		const from = through.scene?.y
			? (coords as CoordinateSystem).coordsToPoint(0, base()).y
			: base(end);
		const points = rings.map((ring) =>
			ring.map((at) =>
				through.coordsToPoint(at.x, from + (at.y - from) * growth),
			),
		);
		if (points.length === 0) continue;
		const item: PathBatchItem = {
			closed: true,
			// Curved: each ring's two boundaries curved on their own (see `curve`);
			// the batch flattens the curves for picking.
			...(kind === "linear"
				? { polylines: points }
				: { curvePaths: points.map((ring) => fillBetweenCurve(ring, kind)) }),
			fill: colorFor(key),
			...(own < 1 ? { progress: own } : {}),
		};
		items.push([key, item]);
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
 * A stacked area chart: bands stacked atop a shared baseline, each shaded in
 * its own colour. Use `offset` for 100% areas or streamgraphs. Inside a
 * `chart` (or any `axes` whose y range covers the stacked total). See
 * {@link stackedBands} for the stacking alone.
 *
 * @example
 * ```ts
 * import { chart, stackPlot } from "@sophistry/charts";
 *
 * const rows = [
 * 	{ year: 2022, north: 3, south: 2 },
 * 	{ year: 2023, north: 4, south: 3 },
 * 	{ year: 2024, north: 5, south: 3 },
 * ];
 * chart.create({
 * 	width: 8,
 * 	height: 4,
 * 	children: [stackPlot.create({ data: rows, x: "year", y: ["north", "south"], series: ["North", "South"] })],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#stacked-areas
 * @category Charts
 */
export const stackPlot = defineComposite<StackPlotProps<AnyDatum>>({
	name: "StackPlot",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { default: [], invalidates: Invalidate.UPDATE },
		series: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		baseline: { invalidates: Invalidate.UPDATE },
		offset: { invalidates: Invalidate.UPDATE },
		order: { invalidates: Invalidate.UPDATE },
		reveal: { invalidates: Invalidate.UPDATE },
		curve: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		blend: { invalidates: Invalidate.UPDATE },
		staging: { invalidates: Invalidate.UPDATE },
		enterStagger: { invalidates: Invalidate.UPDATE },
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
			join: createGroupJoin(),
			from: keyedMemo(),
			to: keyedMemo(),
			categories: stable(),
			toCategories: stable(),
			frameBands: keyedMemo(),
			batch: createCurveBatch(),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
