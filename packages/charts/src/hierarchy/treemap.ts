/**
 * `treemap`: nested rectangles, each leaf's area proportional to its value.
 *
 * Every tile is one `rect` instance of one instances node, keyed by the
 * node's path of names (so a keyed transition or a data change keeps each
 * tile's item); per-tile picking, tooltips and drilling go through
 * `event.item`. Names are `text` nodes, one per tile whose name fits.
 */

import type { CompositeContext, RectProps, SceneNode } from "@sophistry/core";
import { defineComposite, rect } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import { clamp01 } from "@sophistry/core/internal";
import type { BatchItem } from "../batch.js";
import { createBatchedMark } from "../batch.js";
import type { RequiredUnless } from "../data/channels.js";
import type { HierarchyRect, TreemapTile } from "../math/hierarchy.js";
import { treemapLayout, treemapRows } from "../math/hierarchy.js";
import { readableOn } from "../mix.js";
import type { AnyDatum } from "../props.js";
import { staggered } from "../stagger.js";
import { keyedMemo } from "../util.js";
import type { HierarchyDrillProps } from "./drill.js";
import type { HierarchyChart } from "./frame.js";
import { createHierarchyChart } from "./frame.js";
import type { KeyedLabel } from "./labels.js";
import { createLabelMeasure, labelList } from "./labels.js";
import { hierarchyPropsDescriptor } from "./props.js";
import type {
	HierarchyChartBaseProps,
	HierarchyFocusSpec,
	HierarchyTransitionProps,
} from "./shared.js";
import {
	HIERARCHY_LABEL_FONT_SIZE,
	hierarchyOptionDeps,
	hierarchyOptions,
	labelPad,
	presenceOf,
	RECT_FIELDS,
	throughView,
} from "./shared.js";

const DEFAULT_PADDING = 0.03;
const DEFAULT_STAGGER = 0.5;
/** A parent tile's fill opacity, relative to `fillOpacity`: a tint behind its children. */
const GROUP_FILL_OPACITY = 0.25;

/** @category Charts */
export interface TreemapBaseProps<T>
	extends HierarchyChartBaseProps<T>,
		HierarchyTransitionProps<T>,
		HierarchyDrillProps<T> {
	/** Width of the whole treemap. */
	width: number;
	/** Height of the whole treemap. */
	height: number;
	/** Centre of the treemap. Defaults to the origin. */
	center?: Point;
	/**
	 * Tiling method. With a keyed transition (`to`), `"resquarify"` lays `to` out in `data`'s rows
	 * so every tile keeps its neighbours (no tiles cross mid-transition), at the cost of `blend =
	 * 1` not matching a fresh squarify of `to`.
	 * @default "squarify"
	 */
	tile?: TreemapTile;
	/**
	 * Gap between tiles, and between a group's edge and its tiles.
	 * @default 0.03
	 */
	padding?: number;
	/**
	 * Header strip at the top of every group, where its name is written when it fits. Defaults to
	 * `padding` (no header).
	 */
	paddingTop?: number;
	/**
	 * Zoom into a node: its tile fills the box while everything outside fades away. A path of names
	 * below the root (`["src"]`), a predicate, or `{ from, to, t }` for a scrubbable transition.
	 * Given, the chart is controlled: taps only call `onFocusChange`. Defaults to the root.
	 */
	focus?: HierarchyFocusSpec<T>;
}

/**
 * Props of {@link treemap}: `value` is required unless the tree's nodes are numbers.
 *
 * @category Charts
 */
export type TreemapProps<T> = TreemapBaseProps<T> &
	RequiredUnless<T, number, "value">;

/** One tile, in scene units. */
interface TileItem extends BatchItem {
	key: string;
	/** The node's position in the whole layout. */
	position: number;
	center: Point;
	width: number;
	height: number;
	fill: string;
	fillOpacity: number;
	opacity: number;
	/** Where its tooltip points. */
	at: Point;
}

interface TreemapState {
	chart: HierarchyChart<AnyDatum, HierarchyRect<AnyDatum>>;
	tiles: ReturnType<
		typeof createBatchedMark<
			TileItem,
			RectProps,
			SceneNode<RectProps>,
			keyof RectProps
		>
	>;
	keptRows: ReturnType<
		typeof keyedMemo<ReturnType<typeof treemapRows> | undefined>
	>;
	measure: ReturnType<typeof createLabelMeasure>;
}

const states = new WeakMap<object, TreemapState>();

function draw(
	ctx: CompositeContext<TreemapProps<AnyDatum>>,
	state: TreemapState,
): SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	const padding = props.padding ?? DEFAULT_PADDING;
	const options = {
		...hierarchyOptions(props),
		width: props.width,
		height: props.height,
		tile: props.tile,
		padding,
		paddingTop: props.paddingTop,
	};
	const optionDeps = [
		...hierarchyOptionDeps(props),
		props.width,
		props.height,
		props.tile,
		padding,
		props.paddingTop,
	];
	/** `"resquarify"` through a keyed transition: the rows `data` squarifies into, for `to`. */
	const keptRows = state.keptRows(
		[props.data, props.to !== undefined, ...optionDeps],
		() =>
			props.tile === "resquarify" && props.to !== undefined
				? treemapRows(props.data, options)
				: undefined,
	);
	const frame = state.chart.frame(
		props,
		theme,
		(data, end) =>
			treemapLayout(data, {
				...options,
				keepRows: end === "to" ? keptRows : undefined,
			}),
		[...optionDeps, keptRows],
		{
			/** The window onto the layout: a node's tile fills the box when focused. */
			viewOf: (layout, position) => {
				const n = layout[position];
				return n
					? { x0: n.x0, x1: n.x1, y0: n.y0, y1: n.y1 }
					: { x0: 0, x1: props.width, y0: 0, y1: props.height };
			},
		},
	);
	const { layout, keys, fills, zoom } = frame;
	/** The root's tile is the whole box: drawn only when it is the only node. */
	const skipped = layout[0] && !layout[0].leaf ? 1 : 0;
	const count = layout.length - skipped;
	const left = (props.center?.x ?? 0) - props.width / 2;
	const top = (props.center?.y ?? 0) + props.height / 2;
	const fontSize = props.labelFontSize ?? HIERARCHY_LABEL_FONT_SIZE;
	const header = props.paddingTop ?? padding;
	const v = zoom.view;
	/** The header strip's height through the zoom. */
	const headerHeight = header * (props.height / (v.y1 - v.y0 || 1));
	const progress = props.progress ?? 1;
	const stagger = props.stagger ?? DEFAULT_STAGGER;
	const fillOpacity = props.fillOpacity ?? 1;
	const on = props.visible !== false;

	const items: TileItem[] = [];
	const texts: KeyedLabel[] = [];
	for (let rank = 0; rank < count; rank++) {
		const position = rank + skipped;
		const node = layout[position] as (typeof layout)[number];
		const reveal = staggered(progress, rank, count, stagger);
		/** Present (1) inside the focused subtree, fading out of it. */
		const weight = zoom.weight(position) * presenceOf(node);
		const shown = on && reveal > 0 && weight > 0;
		if (!shown) continue;
		/** The tile through the zoom's window, clamped to the box. */
		const [x0, x1] = throughView(node.x0, node.x1, v.x0, v.x1);
		const [y0, y1] = throughView(node.y0, node.y1, v.y0, v.y1);
		const minX = left + x0 * props.width;
		const maxX = left + x1 * props.width;
		const maxY = top - y0 * props.height;
		const minY = top - y1 * props.height;
		const w = maxX - minX;
		const h = maxY - minY;
		if (!(w > 0 && h > 0)) continue;
		const faded = clamp01(reveal) * weight;
		const fill = fills[position] ?? theme.palette.foreground;
		items.push({
			key: keys[position] as string,
			position,
			center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
			width: w,
			height: h,
			fill,
			fillOpacity: fillOpacity * (node.leaf ? 1 : GROUP_FILL_OPACITY),
			opacity: faded,
			at: { x: (minX + maxX) / 2, y: maxY },
		});
		if (props.labels === false || !node.label) continue;
		const pad = labelPad(fontSize);
		const width = state.measure(node.label, fontSize, theme) + 2 * pad;
		let place: { x: number; y: number } | null = null;
		if (node.leaf) {
			if (width <= w && fontSize + 2 * pad <= h)
				place = { x: minX + pad, y: maxY - pad };
		} else if (width <= w && fontSize <= headerHeight) {
			place = { x: minX + pad, y: maxY - headerHeight / 2 };
		}
		if (!place) continue;
		texts.push({
			key: keys[position] as string,
			props: {
				text: node.label,
				x: place.x,
				y: place.y,
				align: "left",
				baseline: node.leaf ? "top" : "middle",
				fontSize,
				// A leaf's name reads on its fill, a group's on the background.
				color: node.leaf
					? readableOn(fill, theme.palette.foreground, theme.palette.background)
					: theme.palette.foreground,
				opacity: faded,
				zIndex: (props.zIndex ?? 0) + 1,
			},
		});
	}

	state.tiles.update(items, {
		stroke: "none",
		zIndex: props.zIndex ?? 0,
		...state.chart.interaction(
			`Treemap, ${items.length} tiles`,
			(item) => state.tiles.itemAt(item)?.position,
			(item) => state.tiles.itemAt(item)?.at,
		),
	} as never);
	const trail = state.chart.breadcrumbs({
		options: props.breadcrumbs,
		corner: { x: left, y: top },
		width: props.width,
		labelFontSize: fontSize,
		progress: props.progress,
		zIndex: props.zIndex,
		visible: props.visible,
	});
	const out: SceneNode[] = [
		state.tiles.node,
		...labelList(ctx, "labels", texts),
	];
	if (trail) out.push(trail);
	return out;
}

/**
 * A treemap: nested rectangles, each leaf's area proportional to its value, squarified by
 * default. Lays itself out in a `width × height` box; needs no `chart`. Leaves take their
 * top-level branch's colour; names are written where they fit. Supports drill-down `focus` and
 * keyed transitions. The tiles are one instances node (`event.item` picks a tile). See
 * {@link treemapLayout} for the layout alone.
 *
 * @example
 * ```ts
 * import { treemap } from "@sophistry/charts";
 *
 * const files = {
 * 	name: "repo",
 * 	children: [
 * 		{ name: "src", children: [{ name: "index.ts", size: 12 }, { name: "chart.ts", size: 30 }] },
 * 		{ name: "README.md", size: 4 },
 * 	],
 * };
 * treemap.create({ data: files, value: "size", label: "name", width: 8, height: 4, drill: true, tooltip: true });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#hierarchies
 * @category Charts
 */
export const treemap = defineComposite<TreemapProps<AnyDatum>>({
	name: "Treemap",
	props: hierarchyPropsDescriptor<TreemapProps<AnyDatum>>([
		"width",
		"height",
		"center",
		"tile",
		"padding",
		"paddingTop",
	]),
	setup: (ctx) => {
		const state: TreemapState = {
			chart: createHierarchyChart(ctx, RECT_FIELDS),
			tiles: createBatchedMark<
				TileItem,
				RectProps,
				SceneNode<RectProps>,
				keyof RectProps
			>(rect as never, {
				channels: {
					center: (item) => item.center,
					width: (item) => item.width,
					height: (item) => item.height,
					fill: (item) => item.fill,
					fillOpacity: (item) => item.fillOpacity,
					opacity: (item) => item.opacity,
				},
			}),
			keptRows: keyedMemo(),
			measure: createLabelMeasure(),
		};
		states.set(ctx.node, state);
		return draw(ctx, state);
	},
	update: (_changed, ctx) => draw(ctx, states.get(ctx.node) as TreemapState),
});
