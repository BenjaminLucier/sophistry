/**
 * Keyed transitions between two hierarchy layouts, matched by path of
 * names: one layout of the union tree at blend `t`, staged exit, then
 * update (matched nodes move), then enter. Pure in `t`, so it scrubs.
 */

import type { HierarchyNodeInfo } from "./hierarchy";
import type { JoinStaging } from "./join";
import {
	joinStages,
	keyedJoin,
	stageProgress,
	staggeredStageProgress,
} from "./join";

/**
 * Where a node of a joined layout came from, and how present it is.
 *
 * @category Math & helpers
 */
export interface HierarchyJoinInfo {
	/** 0..1: fading out (exit), whole (both ends), or fading in (enter). */
	presence: number;
	/** The node's position in the `from` layout, or -1 when it enters. */
	fromAt: number;
	/** The node's position in the `to` layout, or -1 when it exits. */
	toAt: number;
	/** How far the update stage has got, 0..1 (for blending colours). */
	update: number;
}

/**
 * Options for {@link hierarchyJoin}.
 *
 * @category Math & helpers
 */
export interface HierarchyJoinOptions<N> {
	/** The blend, 0..1: 0 is `from`'s layout, 1 is `to`'s. */
	blend: number;
	/** `"staged"`: exit, then update, then enter; `"together"`: all at once, linearly. @default "staged" */
	staging?: JoinStaging;
	/** The numeric fields that place a node (`["x0", "x1", "y0", "y1"]` or `["x", "y", "r"]`). */
	fields: readonly (keyof N & string)[];
	/**
	 * Fraction of the enter stage spent staggering entering nodes, 0..0.95, in
	 * `to`'s pre-order (parents before children).
	 * @default 0
	 */
	enterStagger?: number;
}

/**
 * Each node's identity in a layout: its path of names, repeated sibling names
 * told apart by occurrence. The root's key is always `""`.
 *
 * @category Math & helpers
 */
export function hierarchyKeys<T>(
	nodes: readonly HierarchyNodeInfo<T>[],
): string[] {
	const keys: string[] = [];
	const seen = new Map<string, number>();
	for (const node of nodes) {
		if (node.parent < 0) {
			keys.push("");
			continue;
		}
		const base = `${keys[node.parent]}/${JSON.stringify(node.label)}`;
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		keys.push(count === 0 ? base : `${base}#${count}`);
	}
	return keys;
}

/** Each node's children positions, by parent position. */
function childrenOf<T>(nodes: readonly HierarchyNodeInfo<T>[]): number[][] {
	const out: number[][] = nodes.map(() => []);
	nodes.forEach((node, i) => {
		if (node.parent >= 0) out[node.parent]?.push(i);
	});
	return out;
}

/**
 * Two layouts of one kind (same layout function and options) joined at
 * blend `t` into one layout of the union tree, in pre-order. Matched nodes
 * move on the update stage (`fields` and `value` blended); nodes only in
 * `from` fade out in place; nodes only in `to` fade in at their new place.
 *
 * @param from - The layout at `blend = 0`.
 * @param to - The layout at `blend = 1`.
 * @category Math & helpers
 */
export function hierarchyJoin<T, N extends HierarchyNodeInfo<T>>(
	from: readonly N[],
	to: readonly N[],
	options: HierarchyJoinOptions<N>,
): (N & HierarchyJoinInfo)[] {
	if (from.length === 0 && to.length === 0) return [];
	const fromKeys = hierarchyKeys(from);
	const toKeys = hierarchyKeys(to);
	const join = keyedJoin(fromKeys, toKeys);
	const stages = joinStages({
		exits: join.exits,
		enters: join.enters,
		staging: options.staging,
	});
	const t = options.blend > 0 ? (options.blend < 1 ? options.blend : 1) : 0;
	const exit = stageProgress(t, stages.exit, stages.eased);
	const update = stageProgress(t, stages.update, stages.eased);
	const enter = stageProgress(t, stages.enter, stages.eased);

	const toByKey = new Map(toKeys.map((key, i) => [key, i]));
	// The entering nodes' places in the stagger: `to`'s pre-order.
	const spread = options.enterStagger ?? 0;
	const enterRank = new Map<number, number>();
	if (spread > 0)
		toKeys.forEach((key, b) => {
			if (!join.from.has(key)) enterRank.set(b, enterRank.size);
		});
	const enterOf = (b: number) => {
		const rank = enterRank.get(b);
		return rank === undefined || enterRank.size < 2
			? enter
			: staggeredStageProgress(
					t,
					stages.enter,
					stages.eased,
					rank,
					enterRank.size,
					spread,
				);
	};
	const fromChildren = childrenOf(from);
	const toChildren = childrenOf(to);
	const out: (N & HierarchyJoinInfo)[] = [];

	const place = (a: number, b: number, parent: number, depth: number) => {
		const old = a >= 0 ? from[a] : undefined;
		const now = b >= 0 ? to[b] : undefined;
		let node: N & HierarchyJoinInfo;
		if (old && now) {
			const near = update < 0.5 ? old : now;
			node = {
				...near,
				value: old.value + (now.value - old.value) * update,
				presence: 1,
				fromAt: a,
				toAt: b,
				update,
			};
			const record = node as unknown as Record<string, unknown>;
			for (const field of options.fields) {
				const p = old[field] as number;
				const q = now[field] as number;
				record[field] = p + (q - p) * update;
			}
		} else {
			const only = (old ?? now) as N;
			node = {
				...only,
				presence: old ? 1 - exit : enterOf(b),
				fromAt: old ? a : -1,
				toAt: now ? b : -1,
				update,
			};
		}
		node.parent = parent;
		node.depth = depth;
		const at = out.length;
		out.push(node);
		const matched = new Set<number>();
		for (const child of a >= 0 ? (fromChildren[a] ?? []) : []) {
			const other = toByKey.get(fromKeys[child]);
			const pair = other !== undefined && other >= 0 ? other : -1;
			if (pair >= 0) matched.add(pair);
			place(child, pair, at, depth + 1);
		}
		for (const child of b >= 0 ? (toChildren[b] ?? []) : []) {
			if (!matched.has(child)) place(-1, child, at, depth + 1);
		}
	};
	place(from.length > 0 ? 0 : -1, to.length > 0 ? 0 : -1, -1, 0);
	return out;
}
