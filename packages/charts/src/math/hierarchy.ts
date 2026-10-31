/**
 * Hierarchy layouts (treemap, partition, circle packing) over a nested tree
 * of plain objects, flattened to plain nodes in pre-order. Coordinates are
 * in the layout's own box with **y pointing down**: `[0, width] × [0,
 * height]` for rectangles, `[0, size]²` for circles.
 */

import type { HierarchyNode, HierarchyRectangularNode } from "d3-hierarchy";
import {
	hierarchy,
	pack,
	partition,
	treemap,
	treemapBinary,
	treemapDice,
	treemapResquarify,
	treemapSlice,
	treemapSliceDice,
	treemapSquarify,
} from "d3-hierarchy";

/**
 * How a hierarchy layout reads the tree. Accessors get the datum and its
 * pre-order index in the input tree (root 0).
 *
 * @category Math & helpers
 */
export interface HierarchyOptions<T> {
	/**
	 * A node's children; anything but a non-empty array makes it a leaf. Defaults to the datum's
	 * `children` property.
	 */
	children?: (datum: T, index: number) => readonly T[] | null | undefined;
	/**
	 * A leaf's size; negative and non-finite values count as 0. A parent is the
	 * sum of its leaves. Defaults to the datum itself when a number, else 0.
	 */
	value?: (datum: T, index: number) => number;
	/** A node's name, used for `path`. @default "" */
	label?: (datum: T, index: number) => string;
	/** Order siblings by descending value; `false` keeps data order. @default true */
	sort?: boolean;
}

/**
 * One laid-out node, common to every hierarchy layout.
 *
 * @category Math & helpers
 */
export interface HierarchyNodeInfo<T> {
	/** The input object. */
	datum: T;
	/** Pre-order position in the input tree: the `i` channel functions get. */
	index: number;
	/** 0 for the root, +1 per generation. */
	depth: number;
	/** Longest distance to a leaf below: 0 for a leaf. */
	height: number;
	/** Whether the node has no children. */
	leaf: boolean;
	/** The node's label. */
	label: string;
	/** Labels from the root down to this node, inclusive. */
	path: string[];
	/** The leaf's value, or the sum of a parent's leaves; always > 0. */
	value: number;
	/**
	 * Position of the node's top-level ancestor among the root's children, in
	 * input order (unaffected by `sort`); -1 for the root. Charts colour by it.
	 */
	branch: number;
	/** Position of the parent in the returned array, -1 for the root. */
	parent: number;
}

/**
 * A laid-out rectangle, in the layout box with y pointing down.
 *
 * @category Math & helpers
 */
export interface HierarchyRect<T> extends HierarchyNodeInfo<T> {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/**
 * A laid-out circle, in the layout box with y pointing down.
 *
 * @category Math & helpers
 */
export interface HierarchyCircle<T> extends HierarchyNodeInfo<T> {
	x: number;
	y: number;
	r: number;
}

/**
 * Treemap tiling: `"squarify"` (near-square tiles), `"resquarify"` (keeps its
 * rows when values change, for animating), `"binary"`, `"slice"` (stacked
 * vertically), `"dice"` (side by side), `"sliceDice"` (alternating by depth).
 *
 * @category Math & helpers
 */
export type TreemapTile =
	| "squarify"
	| "binary"
	| "slice"
	| "dice"
	| "sliceDice"
	| "resquarify";

/** @category Math */
export interface TreemapOptions<T> extends HierarchyOptions<T> {
	/** Width of the layout box. @default 1 */
	width?: number;
	/** Height of the layout box. @default 1 */
	height?: number;
	/** Tiling method. @default "squarify" */
	tile?: TreemapTile;
	/** Gap between siblings, and between a parent's edge and its children. @default 0 */
	padding?: number;
	/** Gap at the top of every parent below the root, room for its name. Defaults to `padding`. */
	paddingTop?: number;
	/**
	 * Lay every parent out in these rows (from {@link treemapRows} of another
	 * tree) instead of tiling afresh, so tiles keep their neighbours across a
	 * transition. Children no row lists are squarified into what is left.
	 */
	keepRows?: TreemapRows;
}

/**
 * One row of a squarified parent: its children's labels in order, and
 * whether it runs across the parent (`dice`) or down it.
 *
 * @category Math & helpers
 */
export interface TreemapRow {
	dice: boolean;
	labels: readonly string[];
}

/**
 * The rows squarify chose for every parent, keyed by the parent's
 * JSON-encoded label path. See {@link treemapRows}.
 *
 * @category Math & helpers
 */
export type TreemapRows = ReadonlyMap<string, readonly TreemapRow[]>;

/** @category Math */
export interface PartitionOptions<T> extends HierarchyOptions<T> {
	/** Extent of the breadth axis (siblings side by side). @default 1 */
	width?: number;
	/** Extent of the depth axis (one equal band per level). @default 1 */
	height?: number;
}

/** @category Math */
export interface PackOptions<T> extends HierarchyOptions<T> {
	/** Side of the square box; the root circle's diameter. @default 1 */
	size?: number;
	/** Gap between sibling circles and their parent's rim. @default 0 */
	padding?: number;
}

/** The normalised input node handed to d3. */
interface Entry<T> {
	datum: T;
	index: number;
	label: string;
	value: number;
	branch: number;
	children: Entry<T>[];
}

const defaultChildren = <T>(datum: T): readonly T[] | undefined => {
	if (datum === null || typeof datum !== "object") return undefined;
	const children = (datum as { children?: unknown }).children;
	return Array.isArray(children) ? (children as readonly T[]) : undefined;
};

const defaultValue = <T>(datum: T): number =>
	typeof datum === "number" ? datum : 0;

/**
 * Reads the input tree into {@link Entry} records, in pre-order.
 *
 * @throws {Error} If a node is its own ancestor.
 */
function normalise<T>(root: T, options: HierarchyOptions<T>): Entry<T> {
	const childrenOf = options.children ?? defaultChildren;
	const sizeOf = options.value ?? defaultValue;
	const labelOf = options.label;
	const ancestors = new Set<unknown>();
	let next = 0;

	const visit = (datum: T, branch: number, depth: number): Entry<T> => {
		if (datum !== null && typeof datum === "object") {
			if (ancestors.has(datum)) {
				throw new Error(
					"Hierarchy data contains a cycle: a node is its own ancestor.",
				);
			}
			ancestors.add(datum);
		}
		const index = next++;
		const raw = childrenOf(datum, index);
		const kids = Array.isArray(raw) ? raw : [];
		const label = labelOf ? String(labelOf(datum, index) ?? "") : "";
		const entry: Entry<T> = {
			datum,
			index,
			label,
			value: 0,
			branch,
			children: kids.map((child, i) =>
				visit(child, depth === 0 ? i : branch, depth + 1),
			),
		};
		if (entry.children.length === 0) {
			const value = Number(sizeOf(datum, index));
			entry.value = Number.isFinite(value) && value > 0 ? value : 0;
		}
		ancestors.delete(datum);
		return entry;
	};
	return visit(root, -1, 0);
}

/** The d3 hierarchy over the normalised tree, summed and (optionally) sorted. */
function buildHierarchy<T>(
	root: T,
	options: HierarchyOptions<T>,
): HierarchyNode<Entry<T>> {
	const tree = hierarchy(normalise(root, options), (entry) => entry.children);
	tree.sum((entry) => (entry.children.length === 0 ? entry.value : 0));
	if (options.sort !== false) {
		tree.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
	}
	return tree;
}

/** The pre-order list of positively-valued nodes, each extended by `extra`. */
function flatten<T, N extends HierarchyNode<Entry<T>>, X>(
	tree: N,
	extra: (node: N) => X,
): (HierarchyNodeInfo<T> & X)[] {
	const out: (HierarchyNodeInfo<T> & X)[] = [];
	if (!((tree.value ?? 0) > 0)) return out;
	const position = new Map<HierarchyNode<Entry<T>>, number>();
	const paths = new Map<HierarchyNode<Entry<T>>, string[]>();
	tree.eachBefore((node) => {
		const n = node as N;
		const value = n.value ?? 0;
		if (!(value > 0)) return;
		const parentPath = n.parent ? (paths.get(n.parent) ?? []) : [];
		const path = [...parentPath, n.data.label];
		paths.set(n, path);
		position.set(n, out.length);
		out.push({
			datum: n.data.datum,
			index: n.data.index,
			depth: n.depth,
			height: n.height,
			leaf: !n.children,
			label: n.data.label,
			path,
			value,
			branch: n.data.branch,
			parent: n.parent ? (position.get(n.parent) ?? -1) : -1,
			...extra(n),
		});
	});
	return out;
}

const orDefault = (value: number | undefined, fallback: number) =>
	value === undefined ? fallback : value;

const isBox = (width: number, height: number) =>
	Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

const TILES = {
	squarify: treemapSquarify,
	binary: treemapBinary,
	slice: treemapSlice,
	dice: treemapDice,
	sliceDice: treemapSliceDice,
	resquarify: treemapResquarify,
} as const;

/**
 * A treemap: each node a rectangle with area proportional to its value,
 * nested in its parent's; squarified by default.
 *
 * @returns Every node with a positive value in pre-order, or `[]` when the
 *   total is 0 or the box is empty.
 * @throws {Error} If the tree contains a cycle.
 * @category Math & helpers
 */
export function treemapLayout<T>(
	root: T,
	options: TreemapOptions<T> = {},
): HierarchyRect<T>[] {
	const laid = layTreemap(root, options);
	return laid
		? flatten(laid, (n) => ({ x0: n.x0, y0: n.y0, x1: n.x1, y1: n.y1 }))
		: [];
}

/** A d3 node as the tile functions see it. */
type TileNode<T> = HierarchyRectangularNode<Entry<T>>;
/** A d3 tile function. */
type Tile<T> = (
	node: TileNode<T>,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
) => void;

/** The JSON-encoded label path of a d3 node, root first. */
function pathKey<T>(node: HierarchyNode<Entry<T>>): string {
	return JSON.stringify(
		node
			.ancestors()
			.reverse()
			.map((n) => n.data.label),
	);
}

/** Runs the treemap over `root` with the options' box, tile and padding; null for an empty box. */
function layTreemap<T>(
	root: T,
	options: TreemapOptions<T>,
	tileOverride?: Tile<T>,
): TileNode<T> | null {
	const width = orDefault(options.width, 1);
	const height = orDefault(options.height, 1);
	if (!isBox(width, height)) return null;
	const padding = Math.max(0, options.padding ?? 0) || 0;
	const paddingTop = Math.max(0, options.paddingTop ?? padding) || 0;
	const base: Tile<T> = TILES[options.tile ?? "squarify"] ?? treemapSquarify;
	const kept = options.keepRows;
	const tile = tileOverride ?? (kept ? keptRowsTile(kept, base) : base);
	const tree = buildHierarchy(root, options);
	return treemap<Entry<T>>()
		.size([width, height])
		.tile(tile)
		.paddingInner(padding)
		.paddingRight(padding)
		.paddingBottom(padding)
		.paddingLeft(padding)
		.paddingTop((node) => (node.depth === 0 ? padding : paddingTop))
		.round(false)(tree);
}

/** A tile function laying each parent out in its kept rows, each row taking its children's share of the parent. */
function keptRowsTile<T>(rows: TreemapRows, fallback: Tile<T>): Tile<T> {
	return (parent, x0, y0, x1, y1) => {
		const saved = rows.get(pathKey(parent));
		const children = parent.children ?? [];
		if (!saved) {
			fallback(parent, x0, y0, x1, y1);
			return;
		}
		const byLabel = new Map<string, TileNode<T>>();
		for (const child of children)
			if (!byLabel.has(child.data.label)) byLabel.set(child.data.label, child);
		const used = new Set<TileNode<T>>();
		const groups: { dice: boolean; nodes: TileNode<T>[]; value: number }[] = [];
		for (const row of saved) {
			const nodes: TileNode<T>[] = [];
			for (const label of row.labels) {
				const child = byLabel.get(label);
				if (child && !used.has(child)) {
					used.add(child);
					nodes.push(child);
				}
			}
			const value = nodes.reduce((sum, n) => sum + (n.value ?? 0), 0);
			if (nodes.length > 0 && value > 0)
				groups.push({ dice: row.dice, nodes, value });
		}
		const rest = children.filter((child) => !used.has(child));
		let value = parent.value ?? 0;
		for (const group of groups) {
			const row = { children: group.nodes, value: group.value } as never;
			if (group.dice) {
				const y = value ? y0 + ((y1 - y0) * group.value) / value : y1;
				treemapDice(row, x0, y0, x1, y);
				y0 = y;
			} else {
				const x = value ? x0 + ((x1 - x0) * group.value) / value : x1;
				treemapSlice(row, x0, y0, x, y1);
				x0 = x;
			}
			value -= group.value;
		}
		if (rest.length > 0) {
			const leftover = {
				children: rest,
				value: rest.reduce((sum, n) => sum + (n.value ?? 0), 0),
			} as never;
			treemapSquarify(leftover, x0, y0, x1, y1);
		}
	};
}

/**
 * The rows squarify lays a tree's parents out in, for
 * {@link TreemapOptions.keepRows}: lay another tree out in the same rows so
 * its tiles keep their neighbours. Takes {@link treemapLayout}'s options
 * (`tile` is ignored).
 *
 * @returns Every parent's rows, children by label; empty for an empty box.
 * @throws {Error} If the tree contains a cycle.
 * @category Math & helpers
 */
export function treemapRows<T>(
	root: T,
	options: TreemapOptions<T> = {},
): TreemapRows {
	const out = new Map<string, TreemapRow[]>();
	// d3's resquarify keeps the rows it chose on the node (`_squarify`).
	const record: Tile<T> = (node, x0, y0, x1, y1) => {
		treemapResquarify(node, x0, y0, x1, y1);
		const rows = (
			node as unknown as {
				_squarify?: { dice: boolean; children: TileNode<T>[] }[];
			}
		)._squarify;
		if (rows)
			out.set(
				pathKey(node),
				rows.map((row) => ({
					dice: row.dice,
					labels: row.children.map((child) => child.data.label),
				})),
			);
	};
	layTreemap(root, { ...options, keepRows: undefined }, record);
	return out;
}

/**
 * A partition (icicle / sunburst) layout: one equal band per depth along
 * `y` (root at 0); along `x` each node spans its children, sized by value.
 * Use `width = 1` for a sunburst's turn fraction.
 *
 * @returns Every node with a positive value in pre-order, or `[]` when the
 *   total is 0 or the box is empty.
 * @throws {Error} If the tree contains a cycle.
 * @category Math & helpers
 */
export function partitionLayout<T>(
	root: T,
	options: PartitionOptions<T> = {},
): HierarchyRect<T>[] {
	const width = orDefault(options.width, 1);
	const height = orDefault(options.height, 1);
	if (!isBox(width, height)) return [];
	const tree = buildHierarchy(root, options);
	const laid = partition<Entry<T>>().size([width, height]).round(false)(tree);
	return flatten(laid, (n) => ({ x0: n.x0, y0: n.y0, x1: n.x1, y1: n.y1 }));
}

/**
 * Circle packing: leaves are circles with area proportional to value,
 * packed inside their parent's enclosing circle.
 *
 * @returns Every node with a positive value in pre-order, or `[]` when the
 *   total is 0 or the size is not positive.
 * @throws {Error} If the tree contains a cycle.
 * @category Math & helpers
 */
export function packLayout<T>(
	root: T,
	options: PackOptions<T> = {},
): HierarchyCircle<T>[] {
	const size = orDefault(options.size, 1);
	if (!isBox(size, size)) return [];
	const tree = buildHierarchy(root, options);
	if (!((tree.value ?? 0) > 0)) return [];
	// d3's pack sizes zero-valued leaves at r = 0 and they then confuse the
	// front chain; drop them before packing (they are dropped from the result
	// anyway).
	tree.each((node) => {
		if (node.children) {
			const kept = node.children.filter((child) => (child.value ?? 0) > 0);
			if (kept.length === 0) delete node.children;
			else node.children = kept;
		}
	});
	const laid = pack<Entry<T>>()
		.size([size, size])
		.padding(Math.max(0, options.padding ?? 0) || 0)(tree);
	return flatten(laid, (n) => ({ x: n.x, y: n.y, r: n.r }));
}
