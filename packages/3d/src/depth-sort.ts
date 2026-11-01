/**
 * Depth ordering across everything under one `<Camera3D>`: a painter's sort over
 * pieces from every solid, surface, curve and sphere.
 *
 * Primitives register `DepthItem`s with the camera's `DepthSorter`.
 * `sortByDepth` sweeps for pairs whose screen footprints overlap, orders each
 * pair with Newell-style exact tests (depth ranges, then plane sides), and
 * topologically sorts the result, breaking ties and cycles by farthest
 * centroid. The k-th piece gets the k-th smallest `-depth` value, so 2D shapes
 * interleave as `depthZ` documents. Pieces are never split, and past
 * `MAX_DEPTH_PAIRS` pairs fall back to centroid order.
 */

import type { Point3 } from "@sophistry/core/internal";
import type { ProjectedPoint } from "./project.js";

/**
 * One depth-sortable piece of a 3D primitive: a mesh face, a sphere's disc, a
 * curve, a vector, a grid.
 *
 * @category Camera
 */
export interface DepthItem {
	/** The world-space points the piece spans: a face's corners, a curve's samples, a sphere's centre. */
	world: readonly Point3[];
	/** Projections of the points that are drawn (scene units plus depth). Sets the screen footprint and the depth range. */
	screen: readonly ProjectedPoint[];
	/** Unit normal of the plane the piece lies in, for flat pieces (a face, a grid). Either orientation. */
	normal?: Point3;
	/**
	 * World radius around every point of `world` (a sphere).
	 * @default 0
	 */
	radius?: number;
	/**
	 * Screen radius around every point of `screen` (a sphere's disc).
	 * @default 0
	 */
	screenRadius?: number;
}

/**
 * The most overlapping pairs one sort tests. A scene past it (thousands of
 * faces stacked on screen) orders the untested pairs by centroid alone,
 * instead of letting one frame cost grow without bound.
 *
 * @category Camera
 */
export const MAX_DEPTH_PAIRS = 200_000;

/**
 * The most candidate pairs the sweep visits, counting those it then rejects
 * on y. Pairs overlapping on x alone (a tall column of faces, say) never
 * reach `MAX_DEPTH_PAIRS`, so without this the sweep was still quadratic.
 * Ten times the pair cap: the y test is cheap, and a scene within the pair
 * cap is cut short only when it is mostly such near misses.
 */
const MAX_DEPTH_VISITS = 10 * MAX_DEPTH_PAIRS;

/** Tolerance, in world and scene units, for "on the plane" and "touching". */
const EPS = 1e-6;

/**
 * Pieces with more projected points than this contribute no separating axes
 * of their own to the overlap test (the other piece's, and the bounding box,
 * still apply), which keeps a 200-sample curve from costing 200 axes per pair.
 */
const MAX_AXIS_POINTS = 16;

/**
 * Where `item` lies relative to the plane through `plane.world[0]` with normal
 * `plane.normal`: `1` wholly on the eye's side, `-1` wholly on the far side,
 * `0` straddling, on the plane, or the plane is edge-on to the eye.
 */
function sideOf(item: DepthItem, plane: DepthItem, eye: Point3): number {
	const n = plane.normal as Point3;
	const o = plane.world[0];
	const eyeSide =
		n.x * (eye.x - o.x) + n.y * (eye.y - o.y) + n.z * (eye.z - o.z);
	if (Math.abs(eyeSide) <= EPS) return 0;
	const sign = eyeSide > 0 ? 1 : -1;
	const r = item.radius ?? 0;
	let front = false;
	let back = false;
	for (const p of item.world) {
		const s =
			sign * (n.x * (p.x - o.x) + n.y * (p.y - o.y) + n.z * (p.z - o.z));
		if (s + r > EPS) front = true;
		if (s - r < -EPS) back = true;
		if (front && back) return 0;
	}
	return front ? 1 : back ? -1 : 0;
}

/** Does `axis` separate the two pieces' projected footprints? */
function separates(
	a: DepthItem,
	b: DepthItem,
	ax: number,
	ay: number,
): boolean {
	const len = Math.hypot(ax, ay);
	if (len <= 1e-12) return false;
	const ux = ax / len;
	const uy = ay / len;
	let aMin = Number.POSITIVE_INFINITY;
	let aMax = Number.NEGATIVE_INFINITY;
	for (const p of a.screen) {
		const t = p.x * ux + p.y * uy;
		if (t < aMin) aMin = t;
		if (t > aMax) aMax = t;
	}
	let bMin = Number.POSITIVE_INFINITY;
	let bMax = Number.NEGATIVE_INFINITY;
	for (const p of b.screen) {
		const t = p.x * ux + p.y * uy;
		if (t < bMin) bMin = t;
		if (t > bMax) bMax = t;
	}
	const ra = a.screenRadius ?? 0;
	const rb = b.screenRadius ?? 0;
	return aMax + ra <= bMin - rb + EPS || bMax + rb <= aMin - ra + EPS;
}

/** Tries `item`'s consecutive-point edges as separating axes. */
function edgesSeparate(item: DepthItem, a: DepthItem, b: DepthItem): boolean {
	const pts = item.screen;
	if (pts.length < 2 || pts.length > MAX_AXIS_POINTS) return false;
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i];
		const q = pts[(i + 1) % pts.length];
		// The edge's normal is the axis.
		if (separates(a, b, -(q.y - p.y), q.x - p.x)) return true;
	}
	return false;
}

/**
 * Do the two pieces' screen footprints overlap (more than touch)? A
 * separating-axis test on the projected points — exact for two convex faces,
 * conservative (it may say "overlap" for pieces that don't) for anything
 * else, which only costs an unneeded ordering decision.
 */
function overlaps(a: DepthItem, b: DepthItem): boolean {
	if (edgesSeparate(a, a, b) || edgesSeparate(b, a, b)) return false;
	// A disc against a polygon: the axis from the disc's centre to the
	// polygon's nearest corner is the one edge normals can miss.
	const disc =
		(a.screenRadius ?? 0) > 0 ? a : (b.screenRadius ?? 0) > 0 ? b : null;
	if (disc && disc.screen.length === 1) {
		const other = disc === a ? b : a;
		const c = disc.screen[0];
		let best: ProjectedPoint | null = null;
		let bestD = Number.POSITIVE_INFINITY;
		for (const p of other.screen) {
			const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
			if (d < bestD) {
				bestD = d;
				best = p;
			}
		}
		if (best && separates(a, b, best.x - c.x, best.y - c.y)) return false;
	}
	return true;
}

/**
 * Which of two overlapping pieces must paint first: `-1` for `a`, `1` for
 * `b`, `0` when no test decides (left to centroid order).
 */
function decide(
	a: DepthItem,
	b: DepthItem,
	aNear: number,
	aFar: number,
	bNear: number,
	bFar: number,
	eye: Point3,
): number {
	// Depth ranges that don't overlap: the farther piece is behind along every
	// ray (camera-space depth is monotone along a ray from the eye).
	const aInFront = aFar <= bNear + EPS;
	const bInFront = bFar <= aNear + EPS;
	if (aInFront !== bInFront) return aInFront ? 1 : -1;

	// Plane tests: a piece wholly on the far side of the other's plane is
	// behind it; a piece wholly on the eye's side of the other's plane is in
	// front of it. Each is exact for flat pieces that don't intersect.
	const aVsB = b.normal ? sideOf(a, b, eye) : 0;
	const bVsA = a.normal ? sideOf(b, a, eye) : 0;
	const aFirst = aVsB === -1 || bVsA === 1;
	const bFirst = bVsA === -1 || aVsB === 1;
	if (aFirst !== bFirst) return aFirst ? -1 : 1;
	if (aFirst) return 0;

	// Two spheres: the one whose centre is farther from the eye is behind.
	if (
		!a.normal &&
		!b.normal &&
		a.world.length === 1 &&
		b.world.length === 1 &&
		(a.radius ?? 0) > 0 &&
		(b.radius ?? 0) > 0
	) {
		const pa = a.world[0];
		const pb = b.world[0];
		const da = (pa.x - eye.x) ** 2 + (pa.y - eye.y) ** 2 + (pa.z - eye.z) ** 2;
		const db = (pb.x - eye.x) ** 2 + (pb.y - eye.y) ** 2 + (pb.z - eye.z) ** 2;
		if (da !== db) return da > db ? -1 : 1;
	}
	return 0;
}

/**
 * Paint-order `z` for every piece, back to front: see the module header for
 * the algorithm and its limits.
 *
 * Pure and synchronous: `<Camera3D>` calls it from one memo over everything
 * registered under it, but it can be called directly (a test, a custom
 * renderer) on any list.
 *
 * @param items - The pieces to order. Empty pieces (no `screen` points) get `0`.
 * @param eye - The camera's world-space eye position.
 * @returns One `z` per item, same indices: strictly increasing in paint order, drawn from the items' own `-depth` values.
 *
 * @category Camera
 */
export function sortByDepth(
	items: readonly DepthItem[],
	eye: Point3,
): Float64Array {
	const n = items.length;
	const z = new Float64Array(n);
	if (n === 0) return z;

	const minX = new Float64Array(n);
	const maxX = new Float64Array(n);
	const minY = new Float64Array(n);
	const maxY = new Float64Array(n);
	const near = new Float64Array(n);
	const far = new Float64Array(n);
	const mean = new Float64Array(n);
	const live: number[] = [];
	for (let i = 0; i < n; i++) {
		const item = items[i];
		const pts = item.screen;
		if (pts.length === 0) continue;
		live.push(i);
		const sr = item.screenRadius ?? 0;
		const r = item.radius ?? 0;
		let x0 = Number.POSITIVE_INFINITY;
		let x1 = Number.NEGATIVE_INFINITY;
		let y0 = Number.POSITIVE_INFINITY;
		let y1 = Number.NEGATIVE_INFINITY;
		let d0 = Number.POSITIVE_INFINITY;
		let d1 = Number.NEGATIVE_INFINITY;
		let sum = 0;
		for (const p of pts) {
			if (p.x < x0) x0 = p.x;
			if (p.x > x1) x1 = p.x;
			if (p.y < y0) y0 = p.y;
			if (p.y > y1) y1 = p.y;
			if (p.depth < d0) d0 = p.depth;
			if (p.depth > d1) d1 = p.depth;
			sum += p.depth;
		}
		minX[i] = x0 - sr;
		maxX[i] = x1 + sr;
		minY[i] = y0 - sr;
		maxY[i] = y1 + sr;
		near[i] = d0 - r;
		far[i] = d1 + r;
		mean[i] = sum / pts.length;
	}

	// Ordering constraints: `edges[i]` lists the pieces that must paint after
	// `i`. Allocated per piece only when it gets one.
	const edges: (number[] | undefined)[] = new Array(n);
	const indegree = new Int32Array(n);
	const byX = live.slice().sort((a, b) => minX[a] - minX[b]);
	let pairs = 0;
	let visits = 0;
	sweep: for (let s = 0; s < byX.length; s++) {
		const i = byX[s];
		for (let t = s + 1; t < byX.length; t++) {
			const j = byX[t];
			if (minX[j] >= maxX[i] - EPS) break;
			if (++visits > MAX_DEPTH_VISITS) break sweep;
			if (minY[j] >= maxY[i] - EPS || minY[i] >= maxY[j] - EPS) continue;
			if (++pairs > MAX_DEPTH_PAIRS) break sweep;
			if (!overlaps(items[i], items[j])) continue;
			const order = decide(
				items[i],
				items[j],
				near[i],
				far[i],
				near[j],
				far[j],
				eye,
			);
			if (order === 0) continue;
			const from = order < 0 ? i : j;
			const to = order < 0 ? j : i;
			const list = edges[from];
			if (list) list.push(to);
			else edges[from] = [to];
			indegree[to]++;
		}
	}

	// Farthest centroid first; document (index) order breaks exact ties, as
	// the renderer's stable sort would.
	const before = (a: number, b: number) =>
		mean[a] !== mean[b] ? mean[a] > mean[b] : a < b;
	const byDepth = live.slice().sort((a, b) => (before(a, b) ? -1 : 1));

	// Kahn's algorithm over a binary heap keyed by `before`.
	const heap: number[] = [];
	const push = (v: number) => {
		heap.push(v);
		let c = heap.length - 1;
		while (c > 0) {
			const p = (c - 1) >> 1;
			if (!before(heap[c], heap[p])) break;
			[heap[c], heap[p]] = [heap[p], heap[c]];
			c = p;
		}
	};
	const pop = (): number => {
		const top = heap[0];
		const last = heap.pop() as number;
		if (heap.length > 0) {
			heap[0] = last;
			let p = 0;
			for (;;) {
				const l = 2 * p + 1;
				const r = l + 1;
				let m = p;
				if (l < heap.length && before(heap[l], heap[m])) m = l;
				if (r < heap.length && before(heap[r], heap[m])) m = r;
				if (m === p) break;
				[heap[m], heap[p]] = [heap[p], heap[m]];
				p = m;
			}
		}
		return top;
	};

	const emitted = new Uint8Array(n);
	for (const i of live) if (indegree[i] === 0) push(i);
	let cursor = 0;
	let prev = Number.NEGATIVE_INFINITY;
	for (let k = 0; k < byDepth.length; k++) {
		let next: number;
		if (heap.length > 0) {
			next = pop();
		} else {
			// A cycle: every remaining piece waits on another. Break it at the
			// farthest remaining centroid, as the plain centroid sort would.
			while (emitted[byDepth[cursor]]) cursor++;
			next = byDepth[cursor];
		}
		emitted[next] = 1;
		const list = edges[next];
		if (list) {
			for (const to of list) {
				if (--indegree[to] === 0 && !emitted[to]) push(to);
			}
		}
		// The k-th piece painted gets the k-th smallest `-depth`, nudged so the
		// sequence strictly increases (the renderer's tie-break is document
		// order, which would undo the sort).
		let value = -mean[byDepth[k]];
		if (value <= prev) value = prev + Math.max(1e-9, Math.abs(prev) * 1e-12);
		z[next] = value;
		prev = value;
	}
	return z;
}

/**
 * One primitive's part in a camera's depth sort: what a 3D node implements
 * to register with {@link DepthSorter.register}.
 *
 * @category Camera
 */
export interface DepthSource {
	/**
	 * Brings the source up to date (it may refresh its node) and returns its
	 * current pieces. An explicit `zIndex` returns none: it opts out.
	 */
	depthItems(): readonly DepthItem[];
	/**
	 * Hands the source its slice of the latest sort (one `z` per item, same
	 * indices) when the slice's values or the items it was computed for
	 * changed. Must only mark (invalidate), never compute.
	 */
	depthSorted(z: Float64Array): void;
}

/**
 * The per-camera registry behind {@link sortByDepth}: what `camera3D`
 * publishes as `Camera3DValue.depthOrder`.
 *
 * @category Camera
 */
export interface DepthSorter {
	/**
	 * Adds a source to the sort (in registration order, which breaks exact
	 * ties). Returns the function that removes it again.
	 */
	register(source: DepthSource): () => void;
	/**
	 * Tells the sorter a source's pieces changed: one sort runs later in the
	 * same commit, after every source marked meanwhile, and hands each source
	 * whose slice changed its new `z`.
	 */
	changed(): void;
}

/** What the sorter remembers of a source between sorts. */
interface SourceState {
	readonly source: DepthSource;
	/** The items the last sort placed. */
	items: readonly DepthItem[] | null;
	/** Their `z`, as last handed over. */
	z: Float64Array | null;
}

/** Element-wise equality of two sort slices. */
function sameNumbers(a: Float64Array | null, b: Float64Array): boolean {
	if (a === b) return true;
	if (!a || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/**
 * A depth sorter plus the `sort` its owner runs once per scheduled pass.
 *
 * @internal
 */
export interface DepthSorterRunner extends DepthSorter {
	/** Sorts every registered source's pieces and hands out changed slices. */
	sort(): void;
}

/**
 * Builds the sorter for one camera. `schedule` asks for `sort` to run later
 * in the current commit (the camera queues a hidden node that runs it), so
 * a camera move that re-projects every primitive costs one sort, not one per
 * primitive, and the sort sees every primitive's new pieces.
 *
 * @param eye - The camera's eye position, read when sorting.
 * @param schedule - Requests one `sort` call.
 * @returns The sorter.
 * @internal Called by `camera3D`.
 */
export function createDepthSorter(
	eye: () => Point3,
	schedule: () => void,
): DepthSorterRunner {
	const sources: SourceState[] = [];
	let sorting = false;
	let scheduled = false;
	/** A source registered while a sort was collecting: it needs another. */
	let missed = false;

	function changed(): void {
		// A source refreshed by the sort itself is collected by that sort.
		if (sorting || scheduled) return;
		scheduled = true;
		schedule();
	}

	return {
		register(source) {
			const state: SourceState = { source, items: null, z: null };
			sources.push(state);
			if (sorting) missed = true;
			else changed();
			return () => {
				const at = sources.indexOf(state);
				if (at < 0) return;
				sources.splice(at, 1);
				// The rest keep their order but their z values are drawn from
				// every piece's depth, so they may shift.
				changed();
			};
		},
		changed,
		sort() {
			scheduled = false;
			sorting = true;
			try {
				const states = sources.slice();
				const all: DepthItem[] = [];
				const lists: (readonly DepthItem[])[] = new Array(states.length);
				const offsets = new Int32Array(states.length);
				for (let s = 0; s < states.length; s++) {
					const items = states[s].source.depthItems();
					lists[s] = items;
					offsets[s] = all.length;
					for (const item of items) all.push(item);
				}
				const z = sortByDepth(all, eye());
				for (let s = 0; s < states.length; s++) {
					const state = states[s];
					const items = lists[s];
					if (items.length === 0 && state.items === null) continue;
					const slice = z.subarray(offsets[s], offsets[s] + items.length);
					// Compared by value: a re-sort that leaves these pieces where they
					// were notifies nobody here, so one moving item re-runs only the
					// primitives whose `z` actually changed.
					if (state.items === items && sameNumbers(state.z, slice)) continue;
					state.items = items;
					state.z = slice;
					state.source.depthSorted(slice);
				}
			} finally {
				sorting = false;
			}
			if (missed) {
				missed = false;
				changed();
			}
		},
	};
}
