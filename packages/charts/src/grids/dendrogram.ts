/**
 * `dendrogram`: a clustering's merge tree in a chart's margin, drawn as one
 * path batch (one open item per bracket arm). Merges replay lowest first;
 * each arm draws along its length (the item's `progress`).
 */

import type {
	CompositeContext,
	PathBatchItem,
	PathBatchItemsProps,
	PathBatchNode,
	SceneNode,
} from "@sophistry/core";
import { defineComposite, Invalidate, pathBatch } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, Point } from "@sophistry/core/geometry";
import { cssColor } from "@sophistry/core/internal";
import type { ChartLayer } from "../context";
import { chartLayer } from "../context";
import type { ChartSide } from "../frame/types";
import type { ClusterNode } from "../math/cluster";
import type { TreeNode } from "../math/tree";
import { hierarchyTreeLayout, treeLink } from "../math/tree";
import { ranks, staggered } from "../stagger";
import { keyedMemo } from "../util";

const DEFAULT_SIZE = 0.8;
const DEFAULT_GAP = 0.08;
const DEFAULT_STAGGER = 0.6;
const DEFAULT_STROKE_WIDTH = 0.02;
const DEFAULT_OPACITY = 0.7;

/**
 * Props of {@link dendrogram}.
 *
 * @category Charts
 */
export interface DendrogramProps {
	/**
	 * The merge tree, from {@link clusterRows} or {@link linkageTree}: each leaf's `index` is a
	 * position in `categories`, each merge's `height` its linkage distance.
	 */
	tree: ClusterNode | null | undefined;
	/** The band-axis category of each clustered row: leaf `index` `i` stands at `categories[i]`. */
	categories: readonly BandKey[];
	/**
	 * The band axis the leaves stand on.
	 * @default "y"
	 */
	axis?: "x" | "y";
	/**
	 * Which side of the plotting area the dendrogram stands on, in the margin (it reserves room
	 * there). Move the axis names to the other side to keep the tree against the grid. Defaults to
	 * `"left"` for `axis="y"`, `"top"` for `axis="x"`.
	 */
	side?: "left" | "right" | "top" | "bottom";
	/**
	 * How far the root stands from the leaves.
	 * @default 0.8
	 */
	size?: number;
	/**
	 * Gap between the plotting area's edge and the leaves.
	 * @default 0.08
	 */
	gap?: number;
	/** Line colour. Defaults to the theme foreground. */
	color?: ColorInput;
	/**
	 * Line width.
	 * @default 0.02
	 */
	strokeWidth?: number;
	/**
	 * Line opacity, 0..1.
	 * @default 0.7
	 */
	opacity?: number;
	/**
	 * Reveal, 0..1: merges appear in clustering order, lowest first, each bracket rising to its
	 * height.
	 * @default 1
	 */
	progress?: number;
	/**
	 * Fraction of the reveal spent staggering the merges, 0..0.95.
	 * @default 0.6
	 */
	stagger?: number;
	/** Paint order. */
	zIndex?: number;
	/** Set to false to hide the tree. */
	visible?: boolean;
}

/** One bracket arm in scene units: from a child out to its parent. */
interface Arm {
	merge: number;
	item: PathBatchItem;
}

/** What a dendrogram keeps between updates. */
interface DendrogramState {
	layer: ChartLayer;
	nodes: (
		deps: readonly unknown[],
		make: () => TreeNode<ClusterNode>[],
	) => TreeNode<ClusterNode>[];
	order: (
		deps: readonly unknown[],
		make: () => { byNode: Map<number, number>; count: number },
	) => { byNode: Map<number, number>; count: number };
	arms: (deps: readonly unknown[], make: () => Arm[]) => Arm[];
	batch: PathBatchNode<PathBatchItemsProps>;
}

const states = new WeakMap<object, DendrogramState>();

function draw(ctx: CompositeContext<DendrogramProps>): SceneNode[] {
	const state = states.get(ctx.node) as DendrogramState;
	const props = ctx.props;
	const frame = state.layer.frame();
	if (!frame) throw new Error("Dendrogram must be placed inside a chart.");
	const { coords } = frame;
	const onX = props.axis === "x";
	/** The side the tree stands on: `side` where it fits the axis, else the axis's default. */
	const side: ChartSide = onX
		? props.side === "bottom"
			? "bottom"
			: "top"
		: props.side === "right"
			? "right"
			: "left";
	const size = props.size ?? DEFAULT_SIZE;
	const gap = props.gap ?? DEFAULT_GAP;

	/** The tree with depth as a 0..1 fraction (root 0, leaves 1) by merge height. */
	const nodes = state.nodes([props.tree], () =>
		props.tree
			? hierarchyTreeLayout<ClusterNode>(props.tree, {
					layout: "cluster",
					children: (n) => n.children,
					distance: (n) => n.height,
					separation: 1,
					height: 1,
				})
			: [],
	);
	const leafKeys = nodes
		.filter((n) => n.leaf)
		.flatMap((n) => {
			const key = props.categories[n.datum.index];
			return key === undefined ? [] : [key];
		});
	const report = { categories: leafKeys, padding: 0 };
	const margin = { [side]: gap + size };
	state.layer.report(onX ? { x: report, margin } : { y: report, margin });

	const band = onX ? frame.xBand : frame.yBand;
	const box = frame.marginBox(side);
	const arms = state.arms(
		[
			nodes,
			props.categories,
			band,
			coords,
			box.minX,
			box.minY,
			box.maxX,
			box.maxY,
			side,
			size,
			gap,
		],
		() => {
			// Each node's position along the band axis, in data units: a leaf at
			// its band centre, a merge midway between its two clusters.
			const at = nodes.map(() => Number.NaN);
			for (let i = nodes.length - 1; i >= 0; i--) {
				const n = nodes[i] as TreeNode<ClusterNode>;
				if (n.leaf) {
					const key = props.categories[n.datum.index];
					const start = key === undefined ? undefined : band?.start(key);
					at[i] =
						band && start !== undefined
							? start + band.bandwidth / 2
							: Number.NaN;
				}
			}
			// Children follow their parent in pre-order: average them bottom-up.
			const sums = nodes.map(() => 0);
			const counts = nodes.map(() => 0);
			for (let i = nodes.length - 1; i >= 0; i--) {
				const n = nodes[i] as TreeNode<ClusterNode>;
				if (!n.leaf)
					at[i] =
						(counts[i] as number) > 0
							? (sums[i] as number) / (counts[i] as number)
							: Number.NaN;
				if (n.parent >= 0 && Number.isFinite(at[i])) {
					sums[n.parent] = (sums[n.parent] as number) + (at[i] as number);
					counts[n.parent] = (counts[n.parent] as number) + 1;
				}
			}
			/** The layout's (breadth, depth) to scene units, in the side's margin. */
			const toScene = (breadth: number, depth: number): Point => {
				const out = gap + size * (1 - depth);
				switch (side) {
					case "top":
						return { x: coords.coordsToPoint(breadth, 0).x, y: box.minY + out };
					case "bottom":
						return { x: coords.coordsToPoint(breadth, 0).x, y: box.maxY - out };
					case "right":
						return { x: box.minX + out, y: coords.coordsToPoint(0, breadth).y };
					default:
						return { x: box.maxX - out, y: coords.coordsToPoint(0, breadth).y };
				}
			};
			return nodes.flatMap((n, i) => {
				if (n.parent < 0) return [];
				const parent = nodes[n.parent] as TreeNode<ClusterNode>;
				const self = at[i] as number;
				const up = at[n.parent] as number;
				if (!Number.isFinite(self) || !Number.isFinite(up)) return [];
				const points = treeLink(
					{ x: up, y: parent.y },
					{ x: self, y: n.y },
					"elbow",
				)
					.reverse()
					.map((p) => toScene(p.x, p.y));
				return [
					{
						merge: n.parent,
						item: { closed: false, polylines: [points] },
					},
				];
			});
		},
	);
	/** Each merge's place in the reveal: lowest merge first. */
	const order = state.order([nodes], () => {
		const merges = nodes.filter((n) => !n.leaf);
		const rank = ranks(merges.map((n) => n.distance));
		const byNode = new Map<number, number>();
		let k = 0;
		nodes.forEach((n, i) => {
			if (!n.leaf) byNode.set(i, rank[k++] as number);
		});
		return { byNode, count: merges.length };
	});

	const own = state.layer.progress(props.progress) ?? 1;
	const stagger = props.stagger ?? DEFAULT_STAGGER;
	const items: PathBatchItem[] = [];
	for (const arm of arms) {
		const t = staggered(
			own,
			order.byNode.get(arm.merge) ?? 0,
			order.count,
			stagger,
		);
		if (!(t > 0)) continue;
		items.push(t >= 1 ? arm.item : { ...arm.item, progress: t });
	}
	state.batch.update({
		items,
		stroke: cssColor(props.color ?? ctx.theme.palette.foreground),
		strokeWidth: props.strokeWidth ?? DEFAULT_STROKE_WIDTH,
		opacity: props.opacity ?? DEFAULT_OPACITY,
		zIndex: props.zIndex,
		visible: props.visible,
	});
	return [state.batch];
}

/**
 * A dendrogram in the margin of a `chart` with a band axis: a clustering's merge tree as
 * elbow brackets, each leaf at its category's band and each merge as far out as its linkage
 * distance. It reports its leaf order, so an unordered axis follows it. `heatmap` with
 * `cluster` draws these for you; use this with `cells` to compose one by hand. Drawn as one
 * path batch.
 *
 * @example
 * ```ts
 * import { cells, chart, clusterRows, dendrogram } from "@sophistry/charts";
 *
 * const rows = ["a", "b", "c"];
 * const columns = ["x", "y"];
 * const matrix = [
 * 	[1, 2],
 * 	[1.2, 1.9],
 * 	[5, 0],
 * ];
 * const data = rows.flatMap((row, r) => columns.map((column, c) => ({ row, column, v: matrix[r][c] })));
 * const { root } = clusterRows(matrix);
 * chart.create({
 * 	width: 4,
 * 	height: 4,
 * 	children: [
 * 		cells.create({ data, x: "column", y: "row", value: "v" }),
 * 		dendrogram.create({ tree: root, categories: rows, side: "left" }),
 * 	],
 * });
 * ```
 *
 * @see https://sophistry.dev/reference/chart-catalogue/#heatmaps-and-contours
 * @category Charts
 */
export const dendrogram = defineComposite<DendrogramProps>({
	name: "Dendrogram",
	props: {
		tree: { invalidates: Invalidate.UPDATE },
		categories: { default: [], invalidates: Invalidate.UPDATE },
		axis: { invalidates: Invalidate.UPDATE },
		side: { invalidates: Invalidate.UPDATE },
		size: { invalidates: Invalidate.UPDATE },
		gap: { invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		stagger: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		states.set(ctx.node, {
			layer: chartLayer(ctx),
			nodes: keyedMemo(),
			order: keyedMemo(),
			arms: keyedMemo(),
			batch: pathBatch.create({ items: [] }),
		});
		return draw(ctx);
	},
	update: (_changed, ctx) => draw(ctx),
});
