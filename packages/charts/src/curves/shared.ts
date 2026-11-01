/**
 * What the line and area marks (`linePlot`, `stackPlot`, `fillBetween`,
 * `stairs`, `ecdf`, `density`, `regression`) share: the one path batch each
 * draws through (with the clip a sweep reveal needs), stable items so an
 * outline that did not move is prepared once, and group colours across a
 * keyed transition. Internal.
 *
 * Every curve mark draws one shape per group (a `series` category, or the
 * one `WHOLE` group), and those shapes have outlines of their own, so the
 * mark is one core `pathBatch` node: an item per line, band or region, each
 * with its own stroke or fill and opacity. A `reveal="length"` draw hands
 * each item its `progress` (the stroke traced along
 * the outline, a closed outline's fill coming up with it), over the whole
 * outline; the batch keeps an outline's arrays while only that changes, so
 * the renderer measures their arc length once.
 */

import type {
	Bindable,
	PathBatchItem,
	PathBatchItemsProps,
	PathBatchNode,
	SceneNode,
} from "@sophistry/core";
import { group, pathBatch } from "@sophistry/core";
import type {
	BandKey,
	Bounds,
	Point,
	Polyline,
} from "@sophistry/core/geometry";
import type { ChartLayer } from "../context.js";
import type { GroupJoin } from "../join.js";
import { uniqueKeys } from "../math/ordinal.js";
import type { GroupKey, SeriesState } from "../series.js";
import { WHOLE } from "../series.js";
import { deepEqual, shallowEqual } from "../util.js";

/**
 * A group's colour from the series scale, across a keyed transition: while
 * one runs, over both ends' categories (`data`'s first), so a category keeps
 * its colour. Undefined for {@link WHOLE}, or when an explicit colour wins.
 */
export function groupColors(
	layer: ChartLayer,
	series: SeriesState,
	join: GroupJoin,
): (key: GroupKey) => string | undefined {
	if (!join.active) return (key) => series.colorOf(key as BandKey);
	const scale = layer.colorScale(
		uniqueKeys([...series.categories, ...(join.toCategories ?? [])]),
	);
	return (key) => {
		if (key === WHOLE) return undefined;
		return series.scaled ? scale(key) : undefined;
	};
}

/** Whether two path batch items have the same outline (by value). */
function sameOutline(a: PathBatchItem, b: PathBatchItem): boolean {
	return (
		a.closed === b.closed &&
		samePolylines(a.polylines, b.polylines) &&
		(a.curvePaths === b.curvePaths || deepEqual(a.curvePaths, b.curvePaths))
	);
}

/** Whether two path batch items draw the same outline with the same paints and reveal. */
function sameItem(a: PathBatchItem, b: PathBatchItem): boolean {
	return (
		a.fill === b.fill &&
		a.stroke === b.stroke &&
		a.strokeWidth === b.strokeWidth &&
		a.opacity === b.opacity &&
		a.progress === b.progress &&
		a.dashOffset === b.dashOffset &&
		sameOutline(a, b)
	);
}

/**
 * `item` around `before`'s outline arrays: the batch's prepared outline,
 * and the arc-length tables the renderer keys on it, are kept.
 */
function withOutlineOf(
	before: PathBatchItem,
	item: PathBatchItem,
): PathBatchItem {
	const out: PathBatchItem = { ...item };
	if (before.polylines) out.polylines = before.polylines;
	if (before.curvePaths) out.curvePaths = before.curvePaths;
	return out;
}

function samePolylines(
	a: readonly Polyline[] | undefined,
	b: readonly Polyline[] | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const p = a[i] as Polyline;
		const q = b[i] as Polyline;
		if (p === q) continue;
		if (p.length !== q.length) return false;
		for (let j = 0; j < p.length; j++) {
			const u = p[j] as Point;
			const v = q[j] as Point;
			if (u.x !== v.x || u.y !== v.y) return false;
		}
	}
	return true;
}

/**
 * The one path batch of a curve mark, inside a group whose clip a sweep
 * reveal moves. Call once, in `setup`.
 */
export interface CurveBatch {
	/** The node to return from the mark: the group holding the batch. */
	readonly node: SceneNode;
	/** The batch itself. */
	readonly batch: PathBatchNode<PathBatchItemsProps>;
	/**
	 * Writes one update's items (`[slot key, item]` pairs, in paint order),
	 * shared props and clip. An item equal to the one its slot held last time
	 * is handed over as that same object, one whose outline alone is equal
	 * (its `progress` or a paint changed) around the same outline arrays, and
	 * an unchanged list as the same array, so the batch re-prepares only
	 * outlines that moved.
	 */
	update(
		items: readonly (readonly [unknown, PathBatchItem])[],
		shared: Bindable<Omit<PathBatchItemsProps, "items">>,
		clip?: Bounds | undefined,
	): void;
	/** The items as last written. */
	readonly items: readonly PathBatchItem[];
}

/** Makes a mark's {@link CurveBatch}. */
export function createCurveBatch(): CurveBatch {
	const batch = pathBatch.create({ items: [] });
	const holder = group.create({ children: [batch] });
	let previous = new Map<unknown, PathBatchItem>();
	let list: readonly PathBatchItem[] = [];
	let clipBox: Bounds | undefined;
	return {
		node: holder,
		batch,
		update(items, shared, clip) {
			const next = new Map<unknown, PathBatchItem>();
			const out: PathBatchItem[] = [];
			let same = items.length === list.length;
			items.forEach(([slot, item], i) => {
				const before = previous.get(slot);
				const kept = !before
					? item
					: sameItem(before, item)
						? before
						: sameOutline(before, item)
							? withOutlineOf(before, item)
							: item;
				next.set(slot, kept);
				out.push(kept);
				if (same && list[i] !== kept) same = false;
			});
			previous = next;
			if (!same) list = out;
			batch.update({ ...shared, items: list } as never);
			const box =
				clip && clipBox && shallowEqual(clip, clipBox) ? clipBox : clip;
			if (box !== clipBox) {
				clipBox = box;
				holder.set("clip", box);
			}
		},
		get items() {
			return list;
		},
	};
}

/** A group's slot key in a batch with more than one item per group (`"fill"`, `"line"`). */
export function slotOf(key: GroupKey, part: string): string {
	return `${part}:${typeof key === "symbol" ? "*" : `${typeof key}:${String(key)}`}`;
}
