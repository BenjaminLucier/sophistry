/**
 * `tree`: a node-link tree (tidy tree or dendrogram).
 *
 * The node dots are `circle` instances of one instances node, keyed by the
 * node's path of names; per-node picking, tooltips and drilling go through
 * `event.item`. The links are one path batch (each an open polyline with
 * its branch's stroke and its own opacity); a link draws in along its
 * length with its item's `progress`. Names are `label` nodes, one per named node; with drill
 * or tooltips on, a name answers the same tap as its dot.
 *
 * Work is cached in steps: each end's depth fit is measured once
 * per layout, a keyed-transition frame re-places nodes without re-fitting,
 * and a zoom frame refits only the focused subtrees.
 */

import type {
	CircleProps,
	CompositeContext,
	PathBatchItem,
	PathBatchItemsProps,
	PathBatchNode,
	SceneNode,
} from "@sophistry/core";
import { circle, defineComposite, pathBatch } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import { clamp01 } from "@sophistry/core/internal";
import type { BatchItem } from "../batch.js";
import { createBatchedMark } from "../batch.js";
import type { Channel } from "../data/channels.js";
import { resolveChannel } from "../data/channels.js";
import type { TreeLayoutKind, TreeLinkShape, TreeNode } from "../math/tree.js";
import {
	hierarchyTreeLayout,
	radialTreeLink,
	radialTreePoint,
	treeLink,
} from "../math/tree.js";
import type { AnyDatum } from "../props.js";
import { staggered } from "../stagger.js";
import { keyedMemo, mix, shallowEqual } from "../util.js";
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
	HierarchyView,
	Joined,
	ResolvedFocus,
} from "./shared.js";
import {
	HIERARCHY_LABEL_FONT_SIZE,
	hierarchyOptionDeps,
	hierarchyOptions,
	isWithin,
	labelPad,
	presenceOf,
} from "./shared.js";

const DEFAULT_STAGGER = 0.5;
const DEFAULT_NODE_RADIUS = 0.06;
const DEFAULT_LINK_WIDTH = 0.025;
const DEFAULT_LINK_OPACITY = 0.6;
/** Share of a level's reveal spent drawing its links; the dots take the rest. */
const LINK_SHARE = 0.6;
/** Spread of a keyed transition's enter (and exit) across the levels of a subtree coming or going. */
const PRESENCE_STAGGER = 0.6;
/** Samples along a curved link. */
const LINK_SAMPLES = 24;
/** The fields that place a tree node, for a keyed transition: breadth and depth. */
const TREE_FIELDS = ["x", "y"] as const;

/**
 * The default stagger across `levels` levels: at least {@link DEFAULT_STAGGER}, and wide enough
 * that each level's links start only once its parents' links have drawn (each level's link takes
 * `LINK_SHARE` of its window), so no link hangs in mid-air.
 */
function defaultStagger(levels: number): number {
	const steps = Math.max(0, levels - 1) * LINK_SHARE;
	return Math.min(0.95, Math.max(DEFAULT_STAGGER, steps / (1 + steps)));
}

/** @category Charts */
export interface TreeProps<T>
	extends HierarchyChartBaseProps<T>,
		HierarchyTransitionProps<T>,
		HierarchyDrillProps<T> {
	/** Width of the whole chart, labels included. */
	width: number;
	/** Height of the whole chart, labels included. */
	height: number;
	/** Centre of the chart. Defaults to the origin. */
	center?: Point;
	/**
	 * `"horizontal"`: root at the left, siblings top to bottom. `"vertical"`: root at the top,
	 * siblings left to right. `"radial"`: root in the centre, siblings clockwise from 12 o'clock
	 * (parents are named in the tooltip only).
	 * @default "horizontal"
	 */
	orientation?: "horizontal" | "vertical" | "radial";
	/**
	 * A node's height above the leaves (a dendrogram's merge distance): places nodes along the
	 * depth axis by it instead of one level per depth. Leaves default to 0. Pairs with
	 * `layout: "cluster"`. See {@link hierarchyTreeLayout}.
	 */
	distance?: Channel<T, number>;
	/**
	 * `"tidy"`: a tidy tree, one depth per level. `"cluster"`: a dendrogram, every leaf aligned at
	 * the far side.
	 * @default "tidy"
	 */
	layout?: TreeLayoutKind;
	/**
	 * How links are drawn: `"curve"` (a smooth cubic) or `"elbow"` (a right-angled bracket).
	 * Defaults to `"curve"` for the tidy layout, `"elbow"` for cluster.
	 */
	link?: TreeLinkShape;
	/**
	 * Gap between neighbouring nodes with different parents, relative to the gap between siblings.
	 * @default 2
	 */
	separation?: number;
	/**
	 * Radius of the node dots; 0 hides them.
	 * @default 0.06
	 */
	nodeRadius?: number;
	/**
	 * Stroke width of the links.
	 * @default 0.025
	 */
	linkWidth?: number;
	/**
	 * Opacity of the links, 0..1.
	 * @default 0.6
	 */
	linkOpacity?: number;
	/**
	 * A leaf's value, shown in the tooltip only (it never changes the geometry). Parents sum their
	 * leaves; omitted, a node's value is its leaf count.
	 */
	value?: Channel<T, number>;
	/**
	 * Order siblings by descending value.
	 * @default false
	 */
	sort?: boolean;
	/**
	 * Fill opacity of the node dots, 0..1.
	 * @default 1
	 */
	fillOpacity?: number;
	/**
	 * Draw node names: leaves past the leaf, parents beside the node.
	 * @default true
	 */
	labels?: boolean;
	/**
	 * Zoom into a subtree: the focused node moves to the root side and its descendants fill the box
	 * while the rest fade out. A path of names below the root (`["c"]`), a predicate, or `{ from,
	 * to, t }` for a scrubbable transition. Given, the chart is controlled: taps only call
	 * `onFocusChange`. Defaults to the root.
	 */
	focus?: HierarchyFocusSpec<T>;
}

/**
 * How a layout's depth axis fits the box: where depth 0 stands from the root side and how long
 * depth 1 is (radially, the leaves' radius).
 */
interface DepthFit {
	start: number;
	span: number;
}

/** A node's name: where and how it is set. */
interface NamePlace {
	x: number;
	y: number;
	align: "left" | "right";
	baseline: "middle" | "bottom";
	rotation: number;
}

/** One node's geometry in scene units. */
interface Placed {
	x: number;
	y: number;
	link: Point[] | null;
	label: NamePlace | null;
}

/** One dot, in scene units. */
interface DotItem extends BatchItem {
	key: string;
	/** The node's position in the whole layout. */
	position: number;
	center: Point;
	radius: number;
	fill: string;
	opacity: number;
	/** Where its tooltip points. */
	at: Point;
}

/** What a drawn link's item was made from, to keep it while they hold. */
interface LinkInputs {
	points: readonly Point[];
	reveal: number;
	stroke: string;
	opacity: number;
}

type Layout = readonly Joined<TreeNode<AnyDatum>>[];

interface TreeState {
	chart: HierarchyChart<AnyDatum, TreeNode<AnyDatum>>;
	dots: ReturnType<
		typeof createBatchedMark<
			DotItem,
			CircleProps,
			SceneNode<CircleProps>,
			keyof CircleProps
		>
	>;
	links: PathBatchNode<PathBatchItemsProps>;
	/** Last update's link item per key, reused while its inputs hold. */
	kept: Map<string, { inputs: LinkInputs; item: PathBatchItem }>;
	presenceLevels: (layout: Layout) => { levels: number[]; count: number };
	fromFit: ReturnType<typeof keyedMemo<DepthFit>>;
	toFit: ReturnType<typeof keyedMemo<DepthFit | undefined>>;
	fit: { last: DepthFit | null };
	zoomFit: { last: DepthFit | null };
	seen: ReturnType<typeof keyedMemo<Layout>>;
	placed: ReturnType<typeof keyedMemo<Placed[]>>;
	/** Each name's tap handler, by key, made once. */
	taps: Map<string, () => void>;
	/** The latest update's positions and dots by key, for the name taps. */
	current: { positions: Map<string, number>; dots: Map<string, Point> };
	measure: ReturnType<typeof createLabelMeasure>;
}

const states = new WeakMap<object, TreeState>();

/** `next`, or `last` when shallowly equal (so memos keyed on it hold). */
function stable(holder: { last: DepthFit | null }, next: DepthFit): DepthFit {
	if (holder.last && shallowEqual(holder.last, next)) return holder.last;
	holder.last = next;
	return next;
}

/**
 * Each node's level within the subtree it enters or leaves with (0 for its root, and for a node
 * that stays), and how many such levels there are: an entering subtree grows from its root
 * out, a leaving one withdraws leaves first, so no link hangs from a parent not yet (or no
 * longer) there. Nodes come parent first. The result keeps its identity while equal.
 */
function createPresenceLevels(): (layout: Layout) => {
	levels: number[];
	count: number;
} {
	let last: { levels: number[]; count: number } | null = null;
	return (all) => {
		const levels: number[] = [];
		let count = 1;
		for (let i = 0; i < all.length; i++) {
			const node = all[i] as Layout[number];
			const parent = node.parent;
			const moving = presenceOf(node) < 1;
			const above =
				parent >= 0 && moving && presenceOf(all[parent] as Layout[number]) < 1
					? (levels[parent] as number) + 1
					: 0;
			levels.push(above);
			count = Math.max(count, above + 1);
		}
		if (last && last.count === count && shallowEqual(last.levels, levels))
			return last;
		last = { levels, count };
		return last;
	};
}

function draw(
	ctx: CompositeContext<TreeProps<AnyDatum>>,
	state: TreeState,
): SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	const vertical = props.orientation === "vertical";
	const radial = props.orientation === "radial";
	/** Extent of the breadth axis (siblings side by side), scene units. */
	const breadth = vertical ? props.width : props.height;
	/** Extent of the depth axis (root to leaves), scene units. */
	const depthExtent = vertical ? props.height : props.width;
	const fontSize = props.labelFontSize ?? HIERARCHY_LABEL_FONT_SIZE;
	const radius = Math.max(0, props.nodeRadius ?? DEFAULT_NODE_RADIUS);
	/** Extent of the layout's breadth axis: scene units, or a turn when radial. */
	const extent = radial ? Math.PI * 2 : Math.max(0, breadth);
	const labelsOn = props.labels !== false;

	/**
	 * Layout with breadth in scene units (radians clockwise from 12 o'clock when radial) and depth
	 * as a 0..1 fraction: `data`'s, or the two ends joined at `blend`.
	 */
	const whole = (): HierarchyView => ({ x0: 0, x1: extent, y0: 0, y1: 1 });
	/**
	 * The window that shows one node's subtree: its breadth with the layout's end margin either
	 * side, and depth from the node to its deepest descendant.
	 */
	const viewOf = (all: Layout, position: number): HierarchyView => {
		const n = all[position];
		if (!n || position === 0) return whole();
		let lo = n.x;
		let hi = n.x;
		let deep = n.y;
		// Pre-order: a subtree is the run of nodes right after its root.
		for (let i = position + 1; i < all.length; i++) {
			if (!isWithin(all, i, position)) break;
			const node = all[i] as Layout[number];
			lo = Math.min(lo, node.x);
			hi = Math.max(hi, node.x);
			deep = Math.max(deep, node.y);
		}
		let margin = Number.POSITIVE_INFINITY;
		for (const node of all) margin = Math.min(margin, node.x);
		const pad = margin > 1e-9 ? margin : extent / 2 || 1;
		return {
			x0: lo - pad,
			x1: hi + pad,
			y0: n.y,
			y1: deep - n.y > 1e-9 ? deep : n.y + 1,
		};
	};
	const frame = state.chart.frame(
		props,
		theme,
		(data) =>
			hierarchyTreeLayout(data, {
				...hierarchyOptions(props),
				layout: props.layout,
				separation: props.separation,
				distance: resolveChannel<AnyDatum, number>(
					props.distance,
					undefined,
					"distance",
				),
				radial,
				width: extent,
				height: 1,
			}),
		[
			...hierarchyOptionDeps(props),
			props.layout,
			props.separation,
			props.distance,
			radial,
			extent,
		],
		{ viewOf },
	);
	const { layout: nodes, ends, keys, fills, zoom } = frame;
	/** How far the transition's update stage has got (0 without one). */
	const update = nodes[0]?.update ?? 0;
	/** How many levels the reveal staggers: the nearer end's, read only when the ends differ. */
	const fromHeight = ends.from[0]?.height ?? 0;
	const toHeight = ends.to ? (ends.to[0]?.height ?? 0) : fromHeight;
	const levels =
		(fromHeight === toHeight || update < 0.5 ? fromHeight : toHeight) + 1;
	const presence = state.presenceLevels(nodes);
	/** A node's breadth and depth through a window, clamped to the box. */
	const through = (n: { x: number; y: number }, v: HierarchyView) => ({
		x: clamp01((n.x - v.x0) / (v.x1 - v.x0 || 1)) * extent,
		y: clamp01((n.y - v.y0) / (v.y1 - v.y0 || 1)),
	});
	/** The layout as the zoom shows it: every node through the window. */
	const seen = state.seen([zoom.view, nodes, extent], () => {
		const v = zoom.view;
		if (shallowEqual(v, whole())) return nodes;
		return nodes.map((n) => ({ ...n, ...through(n, v) }));
	});
	const shape: TreeLinkShape =
		props.link ?? (props.layout === "cluster" ? "elbow" : "curve");

	/** How one layout's depth axis fits the box, with room for its names. */
	const fitOf = (all: readonly TreeNode<AnyDatum>[]): DepthFit =>
		depthFit(all, {
			radius,
			fontSize,
			labels: labelsOn,
			radial,
			vertical,
			width: props.width,
			height: props.height,
			depth: depthExtent,
			measure: (text) => state.measure(text, fontSize, theme),
		});
	const fitDeps = [
		radius,
		fontSize,
		labelsOn,
		radial,
		vertical,
		props.width,
		props.height,
		theme.defaults.fontFamily,
	];
	const fromFit = state.fromFit([ends.from, ...fitDeps], () =>
		fitOf(ends.from),
	);
	const toEnd = ends.to;
	const toFit = state.toFit([toEnd, ...fitDeps], () =>
		toEnd ? fitOf(toEnd) : undefined,
	);
	/** The depth fit on this frame: each end's own, blended with the update. */
	const fit = stable(
		state.fit,
		!toFit || shallowEqual(fromFit, toFit)
			? fromFit
			: {
					start: mix(fromFit.start, toFit.start, update),
					span: mix(fromFit.span, toFit.span, update),
				},
	);
	/**
	 * The depth fit a focused subtree needs on its own: its nodes through
	 * its window, the focus as their root. The root's is `fit`.
	 */
	const fitAt = (position: number): DepthFit => {
		if (position === 0) return fit;
		const v = viewOf(nodes, position);
		const subtree: TreeNode<AnyDatum>[] = [];
		for (let i = position; i < nodes.length; i++) {
			if (i > position && !isWithin(nodes, i, position)) break;
			const node = nodes[i] as Layout[number];
			if (presenceOf(node) <= 0) continue;
			subtree.push({ ...node, ...through(node, v) });
		}
		return fitOf(subtree);
	};
	/** The fit on this frame through the zoom: each focused end's, blended as the windows are. */
	const fitIn = (f: ResolvedFocus): DepthFit => {
		if ("at" in f) return fitAt(f.at);
		if (f.t <= 0) return fitIn(f.from);
		if (f.t >= 1) return fitIn(f.to);
		const a = fitIn(f.from);
		const b = fitIn(f.to);
		return {
			start: mix(a.start, b.start, f.t),
			span: mix(a.span, b.span, f.t),
		};
	};
	const zoomFit = stable(state.zoomFit, fitIn(zoom.resolved));

	/** Every node's dot, incoming link and label, in scene units. */
	const placed = state.placed(
		[
			seen,
			zoomFit,
			radial,
			radius,
			fontSize,
			labelsOn,
			props.center?.x,
			props.center?.y,
			props.width,
			props.height,
			vertical,
			shape,
		],
		() =>
			radial
				? placeRadially(seen, {
						span: zoomFit.span,
						offset: radius + labelPad(fontSize),
						labels: labelsOn,
						center: props.center ?? { x: 0, y: 0 },
						shape,
					})
				: placeFlat(seen, {
						fit: zoomFit,
						radius,
						fontSize,
						labels: labelsOn,
						vertical,
						left: (props.center?.x ?? 0) - props.width / 2,
						top: (props.center?.y ?? 0) + props.height / 2,
						shape,
					}),
	);

	const progress = props.progress ?? 1;
	const stagger = props.stagger ?? defaultStagger(levels);
	const on = props.visible !== false;
	const linkOpacity = props.linkOpacity ?? DEFAULT_LINK_OPACITY;
	const interactive = frame.interactive;
	const dots: DotItem[] = [];
	const links: PathBatchItem[] = [];
	const kept = new Map<string, { inputs: LinkInputs; item: PathBatchItem }>();
	const texts: KeyedLabel[] = [];
	const positions = new Map<string, number>();
	const dotsAt = new Map<string, Point>();
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i] as Layout[number];
		const key = keys[i] as string;
		const place = placed[i];
		if (!place) continue;
		const depth = node.depth;
		const present = staggered(
			presenceOf(node),
			presence.levels[i] ?? 0,
			presence.count,
			PRESENCE_STAGGER,
		);
		/** This node's level of the staggered reveal. */
		const level = staggered(progress, depth, levels, stagger);
		/**
		 * The incoming link draws first, then the dot grows in; a leaving node
		 * goes dot first, link last.
		 */
		const linkShare = (t: number) => clamp01(t / LINK_SHARE);
		const dotShare = (t: number) =>
			depth === 0 ? t : clamp01((t - LINK_SHARE) / (1 - LINK_SHARE));
		const linkReveal = linkShare(level) * linkShare(present);
		const dotReveal = dotShare(level) * dotShare(present);
		/** Present (1) inside the focused subtree, fading out of it. */
		const weight = zoom.weight(i);
		/** A link shows while both its ends do. */
		const linkWeight = node.parent < 0 ? 0 : weight * zoom.weight(node.parent);
		const fill = fills[i] ?? theme.palette.foreground;
		if (place.link && on && linkReveal > 0 && linkWeight > 0) {
			const inputs: LinkInputs = {
				points: place.link,
				reveal: Math.min(1, linkReveal),
				stroke: fill,
				opacity: linkOpacity * linkWeight,
			};
			const previous = state.kept.get(key);
			const item =
				previous && shallowEqual(previous.inputs, inputs)
					? previous.item
					: linkItem(inputs);
			kept.set(key, { inputs, item });
			if (item.polylines && (item.polylines[0]?.length ?? 0) >= 2)
				links.push(item);
		}
		const visible = on && dotReveal > 0 && weight > 0;
		if (!visible) continue;
		positions.set(key, i);
		dotsAt.set(key, { x: place.x, y: place.y + radius });
		if (radius > 0)
			dots.push({
				key,
				position: i,
				center: { x: place.x, y: place.y },
				radius: radius * dotReveal,
				fill,
				opacity: dotReveal * weight,
				at: { x: place.x, y: place.y + radius },
			});
		const name = place.label;
		if (!name || !node.label) continue;
		texts.push({
			key,
			props: {
				text: node.label,
				x: name.x,
				y: name.y,
				align: name.align,
				baseline: name.baseline,
				rotation: name.rotation,
				fontSize,
				color: theme.palette.foreground,
				opacity: dotReveal * weight,
				zIndex: (props.zIndex ?? 0) + 1,
				...(interactive
					? { pointerEvents: "painted" as const, onTap: tapOf(state, key) }
					: { onTap: undefined }),
			},
		});
	}
	state.kept = kept;
	state.current = { positions, dots: dotsAt };

	state.links.update({
		items: links,
		stroke: theme.palette.foreground,
		strokeWidth: props.linkWidth ?? DEFAULT_LINK_WIDTH,
		zIndex: props.zIndex ?? 0,
	} as never);
	state.dots.update(dots, {
		stroke: "none",
		fillOpacity: props.fillOpacity ?? 1,
		zIndex: props.zIndex ?? 0,
		...state.chart.interaction(
			`Tree, ${dots.length} nodes`,
			(item) => state.dots.itemAt(item)?.position,
			(item) => state.dots.itemAt(item)?.at,
		),
	} as never);
	const trail = state.chart.breadcrumbs({
		options: props.breadcrumbs,
		corner: {
			x: (props.center?.x ?? 0) - props.width / 2,
			y: (props.center?.y ?? 0) + props.height / 2,
		},
		width: props.width,
		labelFontSize: fontSize,
		progress: props.progress,
		zIndex: props.zIndex,
		visible: props.visible,
	});
	const out: SceneNode[] = [
		state.links,
		state.dots.node,
		...labelList(ctx, "labels", texts),
	];
	if (trail) out.push(trail);
	return out;
}

/** A name's tap: the same as its dot's. One handler per key, for the name's life. */
function tapOf(state: TreeState, key: string): () => void {
	let tap = state.taps.get(key);
	if (!tap) {
		tap = () => {
			const position = state.current.positions.get(key);
			const at = state.current.dots.get(key);
			if (position !== undefined && at) state.chart.tapNode(position, at);
		};
		state.taps.set(key, tap);
	}
	return tap;
}

/** Each link's outline by its points: one array while the points hold. */
const linkOutlines = new WeakMap<readonly Point[], Point[][]>();

/**
 * A link as a path batch item: its whole polyline, drawn along its length
 * to `reveal` (the item's `progress`). The outline array is the same while
 * the points are, so the renderer measures its arc length once.
 */
function linkItem(inputs: LinkInputs): PathBatchItem {
	let outline = linkOutlines.get(inputs.points);
	if (!outline) {
		outline = [inputs.points as Point[]];
		linkOutlines.set(inputs.points, outline);
	}
	return {
		polylines: outline,
		closed: false,
		stroke: inputs.stroke,
		opacity: inputs.opacity,
		...(inputs.reveal < 1 ? { progress: inputs.reveal } : {}),
	};
}

/** What {@link depthFit} reads. */
interface FitOptions {
	radius: number;
	fontSize: number;
	labels: boolean;
	radial: boolean;
	vertical: boolean;
	width: number;
	height: number;
	/** Extent of the depth axis, scene units. */
	depth: number;
	measure: (text: string) => number;
}

/** How one layout's depth axis fits the box, with room for its names. */
function depthFit(
	all: readonly TreeNode<AnyDatum>[],
	options: FitOptions,
): DepthFit {
	const { radius: r, fontSize: size, labels } = options;
	if (options.radial) {
		const offset = r + labelPad(size);
		// The leaves' ring, with room for the longest leaf name past it.
		let room = 0;
		if (labels) {
			for (const n of all) {
				if (n.leaf && n.label)
					room = Math.max(room, offset + options.measure(n.label));
			}
		}
		return {
			start: 0,
			span: Math.max(
				0,
				Math.min(options.width, options.height) / 2 - Math.max(r, room),
			),
		};
	}
	const pad = labelPad(size);
	const offset = r + pad;
	const D = Math.max(0, options.depth);
	const root = all[0];
	// Room on the root side: the dot, and the root's own name.
	let start = r;
	if (labels && root && !root.leaf && root.label) {
		start = Math.max(
			start,
			options.vertical ? pad + size : offset + options.measure(root.label),
		);
	}
	// The depth span is as long as it can be with every dot and leaf name
	// inside the box.
	let span = D - start - r;
	for (const n of all) {
		if (!labels || !n.leaf || !n.label || n.y <= 0) continue;
		const room = D - start - offset - options.measure(n.label);
		span = Math.min(span, room / n.y);
	}
	return { start, span: Math.max(0, span) };
}

/** Every node's dot, incoming link and leaf label round a circle, in scene units. */
function placeRadially(
	all: Layout,
	options: {
		span: number;
		offset: number;
		labels: boolean;
		center: Point;
		shape: TreeLinkShape;
	},
): Placed[] {
	const { span, offset, center } = options;
	const scaled = (n: { x: number; y: number }) => ({ x: n.x, y: n.y * span });
	return all.map((n) => {
		const at = radialTreePoint(n.x, n.y * span, center);
		const parent = all[n.parent];
		const link = parent
			? radialTreeLink(scaled(parent), scaled(n), options.shape, {
					samples: LINK_SAMPLES,
					center,
				})
			: null;
		let label: NamePlace | null = null;
		if (options.labels && n.label && n.leaf && n.depth > 0) {
			// Along the radius, outward; flipped on the left half to stay upright.
			const theta = Math.PI / 2 - n.x;
			const tip = radialTreePoint(n.x, n.y * span + offset, center);
			const left = Math.cos(theta) < -1e-9;
			label = {
				x: tip.x,
				y: tip.y,
				align: left ? "right" : "left",
				baseline: "middle",
				rotation: left ? theta + Math.PI : theta,
			};
		}
		return { x: at.x, y: at.y, link, label };
	});
}

/** Every node's dot, incoming link and label in a horizontal or vertical tree, in scene units. */
function placeFlat(
	all: Layout,
	options: {
		fit: DepthFit;
		radius: number;
		fontSize: number;
		labels: boolean;
		vertical: boolean;
		left: number;
		top: number;
		shape: TreeLinkShape;
	},
): Placed[] {
	const { fit, vertical, left, top } = options;
	const pad = labelPad(options.fontSize);
	const offset = options.radius + pad;
	const { start, span } = fit;
	const toScene = (b: number, d: number): Point =>
		vertical
			? { x: left + b, y: top - start - d * span }
			: { x: left + start + d * span, y: top - b };
	return all.map((n) => {
		const at = toScene(n.x, n.y);
		const parent = all[n.parent];
		const link = parent
			? treeLink(parent, n, options.shape, { samples: LINK_SAMPLES }).map((p) =>
					toScene(p.x, p.y),
				)
			: null;
		let label: NamePlace | null = null;
		if (options.labels && n.label) {
			if (n.leaf) {
				label = vertical
					? {
							x: at.x,
							y: at.y - offset,
							align: "left",
							baseline: "middle",
							rotation: -Math.PI / 2,
						}
					: {
							x: at.x + offset,
							y: at.y,
							align: "left",
							baseline: "middle",
							rotation: 0,
						};
			} else {
				// In the corner between the incoming link and the outgoing ones.
				label = vertical
					? {
							x: at.x + offset,
							y: at.y + pad,
							align: "left",
							baseline: "bottom",
							rotation: 0,
						}
					: {
							x: at.x - offset,
							y: at.y + pad,
							align: "right",
							baseline: "bottom",
							rotation: 0,
						};
			}
		}
		return { x: at.x, y: at.y, link, label };
	});
}

/**
 * A node-link tree: a tidy tree or a dendrogram, nodes as dots joined to their parents by
 * curved or elbow links, in a `width × height` box with room for names. Supports radial
 * layout, merge distances, drill-down `focus`, and keyed transitions between trees. The dots
 * are one instances node (`event.item` picks a node), the links one path batch. See
 * {@link hierarchyTreeLayout} and {@link treeLink} for the geometry alone.
 *
 * @example
 * ```ts
 * import { tree } from "@sophistry/charts";
 *
 * const org = {
 * 	name: "CEO",
 * 	children: [
 * 		{ name: "CTO", children: [{ name: "Platform" }, { name: "Apps" }] },
 * 		{ name: "CFO" },
 * 	],
 * };
 * tree.create({ data: org, label: "name", width: 8, height: 4, layout: "cluster", tooltip: true });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#hierarchies
 * @category Charts
 */
export const tree = defineComposite<TreeProps<AnyDatum>>({
	name: "Tree",
	props: hierarchyPropsDescriptor<TreeProps<AnyDatum>>([
		"width",
		"height",
		"center",
		"orientation",
		"distance",
		"layout",
		"link",
		"separation",
		"nodeRadius",
		"linkWidth",
		"linkOpacity",
	]),
	setup: (ctx) => {
		const state: TreeState = {
			chart: createHierarchyChart(ctx, TREE_FIELDS),
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
			}),
			links: pathBatch.create({ items: [] }),
			kept: new Map(),
			presenceLevels: createPresenceLevels(),
			fromFit: keyedMemo(),
			toFit: keyedMemo(),
			fit: { last: null },
			zoomFit: { last: null },
			seen: keyedMemo(),
			placed: keyedMemo(),
			taps: new Map(),
			current: { positions: new Map(), dots: new Map() },
			measure: createLabelMeasure(),
		};
		states.set(ctx.node, state);
		return draw(ctx, state);
	},
	update: (_changed, ctx) => draw(ctx, states.get(ctx.node) as TreeState),
});
