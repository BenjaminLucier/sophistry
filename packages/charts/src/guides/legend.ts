/**
 * `legend`: a key to a chart's colours, a swatch and a name per entry.
 *
 * The nodes of an entry are kept for as long as the entry is listed (keyed
 * by its `key`, else its label) and hidden with `visible: false` when
 * not listed; the layout is measured once per change of the
 * entries, title or font, not as `progress` or a transition's stages move.
 */

import type {
	CircleProps,
	CompositeContext,
	LabelProps,
	LineProps,
	PolygonProps,
	RectProps,
	SceneNode,
} from "@sophistry/core";
import {
	circle,
	defineComposite,
	Invalidate,
	label,
	line,
	measuresText,
	polygon,
	rect,
} from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, Point } from "@sophistry/core/geometry";
import {
	cssColor,
	DEFAULT_FONT_WEIGHT,
	measureLabel,
} from "@sophistry/core/internal";
import type { LegendMark } from "../frame/types.js";
import type { LegendItemLayout, LegendLayout } from "../math/legend.js";
import { legendLayout } from "../math/legend.js";
import { symbolPolygon } from "../math/symbol.js";
import { staggered } from "../stagger.js";
import { deepEqual, keyedMemo, shallowEqual, stableValue } from "../util.js";
import { write } from "./nodes.js";

const DEFAULT_LEGEND_FONT_SIZE = 0.28;
/** Fraction of a legend's reveal spent staggering its entries in order. */
const LEGEND_STAGGER = 0.5;

/**
 * One legend entry.
 *
 * @category Charts
 */
export interface LegendEntry {
	/** The category this entry stands for, if any. */
	key?: BandKey;
	/** The entry's text. */
	label: string;
	/** The swatch's colour. */
	color: ColorInput;
	/** The swatch's shape. Defaults to a filled square. */
	mark?: LegendMark;
}

/**
 * A legend's keyed transition: the entries each end lists, and how far each stage has got.
 * `chart` passes one while a keyed transition runs.
 *
 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
 * @category Charts
 */
export interface LegendTransition {
	/** The keys of the entries listed at the start. An entry without a key is at both ends. */
	from: readonly BandKey[];
	/** The keys of the entries listed at the end. */
	to: readonly BandKey[];
	/** Progress of the exit stage, 0..1. */
	exit: number;
	/** Progress of the update stage, 0..1. */
	update: number;
	/** Progress of the enter stage, 0..1. */
	enter: number;
}

/**
 * Props for {@link legend}.
 *
 * @category Charts
 */
export interface LegendProps {
	/** The entries, in order. */
	entries: readonly LegendEntry[];
	/** The legend's top-left corner, in scene units. */
	at: Point;
	/**
	 * `"column"`: one entry per row. `"row"`: side by side, wrapping at `maxWidth`.
	 * @default "column"
	 */
	direction?: "column" | "row";
	/** With `direction: "row"`: wrap before an entry that would run past this width. */
	maxWidth?: number;
	/** A title line above the entries. */
	title?: string;
	/**
	 * Font size of the labels.
	 * @default 0.28
	 */
	fontSize?: number;
	/**
	 * Reveal, 0..1: the entries fade in one after another.
	 * @default 1
	 */
	progress?: number;
	/** A keyed data transition in progress. See {@link LegendTransition}. */
	transition?: LegendTransition;
	/** Paint order; higher draws later. */
	zIndex?: number;
	/** Set to `false` to hide the legend. */
	visible?: boolean;
}

/** Measurement options shared by {@link legend} and the frames that place one. */
export interface LegendMetrics {
	direction?: "column" | "row";
	maxWidth?: number;
	title?: string;
	fontSize?: number;
	fontFamily: string;
}

/** Whether any entry draws a stroke, so swatches get the wider line slot. */
function hasLine(entries: readonly LegendEntry[]): boolean {
	return entries.some((entry) => entry.mark?.line && !entry.mark.fill);
}

/**
 * Lays a legend out, its labels measured with the theme's font and swatches sized to it.
 *
 * @internal
 */
export function measureLegend(
	entries: readonly LegendEntry[],
	metrics: LegendMetrics,
): LegendLayout {
	const fontSize = metrics.fontSize ?? DEFAULT_LEGEND_FONT_SIZE;
	const style = {
		fontSize,
		fontFamily: metrics.fontFamily,
		fontWeight: DEFAULT_FONT_WEIGHT,
		italic: false,
		letterSpacing: 0,
	};
	return legendLayout(
		entries.map((entry) => measureLabel(entry.label, style).width),
		{
			direction: metrics.direction ?? "column",
			rowHeight: fontSize * 1.6,
			swatchWidth: fontSize * (hasLine(entries) ? 1.8 : 0.9),
			swatchGap: fontSize * 0.45,
			itemGap: fontSize * 1.2,
			maxWidth: metrics.maxWidth,
			titleWidth:
				metrics.title === undefined
					? undefined
					: measureLabel(metrics.title, style).width,
		},
	);
}

/** The nodes one entry draws: its swatch's parts, made when first needed, and its label. */
interface EntryNodes {
	rect?: SceneNode<RectProps>;
	line?: SceneNode<LineProps>;
	circle?: SceneNode<CircleProps>;
	polygon?: SceneNode<PolygonProps>;
	label: SceneNode<LabelProps>;
}

/** What a legend keeps between updates. */
interface LegendState {
	entries: (next: readonly LegendEntry[]) => readonly LegendEntry[];
	fromKeys: (
		next: readonly BandKey[] | undefined,
	) => readonly BandKey[] | undefined;
	toKeys: (
		next: readonly BandKey[] | undefined,
	) => readonly BandKey[] | undefined;
	layout: (deps: readonly unknown[], make: () => LegendLayout) => LegendLayout;
	fromItems: (
		deps: readonly unknown[],
		make: () => Map<LegendEntry, LegendItemLayout> | undefined,
	) => Map<LegendEntry, LegendItemLayout> | undefined;
	toItems: (
		deps: readonly unknown[],
		make: () => Map<LegendEntry, LegendItemLayout> | undefined,
	) => Map<LegendEntry, LegendItemLayout> | undefined;
	title: SceneNode<LabelProps> | undefined;
	nodes: Map<unknown, EntryNodes>;
}

/**
 * A key to a chart's colours: a swatch and a name per entry, each swatch showing the mark it
 * stands for. `chart` draws one automatically from its colour scale; use this directly for
 * charts without a frame or colours assigned by hand.
 *
 * @example
 * ```ts
 * import { legend } from "@sophistry/charts";
 *
 * legend.create({
 * 	at: { x: 3, y: 2 },
 * 	entries: [
 * 		{ label: "North", color: "tomato" },
 * 		{ label: "South", color: "steelblue", mark: { line: true, symbol: "circle" } },
 * 	],
 * });
 * ```
 *
 * @see https://sophistry.dev/guides/charts/#series-and-legends
 * @category Charts
 */
export const legend = defineComposite<LegendProps>({
	name: "Legend",
	props: {
		entries: { default: [], invalidates: Invalidate.UPDATE },
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
		const state: LegendState = {
			// Entries compared by value, so a frame passing equal new lists keeps the layout.
			entries: stableValue<readonly LegendEntry[]>(deepEqual),
			fromKeys: stableValue(sameKeys),
			toKeys: stableValue(sameKeys),
			layout: keyedMemo(),
			fromItems: keyedMemo(),
			toItems: keyedMemo(),
			title: undefined,
			nodes: new Map(),
		};
		states.set(ctx.node, state);
		return render(ctx, state);
	},
	update: (_changed, ctx) => render(ctx, states.get(ctx.node) as LegendState),
});

/** Each legend node's state, kept from `setup` for its updates. */
const states = new WeakMap<object, LegendState>();

/** Builds or updates a legend's nodes for its current props; returns them in paint order. */
function render(
	ctx: CompositeContext<LegendProps>,
	state: LegendState,
): SceneNode[] {
	const epoch = measuresText(ctx);
	const props = ctx.props;
	const theme = ctx.theme;
	const fontFamily = theme.defaults.fontFamily;
	const fontSize = props.fontSize ?? DEFAULT_LEGEND_FONT_SIZE;
	const entries = state.entries(props.entries);
	const metrics: LegendMetrics = {
		direction: props.direction,
		maxWidth: props.maxWidth,
		title: props.title,
		fontSize: props.fontSize,
		fontFamily,
	};
	const metricDeps = [
		props.direction,
		props.maxWidth,
		props.title,
		props.fontSize,
		fontFamily,
		epoch,
	];
	const layout = state.layout([entries, ...metricDeps], () =>
		measureLegend(entries, metrics),
	);
	/** During a transition, each end's own layout, re-measured only when the lists change. */
	const endLayout = (keys: readonly BandKey[] | undefined) => {
		if (!keys) return undefined;
		const listed = new Set(keys);
		const listedEntries = entries.filter(
			(entry) => entry.key === undefined || listed.has(entry.key),
		);
		const own = measureLegend(listedEntries, metrics);
		const items = new Map<LegendEntry, LegendItemLayout>();
		listedEntries.forEach((entry, i) => {
			const item = own.items[i];
			if (item) items.set(entry, item);
		});
		return items;
	};
	const run = props.transition;
	const fromKeys = state.fromKeys(run?.from);
	const toKeys = state.toKeys(run?.to);
	const fromItems = state.fromItems([fromKeys, entries, ...metricDeps], () =>
		endLayout(fromKeys),
	);
	const toItems = state.toItems([toKeys, entries, ...metricDeps], () =>
		endLayout(toKeys),
	);
	const shownAtAll = props.visible !== false;
	const reveal = (index: number) =>
		staggered(props.progress ?? 1, index, entries.length, LEGEND_STAGGER);
	const at = props.at;
	const offset = (p: Point): Point => ({ x: at.x + p.x, y: at.y + p.y });
	const zIndex = props.zIndex;
	const children: SceneNode[] = [];

	// The title: an end listing no entry has no legend, so the title fades with the exits or enters.
	if (props.title !== undefined && layout.title) {
		let presence = 1;
		if (run) {
			const a = (fromItems?.size ?? 0) > 0;
			const b = (toItems?.size ?? 0) > 0;
			presence = a === b ? (a ? 1 : 0) : a ? 1 - run.exit : run.enter;
		}
		const shown = reveal(0) * Math.max(0, Math.min(1, presence));
		const place = offset(layout.title);
		const next: Partial<LabelProps> = {
			text: props.title,
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

	const swatchWidth = fontSize * (hasLine(entries) ? 1.8 : 0.9);
	const square = fontSize * 0.8;
	const seen = new Map<unknown, EntryNodes>();
	entries.forEach((entry, index) => {
		const key = entryKey(entry, index, seen);
		// Where the entry stands and how present it is, mid-transition.
		const own = layout.items[index];
		const a = fromItems?.get(entry);
		const b = toItems?.get(entry);
		let item: LegendItemLayout | undefined;
		let presence: number;
		if (!run || (!a && !b)) {
			item = own;
			presence = run ? 0 : 1;
		} else if (a && b) {
			item = mixItem(a, b, run.update);
			presence = 1;
		} else if (a) {
			item = a;
			presence = 1 - run.exit;
		} else {
			item = b;
			presence = run.enter;
		}
		const shown = reveal(index) * Math.max(0, Math.min(1, presence));
		const visible = shownAtAll && shown > 0 && item !== undefined;
		const swatch = offset(item?.swatch ?? { x: 0, y: 0 });
		const labelAt = offset(item?.label ?? { x: 0, y: 0 });
		const color = cssColor(entry.color);
		const mark = entry.mark ?? { fill: true };
		const markerRadius = fontSize * (mark.line ? 0.24 : 0.3);
		const labelProps: Partial<LabelProps> = {
			text: entry.label,
			x: labelAt.x,
			y: labelAt.y,
			align: "left",
			fontSize,
			color: theme.palette.foreground,
			opacity: shown,
			zIndex,
			visible,
		};
		let nodes = state.nodes.get(key);
		if (nodes) write(nodes.label, labelProps);
		else nodes = { label: label.create(labelProps as LabelProps) };
		seen.set(key, nodes);

		if (mark.fill) {
			const next: Partial<RectProps> = {
				center: swatch,
				width: square,
				height: square,
				cornerRadius: square * 0.15,
				fill: color,
				stroke: "none",
				opacity: shown,
				zIndex,
				visible,
			};
			if (nodes.rect) write(nodes.rect, next);
			else nodes.rect = rect.create(next as RectProps);
			children.push(nodes.rect);
		} else {
			nodes.rect = drop(nodes.rect);
		}
		if (!mark.fill && mark.line) {
			const next: Partial<LineProps> = {
				from: { x: swatch.x - swatchWidth / 2, y: swatch.y },
				to: { x: swatch.x + swatchWidth / 2, y: swatch.y },
				stroke: color,
				// Drawn on and faded together: barely begun, a round-capped
				// stroke alone would read as a dot.
				opacity: shown,
				progress: shown,
				zIndex,
				visible,
			};
			if (nodes.line) write(nodes.line, next);
			else nodes.line = line.create(next as LineProps);
			children.push(nodes.line);
		} else {
			nodes.line = drop(nodes.line);
		}
		const symbol = mark.fill ? undefined : mark.symbol;
		if (symbol === "circle") {
			const next: Partial<CircleProps> = {
				center: swatch,
				radius: markerRadius,
				fill: color,
				stroke: "none",
				opacity: shown,
				zIndex,
				visible,
			};
			if (nodes.circle) write(nodes.circle, next);
			else nodes.circle = circle.create(next as CircleProps);
			children.push(nodes.circle);
		} else {
			nodes.circle = drop(nodes.circle);
		}
		if (symbol && symbol !== "circle") {
			const next: Partial<PolygonProps> = {
				points: symbolPolygon(symbol, swatch.x, swatch.y, markerRadius),
				fill: color,
				stroke: "none",
				opacity: shown,
				zIndex,
				visible,
			};
			if (nodes.polygon) write(nodes.polygon, next);
			else nodes.polygon = polygon.create(next as PolygonProps);
			children.push(nodes.polygon);
		} else {
			nodes.polygon = drop(nodes.polygon);
		}
		children.push(nodes.label);
	});
	// Entries no longer listed: left out of the returned children, their nodes are disposed.
	state.nodes = seen;
	return children;
}

/** An entry's identity across updates: its key, else its label (made unique by position). */
function entryKey(
	entry: LegendEntry,
	index: number,
	seen: Map<unknown, unknown>,
): unknown {
	const key =
		entry.key !== undefined
			? `key:${String(entry.key)}`
			: `label:${entry.label}`;
	return seen.has(key) ? `${key}#${index}` : key;
}

/** Forgets a swatch part the entry no longer draws (left out of the children, it is disposed). */
function drop(_node: SceneNode | undefined): undefined {
	return undefined;
}

/** Two key lists (or none) compared by value. */
function sameKeys(
	a: readonly BandKey[] | undefined,
	b: readonly BandKey[] | undefined,
): boolean {
	return a === b || (!!a && !!b && shallowEqual(a, b));
}

/** An entry's layout blended from `a` to `b` by `t`. */
function mixItem(
	a: LegendItemLayout,
	b: LegendItemLayout,
	t: number,
): LegendItemLayout {
	if (t <= 0) return a;
	if (t >= 1) return b;
	const at = (p: Point, q: Point): Point => ({
		x: p.x + (q.x - p.x) * t,
		y: p.y + (q.y - p.y) * t,
	});
	return { swatch: at(a.swatch, b.swatch), label: at(a.label, b.label) };
}
