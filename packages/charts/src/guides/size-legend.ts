/**
 * `sizeLegend`: a key to a size encoding, a hollow reference circle per
 * value; `sizeKeyStack`: a frame's stack of them, one per size scale; and
 * the measurements a frame lays them out with.
 *
 * A value's nodes are kept for as long as either end of a transition shows
 * the value, and hidden with `visible: false` when they are not shown.
 * Each end is measured once per change of its scale, values, title or font,
 * not as `progress` or a transition's stages move.
 */

import type {
	CircleProps,
	CompositeContext,
	LabelProps,
	SceneNode,
} from "@sophistry/core";
import {
	circle,
	defineComposite,
	Invalidate,
	label,
	measuresText,
} from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import {
	clamp01,
	DEFAULT_FONT_WEIGHT,
	measureLabel,
} from "@sophistry/core/internal";
import type { SizeScale } from "../frame/types";
import { bubbleLegendValues, bubbleRadiusScale } from "../math/bubble";
import type { SizeLegendLayout } from "../math/legend";
import { sizeLegendLayout } from "../math/legend";
import { staggered } from "../stagger";
import { keyedMemo, mix, mixPoint, shallowEqual, stableValue } from "../util";
import { write } from "./nodes";

const DEFAULT_FONT_SIZE = 0.28;
/** `scatter`'s default `sizeRange`. */
const DEFAULT_RANGE: readonly [number, number] = [0, 0.35];
/** Fraction of the key's reveal spent staggering its circles. */
const STAGGER = 0.5;
const STROKE_WIDTH = 0.02;

/**
 * A size key's keyed transition: the far end's scale and values, and how far each stage has
 * got. `chart` passes one while a keyed transition runs.
 *
 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
 * @category Charts
 */
export interface SizeLegendTransition {
	/** The scale at the end. */
	to: SizeScale;
	/** The values the end shows. Defaults to `values`, else the end's own round values. */
	values?: readonly number[];
	/** Progress of the exit stage, 0..1. */
	exit: number;
	/** Progress of the update stage, 0..1. */
	update: number;
	/** Progress of the enter stage, 0..1. */
	enter: number;
}

/**
 * Props for {@link sizeLegend}.
 *
 * @category Charts
 */
export interface SizeLegendProps {
	/** The size scale the key explains. */
	scale: SizeScale;
	/**
	 * The values to draw circles for, in order. Defaults to up to three round values of the scale.
	 */
	values?: readonly number[];
	/** How a value is written. Defaults to the axes' formatting. */
	format?: (value: number) => string;
	/** The key's top-left corner, in scene units. */
	at: Point;
	/**
	 * `"column"`: one circle per row. `"row"`: side by side, wrapping at `maxWidth`.
	 * @default "column"
	 */
	direction?: "column" | "row";
	/** With `direction: "row"`: wrap before an entry that would run past this width. */
	maxWidth?: number;
	/** A title line above the circles. */
	title?: string;
	/**
	 * Font size of the labels.
	 * @default 0.28
	 */
	fontSize?: number;
	/**
	 * Reveal, 0..1: the circles fade in one after another.
	 * @default 1
	 */
	progress?: number;
	/** A keyed data transition in progress; see {@link SizeLegendTransition}. */
	transition?: SizeLegendTransition;
	/** Paint order; higher draws later. */
	zIndex?: number;
	/** Set to `false` to hide the key. */
	visible?: boolean;
}

/** One entry of a size key: its value, circle radius and text. */
interface SizeLegendEntry {
	value: number;
	radius: number;
	label: string;
}

/** Measurement options shared by {@link sizeLegend} and the frames that place one. */
export interface SizeLegendMetrics {
	direction?: "column" | "row";
	maxWidth?: number;
	title?: string;
	fontSize?: number;
	format?: (value: number) => string;
	fontFamily: string;
}

/**
 * A size key's entries: the values (given, else round values of the scale) with their radii
 * and text. Non-positive values are left out.
 *
 * @internal
 */
function sizeLegendEntries(
	scale: SizeScale,
	values: readonly number[] | undefined,
	format: ((value: number) => string) | undefined,
): SizeLegendEntry[] {
	// A scale with nothing to size (an empty end of a transition) has no key.
	if (!(scale.maxValue > 0) || !Number.isFinite(scale.maxValue)) return [];
	const shown = (values ?? bubbleLegendValues(scale.maxValue)).filter(
		(value) => Number.isFinite(value) && value > 0,
	);
	const [minRadius, maxRadius] = scale.range ?? DEFAULT_RANGE;
	const radii = bubbleRadiusScale(shown, {
		minRadius,
		maxRadius,
		maxValue: scale.maxValue,
	});
	return shown.map((value, i) => ({
		value,
		radius: radii[i] as number,
		label: format?.(value) ?? formatTick(value),
	}));
}

/**
 * Lays a size key out, its labels measured with the theme's font.
 *
 * @internal
 */
function measureSizeLegend(
	entries: readonly SizeLegendEntry[],
	metrics: SizeLegendMetrics,
): SizeLegendLayout {
	const fontSize = metrics.fontSize ?? DEFAULT_FONT_SIZE;
	const style = {
		fontSize,
		fontFamily: metrics.fontFamily,
		fontWeight: DEFAULT_FONT_WEIGHT,
		italic: false,
		letterSpacing: 0,
	};
	return sizeLegendLayout(
		entries.map((entry) => entry.radius),
		entries.map((entry) => measureLabel(entry.label, style).width),
		{
			direction: metrics.direction ?? "column",
			rowHeight: fontSize * 1.6,
			gap: fontSize * 0.45,
			itemGap: fontSize * 1.2,
			pad: fontSize * 0.15,
			maxWidth: metrics.maxWidth,
			titleWidth:
				metrics.title === undefined || metrics.title === ""
					? undefined
					: measureLabel(metrics.title, style).width,
		},
	);
}

/** Where one entry stands on a frame, how big and how present. */
interface Placed {
	center: Point;
	label: Point;
	radius: number;
	text: string;
	presence: number;
}

/** One end of a key: its entries and their layout. */
interface SizeKeyEnd {
	entries: SizeLegendEntry[];
	layout: SizeLegendLayout;
}

/** The nodes one value draws. */
interface ValueNodes {
	circle: SceneNode<CircleProps>;
	label: SceneNode<LabelProps>;
}

/** What a size key keeps between updates. */
interface SizeLegendState {
	fromScale: (next: SizeScale) => SizeScale;
	toScale: (next: SizeScale | undefined) => SizeScale | undefined;
	values: (
		next: readonly number[] | undefined,
	) => readonly number[] | undefined;
	toValues: (
		next: readonly number[] | undefined,
	) => readonly number[] | undefined;
	startKey: (deps: readonly unknown[], make: () => SizeKeyEnd) => SizeKeyEnd;
	endKey: (
		deps: readonly unknown[],
		make: () => SizeKeyEnd | undefined,
	) => SizeKeyEnd | undefined;
	title: SceneNode<LabelProps> | undefined;
	nodes: Map<number, ValueNodes>;
}

/** Each size key node's state, kept from `setup` for its updates. */
const states = new WeakMap<object, SizeLegendState>();

const sameValues = (
	a: readonly number[] | undefined,
	b: readonly number[] | undefined,
) => a === b || (!!a && !!b && shallowEqual(a, b));

/**
 * A key to a size encoding: a hollow reference circle per value, with the value beside it,
 * drawn through the same square-root scale as the marks. `chart` draws one automatically for
 * layers sized by value (`scatter`'s `size`); use this directly for charts without a frame.
 *
 * @example
 * ```ts
 * import { sizeLegend } from "@sophistry/charts";
 *
 * sizeLegend.create({
 * 	at: { x: 3, y: 2 },
 * 	scale: { maxValue: 100, range: [0, 0.5] },
 * 	values: [25, 100],
 * 	title: "Population",
 * });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#series-and-legends
 * @category Charts
 */
export const sizeLegend = defineComposite<SizeLegendProps>({
	name: "SizeLegend",
	props: {
		scale: { default: { maxValue: 0 }, invalidates: Invalidate.UPDATE },
		values: { invalidates: Invalidate.UPDATE },
		format: { invalidates: Invalidate.UPDATE },
		at: { default: { x: 0, y: 0 }, invalidates: Invalidate.UPDATE },
		direction: { invalidates: Invalidate.UPDATE },
		maxWidth: { invalidates: Invalidate.UPDATE },
		title: { invalidates: Invalidate.UPDATE },
		fontSize: { invalidates: Invalidate.UPDATE },
		progress: { invalidates: Invalidate.UPDATE },
		transition: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const state: SizeLegendState = {
			fromScale: stableValue(sameScale),
			toScale: stableValue(
				(a: SizeScale | undefined, b: SizeScale | undefined) =>
					a === b || (!!a && !!b && sameScale(a, b)),
			),
			values: stableValue(sameValues),
			toValues: stableValue(sameValues),
			startKey: keyedMemo(),
			endKey: keyedMemo(),
			title: undefined,
			nodes: new Map(),
		};
		states.set(ctx.node, state);
		return renderSizeLegend(ctx, state);
	},
	update: (_changed, ctx) =>
		renderSizeLegend(ctx, states.get(ctx.node) as SizeLegendState),
});

/** Builds or updates a size key's nodes for its current props; returns them in paint order. */
function renderSizeLegend(
	ctx: CompositeContext<SizeLegendProps>,
	state: SizeLegendState,
): SceneNode[] {
	const epoch = measuresText(ctx);
	const props = ctx.props;
	const theme = ctx.theme;
	const fontFamily = theme.defaults.fontFamily;
	const fontSize = props.fontSize ?? DEFAULT_FONT_SIZE;
	const metrics: SizeLegendMetrics = {
		direction: props.direction,
		maxWidth: props.maxWidth,
		title: props.title,
		fontSize: props.fontSize,
		format: props.format,
		fontFamily,
	};
	const metricDeps = [
		props.direction,
		props.maxWidth,
		props.title,
		props.fontSize,
		props.format,
		fontFamily,
		epoch,
	];
	/** One end's entries and layout. Re-measured only when a scale or the values change, not as the stages move. */
	const endOf = (
		scale: SizeScale,
		values: readonly number[] | undefined,
	): SizeKeyEnd => {
		const entries = sizeLegendEntries(scale, values, props.format);
		return { entries, layout: measureSizeLegend(entries, metrics) };
	};
	const run = props.transition;
	const fromScale = state.fromScale({
		maxValue: props.scale.maxValue,
		range: props.scale.range,
	});
	const toScale = state.toScale(
		run ? { maxValue: run.to.maxValue, range: run.to.range } : undefined,
	);
	const values = state.values(props.values);
	// The far end's values, read apart from the stages, which move on every frame.
	const toValues = state.toValues(run?.values ?? props.values);
	const startKey = state.startKey([fromScale, values, ...metricDeps], () =>
		endOf(fromScale, values),
	);
	const endKey = state.endKey([toScale, toValues, ...metricDeps], () =>
		toScale ? endOf(toScale, toValues) : undefined,
	);
	// Every value either end shows, the start's first: one set of nodes per value.
	const own = startKey.entries.map((entry) => entry.value);
	const far = endKey?.entries.map((entry) => entry.value) ?? [];
	// (A value listed twice gets one set of nodes: a node can't appear twice among the children.)
	const shownValues = [...new Set([...own, ...far])];
	// Whether each end has a key: an end with nothing to size draws none, title included.
	const startShown = startKey.entries.length > 0;
	const endShown = endKey ? endKey.entries.length > 0 : startShown;
	const running = run !== undefined;
	const exit = run?.exit ?? 0;
	const update = run?.update ?? 0;
	const enter = run?.enter ?? 0;
	const reveal = (index: number) =>
		staggered(props.progress ?? 1, index, shownValues.length, STAGGER);
	const at = props.at;
	const offset = (p: Point): Point => ({ x: at.x + p.x, y: at.y + p.y });
	const shownAtAll = props.visible !== false;
	const zIndex = props.zIndex;
	const children: SceneNode[] = [];

	const titleAt =
		props.title === undefined ||
		props.title === "" ||
		(!startShown && !endShown)
			? undefined
			: ((startShown ? startKey.layout.title : undefined) ??
				endKey?.layout.title);
	if (titleAt) {
		// Out with the exits when the end has no key, in with the enters when the start has none.
		const shown =
			startShown === endShown
				? reveal(0)
				: reveal(0) * clamp01(startShown ? 1 - exit : enter);
		const place = offset(titleAt);
		const next: Partial<LabelProps> = {
			text: props.title ?? "",
			x: place.x,
			y: place.y,
			align: "left",
			fontSize,
			color: theme.palette.muted,
			opacity: shown,
			zIndex,
			visible: shownAtAll && shown > 0,
		};
		if (state.title) write(state.title, next);
		else state.title = label.create(next as LabelProps);
		children.push(state.title);
	} else {
		// Left out of the returned children, the old title is disposed.
		state.title = undefined;
	}

	const kept = new Map<number, ValueNodes>();
	shownValues.forEach((value, index) => {
		const place = keyPlace(value, startKey, endKey, running, {
			exit,
			update,
			enter,
		});
		const shown = reveal(index) * clamp01(place?.presence ?? 0);
		const visible = shownAtAll && shown > 0 && place !== undefined;
		const center = offset(place?.center ?? { x: 0, y: 0 });
		const labelAt = offset(place?.label ?? { x: 0, y: 0 });
		const circleProps: Partial<CircleProps> = {
			center,
			radius: place?.radius ?? 0,
			fill: "none",
			stroke: theme.palette.muted,
			strokeWidth: STROKE_WIDTH,
			opacity: shown,
			zIndex,
			visible,
		};
		const labelProps: Partial<LabelProps> = {
			text: place?.text ?? "",
			x: labelAt.x,
			y: labelAt.y,
			align: "left",
			fontSize,
			color: theme.palette.foreground,
			opacity: shown,
			zIndex,
			visible,
		};
		let nodes = state.nodes.get(value);
		if (nodes) {
			write(nodes.circle, circleProps);
			write(nodes.label, labelProps);
		} else {
			nodes = {
				circle: circle.create(circleProps as CircleProps),
				label: label.create(labelProps as LabelProps),
			};
		}
		kept.set(value, nodes);
		children.push(nodes.circle, nodes.label);
	});
	// Values neither end shows any more: left out of the children, their nodes are disposed.
	state.nodes = kept;
	return children;
}

/** Where a value's entry is on this frame: either end's place, or between the two. */
function keyPlace(
	value: number,
	own: SizeKeyEnd,
	far: SizeKeyEnd | undefined,
	running: boolean,
	stages: SizeKeyStages,
): Placed | undefined {
	const i = own.entries.findIndex((entry) => entry.value === value);
	const j = far?.entries.findIndex((entry) => entry.value === value) ?? -1;
	const a =
		i >= 0
			? {
					entry: own.entries[i] as SizeLegendEntry,
					item: own.layout.items[i] as SizeLegendLayout["items"][number],
				}
			: undefined;
	const b =
		far && j >= 0
			? {
					entry: far.entries[j] as SizeLegendEntry,
					item: far.layout.items[j] as SizeLegendLayout["items"][number],
				}
			: undefined;
	const at = (end: NonNullable<typeof a>, presence: number): Placed => ({
		center: end.item.center,
		label: end.item.label,
		radius: end.entry.radius,
		text: end.entry.label,
		presence,
	});
	if (!running || !far) return a ? at(a, 1) : undefined;
	if (a && b) {
		const u = stages.update;
		if (u <= 0) return at(a, 1);
		if (u >= 1) return at(b, 1);
		return {
			center: mixPoint(a.item.center, b.item.center, u),
			label: mixPoint(a.item.label, b.item.label, u),
			radius: mix(a.entry.radius, b.entry.radius, u),
			text: u < 0.5 ? a.entry.label : b.entry.label,
			presence: 1,
		};
	}
	if (a) return at(a, 1 - stages.exit);
	return b ? at(b, stages.enter) : undefined;
}

/**
 * One key of a frame's stack of size keys: the scale its sized layers draw on at each end of a
 * keyed transition, and the first such layer's channel name.
 *
 * @internal
 */
export interface SizeKey {
	maxValue: number;
	to?: number;
	range: readonly [number, number];
	label?: string;
}

/**
 * A key's laid-out size, and how far it is there at all (0 at an end without one).
 *
 * @internal
 */
export interface SizeKeyExtent {
	width: number;
	height: number;
	presence: number;
}

/**
 * A stack of size keys at each end of a keyed transition: the stack's size and each key's
 * place in it.
 *
 * @internal
 */
export interface SizeKeysEnds {
	from: SizeKeyExtent;
	to: SizeKeyExtent | undefined;
	/** Each key's top-left corner from the stack's: `x` to the right, `y` down. */
	offsets: { from: readonly Point[]; to: readonly Point[] | undefined };
}

/**
 * Each key of a stack measured at each end, before the stack is flowed ({@link flowSizeKeys}).
 *
 * @internal
 */
export interface SizeKeyMeasures {
	from: readonly SizeKeyExtent[];
	to: readonly SizeKeyExtent[] | undefined;
}

/**
 * How a stack of keys flows into columns: a key that would run past `maxHeight` starts a new
 * column `gap` to the right.
 *
 * @internal
 */
interface SizeKeyColumns {
	maxHeight: number;
	gap: number;
}

/** A stack's key's title: a given `title` names the first key, every other key its layers' channel. */
function sizeKeyTitle(
	key: SizeKey,
	index: number,
	given: string | undefined,
): string | undefined {
	return index === 0 && given !== undefined ? given : key.label;
}

/**
 * Measures each key of a stack at each end (presence 0 where an end sizes nothing). Undefined
 * without keys. Separate from {@link flowSizeKeys} so a re-flow doesn't re-measure text.
 *
 * @internal
 */
export function measureSizeKeyExtents(
	keys: readonly SizeKey[],
	options: Omit<SizeLegendMetrics, "title"> & {
		title?: string;
		values?: readonly number[];
	},
): SizeKeyMeasures | undefined {
	if (keys.length === 0) return undefined;
	const measure = (
		key: SizeKey,
		index: number,
		maxValue: number,
	): SizeKeyExtent => {
		if (!(maxValue > 0) || !Number.isFinite(maxValue))
			return { width: 0, height: 0, presence: 0 };
		const layout = measureSizeLegend(
			sizeLegendEntries(
				{ maxValue, range: key.range },
				options.values,
				options.format,
			),
			{ ...options, title: sizeKeyTitle(key, index, options.title) },
		);
		return { width: layout.width, height: layout.height, presence: 1 };
	};
	const rescales = keys.some((key) => key.to !== undefined);
	return {
		from: keys.map((key, i) => measure(key, i, key.maxValue)),
		to: rescales
			? keys.map((key, i) => measure(key, i, key.to ?? key.maxValue))
			: undefined,
	};
}

/**
 * Flows a stack's measured keys at each end: one under another `gap` apart, starting a new
 * column when one would run past `columns.maxHeight`. A key absent at an end takes no room.
 *
 * @internal
 */
export function flowSizeKeys(
	measures: SizeKeyMeasures | undefined,
	gap: number,
	columns?: SizeKeyColumns,
): SizeKeysEnds | undefined {
	if (!measures) return undefined;
	const flow = (extents: readonly SizeKeyExtent[]) => {
		const offsets: Point[] = [];
		let x = 0;
		let y = 0;
		let column = 0;
		let height = 0;
		let filled = false;
		for (const extent of extents) {
			const shown = extent.presence > 0;
			if (
				shown &&
				filled &&
				columns &&
				y + extent.height > columns.maxHeight + 1e-9
			) {
				x += column + columns.gap;
				y = 0;
				column = 0;
				filled = false;
			}
			offsets.push({ x, y });
			if (!shown) continue;
			column = Math.max(column, extent.width);
			height = Math.max(height, y + extent.height);
			y += extent.height + gap;
			filled = true;
		}
		return {
			extent: {
				width: x + column,
				height,
				presence: Math.max(0, ...extents.map((extent) => extent.presence)),
			},
			offsets,
		};
	};
	const from = flow(measures.from);
	const to = measures.to ? flow(measures.to) : undefined;
	return {
		from: from.extent,
		to: to?.extent,
		offsets: { from: from.offsets, to: to?.offsets },
	};
}

/**
 * Measures a stack of size keys and flows it ({@link measureSizeKeyExtents},
 * {@link flowSizeKeys}). Undefined without keys.
 *
 * @internal
 */
export function measureSizeKeys(
	keys: readonly SizeKey[],
	options: Omit<SizeLegendMetrics, "title"> & {
		title?: string;
		values?: readonly number[];
	},
	gap: number,
	columns?: SizeKeyColumns,
): SizeKeysEnds | undefined {
	return flowSizeKeys(measureSizeKeyExtents(keys, options), gap, columns);
}

/** Two stacks' measured keys with the same sizes, end by end. */
export function sameSizeKeyMeasures(
	a: SizeKeyMeasures | undefined,
	b: SizeKeyMeasures | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	const sameList = (
		p: readonly SizeKeyExtent[] | undefined,
		q: readonly SizeKeyExtent[] | undefined,
	) =>
		p === q ||
		(!!p &&
			!!q &&
			p.length === q.length &&
			p.every((extent, i) => sameKeyExtent(extent, q[i] as SizeKeyExtent)));
	return sameList(a.from, b.from) && sameList(a.to, b.to);
}

/** Two measured stacks of size keys with the same sizes and places. */
export function sameSizeKeysEnds(
	a: SizeKeysEnds | undefined,
	b: SizeKeysEnds | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	const same = (p: SizeKeyExtent | undefined, q: SizeKeyExtent | undefined) =>
		p === q || (!!p && !!q && sameKeyExtent(p, q));
	return (
		same(a.from, b.from) &&
		same(a.to, b.to) &&
		sameOffsets(a.offsets.from, b.offsets.from) &&
		sameOffsets(a.offsets.to, b.offsets.to)
	);
}

function sameKeyExtent(a: SizeKeyExtent, b: SizeKeyExtent): boolean {
	return (
		a.width === b.width && a.height === b.height && a.presence === b.presence
	);
}

/**
 * Each key's place in the stack now: its own end's, or while a key rescales, both ends'
 * blended by the update progress `u`.
 *
 * @internal
 */
export function sizeKeyOffsets(
	ends: SizeKeysEnds | undefined,
	u: number,
): readonly Point[] {
	if (!ends) return [];
	const { from, to } = ends.offsets;
	if (!to || u <= 0) return from;
	if (u >= 1) return to;
	return from.map((a, i) => mixPoint(a, to[i] as Point, u));
}

/** Two lists of key places, compared by value. */
export function sameOffsets(
	a: readonly Point[] | undefined,
	b: readonly Point[] | undefined,
): boolean {
	return (
		a === b ||
		(!!a &&
			!!b &&
			a.length === b.length &&
			a.every((point, i) => {
				const other = b[i] as Point;
				return point.x === other.x && point.y === other.y;
			}))
	);
}

/** The stages a stack of keys transitions on: exit, update and enter progress, as `SizeLegendTransition` takes them. */
export type SizeKeyStages = Pick<
	SizeLegendTransition,
	"exit" | "update" | "enter"
>;

/**
 * Props for {@link sizeKeyStack}.
 *
 * @internal
 */
export interface SizeKeyStackProps {
	keys: readonly SizeKey[];
	/** Each key's top-left corner from `at`: `x` to the right, `y` down. */
	offsets: readonly Point[];
	/** The stack's top-left corner. */
	at: Point;
	/** A title for the first key (see `sizeKeyTitle`). */
	title?: string;
	values?: readonly number[];
	format?: (value: number) => string;
	direction: "column" | "row";
	maxWidth?: number;
	fontSize?: number;
	progress?: number;
	/** The keyed transition's stages, while one runs. */
	stages?: SizeKeyStages;
	zIndex?: number;
	visible?: boolean;
}

/**
 * A frame's size keys, one {@link sizeLegend} per key at its place in the stack, each blending to
 * its far end's scale while `stages` is given. Keys are kept by position in the stack.
 *
 * @internal
 */
export const sizeKeyStack = defineComposite<SizeKeyStackProps>({
	name: "SizeKeyStack",
	props: {
		keys: { default: [], invalidates: Invalidate.UPDATE },
		offsets: { default: [], invalidates: Invalidate.UPDATE },
		at: { default: { x: 0, y: 0 }, invalidates: Invalidate.UPDATE },
		title: { invalidates: Invalidate.UPDATE },
		values: { invalidates: Invalidate.UPDATE },
		format: { invalidates: Invalidate.UPDATE },
		direction: { default: "column", invalidates: Invalidate.UPDATE },
		maxWidth: { invalidates: Invalidate.UPDATE },
		fontSize: { invalidates: Invalidate.UPDATE },
		progress: { invalidates: Invalidate.UPDATE },
		stages: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => stackChildren(ctx),
	update: (_changed, ctx) => stackChildren(ctx),
});

/** The stack's keys, each a size key kept by its index. */
function stackChildren(ctx: CompositeContext<SizeKeyStackProps>): SceneNode[] {
	const props = ctx.props;
	const keyProps = (key: SizeKey, index: number): Partial<SizeLegendProps> => {
		const stages = props.stages;
		const offset = props.offsets[index];
		return {
			scale: { maxValue: key.maxValue, range: key.range },
			values: props.values,
			format: props.format,
			at: {
				x: props.at.x + (offset?.x ?? 0),
				y: props.at.y - (offset?.y ?? 0),
			},
			direction: props.direction,
			maxWidth: props.maxWidth,
			title: sizeKeyTitle(key, index, props.title),
			fontSize: props.fontSize,
			progress: props.progress,
			transition:
				!stages || key.to === undefined || key.to === key.maxValue
					? undefined
					: {
							to: { maxValue: key.to, range: key.range },
							exit: stages.exit,
							update: stages.update,
							enter: stages.enter,
						},
			zIndex: props.zIndex,
			visible: props.visible,
		};
	};
	return ctx.list("keys", props.keys, {
		key: (_key, index) => index,
		create: (key, index) =>
			sizeLegend.create(keyProps(key, index) as SizeLegendProps),
		update: (node, key, index) => write(node, keyProps(key, index)),
	});
}

function sameScale(a: SizeScale, b: SizeScale): boolean {
	return (
		a.maxValue === b.maxValue &&
		(a.range === b.range ||
			(!!a.range && !!b.range && shallowEqual(a.range, b.range)))
	);
}
