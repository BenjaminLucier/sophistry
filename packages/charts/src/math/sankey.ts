/**
 * Sankey layout: nodes in columns, links as ribbons as wide as their value.
 * Coordinates are in a `[0, width] × [0, height]` box with **y pointing
 * down**: `y0` is a node's top edge. A y-up renderer maps `y` to `top - y`.
 */

import type { Point } from "@sophistry/core/geometry";
import { maxOf } from "@sophistry/core/internal";

/**
 * A node id: whatever the links name their endpoints with.
 *
 * @category Math & helpers
 */
export type SankeyId = string | number;

/**
 * One link of the input graph.
 *
 * @category Math & helpers
 */
export interface SankeyLinkInput {
	source: SankeyId;
	target: SankeyId;
	/** The flow's size; non-finite and negative values count as 0. */
	value: number;
}

/**
 * How nodes are assigned to columns: `"justify"` by longest path from a
 * source with sinks in the last column; `"left"` by longest path from a
 * source; `"right"` by longest path to a sink; `"center"` like `"left"` but
 * each source one column before its nearest target.
 *
 * @category Math & helpers
 */
export type SankeyAlign = "justify" | "left" | "right" | "center";

/**
 * Options for {@link sankeyLayout}.
 *
 * @category Math & helpers
 */
export interface SankeyOptions {
	/**
	 * Node ids in stacking and colour order; ids named only by links are appended. Defaults to the
	 * link endpoints in first-seen order.
	 */
	nodes?: readonly SankeyId[];
	/** Width of the layout box. @default 1 */
	width?: number;
	/** Height of the layout box. @default 1 */
	height?: number;
	/** Width of each node bar. Defaults to 2.4% of `width`. */
	nodeWidth?: number;
	/**
	 * Vertical gap between nodes in a column, shrunk if a tall column can't fit it. Defaults to 8%
	 * of `height`.
	 */
	nodePadding?: number;
	/** Column assignment; see {@link SankeyAlign}. @default "justify" */
	align?: SankeyAlign;
	/** Relaxation passes pulling connected nodes level; 0 keeps the initial stacking. @default 6 */
	iterations?: number;
}

/**
 * One laid-out node. `y0 < y1` (y points down).
 *
 * @category Math & helpers
 */
export interface SankeyNode {
	id: SankeyId;
	/** Position in the node order (first-seen, or `options.nodes`). */
	index: number;
	/** `max(Σ incoming, Σ outgoing)`. */
	value: number;
	/** The column the node is drawn in, after `align`; 0 is the leftmost. */
	depth: number;
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

/**
 * One laid-out link. `y0`/`y1` are the ribbon's centreline at its source and
 * target ends; its edges are `width / 2` either side.
 *
 * @category Math & helpers
 */
export interface SankeyLink {
	/** Index of the source node in {@link SankeyLayout.nodes}. */
	source: number;
	/** Index of the target node in {@link SankeyLayout.nodes}. */
	target: number;
	/** The value used (non-finite and negative inputs read as 0). */
	value: number;
	/** Centreline y where the link leaves its source. */
	y0: number;
	/** Centreline y where the link enters its target. */
	y1: number;
	/** `value × ky`: the ribbon's thickness. */
	width: number;
	/** Position of the link in the input. */
	index: number;
}

/**
 * The result of {@link sankeyLayout}.
 *
 * @category Math & helpers
 */
export interface SankeyLayout {
	nodes: SankeyNode[];
	/** In input order. */
	links: SankeyLink[];
	/** Number of columns. */
	columns: number;
	/** The vertical scale: layout units per unit of value. */
	ky: number;
}

const DEFAULT_ITERATIONS = 6;

/** A link's value, with data problems read as 0. */
const usable = (value: number): number =>
	Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Lays out a Sankey diagram: each node gets a column and a height
 * proportional to its value (`max(Σ in, Σ out)`), each link its attachment
 * points. Relaxation passes pull nodes toward their neighbours, and links are
 * ordered at each node so ribbons don't cross there. Deterministic.
 *
 * @returns Nodes and links in a `[0, width] × [0, height]` box, y down.
 * @throws {Error} If the graph has a cycle (a self-loop included).
 * @throws {Error} If `options.nodes` is given and a link names an id not in it.
 * @category Math & helpers
 */
export function sankeyLayout(
	links: readonly SankeyLinkInput[],
	options: SankeyOptions = {},
): SankeyLayout {
	const width = options.width ?? 1;
	const height = options.height ?? 1;
	const nodeWidth = options.nodeWidth ?? width * 0.024;
	const iterations = Math.max(
		0,
		Math.floor(options.iterations ?? DEFAULT_ITERATIONS),
	);

	// --- Nodes, in order -------------------------------------------------
	const ids: SankeyId[] = [];
	const indexOf = new Map<SankeyId, number>();
	const add = (id: SankeyId) => {
		if (!indexOf.has(id)) {
			indexOf.set(id, ids.length);
			ids.push(id);
		}
	};
	if (options.nodes) {
		for (const id of options.nodes) add(id);
		for (const link of links) {
			for (const end of [link.source, link.target]) {
				if (!indexOf.has(end)) {
					throw new Error(
						`sankeyLayout: link ${String(link.source)} → ${String(link.target)} names node "${String(end)}", which is not in \`nodes\`.`,
					);
				}
			}
		}
	} else {
		for (const link of links) {
			add(link.source);
			add(link.target);
		}
	}
	const n = ids.length;

	const outLinks: number[][] = ids.map(() => []);
	const inLinks: number[][] = ids.map(() => []);
	const graph = links.map((link, index) => {
		const source = indexOf.get(link.source) as number;
		const target = indexOf.get(link.target) as number;
		outLinks[source].push(index);
		inLinks[target].push(index);
		return { source, target, value: usable(link.value), index };
	});

	const values = ids.map((_, i) => {
		let sumIn = 0;
		let sumOut = 0;
		for (const l of inLinks[i]) sumIn += graph[l].value;
		for (const l of outLinks[i]) sumOut += graph[l].value;
		return Math.max(sumIn, sumOut);
	});

	// --- Columns: longest path, by topological order (Kahn) --------------
	const order = topologicalOrder(graph, inLinks, outLinks, ids);
	const depth = new Array<number>(n).fill(0);
	for (const u of order) {
		for (const l of outLinks[u]) {
			const v = graph[l].target;
			depth[v] = Math.max(depth[v], depth[u] + 1);
		}
	}
	const reach = new Array<number>(n).fill(0); // longest path to a sink
	for (let k = order.length - 1; k >= 0; k--) {
		const u = order[k];
		for (const l of outLinks[u]) {
			reach[u] = Math.max(reach[u], reach[graph[l].target] + 1);
		}
	}
	const last = n === 0 ? 0 : maxOf(depth);
	const align = options.align ?? "justify";
	const column = ids.map((_, i) => {
		switch (align) {
			case "left":
				return depth[i];
			case "right":
				return last - reach[i];
			case "center":
				if (inLinks[i].length > 0) return depth[i];
				if (outLinks[i].length > 0) {
					let nearest = Number.POSITIVE_INFINITY;
					for (const l of outLinks[i]) {
						nearest = Math.min(nearest, depth[graph[l].target]);
					}
					return nearest - 1;
				}
				return 0;
			default:
				return outLinks[i].length === 0 ? last : depth[i];
		}
	});
	const columnCount = n === 0 ? 0 : last + 1;

	const nodes: SankeyNode[] = ids.map((id, index) => {
		const x0 =
			columnCount <= 1
				? (width - nodeWidth) / 2
				: (column[index] * (width - nodeWidth)) / (columnCount - 1);
		return {
			id,
			index,
			value: values[index],
			depth: column[index],
			x0,
			x1: x0 + nodeWidth,
			y0: 0,
			y1: 0,
		};
	});
	const columns: SankeyNode[][] = Array.from({ length: columnCount }, () => []);
	for (const node of nodes) columns[node.depth].push(node);

	// --- Vertical scale and initial stacking ------------------------------
	const tallest = columns.reduce((m, c) => Math.max(m, c.length), 0);
	const padding = Math.max(
		0,
		Math.min(
			options.nodePadding ?? height * 0.08,
			tallest > 1 ? height / (tallest - 1) : Number.POSITIVE_INFINITY,
		),
	);
	let ky = Number.POSITIVE_INFINITY;
	for (const c of columns) {
		const total = c.reduce((s, node) => s + node.value, 0);
		if (total > 0) {
			ky = Math.min(ky, (height - (c.length - 1) * padding) / total);
		}
	}
	if (!Number.isFinite(ky) || ky < 0) ky = 0;

	for (const c of columns) {
		let y = 0;
		for (const node of c) {
			node.y0 = y;
			node.y1 = y + node.value * ky;
			y = node.y1 + padding;
		}
		// Share whatever height is left between the gaps above, between and
		// below the nodes, so a short column sits centred rather than at the top.
		const spare = (height - y + padding) / (c.length + 1);
		c.forEach((node, i) => {
			node.y0 += spare * (i + 1);
			node.y1 += spare * (i + 1);
		});
	}

	// --- Relaxation -------------------------------------------------------
	const centre = (node: SankeyNode) => (node.y0 + node.y1) / 2;
	/** Moves `node` toward the value-weighted centre of the other ends of `edges`. */
	const pull = (
		node: SankeyNode,
		edges: readonly number[],
		other: "source" | "target",
		alpha: number,
	) => {
		let sum = 0;
		let weight = 0;
		for (const l of edges) {
			const link = graph[l];
			if (link.value <= 0) continue;
			sum += centre(nodes[link[other]]) * link.value;
			weight += link.value;
		}
		if (!(weight > 0)) return;
		const dy = (sum / weight - centre(node)) * alpha;
		node.y0 += dy;
		node.y1 += dy;
	};
	const byTop = (a: SankeyNode, b: SankeyNode) =>
		a.y0 - b.y0 || a.index - b.index;

	for (let i = 0; i < iterations; i++) {
		const alpha = 0.99 ** i;
		const beta = Math.max(1 - alpha, (i + 1) / iterations);
		for (let c = columnCount - 2; c >= 0; c--) {
			for (const node of columns[c]) {
				pull(node, outLinks[node.index], "target", alpha);
			}
			columns[c].sort(byTop);
			resolveCollisions(columns[c], padding, height, beta);
		}
		for (let c = 1; c < columnCount; c++) {
			for (const node of columns[c]) {
				pull(node, inLinks[node.index], "source", alpha);
			}
			columns[c].sort(byTop);
			resolveCollisions(columns[c], padding, height, beta);
		}
	}

	// --- Link attachment --------------------------------------------------
	const result: SankeyLink[] = graph.map((link) => ({
		...link,
		y0: 0,
		y1: 0,
		width: link.value * ky,
	}));
	for (const node of nodes) {
		const outgoing = [...outLinks[node.index]].sort(
			(a, b) =>
				nodes[graph[a].target].y0 - nodes[graph[b].target].y0 ||
				graph[a].target - graph[b].target ||
				a - b,
		);
		let y = node.y0;
		for (const l of outgoing) {
			result[l].y0 = y + result[l].width / 2;
			y += result[l].width;
		}
		const incoming = [...inLinks[node.index]].sort(
			(a, b) =>
				nodes[graph[a].source].y0 - nodes[graph[b].source].y0 ||
				graph[a].source - graph[b].source ||
				a - b,
		);
		y = node.y0;
		for (const l of incoming) {
			result[l].y1 = y + result[l].width / 2;
			y += result[l].width;
		}
	}

	return { nodes, links: result, columns: columnCount, ky };
}

/** Topological order, smallest index first among ready nodes. Throws on a cycle. */
function topologicalOrder(
	graph: readonly { source: number; target: number }[],
	inLinks: readonly number[][],
	outLinks: readonly number[][],
	ids: readonly SankeyId[],
): number[] {
	const remaining = inLinks.map((edges) => edges.length);
	const ready: number[] = [];
	remaining.forEach((count, i) => {
		if (count === 0) ready.push(i);
	});
	const order: number[] = [];
	while (ready.length > 0) {
		const u = ready.shift() as number;
		order.push(u);
		for (const l of outLinks[u]) {
			const v = graph[l].target;
			remaining[v]--;
			if (remaining[v] === 0) ready.push(v);
		}
	}
	if (order.length < ids.length) {
		const stuck = ids.filter((_, i) => remaining[i] > 0).map(String);
		throw new Error(
			`sankeyLayout: the links form a cycle (through ${stuck.join(", ")}); a Sankey diagram needs an acyclic graph.`,
		);
	}
	return order;
}

/** The collision pass over one column (sorted top-down): push nodes apart from the middle out, then inside `[0, height]`. */
function resolveCollisions(
	column: SankeyNode[],
	padding: number,
	height: number,
	alpha: number,
): void {
	if (column.length === 0) return;
	const mid = column.length >> 1;
	const subject = column[mid];
	pushUp(column, subject.y0 - padding, mid - 1, padding, alpha);
	pushDown(column, subject.y1 + padding, mid + 1, padding, alpha);
	pushUp(column, height, column.length - 1, padding, alpha);
	pushDown(column, 0, 0, padding, alpha);
}

/** Moves nodes `from..end` down so each starts at or below `y`. */
function pushDown(
	column: SankeyNode[],
	y: number,
	from: number,
	padding: number,
	alpha: number,
): void {
	let edge = y;
	for (let i = from; i < column.length; i++) {
		const node = column[i];
		const dy = (edge - node.y0) * alpha;
		if (dy > 1e-6) {
			node.y0 += dy;
			node.y1 += dy;
		}
		edge = node.y1 + padding;
	}
}

/** Moves nodes `from..0` up so each ends at or above `y`. */
function pushUp(
	column: SankeyNode[],
	y: number,
	from: number,
	padding: number,
	alpha: number,
): void {
	let edge = y;
	for (let i = from; i >= 0; i--) {
		const node = column[i];
		const dy = (node.y1 - edge) * alpha;
		if (dy > 1e-6) {
			node.y0 -= dy;
			node.y1 -= dy;
		}
		edge = node.y0 - padding;
	}
}

/**
 * Options for {@link sankeyRibbon}.
 *
 * @category Math & helpers
 */
export interface SankeyRibbonOptions {
	/** Points sampled along each edge. @default 24 */
	samples?: number;
	/**
	 * How much of the ribbon to keep from the source end, 0..1, for a
	 * left-to-right reveal; the cut is vertical.
	 * @default 1
	 */
	t?: number;
}

/**
 * The outline of one link's ribbon as an open polygon: a cubic Bézier with
 * horizontal end tangents along the top edge, the same curve `width` lower
 * traced back. Coordinates are in the inputs' space.
 *
 * @param x0 - Where the ribbon leaves its source (the source node's `x1`).
 * @param y0 - Centreline y at the source end (the link's `y0`).
 * @param x1 - Where the ribbon enters its target (the target node's `x0`).
 * @param y1 - Centreline y at the target end (the link's `y1`).
 * @param width - The ribbon's thickness (the link's `width`).
 * @returns `2 × samples` points, top edge forward then bottom edge back; empty when `t` is 0.
 * @category Math & helpers
 */
export function sankeyRibbon(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	width: number,
	options: SankeyRibbonOptions = {},
): Point[] {
	const t = Math.min(1, Math.max(0, options.t ?? 1));
	if (!(t > 0)) return [];
	const samples = Math.max(2, Math.floor(options.samples ?? 24));
	const half = width / 2;
	const xm = (x0 + x1) / 2;
	const top: Point[] = [];
	const bottom: Point[] = [];
	for (let k = 0; k < samples; k++) {
		const s = (t * k) / (samples - 1);
		const u = 1 - s;
		// Control x's are x0, xm, xm, x1; control y's y0, y0, y1, y1.
		const x = u * u * u * x0 + 3 * u * s * (u + s) * xm + s * s * s * x1;
		const y = u * u * (u + 3 * s) * y0 + s * s * (s + 3 * u) * y1;
		top.push({ x, y: y - half });
		bottom.push({ x, y: y + half });
	}
	return [...top, ...bottom.reverse()];
}
