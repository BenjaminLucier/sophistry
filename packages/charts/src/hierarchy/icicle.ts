/**
 * `icicle`: the partition layout as rectangles, one band per depth.
 *
 * Every band is one `rect` instance of one instances node, keyed by the
 * node's path of names; per-node picking, tooltips and drilling go through
 * `event.item`. The level-by-level reveal grows each rectangle from its
 * parent side (geometry). Names are `label` nodes, one per
 * rectangle whose name fits.
 */

import type { CompositeContext, RectProps, SceneNode } from "@sophistry/core";
import { defineComposite, rect } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import { clamp01 } from "@sophistry/core/internal";
import type { BatchItem } from "../batch";
import { createBatchedMark } from "../batch";
import type { RequiredUnless } from "../data/channels";
import type { HierarchyRect } from "../math/hierarchy";
import { partitionLayout } from "../math/hierarchy";
import { readableOn } from "../mix";
import type { AnyDatum } from "../props";
import { staggered } from "../stagger";
import type { HierarchyDrillProps } from "./drill";
import type { HierarchyChart } from "./frame";
import { createHierarchyChart } from "./frame";
import type { KeyedLabel } from "./labels";
import { createLabelMeasure, labelList } from "./labels";
import { hierarchyPropsDescriptor } from "./props";
import type {
	HierarchyChartBaseProps,
	HierarchyFocusSpec,
	HierarchyTransitionProps,
} from "./shared";
import {
	HIERARCHY_LABEL_FONT_SIZE,
	hierarchyOptionDeps,
	hierarchyOptions,
	labelPad,
	presenceOf,
	RECT_FIELDS,
	throughView,
} from "./shared";

const DEFAULT_INSET = 0.01;
const DEFAULT_STAGGER = 0.5;

/** @category Charts */
export interface IcicleBaseProps<T>
	extends HierarchyChartBaseProps<T>,
		HierarchyTransitionProps<T>,
		HierarchyDrillProps<T> {
	/** Width of the whole chart. */
	width: number;
	/** Height of the whole chart. */
	height: number;
	/** Centre of the chart. Defaults to the origin. */
	center?: Point;
	/**
	 * `"horizontal"`: the root is a column at the left, depth increasing to the right.
	 * `"vertical"`: the root is a row at the top, depth increasing downward.
	 * @default "horizontal"
	 */
	orientation?: "horizontal" | "vertical";
	/**
	 * Draw the root's band; `false` gives its room to the other levels.
	 * @default true
	 */
	root?: boolean;
	/**
	 * Gap left around each rectangle.
	 * @default 0.01
	 */
	inset?: number;
	/**
	 * Zoom into a node: it spans the whole breadth, its descendants fill the depth after it, and
	 * the rest fades away. A path of names below the root (`["a"]`), a predicate, or `{ from, to, t
	 * }` for a scrubbable transition. Given, the chart is controlled: taps only call
	 * `onFocusChange`. Defaults to the root.
	 */
	focus?: HierarchyFocusSpec<T>;
}

/**
 * Props of {@link icicle}: `value` is required unless the tree's nodes are numbers.
 *
 * @category Charts
 */
export type IcicleProps<T> = IcicleBaseProps<T> &
	RequiredUnless<T, number, "value">;

/** One rectangle, in scene units. */
interface BandItem extends BatchItem {
	key: string;
	/** The node's position in the whole layout. */
	position: number;
	center: Point;
	width: number;
	height: number;
	fill: string;
	opacity: number;
	/** Where its tooltip points. */
	at: Point;
}

interface IcicleState {
	chart: HierarchyChart<AnyDatum, HierarchyRect<AnyDatum>>;
	bands: ReturnType<
		typeof createBatchedMark<
			BandItem,
			RectProps,
			SceneNode<RectProps>,
			keyof RectProps
		>
	>;
	measure: ReturnType<typeof createLabelMeasure>;
}

const states = new WeakMap<object, IcicleState>();

function draw(
	ctx: CompositeContext<IcicleProps<AnyDatum>>,
	state: IcicleState,
): SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	const hideRoot = props.root === false;
	/** Unit layout: `x` is breadth, `y` is depth, both 0..1. */
	const frame = state.chart.frame(
		props,
		theme,
		(data) => partitionLayout(data, hierarchyOptions(props)),
		hierarchyOptionDeps(props),
		{
			/**
			 * The window onto the unit layout: a node's breadth, and depth from it
			 * (from the first drawn level, for the root) to the leaves.
			 */
			viewOf: (layout, position) => {
				const n = layout[position];
				if (!n) return { x0: 0, x1: 1, y0: 0, y1: 1 };
				const skip = n.depth === 0 && hideRoot;
				return { x0: n.x0, x1: n.x1, y0: skip ? n.y1 : n.y0, y1: 1 };
			},
		},
	);
	const { layout, keys, fills, zoom } = frame;
	const firstDepth = hideRoot ? 1 : 0;
	const levels = (layout[0]?.height ?? 0) + 1 - firstDepth;
	const vertical = props.orientation === "vertical";
	const left = (props.center?.x ?? 0) - props.width / 2;
	const top = (props.center?.y ?? 0) + props.height / 2;
	const fontSize = props.labelFontSize ?? HIERARCHY_LABEL_FONT_SIZE;
	const inset = props.inset ?? DEFAULT_INSET;
	const progress = props.progress ?? 1;
	const stagger = props.stagger ?? DEFAULT_STAGGER;
	const on = props.visible !== false;
	const v = zoom.view;
	const breadth = vertical ? props.width : props.height;
	const depth = vertical ? props.height : props.width;

	const items: BandItem[] = [];
	const texts: KeyedLabel[] = [];
	for (let position = firstDepth; position < layout.length; position++) {
		const node = layout[position] as (typeof layout)[number];
		if (node.depth < firstDepth) continue;
		const reveal = staggered(
			progress,
			node.depth - firstDepth,
			levels,
			stagger,
		);
		/** Present (1) inside the focused subtree, fading out of it. */
		const weight = zoom.weight(position) * presenceOf(node);
		const shown = on && reveal > 0 && weight > 0;
		if (!shown) continue;
		/** The node's full box through the zoom's window, in scene units. */
		const [x0, x1] = throughView(node.x0, node.x1, v.x0, v.x1);
		const [e0, e1] = throughView(node.y0, node.y1, v.y0, v.y1);
		const b0 = x0 * breadth;
		const b1 = x1 * breadth;
		const d0 = e0 * depth;
		const d1 = e1 * depth;
		if (!(b1 > b0 && d1 > d0)) continue;
		/** The revealed box, inset. */
		const grown = d0 + (d1 - d0) * clamp01(reveal);
		const box = vertical
			? {
					minX: left + b0 + inset,
					maxX: left + b1 - inset,
					maxY: top - d0 - inset,
					minY: Math.min(top - d0 - inset, top - grown + inset),
				}
			: {
					minX: left + d0 + inset,
					maxX: Math.max(left + d0 + inset, left + grown - inset),
					maxY: top - b0 - inset,
					minY: top - b1 + inset,
				};
		const fill = fills[position] ?? theme.palette.foreground;
		const faded = clamp01(reveal) * weight;
		items.push({
			key: keys[position] as string,
			position,
			center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
			width: Math.max(0, box.maxX - box.minX),
			height: Math.max(0, box.maxY - box.minY),
			fill,
			opacity: weight,
			at: { x: (box.minX + box.maxX) / 2, y: box.maxY },
		});
		if (props.labels === false || !node.label) continue;
		const pad = labelPad(fontSize);
		const along = d1 - d0 - 2 * inset;
		const across = b1 - b0 - 2 * inset;
		if (state.measure(node.label, fontSize, theme) + 2 * pad > along) continue;
		if (fontSize + 2 * pad > across) continue;
		texts.push({
			key: keys[position] as string,
			props: {
				text: node.label,
				...(vertical
					? { x: left + b0 + inset + pad, y: top - d0 - inset - pad }
					: { x: left + d0 + inset + pad, y: top - (b0 + b1) / 2 }),
				align: "left",
				baseline: vertical ? "top" : "middle",
				fontSize,
				color: readableOn(
					fill,
					theme.palette.foreground,
					theme.palette.background,
				),
				opacity: faded,
				zIndex: (props.zIndex ?? 0) + 1,
			},
		});
	}

	state.bands.update(items, {
		stroke: "none",
		fillOpacity: props.fillOpacity ?? 1,
		zIndex: props.zIndex ?? 0,
		...state.chart.interaction(
			`Icicle, ${items.length} nodes`,
			(item) => state.bands.itemAt(item)?.position,
			(item) => state.bands.itemAt(item)?.at,
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
		state.bands.node,
		...labelList(ctx, "labels", texts),
	];
	if (trail) out.push(trail);
	return out;
}

/**
 * An icicle chart: the partition layout as rectangles, one band per depth, each node spanning
 * exactly its children, sized by value. Lays itself out in a `width × height` box; reveals one
 * depth at a time from the root. Supports drill-down `focus` and keyed transitions. The
 * rectangles are one instances node (`event.item` picks a node). See {@link partitionLayout} for
 * the layout alone.
 *
 * @example
 * ```ts
 * import { icicle } from "@sophistry/charts";
 *
 * const files = {
 * 	name: "repo",
 * 	children: [
 * 		{ name: "src", children: [{ name: "index.ts", size: 12 }, { name: "chart.ts", size: 30 }] },
 * 		{ name: "README.md", size: 4 },
 * 	],
 * };
 * icicle.create({ data: files, value: "size", label: "name", width: 8, height: 4, orientation: "vertical" });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#hierarchies
 * @category Charts
 */
export const icicle = defineComposite<IcicleProps<AnyDatum>>({
	name: "Icicle",
	props: hierarchyPropsDescriptor<IcicleProps<AnyDatum>>([
		"width",
		"height",
		"center",
		"orientation",
		"root",
		"inset",
	]),
	setup: (ctx) => {
		const state: IcicleState = {
			chart: createHierarchyChart(ctx, RECT_FIELDS),
			bands: createBatchedMark<
				BandItem,
				RectProps,
				SceneNode<RectProps>,
				keyof RectProps
			>(rect as never, {
				channels: {
					center: (item) => item.center,
					width: (item) => item.width,
					height: (item) => item.height,
					fill: (item) => item.fill,
					opacity: (item) => item.opacity,
				},
			}),
			measure: createLabelMeasure(),
		};
		states.set(ctx.node, state);
		return draw(ctx, state);
	},
	update: (_changed, ctx) => draw(ctx, states.get(ctx.node) as IcicleState),
});
