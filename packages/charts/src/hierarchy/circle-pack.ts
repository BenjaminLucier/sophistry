/**
 * `circlePack`: every leaf a disc, packed inside its parent's circle.
 *
 * Every circle is one `circle` instance of one instances node, keyed by the
 * node's path of names, with its own fill, fill opacity and stroke (groups
 * are tinted and outlined, leaves filled); per-node picking, tooltips and
 * drilling go through `event.item`. Circles grow from their centres
 * (radius). While zoomed, the node and the leaf names sit in
 * a `group` clipped to the root's disc. Names are `text` nodes, one per
 * leaf whose name fits.
 */

import type {
	CircleProps,
	CompositeContext,
	GroupProps,
	SceneNode,
} from "@sophistry/core";
import { circle, defineComposite, group } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import { circlePolyline } from "@sophistry/core/geometry";
import { clamp01 } from "@sophistry/core/internal";
import type { BatchItem } from "../batch.js";
import { createBatchedMark } from "../batch.js";
import type { RequiredUnless } from "../data/channels.js";
import type { HierarchyCircle } from "../math/hierarchy.js";
import { packLayout } from "../math/hierarchy.js";
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
	CIRCLE_FIELDS,
	HIERARCHY_LABEL_FONT_SIZE,
	hierarchyOptionDeps,
	hierarchyOptions,
	labelPad,
	presenceOf,
	smoothZoomView,
} from "./shared.js";

const DEFAULT_PADDING = 0.03;
const DEFAULT_STAGGER = 0.5;
/** A parent circle's fill opacity, relative to `fillOpacity`. */
const GROUP_FILL_OPACITY = 0.15;
const GROUP_STROKE_WIDTH = 0.015;
/** Segments of the root disc that clips a zoom. */
const CLIP_SEGMENTS = 128;

/** @category Charts */
export interface CirclePackBaseProps<T>
	extends HierarchyChartBaseProps<T>,
		HierarchyTransitionProps<T>,
		HierarchyDrillProps<T> {
	/** Centre of the chart. Defaults to the origin. */
	center?: Point;
	/**
	 * Radius of the root circle.
	 * @default 1
	 */
	radius?: number;
	/**
	 * Gap between sibling circles and their parent's rim.
	 * @default 0.03
	 */
	padding?: number;
	/**
	 * Draw the root's circle.
	 * @default true
	 */
	root?: boolean;
	/**
	 * Zoom into a node: its circle grows to fill the root's while the rest fades away along a
	 * smooth zoom path. A path of names below the root (`["a"]`), a predicate, or `{ from, to, t }`
	 * for a scrubbable transition. Given, the chart is controlled: taps only call `onFocusChange`.
	 * Defaults to the root.
	 */
	focus?: HierarchyFocusSpec<T>;
}

/**
 * Props of {@link circlePack}: `value` is required unless the tree's nodes are numbers.
 *
 * @category Charts
 */
export type CirclePackProps<T> = CirclePackBaseProps<T> &
	RequiredUnless<T, number, "value">;

/** One circle, in scene units. */
interface DiscItem extends BatchItem {
	key: string;
	/** The node's position in the whole layout. */
	position: number;
	center: Point;
	radius: number;
	fill: string;
	fillOpacity: number;
	stroke: string;
	strokeWidth: number;
	opacity: number;
	/** Where its tooltip points. */
	at: Point;
}

interface CirclePackState {
	chart: HierarchyChart<AnyDatum, HierarchyCircle<AnyDatum>>;
	discs: ReturnType<
		typeof createBatchedMark<
			DiscItem,
			CircleProps,
			SceneNode<CircleProps>,
			keyof CircleProps
		>
	>;
	/** The clipping group, made once. */
	clipGroup: SceneNode<GroupProps> & {
		setChildren(children: readonly SceneNode[]): void;
	};
	clip: ReturnType<typeof keyedMemo<Point[] | undefined>>;
	measure: ReturnType<typeof createLabelMeasure>;
}

const states = new WeakMap<object, CirclePackState>();

function draw(
	ctx: CompositeContext<CirclePackProps<AnyDatum>>,
	state: CirclePackState,
): SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	const r = props.radius ?? 1;
	const size = 2 * r;
	const padding = props.padding ?? DEFAULT_PADDING;
	const frame = state.chart.frame(
		props,
		theme,
		(data) => packLayout(data, { ...hierarchyOptions(props), size, padding }),
		[...hierarchyOptionDeps(props), size, padding],
		{
			/** The window onto the layout: a node's circle's box, blended along a smooth zoom path. */
			viewOf: (layout, position) => {
				const n = layout[position];
				return n
					? { x0: n.x - n.r, x1: n.x + n.r, y0: n.y - n.r, y1: n.y + n.r }
					: { x0: 0, x1: size, y0: 0, y1: size };
			},
			blend: smoothZoomView,
		},
	);
	const { layout, keys, fills, zoom } = frame;
	const firstDepth = props.root === false ? 1 : 0;
	const levels = (layout[0]?.height ?? 0) + 1 - firstDepth;
	const cx = props.center?.x ?? 0;
	const cy = props.center?.y ?? 0;
	const left = cx - r;
	const top = cy + r;
	const fontSize = props.labelFontSize ?? HIERARCHY_LABEL_FONT_SIZE;
	const progress = props.progress ?? 1;
	const stagger = props.stagger ?? DEFAULT_STAGGER;
	const fillOpacity = props.fillOpacity ?? 1;
	const on = props.visible !== false;
	/** Layout units → scene units through the window. */
	const v = zoom.view;
	const k = size / (v.x1 - v.x0 || 1);
	/** Zoomed anywhere but the root (or between): what slides out is clipped to the root's circle. */
	const off = 1e-9 * size;
	const zoomed =
		Math.abs(v.x0) > off ||
		Math.abs(v.y0) > off ||
		Math.abs(v.x1 - size) > off ||
		Math.abs(v.y1 - size) > off;
	const clip = state.clip([zoomed, cx, cy, r], () =>
		zoomed
			? circlePolyline(cx, cy, r + GROUP_STROKE_WIDTH, CLIP_SEGMENTS)
			: undefined,
	);

	const items: DiscItem[] = [];
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
		const fill = fills[position] ?? theme.palette.foreground;
		/** The circle through the zoom, in scene units. */
		const x = left + (node.x - v.x0) * k;
		const y = top - (node.y - v.y0) * k;
		const radius = node.r * k;
		items.push({
			key: keys[position] as string,
			position,
			center: { x, y },
			radius: radius * clamp01(reveal),
			fill: node.depth === 0 ? theme.palette.muted : fill,
			...(node.leaf
				? { fillOpacity, stroke: "none", strokeWidth: 0 }
				: {
						fillOpacity: fillOpacity * GROUP_FILL_OPACITY,
						stroke: node.depth === 0 ? theme.palette.muted : fill,
						strokeWidth: GROUP_STROKE_WIDTH,
					}),
			opacity: weight,
			at: { x, y: y + radius },
		});
		if (props.labels === false || !node.label || !node.leaf) continue;
		const width =
			state.measure(node.label, fontSize, theme) + 2 * labelPad(fontSize);
		const diameter = 2 * radius;
		if (width > diameter || fontSize * 1.2 > diameter) continue;
		texts.push({
			key: keys[position] as string,
			props: {
				text: node.label,
				x,
				y,
				fontSize,
				color: readableOn(
					fill,
					theme.palette.foreground,
					theme.palette.background,
				),
				opacity: clamp01(reveal) * weight,
				zIndex: (props.zIndex ?? 0) + 1,
			},
		});
	}

	state.discs.update(items, {
		zIndex: props.zIndex ?? 0,
		...state.chart.interaction(
			`Circle pack, ${items.length} circles`,
			(item) => state.discs.itemAt(item)?.position,
			(item) => state.discs.itemAt(item)?.at,
		),
	} as never);
	state.clipGroup.update({ clip });
	state.clipGroup.setChildren([
		state.discs.node,
		...labelList(ctx, "labels", texts),
	]);
	const trail = state.chart.breadcrumbs({
		options: props.breadcrumbs,
		corner: { x: left, y: top },
		width: 2 * r,
		labelFontSize: fontSize,
		progress: props.progress,
		zIndex: props.zIndex,
		visible: props.visible,
	});
	return trail ? [state.clipGroup, trail] : [state.clipGroup];
}

/**
 * Circle packing: every leaf a disc with area proportional to its value, packed inside its
 * parent's circle. Draws in scene units; circles grow from their centres, parents first.
 * Supports drill-down `focus` and keyed transitions. The circles are one instances node
 * (`event.item` picks a circle). See {@link packLayout} for the layout alone.
 *
 * @example
 * ```ts
 * import { circlePack } from "@sophistry/charts";
 *
 * const files = {
 * 	name: "repo",
 * 	children: [
 * 		{ name: "src", children: [{ name: "index.ts", size: 12 }, { name: "chart.ts", size: 30 }] },
 * 		{ name: "README.md", size: 4 },
 * 	],
 * };
 * circlePack.create({ data: files, value: "size", label: "name", radius: 2, drill: true });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#hierarchies
 * @category Charts
 */
export const circlePack = defineComposite<CirclePackProps<AnyDatum>>({
	name: "CirclePack",
	props: hierarchyPropsDescriptor<CirclePackProps<AnyDatum>>([
		"center",
		"radius",
		"padding",
		"root",
	]),
	setup: (ctx) => {
		const state: CirclePackState = {
			chart: createHierarchyChart(ctx, CIRCLE_FIELDS),
			discs: createBatchedMark<
				DiscItem,
				CircleProps,
				SceneNode<CircleProps>,
				keyof CircleProps
			>(circle as never, {
				channels: {
					center: (item) => item.center,
					radius: (item) => item.radius,
					fill: (item) => item.fill,
					fillOpacity: (item) => item.fillOpacity,
					stroke: (item) => item.stroke,
					strokeWidth: (item) => item.strokeWidth,
					opacity: (item) => item.opacity,
				},
			}),
			clipGroup: group.create({}) as CirclePackState["clipGroup"],
			clip: keyedMemo(),
			measure: createLabelMeasure(),
		};
		states.set(ctx.node, state);
		return draw(ctx, state);
	},
	update: (_changed, ctx) => draw(ctx, states.get(ctx.node) as CirclePackState),
});
