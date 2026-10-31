/**
 * Agglomerative hierarchical clustering: pairwise row distances, the merge
 * tree single, complete or average linkage builds, and the leaf order a
 * dendrogram follows. The tree feeds {@link hierarchyTreeLayout} with
 * `distance: (n) => n.height`.
 */

/**
 * How cluster distance is measured from member distances: `"single"` (the
 * closest pair; chained clusters), `"complete"` (the farthest pair; compact
 * clusters) or `"average"` (the mean over all pairs, UPGMA).
 *
 * @category Math & helpers
 */
export type ClusterLinkage = "single" | "complete" | "average";

/**
 * How far apart two rows are: `"euclidean"`, `"manhattan"` (sum of absolute
 * differences) or `"correlation"` (`1 − r`: rows that rise and fall
 * together are close whatever their level).
 *
 * @category Math & helpers
 */
export type ClusterMetric = "euclidean" | "manhattan" | "correlation";

/**
 * One node of a merge tree: a leaf (one input row) or the merge of two
 * clusters.
 *
 * @category Math & helpers
 */
export interface ClusterNode {
	/** The input row of a leaf; -1 for a merge. */
	index: number;
	/** The linkage distance at which the two children merged; 0 for a leaf. */
	height: number;
	/** How many rows the cluster holds. */
	size: number;
	/** A merge's two clusters, the one holding the lower row index first; absent on a leaf. */
	children?: [ClusterNode, ClusterNode];
}

/** @category Math */
export interface ClusterTree {
	/** The merge tree, or `null` when there are no rows. */
	root: ClusterNode | null;
	/** The rows in dendrogram (left-to-right leaf) order: the order to draw them in. */
	order: number[];
}

/** @category Math */
export interface ClusterOptions {
	/** See {@link ClusterLinkage}. @default "average" */
	linkage?: ClusterLinkage;
	/** See {@link ClusterMetric}. @default "euclidean" */
	metric?: ClusterMetric;
}

/**
 * The distance between every pair of rows. Non-finite entries are skipped
 * pairwise and the sum scaled up to all columns, so a gap neither shrinks
 * nor grows a distance; rows with no column in common get `NaN`.
 *
 * @param metric - Defaults to `"euclidean"`.
 * @returns A symmetric `n × n` matrix with zeros on the diagonal.
 * @category Math & helpers
 */
export function distanceMatrix(
	rows: readonly (readonly number[])[],
	metric: ClusterMetric = "euclidean",
): number[][] {
	const n = rows.length;
	const width = rows.reduce((w, row) => Math.max(w, row.length), 0);
	const out = Array.from({ length: n }, () => new Array<number>(n).fill(0));
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const d = pairDistance(rows[i], rows[j], width, metric);
			out[i][j] = d;
			out[j][i] = d;
		}
	}
	return out;
}

/** The distance between two rows over the columns both have. */
function pairDistance(
	a: readonly number[],
	b: readonly number[],
	width: number,
	metric: ClusterMetric,
): number {
	const xs: number[] = [];
	const ys: number[] = [];
	for (let k = 0; k < width; k++) {
		const x = a[k];
		const y = b[k];
		if (Number.isFinite(x) && Number.isFinite(y)) {
			xs.push(x);
			ys.push(y);
		}
	}
	const m = xs.length;
	if (m === 0) return Number.NaN;
	if (metric === "correlation") {
		const mx = xs.reduce((s, v) => s + v, 0) / m;
		const my = ys.reduce((s, v) => s + v, 0) / m;
		let sxy = 0;
		let sxx = 0;
		let syy = 0;
		for (let k = 0; k < m; k++) {
			sxy += (xs[k] - mx) * (ys[k] - my);
			sxx += (xs[k] - mx) ** 2;
			syy += (ys[k] - my) ** 2;
		}
		const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
		return 1 - Math.max(-1, Math.min(1, r));
	}
	const scale = width / m;
	let sum = 0;
	for (let k = 0; k < m; k++) {
		const d = Math.abs(xs[k] - ys[k]);
		sum += metric === "manhattan" ? d : d * d;
	}
	return metric === "manhattan" ? sum * scale : Math.sqrt(sum * scale);
}

/**
 * Agglomerative clustering over a distance matrix: the two closest clusters
 * merge until one is left. Ties merge the lowest row indices first, so it
 * is deterministic; heights rise toward the root. A non-finite distance
 * counts as the largest finite one. O(n³) in rows.
 *
 * @param linkage - Defaults to `"average"`.
 * @returns The merge tree and the dendrogram's leaf order.
 * @category Math & helpers
 */
export function linkageTree(
	distances: readonly (readonly number[])[],
	linkage: ClusterLinkage = "average",
): ClusterTree {
	const n = distances.length;
	if (n === 0) return { root: null, order: [] };
	let largest = 0;
	for (let i = 0; i < n; i++)
		for (let j = 0; j < n; j++) {
			const d = distances[i]?.[j];
			if (d !== undefined && Number.isFinite(d)) largest = Math.max(largest, d);
		}
	const read = (i: number, j: number) => {
		const d = distances[i]?.[j] ?? distances[j]?.[i];
		return d !== undefined && Number.isFinite(d) ? Math.max(0, d) : largest;
	};
	const d = Array.from({ length: n }, (_, i) =>
		Array.from({ length: n }, (_, j) => (i === j ? 0 : read(i, j))),
	);
	/** The cluster held in each slot (merges keep the lower slot), or null once merged away. */
	const clusters: (ClusterNode | null)[] = Array.from(
		{ length: n },
		(_, i) => ({
			index: i,
			height: 0,
			size: 1,
		}),
	);
	/** The lowest row index in each slot's cluster: its first leaf. */
	const first = Array.from({ length: n }, (_, i) => i);
	for (let step = 1; step < n; step++) {
		let a = -1;
		let b = -1;
		let best = Number.POSITIVE_INFINITY;
		for (let i = 0; i < n; i++) {
			if (!clusters[i]) continue;
			for (let j = i + 1; j < n; j++) {
				if (!clusters[j]) continue;
				if (d[i][j] < best) {
					best = d[i][j];
					a = i;
					b = j;
				}
			}
		}
		const left = clusters[a] as ClusterNode;
		const right = clusters[b] as ClusterNode;
		const [lo, hi] = first[a] <= first[b] ? [left, right] : [right, left];
		clusters[a] = {
			index: -1,
			height: best,
			size: left.size + right.size,
			children: [lo, hi],
		};
		clusters[b] = null;
		first[a] = Math.min(first[a], first[b]);
		for (let k = 0; k < n; k++) {
			if (k === a || !clusters[k]) continue;
			const da = d[a][k];
			const db = d[b][k];
			const merged =
				linkage === "single"
					? Math.min(da, db)
					: linkage === "complete"
						? Math.max(da, db)
						: (left.size * da + right.size * db) / (left.size + right.size);
			d[a][k] = merged;
			d[k][a] = merged;
		}
	}
	const root = clusters.find((c) => c !== null) ?? null;
	return { root, order: root ? leafOrder(root) : [] };
}

/**
 * Clusters rows by their values: {@link distanceMatrix} then
 * {@link linkageTree}.
 *
 * @param rows - One vector per row (non-finite entries are gaps).
 * @returns The merge tree and the rows' dendrogram order.
 * @category Math & helpers
 */
export function clusterRows(
	rows: readonly (readonly number[])[],
	options: ClusterOptions = {},
): ClusterTree {
	return linkageTree(
		distanceMatrix(rows, options.metric ?? "euclidean"),
		options.linkage ?? "average",
	);
}

/**
 * A merge tree's leaves, left to right: the input rows in dendrogram order.
 *
 * @category Math & helpers
 */
export function leafOrder(root: ClusterNode): number[] {
	const out: number[] = [];
	const stack: ClusterNode[] = [root];
	while (stack.length > 0) {
		const node = stack.pop() as ClusterNode;
		if (!node.children) out.push(node.index);
		else stack.push(node.children[1], node.children[0]);
	}
	return out;
}
