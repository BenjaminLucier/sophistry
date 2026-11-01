/**
 * Node-link tree layouts (the tidy tree and the cluster dendrogram) over a
 * nested tree of plain objects, plus the polyline of one link. Every node is
 * kept. Coordinates are in the layout's box: `x` along the breadth axis
 * (`[0, width]`), `y` along the depth axis (root at 0, deepest at `height`).
 */

import type { Point } from "@sophistry/core/geometry";
import type { HierarchyNode } from "d3-hierarchy";
import { cluster, hierarchy, tree } from "d3-hierarchy";
import type { HierarchyNodeInfo, HierarchyOptions } from "./hierarchy.js";

/**
 * Node-link layout: `"tidy"` places each level at its own depth with parents
 * centred over their children; `"cluster"` is a dendrogram, every leaf at
 * the far depth.
 *
 * @category Math & helpers
 */
export type TreeLayoutKind = "tidy" | "cluster";

/** @category Math */
export interface TreeLayoutOptions<T> extends HierarchyOptions<T> {
	/** Which layout; see {@link TreeLayoutKind}. @default "tidy" */
	layout?: TreeLayoutKind;
	/** Extent of the breadth axis (`x`, siblings side by side). @default 1 */
	width?: number;
	/** Extent of the depth axis (`y`, root at 0). @default 1 */
	height?: number;
	/**
	 * Gap between neighbours with different parents, relative to the sibling
	 * gap (1); 1 spaces every neighbour evenly.
	 * @default 2
	 */
	separation?: number;
	/** A leaf's value; geometry does not depend on it. Omitted, every node's value is its leaf count. */
	value?: (datum: T, index: number) => number;
	/** Order siblings by descending value. @default false */
	sort?: boolean;
	/**
	 * A node's height above the leaves (a dendrogram's merge distance),
	 * placing it along the depth axis instead of its depth: the greatest
	 * distance at `y = 0`, 0 at `y = height`. A parent's missing or too-small
	 * distance is raised to its tallest child's.
	 */
	distance?: (datum: T, index: number) => number;
	/**
	 * Lay out for a radial tree, dividing neighbour gaps by depth. Pair with
	 * `width = 2π` and {@link radialTreePoint}.
	 * @default false
	 */
	radial?: boolean;
}

/**
 * One laid-out tree node: {@link HierarchyNodeInfo} plus its position.
 *
 * @category Math & helpers
 */
export interface TreeNode<T> extends HierarchyNodeInfo<T> {
	/** Position along the breadth axis, in `[0, width]`. */
	x: number;
	/** Position along the depth axis: 0 for the root, up to `height`. */
	y: number;
	/** The leaf's value, or the sum of a parent's leaves (the leaf count without `value`); may be 0. */
	value: number;
	/** The node's height above the leaves: its raised `distance` when given, else its height in levels. */
	distance: number;
}

/**
 * How a parent-child link is drawn: `"curve"`, a cubic leaving and reaching
 * along the depth axis; `"elbow"`, a right-angled dendrogram bracket.
 *
 * @category Math & helpers
 */
export type TreeLinkShape = "curve" | "elbow";

/** @category Math */
export interface TreeLinkOptions {
	/** Points sampled along a `"curve"` link, ends included. @default 24 */
	samples?: number;
}

/** The normalised input node handed to d3. */
interface Entry<T> {
	datum: T;
	index: number;
	label: string;
	value: number;
	branch: number;
	/** The node's own `distance`, NaN when none was given. */
	distance: number;
	children: Entry<T>[];
}

const defaultChildren = <T>(datum: T): readonly T[] | undefined => {
	if (datum === null || typeof datum !== "object") return undefined;
	const children = (datum as { children?: unknown }).children;
	return Array.isArray(children) ? (children as readonly T[]) : undefined;
};

/**
 * Reads the input tree into {@link Entry} records, in pre-order.
 *
 * @throws {Error} If a node is its own ancestor.
 */
function normalise<T>(root: T, options: TreeLayoutOptions<T>): Entry<T> {
	const childrenOf = options.children ?? defaultChildren;
	const sizeOf = options.value;
	const labelOf = options.label;
	const distanceOf = options.distance;
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
		const distance = distanceOf ? Number(distanceOf(datum, index)) : Number.NaN;
		const entry: Entry<T> = {
			datum,
			index,
			label,
			value: 0,
			branch,
			distance,
			children: kids.map((child, i) =>
				visit(child, depth === 0 ? i : branch, depth + 1),
			),
		};
		if (entry.children.length === 0) {
			if (sizeOf) {
				const value = Number(sizeOf(datum, index));
				entry.value = Number.isFinite(value) && value > 0 ? value : 0;
			} else {
				entry.value = 1;
			}
		}
		ancestors.delete(datum);
		return entry;
	};
	return visit(root, -1, 0);
}

const orDefault = (value: number | undefined, fallback: number) =>
	value === undefined ? fallback : value;

/**
 * A node-link tree layout: the tidy tree (`layout: "tidy"`) or the
 * dendrogram (`"cluster"`). The outermost nodes keep half a gap from the
 * edges, so a lone root sits at `width / 2`. Not the graph `treeLayout` in
 * `@sophistry/core/geometry`.
 *
 * @returns Every node in pre-order, or `[]` when the box is empty.
 * @throws {Error} If the tree contains a cycle.
 * @category Math & helpers
 */
export function hierarchyTreeLayout<T>(
	root: T,
	options: TreeLayoutOptions<T> = {},
): TreeNode<T>[] {
	const width = orDefault(options.width, 1);
	const height = orDefault(options.height, 1);
	if (
		!(Number.isFinite(width) && Number.isFinite(height)) ||
		width <= 0 ||
		height < 0
	)
		return [];
	const input = hierarchy(normalise(root, options), (entry) => entry.children);
	input.sum((entry) => (entry.children.length === 0 ? entry.value : 0));
	if (options.sort === true) {
		input.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
	}
	const cousins = Math.max(0, options.separation ?? 2) || 2;
	const separation = (a: HierarchyNode<Entry<T>>, b: HierarchyNode<Entry<T>>) =>
		(a.parent === b.parent ? 1 : cousins) /
		(options.radial ? Math.max(1, a.depth) : 1);
	// d3 divides by the depth extent; lay out in a unit depth and scale after,
	// so a zero `height` (everything on one line) stays finite.
	const laid =
		options.layout === "cluster"
			? cluster<Entry<T>>().size([width, 1]).separation(separation)(input)
			: tree<Entry<T>>().size([width, 1]).separation(separation)(input);

	// Heights above the leaves: given distances, raised to cover the children.
	const heights = new Map<HierarchyNode<Entry<T>>, number>();
	laid.eachAfter((n) => {
		if (!options.distance) {
			heights.set(n, n.height);
			return;
		}
		const own = n.data.distance;
		let floor = n.children ? Number.NEGATIVE_INFINITY : 0;
		for (const child of n.children ?? [])
			floor = Math.max(floor, heights.get(child) ?? 0);
		heights.set(n, Number.isFinite(own) ? Math.max(own, floor) : floor);
	});
	const top = heights.get(laid) ?? 0;
	/** Depth-axis position: by depth, or by distance below the root's. */
	const depthOf = (n: typeof laid) =>
		options.distance && top > 0
			? ((top - (heights.get(n) ?? 0)) / top) * height
			: n.y * height;

	const out: TreeNode<T>[] = [];
	const position = new Map<HierarchyNode<Entry<T>>, number>();
	const paths = new Map<HierarchyNode<Entry<T>>, string[]>();
	laid.eachBefore((n) => {
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
			value: n.value ?? 0,
			branch: n.data.branch,
			parent: n.parent ? (position.get(n.parent) ?? -1) : -1,
			x: n.x,
			y: depthOf(n),
			distance: heights.get(n) ?? n.height,
		});
	});
	return out;
}

/**
 * The polyline of one tree link from `parent` to `child`, in layout
 * coordinates; drawn by arc length it grows out of the parent.
 *
 * @returns `samples` points along a curve, or two or three for an elbow.
 * @category Math & helpers
 */
export function treeLink(
	parent: Point,
	child: Point,
	shape: TreeLinkShape,
	options: TreeLinkOptions = {},
): Point[] {
	if (shape === "elbow") {
		const corner = { x: child.x, y: parent.y };
		const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
		if (same(corner, parent) || same(corner, child)) {
			return [
				{ x: parent.x, y: parent.y },
				{ x: child.x, y: child.y },
			];
		}
		return [{ x: parent.x, y: parent.y }, corner, { x: child.x, y: child.y }];
	}
	const samples = Math.max(2, Math.floor(options.samples ?? 24) || 24);
	// Cubic with both control points at mid-depth: it leaves the parent and
	// reaches the child along the depth axis.
	const mid = (parent.y + child.y) / 2;
	const points: Point[] = [];
	for (let i = 0; i < samples; i++) {
		const t = i / (samples - 1);
		const u = 1 - t;
		const a = u * u * u;
		const b = 3 * u * u * t;
		const c = 3 * u * t * t;
		const d = t * t * t;
		points.push({
			x: (a + b) * parent.x + (c + d) * child.x,
			y: a * parent.y + (b + c) * mid + d * child.y,
		});
	}
	return points;
}

/**
 * A radial tree point in Cartesian coordinates, y up: `angle` in radians
 * clockwise from 12 o'clock (a node's `x` laid out with `width = 2π`), and
 * `radius` from `center` (a node's `y`).
 *
 * @category Math & helpers
 */
export function radialTreePoint(
	angle: number,
	radius: number,
	center: Point = { x: 0, y: 0 },
): Point {
	return {
		x: center.x + radius * Math.sin(angle),
		y: center.y + radius * Math.cos(angle),
	};
}

/** @category Math */
export interface RadialTreeLinkOptions extends TreeLinkOptions {
	/** The tree's centre. Defaults to the origin. */
	center?: Point;
	/** Points per radian along an elbow's arc. @default 24 */
	arcDensity?: number;
}

/**
 * The Cartesian polyline of one radial tree link, from `parent` to `child`
 * in layout coordinates (`x` angle, `y` radius). `"curve"` is the cubic in
 * polar coordinates; `"elbow"` runs round the parent's circle, then out.
 *
 * @category Math & helpers
 */
export function radialTreeLink(
	parent: Point,
	child: Point,
	shape: TreeLinkShape,
	options: RadialTreeLinkOptions = {},
): Point[] {
	const center = options.center ?? { x: 0, y: 0 };
	const toScene = (p: Point) => radialTreePoint(p.x, p.y, center);
	if (shape === "curve")
		return treeLink(parent, child, shape, options).map(toScene);
	const density = Math.max(1, options.arcDensity ?? 24);
	const steps = Math.max(1, Math.ceil(Math.abs(child.x - parent.x) * density));
	const points: Point[] = [];
	for (let i = 0; i <= steps; i++) {
		const angle = parent.x + ((child.x - parent.x) * i) / steps;
		points.push(radialTreePoint(angle, parent.y, center));
	}
	if (child.y !== parent.y) points.push(toScene(child));
	return points;
}
