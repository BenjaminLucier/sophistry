/**
 * `sankey`: quantities flowing between stages.
 *
 * The flows are one path batch: each ribbon a closed ring with its own fill
 * (its source's, target's or own colour), the fill opacity shared; per-flow
 * picking and tooltips go through `event.item`. The node bars are `rect`
 * instances of one instances node, keyed by node id. The left-to-right draw
 * of a flow cuts its ring (`sankeyRibbon`'s `t`). Node names
 * are `label` nodes placed beside their bars: outside the diagram for the first and last
 * columns, right of the bar (with a halo over the flows) for the others.
 */

import type {
	CompositeContext,
	PathBatchItem,
	PathBatchItemsProps,
	PathBatchNode,
	RectProps,
	SceneNode,
} from "@sophistry/core";
import {
	defineComposite,
	Invalidate,
	LEFT,
	pathBatch,
	RIGHT,
	rect,
} from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { Point } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import {
	anchoredLabelProps,
	clamp01,
	cssColor,
} from "@sophistry/core/internal";
import type { BatchItem } from "../batch.js";
import { createBatchedMark } from "../batch.js";
import type {
	Channel,
	ColorChannel,
	RequiredUnless,
} from "../data/channels.js";
import {
	identity,
	numberValues,
	resolveChannel,
	resolveColor,
} from "../data/channels.js";
import { itemTooltipHandlers } from "../item-tooltip.js";
import type {
	SankeyAlign,
	SankeyId,
	SankeyLayout,
	SankeyLink,
	SankeyNode,
} from "../math/sankey.js";
import { sankeyLayout, sankeyRibbon } from "../math/sankey.js";
import type { AnyDatum } from "../props.js";
import { staggered } from "../stagger.js";
import type { TooltipSpec, TooltipState } from "../tooltip.js";
import { tooltipText } from "../tooltip.js";
import type { KeyedLabel } from "./labels.js";
import { labelList } from "./labels.js";
import { createOwnTooltip } from "./own-tooltip.js";

const DEFAULT_NODE_WIDTH = 0.2;
const DEFAULT_NODE_PADDING = 0.2;
const DEFAULT_LINK_OPACITY = 0.35;
const DEFAULT_LABEL_FONT_SIZE = 0.24;
const LABEL_GAP = 0.1;
/** Points per ribbon edge. */
const RIBBON_SAMPLES = 32;
/** Share of `progress` spent revealing the nodes before any flow draws. */
const NODE_SHARE = 0.3;
/** Fraction of the node reveal spent staggering column after column. */
const NODE_STAGGER = 0.5;

/** @category Charts */
export interface SankeyBaseProps<L, N> {
	/** The flows: one ribbon per datum. */
	data: readonly L[];
	/** The node a flow leaves. */
	source: Channel<L, SankeyId>;
	/** The node a flow enters. */
	target: Channel<L, SankeyId>;
	/** The flow's size; non-finite and negative values draw nothing. */
	value: Channel<L, number>;
	/**
	 * The nodes, in the order they are stacked and coloured. Every id a link names must be here
	 * (else throws). Defaults to the links' endpoints in first-seen order.
	 */
	nodes?: readonly N[];
	/**
	 * A node's id, matched against `source`/`target`. Defaults to the datum itself, when `nodes` is
	 * `(string | number)[]`.
	 */
	nodeId?: Channel<N, SankeyId>;
	/** The text beside a node. Defaults to its id. */
	nodeLabel?: Channel<N, string>;
	/** Width of the diagram, nodes included; labels may overhang it. */
	width: number;
	/** Height of the diagram. */
	height: number;
	/** Centre of the diagram. Defaults to the origin. */
	center?: Point;
	/**
	 * Width of each node bar.
	 * @default 0.2
	 */
	nodeWidth?: number;
	/**
	 * Gap between nodes in a column.
	 * @default 0.2
	 */
	nodePadding?: number;
	/**
	 * How nodes are assigned to columns; see {@link SankeyAlign}.
	 * @default "justify"
	 */
	align?: SankeyAlign;
	/**
	 * Relaxation passes of the layout.
	 * @default 6
	 */
	iterations?: number;
	/** Node colours, cycled by node order. Defaults to the theme's categorical colours. */
	colors?: readonly ColorInput[];
	/**
	 * A flow's colour: its `"source"` node's, its `"target"` node's, or a colour channel of its
	 * own.
	 * @default "source"
	 */
	linkColor?: "source" | "target" | ColorChannel<L>;
	/**
	 * Fill opacity of the flows, 0..1.
	 * @default 0.35
	 */
	linkOpacity?: number;
	/**
	 * Draw node labels.
	 * @default true
	 */
	labels?: boolean;
	/**
	 * Font size of node labels.
	 * @default 0.24
	 */
	labelFontSize?: number;
	/**
	 * Reveal, 0..1: nodes appear column by column, then the flows draw left to right.
	 * @default 1
	 * @see https://sophistry.dev/guides/chart-animation/#reveals
	 */
	progress?: number;
	/**
	 * Hover tooltip: `true` shows "A → B: value" on a flow and "name: value" on a node; a function
	 * replaces the flow text.
	 */
	tooltip?: TooltipSpec<L>;
	/** Paint order of the flows; nodes paint above them. */
	zIndex?: number;
	visible?: boolean;
}

/**
 * Props of {@link sankey}: `nodeId` is required when `nodes` holds records.
 *
 * @category Charts
 */
export type SankeyProps<L, N = SankeyId> = SankeyBaseProps<L, N> &
	RequiredUnless<N, SankeyId, "nodeId">;

/** One node bar, in scene units. */
interface BarItem extends BatchItem {
	key: SankeyId;
	node: SankeyNode;
	center: Point;
	width: number;
	height: number;
	fill: string;
	opacity: number;
}

interface SankeyState {
	tooltipOf: ReturnType<typeof createOwnTooltip>;
	tooltip: TooltipState | null;
	nodeList: (
		nodes: readonly unknown[] | undefined,
		nodeId: unknown,
		nodeLabel: unknown,
	) => { ids: SankeyId[]; labels: Map<SankeyId, string> } | undefined;
	layout: (...args: unknown[]) => SankeyLayout;
	ribbons: PathBatchNode<PathBatchItemsProps>;
	bars: ReturnType<
		typeof createBatchedMark<
			BarItem,
			RectProps,
			SceneNode<RectProps>,
			keyof RectProps
		>
	>;
	/** Last update's ribbon per flow, reused while its inputs hold. */
	kept: Map<
		number,
		{ layout: SankeyLayout; t: number; fill: string; item: PathBatchItem }
	>;
	/** The drawn flows, in item order. */
	drawnLinks: SankeyLink[];
	current: {
		props: SankeyProps<AnyDatum, AnyDatum>;
		layout: SankeyLayout;
		names: Map<SankeyId, string> | undefined;
	};
	ribbonHandlers: ReturnType<typeof itemTooltipHandlers> | null;
	barHandlers: ReturnType<typeof itemTooltipHandlers> | null;
}

const states = new WeakMap<object, SankeyState>();

function draw(
	ctx: CompositeContext<SankeyProps<AnyDatum, AnyDatum>>,
	state: SankeyState,
): SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	const tooltip = state.tooltipOf(ctx);
	if (tooltip !== state.tooltip) {
		state.tooltip = tooltip;
		state.ribbonHandlers = itemTooltipHandlers(
			tooltip,
			(item) => flowText(state, item),
			(item) => flowAnchor(state, item),
			() => undefined,
		);
		state.barHandlers = itemTooltipHandlers(
			tooltip,
			(item) => barText(state, item),
			(item) => {
				const own = state.bars.itemAt(item);
				return own
					? toSceneOf(state.current.props)(
							(own.node.x0 + own.node.x1) / 2,
							own.node.y0,
						)
					: undefined;
			},
			() => undefined,
		);
	}
	/** Node ids and labels from `nodes`, or undefined to infer them from the links. */
	const nodeList = state.nodeList(props.nodes, props.nodeId, props.nodeLabel);
	const layout = state.layout(
		props.data,
		props.source,
		props.target,
		props.value,
		nodeList,
		props.width,
		props.height,
		props.nodeWidth,
		props.nodePadding,
		props.align,
		props.iterations,
	);
	state.current = { props, layout, names: nodeList?.labels };
	const toScene = toSceneOf(props);
	const palette = props.colors ?? theme.palette.series;
	const nodeColor = (index: number): string =>
		cssColor(
			palette.length === 0
				? theme.palette.foreground
				: (palette[index % palette.length] as ColorInput),
		);
	const linkSpec = props.linkColor;
	const ownLinkColor =
		linkSpec === undefined || linkSpec === "source" || linkSpec === "target"
			? undefined
			: resolveColor(linkSpec);
	const linkColor = (link: SankeyLink): string => {
		if (linkSpec === undefined || linkSpec === "source")
			return nodeColor(link.source);
		if (linkSpec === "target") return nodeColor(link.target);
		return (
			ownLinkColor?.(props.data[link.index], link.index) ??
			nodeColor(link.source)
		);
	};
	const progress = props.progress ?? 1;
	const on = props.visible !== false;

	/** One flow's own reveal: source column after source column, as one sweep. */
	const sweep = clamp01((progress - NODE_SHARE) / (1 - NODE_SHARE));
	const count = Math.max(1, layout.columns - 1);
	const ribbons: PathBatchItem[] = [];
	const drawnLinks: SankeyLink[] = [];
	const kept = new Map<
		number,
		{ layout: SankeyLayout; t: number; fill: string; item: PathBatchItem }
	>();
	for (const link of layout.links) {
		const rank = layout.nodes[link.source]?.depth ?? 0;
		const t = staggered(sweep, rank, count, (count - 1) / count);
		if (!(on && link.width > 0 && t > 0)) continue;
		const fill = linkColor(link);
		const previous = state.kept.get(link.index);
		let item: PathBatchItem;
		if (
			previous &&
			previous.layout === layout &&
			previous.t === t &&
			previous.fill === fill
		) {
			item = previous.item;
		} else {
			const source = layout.nodes[link.source] as SankeyNode;
			const target = layout.nodes[link.target] as SankeyNode;
			const ring = sankeyRibbon(
				source.x1,
				link.y0,
				target.x0,
				link.y1,
				link.width,
				{
					t,
					samples: RIBBON_SAMPLES,
				},
			).map((p) => toScene(p.x, p.y));
			item = { polylines: [ring], closed: true, fill };
		}
		kept.set(link.index, { layout, t, fill, item });
		ribbons.push(item);
		drawnLinks.push(link);
	}
	state.kept = kept;
	state.drawnLinks = drawnLinks;

	/** One node's own reveal: columns one after another over the first share. */
	const nodeT = (node: SankeyNode) =>
		staggered(
			clamp01(progress / NODE_SHARE),
			node.depth,
			layout.columns,
			NODE_STAGGER,
		);
	const bars: BarItem[] = [];
	const texts: KeyedLabel[] = [];
	const fontSize = props.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE;
	for (const node of on ? layout.nodes : []) {
		const t = nodeT(node);
		bars.push({
			key: node.id,
			node,
			center: toScene((node.x0 + node.x1) / 2, (node.y0 + node.y1) / 2),
			width: node.x1 - node.x0,
			height: (node.y1 - node.y0) * t,
			fill: nodeColor(node.index),
			opacity: t,
		});
		if (props.labels === false) continue;
		// The edge columns are labelled on their outer side, clear of every
		// band; an inner column beside its bar, over its outgoing flows, so
		// there the name gets a halo to stay legible.
		const first = node.depth === 0;
		const last = node.depth === layout.columns - 1 && layout.columns > 1;
		const outward = first ? LEFT : RIGHT;
		texts.push({
			key: node.id,
			props: anchoredLabelProps(
				{
					text: nameOf(state, node),
					at: toScene(first ? node.x0 : node.x1, (node.y0 + node.y1) / 2),
					direction: first || last ? outward : RIGHT,
					gap: LABEL_GAP,
					fontSize,
					color: theme.palette.foreground,
					opacity: t,
					zIndex: (props.zIndex ?? 0) + 2,
					halo: first || last ? undefined : true,
				},
				theme.defaults.fontFamily,
			),
		});
	}

	const tips = props.tooltip !== undefined && props.tooltip !== false;
	const ribbonTips = tips ? state.ribbonHandlers : null;
	state.ribbons.update({
		items: ribbons,
		stroke: "none",
		fillOpacity: props.linkOpacity ?? DEFAULT_LINK_OPACITY,
		zIndex: props.zIndex ?? 0,
		label: ribbonTips ? `Sankey flows, ${ribbons.length}` : undefined,
		itemLabel: ribbonTips?.itemLabel,
		onEnter: ribbonTips?.onEnter,
		onLeave: ribbonTips?.onLeave,
		onTap: ribbonTips?.onTap,
	} as never);
	const barTips = props.tooltip ? state.barHandlers : null;
	state.bars.update(bars, {
		stroke: "none",
		zIndex: (props.zIndex ?? 0) + 1,
		label: barTips ? `Sankey nodes, ${bars.length}` : undefined,
		itemLabel: barTips?.itemLabel,
		onEnter: barTips?.onEnter,
		onLeave: barTips?.onLeave,
		onTap: barTips?.onTap,
	} as never);
	return [state.ribbons, state.bars.node, ...labelList(ctx, "labels", texts)];
}

/** Layout box (y down, origin top-left) → scene (y up). */
function toSceneOf(props: { center?: Point; width: number; height: number }) {
	const cx = props.center?.x ?? 0;
	const cy = props.center?.y ?? 0;
	return (x: number, y: number): Point => ({
		x: cx - props.width / 2 + x,
		y: cy + props.height / 2 - y,
	});
}

function nameOf(state: SankeyState, node: SankeyNode | undefined): string {
	return node === undefined
		? ""
		: (state.current.names?.get(node.id) ?? String(node.id));
}

/** A drawn flow's tooltip: "A → B: value", or the `tooltip` prop's own. */
function flowText(state: SankeyState, item: number) {
	const link = state.drawnLinks[item];
	if (!link) return undefined;
	const { props, layout } = state.current;
	return tooltipText(
		props.tooltip,
		() =>
			`${nameOf(state, layout.nodes[link.source])} → ${nameOf(state, layout.nodes[link.target])}: ${formatTick(link.value)}`,
		props.data[link.index],
		link.index,
	);
}

function flowAnchor(state: SankeyState, item: number): Point | undefined {
	const link = state.drawnLinks[item];
	if (!link) return undefined;
	const { props, layout } = state.current;
	const source = layout.nodes[link.source] as SankeyNode;
	const target = layout.nodes[link.target] as SankeyNode;
	return toSceneOf(props)(
		(source.x1 + target.x0) / 2,
		(link.y0 + link.y1) / 2 - link.width / 2,
	);
}

/** A node bar's tooltip: "name: value". */
function barText(state: SankeyState, item: number) {
	const own = state.bars.itemAt(item);
	if (!own || !state.current.props.tooltip) return undefined;
	return `${nameOf(state, own.node)}: ${formatTick(own.node.value)}`;
}

/**
 * A Sankey diagram: quantities flowing between stages, each flow a ribbon as thick as its
 * value, each node a bar as tall as what passes through it. Lays itself out in a
 * `width × height` box; needs no `chart`. A cycle in the links throws. The flows are one path
 * batch and the bars one instances node (`event.item` picks one). See {@link sankeyLayout} and
 * {@link sankeyRibbon} for the geometry alone.
 *
 * @example
 * ```ts
 * import { sankey } from "@sophistry/charts";
 *
 * const flows = [
 * 	{ from: "coal", to: "electricity", twh: 40 },
 * 	{ from: "wind", to: "electricity", twh: 25 },
 * 	{ from: "electricity", to: "homes", twh: 35 },
 * 	{ from: "electricity", to: "industry", twh: 30 },
 * ];
 * sankey.create({ data: flows, source: "from", target: "to", value: "twh", width: 8, height: 4, tooltip: true });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#flows
 * @category Charts
 */
export const sankey = defineComposite<SankeyProps<AnyDatum, AnyDatum>>({
	name: "Sankey",
	props: {
		data: { default: [], invalidates: Invalidate.UPDATE },
		source: { invalidates: Invalidate.UPDATE },
		target: { invalidates: Invalidate.UPDATE },
		value: { invalidates: Invalidate.UPDATE },
		nodes: { invalidates: Invalidate.UPDATE },
		nodeId: { invalidates: Invalidate.UPDATE },
		nodeLabel: { invalidates: Invalidate.UPDATE },
		width: { invalidates: Invalidate.UPDATE },
		height: { invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		nodeWidth: { invalidates: Invalidate.UPDATE },
		nodePadding: { invalidates: Invalidate.UPDATE },
		align: { invalidates: Invalidate.UPDATE },
		iterations: { invalidates: Invalidate.UPDATE },
		colors: { invalidates: Invalidate.UPDATE },
		linkColor: { invalidates: Invalidate.UPDATE },
		linkOpacity: { invalidates: Invalidate.UPDATE },
		labels: { invalidates: Invalidate.UPDATE },
		labelFontSize: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		tooltip: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const state: SankeyState = {
			tooltipOf: createOwnTooltip(),
			tooltip: null,
			nodeList: ctx.memo((list, nodeId, nodeLabel) => {
				if (!list) return undefined;
				const id = resolveChannel<unknown, SankeyId>(
					nodeId as Channel<unknown, SankeyId> | undefined,
					identity,
					"nodeId",
				);
				const label = resolveChannel(
					nodeLabel as Channel<unknown, string> | undefined,
					undefined,
					"nodeLabel",
				);
				const ids = list.map((d, i) => id(d, i));
				const labels = new Map<SankeyId, string>();
				if (label)
					list.forEach((d, i) => {
						labels.set(ids[i] as SankeyId, label(d, i));
					});
				return { ids, labels };
			}),
			layout: ctx.memo((...args: unknown[]) => {
				const [
					data,
					sourceOf,
					targetOf,
					valueChannel,
					nodeList,
					width,
					height,
					nodeWidth,
					nodePadding,
					align,
					iterations,
				] = args as [
					readonly unknown[],
					Channel<unknown, SankeyId>,
					Channel<unknown, SankeyId>,
					Channel<unknown, number>,
					{ ids: SankeyId[] } | undefined,
					number,
					number,
					number | undefined,
					number | undefined,
					SankeyAlign | undefined,
					number | undefined,
				];
				const source = resolveChannel(sourceOf, undefined, "source");
				const target = resolveChannel(targetOf, undefined, "target");
				const values = numberValues(data, valueChannel, undefined, "value");
				const links = data.map((d, i) => ({
					source: source(d, i) as SankeyId,
					target: target(d, i) as SankeyId,
					value: values[i] as number,
				}));
				return sankeyLayout(links, {
					nodes: nodeList?.ids,
					width,
					height,
					nodeWidth: nodeWidth ?? DEFAULT_NODE_WIDTH,
					nodePadding: nodePadding ?? DEFAULT_NODE_PADDING,
					align,
					iterations,
				});
			}),
			ribbons: pathBatch.create({ items: [] }),
			bars: createBatchedMark<
				BarItem,
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
			kept: new Map(),
			drawnLinks: [],
			current: {
				props: ctx.props,
				layout: { nodes: [], links: [], columns: 0, ky: 0 },
				names: undefined,
			},
			ribbonHandlers: null,
			barHandlers: null,
		};
		states.set(ctx.node, state);
		return draw(ctx, state);
	},
	update: (_changed, ctx) => draw(ctx, states.get(ctx.node) as SankeyState),
});
