/**
 * Network graph layouts (Manim's `layout=`) as pure functions
 * `(graph, options) => Map<id, point>`, resolved by name through
 * `resolveGraphLayout`.
 *
 * Layouts are deterministic: `spring` is a hand-written Fruchterman-Reingold
 * seeded from a phyllotaxis spiral, with `fieldJitter` (not `Math.random`) to
 * separate coincident vertices; d3-force was avoided because building a
 * simulation starts a timer and mutates its nodes. Each algorithm works in its
 * own layout space, then is fitted uniformly to `scale` around `center`. No
 * layout throws or emits `NaN`; `tree` over a cyclic graph lays out a BFS
 * spanning forest.
 */

import { boundsOf } from "./bounds.js";
import { fieldJitter } from "./field.js";
import type { Point } from "./path/types.js";
import { createResolver } from "./resolver.js";

/**
 * Whatever the caller identifies a vertex by. Compared with `===`.
 *
 * @category Graph layouts
 */
export type VertexId = string | number;

/**
 * One edge of a graph, between two vertex ids.
 *
 * @category Graph layouts
 */
export interface GraphEdge {
	/** Id of the vertex the edge starts at. */
	source: VertexId;
	/** Id of the vertex the edge ends at. */
	target: VertexId;
	/** Scales a spring's pull. Every other layout ignores it. */
	weight?: number;
}

/**
 * The plain data a layout reads: vertex ids and the edges between them.
 *
 * @category Graph layouts
 */
export interface GraphData {
	/** Every vertex id, in the order the result map will iterate. */
	vertices: readonly VertexId[];
	/** Edges between the ids in `vertices`. */
	edges: readonly GraphEdge[];
	/**
	 * Read the edge list as directed. Only root-picking uses it — `tree` and
	 * `partite` prefer a vertex with no incoming edge when they have to guess a
	 * root, which is almost always the one the author meant.
	 */
	directed?: boolean;
}

/**
 * A square of this side, or an explicit box. In scene units.
 *
 * @category Graph layouts
 */
export type GraphExtent = number | { width: number; height: number };

/**
 * Which way the layered layouts (`tree`, `partite`) grow.
 *
 * @category Graph layouts
 */
export type GraphDirection = "down" | "up" | "right" | "left";

/**
 * One options bag for every layout (Manim's `layout_config`), so swapping layouts
 * is a one-word change; each layout ignores the fields it doesn't use.
 *
 * @category Graph layouts
 */
export interface GraphLayoutOptions {
	/** Box the result is fitted into. Defaults to a square of side 4. */
	scale?: GraphExtent;
	/** Centre of that box. Defaults to the origin. */
	center?: Point;
	/**
	 * `"contain"` (the default) scales both axes by the same factor, so the
	 * layout keeps its proportions and merely fills as much of `scale` as it can.
	 * `"stretch"` fills the box exactly, at the cost of distorting it.
	 * `"none"` leaves layout space alone entirely — no scale and no translation
	 * unless `center` is named, so `explicit` positions come back exactly as
	 * they went in.
	 */
	fit?: "contain" | "stretch" | "none";
	/** Growth direction for `tree` (default `"down"`) and `partite` (`"right"`). */
	direction?: GraphDirection;
	/** Root(s) for `tree`, and the BFS source for `shell`/`partite` layers. */
	root?: VertexId | readonly VertexId[];
	/**
	 * Explicit groups: columns for `partite`, rings for `shell` (innermost
	 * first). Vertices left out land in one extra final group. Absent, both
	 * derive their groups from BFS distance to `root`.
	 */
	partitions?: readonly (readonly VertexId[])[];
	/** Positions for the `explicit` layout. */
	positions?: ReadonlyMap<VertexId, Point> | Readonly<Record<string, Point>>;
	/** `grid`: defaults to `ceil(sqrt(n))` columns, or whatever `rows` implies. */
	columns?: number;
	/** `grid`: number of rows; only consulted when `columns` is absent. */
	rows?: number;
	/**
	 * `circular`/`shell`: angle in radians where the first vertex sits. The top by default.
	 * @default Math.PI / 2
	 */
	startAngle?: number;
	/** `circular`/`shell`: go clockwise instead of the mathematical direction. */
	clockwise?: boolean;
	/** `spring`: relaxation steps. Defaults to 300, reduced on large graphs. */
	iterations?: number;
	/** `spring`: perturbs the deterministic start, for when a layout tangles. */
	seed?: number;
	/**
	 * `tree`/`partite`: gap between neighbours within a level.
	 * @default 1
	 */
	siblingGap?: number;
	/**
	 * `tree`/`partite`: gap between levels.
	 * @default 1
	 */
	levelGap?: number;
}

/**
 * A layout: `(graph, options) => Map<id, point>`, in `graph.vertices` order.
 * Any function with this signature can be passed as `layout`.
 *
 * @category Graph layouts
 */
export type GraphLayout = (
	graph: GraphData,
	options: GraphLayoutOptions,
) => Map<VertexId, Point>;

const DEFAULT_SCALE = 4;
const DEFAULT_ITERATIONS = 300;
/**
 * Fruchterman–Reingold is O(n²) per step, and a graph big enough to matter is
 * usually pasted in rather than typed. Past this many pair-steps the iteration
 * count is cut instead: a looser layout, drawn this frame.
 */
const MAX_SPRING_WORK = 4_000_000;
/** Below this, two vertices count as coincident and get jittered apart. */
const COINCIDENT = 1e-9;

/* ------------------------------------------------------------------ shared */

interface Prepared {
	ids: VertexId[];
	index: Map<VertexId, number>;
	/** Undirected, deduplicated, self-loops removed — placement's view. */
	links: { u: number; v: number; weight: number }[];
	neighbors: number[][];
	/** Only meaningful when `graph.directed`; all zero otherwise. */
	indegree: number[];
}

/**
 * The graph as indices, which is the only form the algorithms want.
 *
 * Vertices named only by an edge are appended rather than ignored: Manim
 * requires every vertex to be declared and silently misplaces the ones that
 * aren't, and a vertex with no position is the direct route to a `NaN` on
 * screen.
 */
function prepare(graph: GraphData): Prepared {
	const ids: VertexId[] = [];
	const index = new Map<VertexId, number>();
	const add = (id: VertexId) => {
		if (index.has(id)) return;
		index.set(id, ids.length);
		ids.push(id);
	};
	for (const id of graph.vertices) add(id);
	for (const edge of graph.edges) {
		add(edge.source);
		add(edge.target);
	}

	const neighbors: number[][] = ids.map(() => []);
	const indegree = new Array<number>(ids.length).fill(0);
	const links: Prepared["links"] = [];
	const seen = new Set<string>();
	for (const edge of graph.edges) {
		const u = index.get(edge.source);
		const v = index.get(edge.target);
		if (u === undefined || v === undefined) continue;
		if (graph.directed) indegree[v] += 1;
		if (u === v) continue;
		const key = u < v ? `${u}:${v}` : `${v}:${u}`;
		if (seen.has(key)) continue;
		seen.add(key);
		neighbors[u].push(v);
		neighbors[v].push(u);
		links.push({ u, v, weight: edge.weight ?? 1 });
	}

	return { ids, index, links, neighbors, indegree };
}

function extentOf(scale: GraphExtent | undefined): {
	width: number;
	height: number;
} {
	if (scale === undefined)
		return { width: DEFAULT_SCALE, height: DEFAULT_SCALE };
	if (typeof scale === "number") return { width: scale, height: scale };
	return { width: scale.width, height: scale.height };
}

/**
 * Layout space → scene units: scale to `scale`, centre on `center`.
 *
 * A degenerate axis (every vertex on one row, or a single vertex) contributes
 * no scale factor rather than an infinite one, which is the whole of the
 * single-vertex and empty-graph story.
 */
function finish(
	ids: VertexId[],
	raw: Point[],
	options: GraphLayoutOptions,
	fallbackFit: GraphLayoutOptions["fit"] = "contain",
): Map<VertexId, Point> {
	const out = new Map<VertexId, Point>();
	if (ids.length === 0) return out;

	const fit =
		options.fit ?? (options.scale === undefined ? fallbackFit : "contain");
	// `"none"` with no `center` is the identity, so a caller who wrote out
	// coordinates gets those coordinates back rather than a recentred copy.
	if (fit === "none" && options.center === undefined) {
		for (let i = 0; i < ids.length; i++) {
			const point = raw[i] ?? { x: 0, y: 0 };
			out.set(ids[i], {
				x: Number.isFinite(point.x) ? point.x : 0,
				y: Number.isFinite(point.y) ? point.y : 0,
			});
		}
		return out;
	}
	const center = options.center ?? { x: 0, y: 0 };

	// A layout that produced a non-finite coordinate is a bug, but shipping it
	// to the renderer turns one bad vertex into an unbounded scene.
	const { minX, minY, maxX, maxY } = boundsOf([
		raw.map((point) => ({
			x: Number.isFinite(point.x) ? point.x : 0,
			y: Number.isFinite(point.y) ? point.y : 0,
		})),
	]);

	const spanX = maxX - minX;
	const spanY = maxY - minY;
	const box = extentOf(options.scale);
	let scaleX = 1;
	let scaleY = 1;
	if (fit === "stretch") {
		scaleX = spanX > 0 ? box.width / spanX : 1;
		scaleY = spanY > 0 ? box.height / spanY : 1;
	} else if (fit === "contain") {
		const candidates: number[] = [];
		if (spanX > 0) candidates.push(box.width / spanX);
		if (spanY > 0) candidates.push(box.height / spanY);
		scaleX = scaleY = candidates.length > 0 ? Math.min(...candidates) : 1;
	}

	const midX = (minX + maxX) / 2;
	const midY = (minY + maxY) / 2;
	for (let i = 0; i < ids.length; i++) {
		const point = raw[i] ?? { x: 0, y: 0 };
		const x = Number.isFinite(point.x) ? point.x : 0;
		const y = Number.isFinite(point.y) ? point.y : 0;
		out.set(ids[i], {
			x: center.x + (x - midX) * scaleX,
			y: center.y + (y - midY) * scaleY,
		});
	}
	return out;
}

/** The caller's roots as indices, in the order given; empty when unusable. */
function requestedRoots(
	options: GraphLayoutOptions,
	prepared: Prepared,
): number[] {
	const asked = options.root;
	if (asked === undefined) return [];
	const list = Array.isArray(asked)
		? (asked as readonly VertexId[])
		: [asked as VertexId];
	const out: number[] = [];
	for (const id of list) {
		const at = prepared.index.get(id);
		if (at !== undefined && !out.includes(at)) out.push(at);
	}
	return out;
}

/**
 * One root per connected component: the caller's, then — for components they
 * didn't name — a source vertex if the edges are directed and one exists, and
 * otherwise the component's first vertex in declaration order.
 *
 * Picking the first vertex is a guess, but it is a *legible* one: an author
 * writing out a tree lists the root first. The alternative (a min-eccentricity
 * centre) gives balanced pictures of graphs and surprising pictures of trees.
 */
function pickRoots(options: GraphLayoutOptions, prepared: Prepared): number[] {
	const n = prepared.ids.length;
	const roots = requestedRoots(options, prepared);
	const claimed = new Array<boolean>(n).fill(false);

	const claim = (from: number) => {
		if (claimed[from]) return;
		const queue = [from];
		claimed[from] = true;
		for (let head = 0; head < queue.length; head++) {
			for (const next of prepared.neighbors[queue[head]]) {
				if (claimed[next]) continue;
				claimed[next] = true;
				queue.push(next);
			}
		}
	};
	for (const root of roots) claim(root);

	for (let i = 0; i < n; i++) {
		if (claimed[i]) continue;
		// Walk the component looking for a source before settling for `i`.
		let best = i;
		const queue = [i];
		const seen = new Array<boolean>(n).fill(false);
		seen[i] = true;
		for (let head = 0; head < queue.length; head++) {
			const at = queue[head];
			if (prepared.indegree[at] === 0 && prepared.indegree[best] > 0) best = at;
			for (const next of prepared.neighbors[at]) {
				if (seen[next]) continue;
				seen[next] = true;
				queue.push(next);
			}
		}
		roots.push(best);
		claim(best);
	}
	return roots;
}

/**
 * BFS distance from every root at once, `-1` for anything unreachable.
 * Multi-source rather than per-root so a forest layers consistently.
 */
function bfsLevels(prepared: Prepared, roots: number[]): number[] {
	const level = new Array<number>(prepared.ids.length).fill(-1);
	const queue: number[] = [];
	for (const root of roots) {
		if (level[root] >= 0) continue;
		level[root] = 0;
		queue.push(root);
	}
	for (let head = 0; head < queue.length; head++) {
		const at = queue[head];
		for (const next of prepared.neighbors[at]) {
			if (level[next] >= 0) continue;
			level[next] = level[at] + 1;
			queue.push(next);
		}
	}
	return level;
}

/**
 * Turns `partitions` (or BFS levels, when none were given) into index groups.
 * Anything unassigned joins one extra trailing group rather than vanishing.
 */
function groupsOf(options: GraphLayoutOptions, prepared: Prepared): number[][] {
	const n = prepared.ids.length;
	const placed = new Array<boolean>(n).fill(false);
	const groups: number[][] = [];

	if (options.partitions) {
		for (const partition of options.partitions) {
			const group: number[] = [];
			for (const id of partition) {
				const at = prepared.index.get(id);
				if (at === undefined || placed[at]) continue;
				placed[at] = true;
				group.push(at);
			}
			groups.push(group);
		}
	} else {
		const level = bfsLevels(prepared, pickRoots(options, prepared));
		const depth = Math.max(0, ...level) + 1;
		for (let d = 0; d < depth; d++) groups.push([]);
		for (let i = 0; i < n; i++) {
			if (level[i] < 0) continue;
			placed[i] = true;
			groups[level[i]].push(i);
		}
	}

	const leftovers: number[] = [];
	for (let i = 0; i < n; i++) if (!placed[i]) leftovers.push(i);
	if (leftovers.length > 0) groups.push(leftovers);
	return groups.filter((group) => group.length > 0);
}

/* ------------------------------------------------------------------ spring */

/**
 * Fruchterman-Reingold on the unit square, deterministic: vertices start on a
 * phyllotaxis spiral, repel by `k²/d` and attract along edges by `d²/k`, with a
 * linearly cooling step cap and positions clamped to the square. Coincident
 * vertices get a direction from `fieldJitter`.
 */
/**
 * Runs the anneal, optionally handing every intermediate state to `visit`. The
 * cooling schedule depends on the iteration count, so a trajectory must come
 * from one run, not several runs of rising length.
 */
function runSpring(
	prepared: ReturnType<typeof prepare>,
	options: GraphLayoutOptions,
	visit?: (raw: Point[], step: number, total: number) => void,
	/**
	 * Layout-space starting positions, indexed like `prepared.ids`. A `null`
	 * entry means "no opinion" and gets the spiral. Used by `springGrowth` to
	 * continue a previous run rather than start a new one.
	 */
	initial?: (Point | null)[],
): Point[] {
	const n = prepared.ids.length;
	const seed = options.seed ?? 0;
	const golden = Math.PI * (3 - Math.sqrt(5));
	const xs = new Float64Array(n);
	const ys = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const given = initial?.[i];
		if (given) {
			xs[i] = Math.max(-0.5, Math.min(0.5, given.x));
			ys[i] = Math.max(-0.5, Math.min(0.5, given.y));
			continue;
		}
		const radius = 0.5 * Math.sqrt((i + 0.5) / n);
		const angle = i * golden;
		xs[i] = radius * Math.cos(angle) + fieldJitter(i, seed + 1) * 1e-3;
		ys[i] = radius * Math.sin(angle) + fieldJitter(i, seed + 2) * 1e-3;
	}
	const snapshot = (): Point[] => {
		const out: Point[] = new Array(n);
		for (let i = 0; i < n; i++) out[i] = { x: xs[i], y: ys[i] };
		return out;
	};

	if (n === 1) {
		const only = [{ x: 0, y: 0 }];
		visit?.(only, 0, 0);
		return only;
	}

	const asked = Math.max(
		1,
		Math.round(options.iterations ?? DEFAULT_ITERATIONS),
	);
	const iterations = Math.max(
		1,
		Math.min(asked, Math.floor(MAX_SPRING_WORK / (n * n))),
	);
	// The ideal edge length on a unit square holding `n` vertices.
	const k = Math.sqrt(1 / n);
	const dx = new Float64Array(n);
	const dy = new Float64Array(n);

	// Step 0 is the phyllotaxis seed itself — the picture before any force has
	// been applied, which is half of what watching the algorithm is about.
	visit?.(snapshot(), 0, iterations);

	for (let step = 0; step < iterations; step++) {
		const temperature = 0.1 * (1 - step / iterations);
		dx.fill(0);
		dy.fill(0);

		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				let ex = xs[i] - xs[j];
				let ey = ys[i] - ys[j];
				let distance = Math.hypot(ex, ey);
				if (distance < COINCIDENT) {
					const salt = i * n + j;
					ex = fieldJitter(salt, seed + 3);
					ey = fieldJitter(salt, seed + 4);
					distance = Math.hypot(ex, ey) || 1;
					ex = (ex / distance) * COINCIDENT;
					ey = (ey / distance) * COINCIDENT;
					distance = COINCIDENT;
				}
				const push = (k * k) / (distance * distance);
				dx[i] += ex * push;
				dy[i] += ey * push;
				dx[j] -= ex * push;
				dy[j] -= ey * push;
			}
		}

		for (const link of prepared.links) {
			const ex = xs[link.u] - xs[link.v];
			const ey = ys[link.u] - ys[link.v];
			const distance = Math.hypot(ex, ey);
			if (distance < COINCIDENT) continue;
			const pull = (distance * link.weight) / k;
			dx[link.u] -= ex * pull;
			dy[link.u] -= ey * pull;
			dx[link.v] += ex * pull;
			dy[link.v] += ey * pull;
		}

		for (let i = 0; i < n; i++) {
			const length = Math.hypot(dx[i], dy[i]);
			if (length < COINCIDENT) continue;
			const move = Math.min(length, temperature) / length;
			xs[i] = Math.max(-0.5, Math.min(0.5, xs[i] + dx[i] * move));
			ys[i] = Math.max(-0.5, Math.min(0.5, ys[i] + dy[i] * move));
		}

		visit?.(snapshot(), step + 1, iterations);
	}

	return snapshot();
}

/**
 * Force-directed layout (Fruchterman-Reingold), Manim's `layout="spring"` and
 * the default for `<NetworkGraph>`.
 *
 * Deterministic: the same graph and options give identical positions on every
 * run. Connected vertices attract (scaled by edge `weight`), all vertices
 * repel. Use `seed` to try a different start if a layout tangles, and see
 * {@link springTrajectory} to animate the relaxation.
 *
 * @param graph - Vertices and edges.
 * @param options - Fit settings, plus `iterations` (default 300) and `seed`.
 * @returns A map from vertex id to position, in `graph.vertices` order.
 *
 * @example
 * ```ts
 * import { createScene, networkGraph } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 8 });
 * scene.add(
 *   networkGraph.create({
 *     vertices: [1, 2, 3, 4],
 *     edges: [[1, 2], [2, 3], [3, 4], [4, 1]],
 *     layout: "spring",
 *   }),
 * );
 * ```
 *
 * @category Graph layouts
 */
export const springLayout: GraphLayout = (graph, options = {}) => {
	const prepared = prepare(graph);
	if (prepared.ids.length === 0) return new Map();
	return finish(prepared.ids, runSpring(prepared, options), options);
};

/**
 * Every state the spring layout passes through, from seed to answer, for
 * animating the relaxation; the last entry equals `springLayout`'s result. All
 * frames share the final state's fit, so the layout visibly expands. `samples`
 * thins it to at most that many frames.
 *
 * @param graph - Vertices and edges.
 * @param options - As for {@link springLayout}, plus `samples`, the most frames to return.
 * @returns Position maps from the seed state to the final layout; empty for an empty graph.
 *
 * @category Graph layouts
 */
export function springTrajectory(
	graph: GraphData,
	options: GraphLayoutOptions & { samples?: number } = {},
): Map<VertexId, Point>[] {
	const prepared = prepare(graph);
	if (prepared.ids.length === 0) return [];

	const states: Point[][] = [];
	runSpring(prepared, options, (raw) => states.push(raw));
	if (states.length === 0) return [];

	const wanted = options.samples;
	const kept =
		wanted !== undefined && wanted >= 2 && wanted < states.length
			? Array.from(
					{ length: wanted },
					(_, i) =>
						states[Math.round((i * (states.length - 1)) / (wanted - 1))],
				)
			: states;

	// The shared transform: `finish` derives it from the points it is given, so
	// running the final state through it and reading back the mapping is how one
	// frame's fit is applied to all of them without duplicating that arithmetic.
	const last = states[states.length - 1];
	const fitted = finish(prepared.ids, last, options);
	const reference = transformBetween(prepared.ids, last, fitted);

	return kept.map((raw) => {
		const out = new Map<VertexId, Point>();
		for (let i = 0; i < prepared.ids.length; i++) {
			const point = raw[i] ?? { x: 0, y: 0 };
			const x = Number.isFinite(point.x) ? point.x : 0;
			const y = Number.isFinite(point.y) ? point.y : 0;
			out.set(prepared.ids[i], {
				x: reference.offsetX + x * reference.scaleX,
				y: reference.offsetY + y * reference.scaleY,
			});
		}
		return out;
	});
}

/**
 * The settled layout after each vertex arrives, for animating a graph growing.
 * Each step is warm-started from the previous one (a new vertex starts at the
 * centroid of its placed neighbours), so the arrangement drifts rather than
 * reshuffling, and all steps share the final fit.
 *
 * @param graph - Vertices and edges.
 * @param options - As for {@link springLayout}, plus `order`, the sequence vertices arrive in.
 * @returns One position map per arrival step; empty for an empty graph.
 *
 * @category Graph layouts
 */
export function springGrowth(
	graph: GraphData,
	options: GraphLayoutOptions & {
		/** Order vertices arrive in. Defaults to `graph.vertices` order. */
		order?: readonly VertexId[];
	} = {},
): Map<VertexId, Point>[] {
	const prepared = prepare(graph);
	if (prepared.ids.length === 0) return [];

	const order = options.order ?? prepared.ids;
	const arrival = order.filter((id) => prepared.index.has(id));
	for (const id of prepared.ids) if (!arrival.includes(id)) arrival.push(id);

	const asked = Math.max(
		1,
		Math.round(options.iterations ?? DEFAULT_ITERATIONS),
	);
	/** A continuation is already close; it needs a nudge, not a fresh anneal. */
	const settle = Math.max(12, Math.round(asked / 4));

	const placed = new Map<VertexId, Point>();
	const steps: { ids: VertexId[]; raw: Point[] }[] = [];

	for (let count = 1; count <= arrival.length; count++) {
		const vertices = arrival.slice(0, count);
		const present = new Set(vertices.map(String));
		const sub = prepare({
			vertices,
			edges: graph.edges.filter(
				(edge) =>
					present.has(String(edge.source)) && present.has(String(edge.target)),
			),
			directed: graph.directed,
		});

		const initial = sub.ids.map((id, index) => {
			const known = placed.get(id);
			if (known) return known;
			// The newcomer: sit it among the neighbours it already has.
			let sumX = 0;
			let sumY = 0;
			let found = 0;
			for (const link of sub.links) {
				const other =
					link.u === index ? link.v : link.v === index ? link.u : -1;
				if (other < 0) continue;
				const at = placed.get(sub.ids[other]);
				if (!at) continue;
				sumX += at.x;
				sumY += at.y;
				found++;
			}
			if (found === 0) return null;
			const nudge = 1e-2;
			return {
				x: sumX / found + fieldJitter(count, 11) * nudge,
				y: sumY / found + fieldJitter(count, 13) * nudge,
			};
		});

		const raw = runSpring(
			sub,
			{ ...options, iterations: count === 1 ? asked : settle },
			undefined,
			initial,
		);

		placed.clear();
		for (let i = 0; i < sub.ids.length; i++) placed.set(sub.ids[i], raw[i]);
		steps.push({ ids: sub.ids, raw });
	}

	const last = steps[steps.length - 1];
	const fitted = finish(last.ids, last.raw, options);
	const reference = transformBetween(last.ids, last.raw, fitted);

	return steps.map((step) => {
		const out = new Map<VertexId, Point>();
		for (let i = 0; i < step.ids.length; i++) {
			const point = step.raw[i] ?? { x: 0, y: 0 };
			const x = Number.isFinite(point.x) ? point.x : 0;
			const y = Number.isFinite(point.y) ? point.y : 0;
			out.set(step.ids[i], {
				x: reference.offsetX + x * reference.scaleX,
				y: reference.offsetY + y * reference.scaleY,
			});
		}
		return out;
	});
}

/**
 * Recovers the affine `finish` applied, by comparing what went in with what came
 * out. Two well-separated coordinates determine it; a degenerate axis (every
 * vertex on one line) has no scale to recover, so it falls back to 1 and the
 * offset still centres correctly.
 */
function transformBetween(
	ids: VertexId[],
	raw: Point[],
	fitted: Map<VertexId, Point>,
): { scaleX: number; scaleY: number; offsetX: number; offsetY: number } {
	let scaleX = 1;
	let scaleY = 1;
	const first = fitted.get(ids[0]) ?? { x: 0, y: 0 };
	const rawFirst = raw[0] ?? { x: 0, y: 0 };

	for (let i = 1; i < ids.length; i++) {
		const point = fitted.get(ids[i]);
		if (!point) continue;
		const spanRawX = (raw[i]?.x ?? 0) - rawFirst.x;
		const spanRawY = (raw[i]?.y ?? 0) - rawFirst.y;
		if (Math.abs(spanRawX) > COINCIDENT)
			scaleX = (point.x - first.x) / spanRawX;
		if (Math.abs(spanRawY) > COINCIDENT)
			scaleY = (point.y - first.y) / spanRawY;
	}

	return {
		scaleX,
		scaleY,
		offsetX: first.x - rawFirst.x * scaleX,
		offsetY: first.y - rawFirst.y * scaleY,
	};
}

/* -------------------------------------------------------------------- tree */

interface TidyNode {
	parent: number;
	children: number[];
	/** Position among siblings — `moveSubtree` divides a shift by this gap. */
	number: number;
	x: number;
	mod: number;
	thread: number;
	ancestor: number;
	change: number;
	shift: number;
	depth: number;
}

/** Fresh per-vertex state for {@link tidyTree}; built once and shared by every root, since subtrees are disjoint. */
function buildTidyNodes(children: number[][], parent: number[]): TidyNode[] {
	const nodes: TidyNode[] = children.map((kids, i) => ({
		parent: parent[i],
		children: kids,
		number: 0,
		x: 0,
		mod: 0,
		thread: -1,
		ancestor: i,
		change: 0,
		shift: 0,
		depth: 0,
	}));
	for (const node of nodes) {
		node.children.forEach((child, at) => {
			nodes[child].number = at;
		});
	}
	return nodes;
}

/**
 * Reingold-Tilford with Buchheim, Jünger and Leipert's linear-time improvement.
 * Forests are packed side by side; explicit stacks instead of recursion, so very
 * deep trees don't overflow.
 */
function tidyTree(
	root: number,
	nodes: TidyNode[],
	distance: number,
): TidyNode[] {
	const left = (v: number) =>
		nodes[v].thread >= 0
			? nodes[v].thread
			: nodes[v].children.length > 0
				? nodes[v].children[0]
				: -1;
	const right = (v: number) =>
		nodes[v].thread >= 0
			? nodes[v].thread
			: nodes[v].children.length > 0
				? nodes[v].children[nodes[v].children.length - 1]
				: -1;
	const leftBrother = (v: number) => {
		const p = nodes[v].parent;
		if (p < 0 || nodes[v].number === 0) return -1;
		return nodes[p].children[nodes[v].number - 1];
	};
	const lmostSibling = (v: number) => {
		const p = nodes[v].parent;
		if (p < 0 || nodes[v].number === 0) return -1;
		return nodes[p].children[0];
	};

	const moveSubtree = (wl: number, wr: number, shift: number) => {
		const subtrees = nodes[wr].number - nodes[wl].number;
		if (subtrees === 0) return;
		nodes[wr].change -= shift / subtrees;
		nodes[wr].shift += shift;
		nodes[wl].change += shift / subtrees;
		nodes[wr].x += shift;
		nodes[wr].mod += shift;
	};

	const executeShifts = (v: number) => {
		let shift = 0;
		let change = 0;
		const kids = nodes[v].children;
		for (let i = kids.length - 1; i >= 0; i--) {
			const w = kids[i];
			nodes[w].x += shift;
			nodes[w].mod += shift;
			change += nodes[w].change;
			shift += nodes[w].shift + change;
		}
	};

	const ancestorOf = (vil: number, v: number, fallback: number) =>
		nodes[nodes[vil].ancestor].parent === nodes[v].parent
			? nodes[vil].ancestor
			: fallback;

	const apportion = (v: number, fallback: number): number => {
		const w = leftBrother(v);
		if (w < 0) return fallback;
		let defaultAncestor = fallback;
		let vir = v;
		let vor = v;
		let vil = w;
		let vol = lmostSibling(v);
		if (vol < 0) vol = v;
		let sir = nodes[v].mod;
		let sor = nodes[v].mod;
		let sil = nodes[vil].mod;
		let sol = nodes[vol].mod;

		while (right(vil) >= 0 && left(vir) >= 0) {
			vil = right(vil);
			vir = left(vir);
			vol = left(vol);
			vor = right(vor);
			nodes[vor].ancestor = v;
			const shift = nodes[vil].x + sil - (nodes[vir].x + sir) + distance;
			if (shift > 0) {
				moveSubtree(ancestorOf(vil, v, defaultAncestor), v, shift);
				sir += shift;
				sor += shift;
			}
			sil += nodes[vil].mod;
			sir += nodes[vir].mod;
			sol += nodes[vol].mod;
			sor += nodes[vor].mod;
		}

		if (right(vil) >= 0 && right(vor) < 0) {
			nodes[vor].thread = right(vil);
			nodes[vor].mod += sil - sor;
		} else {
			if (left(vir) >= 0 && left(vol) < 0) {
				nodes[vol].thread = left(vir);
				nodes[vol].mod += sir - sol;
			}
			defaultAncestor = v;
		}
		return defaultAncestor;
	};

	// First walk: preliminary x and mod, post-order, with `apportion` run on each
	// child the moment its own subtree is finished — which is exactly where the
	// recursive form calls it.
	const defaultAncestor = new Int32Array(nodes.length).fill(-1);
	const cursor = new Int32Array(nodes.length).fill(0);
	const stack = [root];
	while (stack.length > 0) {
		const v = stack[stack.length - 1];
		const node = nodes[v];
		if (cursor[v] === 0 && node.children.length > 0)
			defaultAncestor[v] = node.children[0];
		if (cursor[v] < node.children.length) {
			stack.push(node.children[cursor[v]++]);
			continue;
		}
		stack.pop();

		if (node.children.length === 0) {
			const brother = leftBrother(v);
			node.x = brother >= 0 ? nodes[brother].x + distance : 0;
		} else {
			executeShifts(v);
			const first = node.children[0];
			const last = node.children[node.children.length - 1];
			const midpoint = (nodes[first].x + nodes[last].x) / 2;
			const brother = leftBrother(v);
			if (brother >= 0) {
				node.x = nodes[brother].x + distance;
				node.mod = node.x - midpoint;
			} else {
				node.x = midpoint;
			}
		}

		if (node.parent >= 0)
			defaultAncestor[node.parent] = apportion(v, defaultAncestor[node.parent]);
	}

	// Second walk: fold the accumulated `mod` down the tree into real positions.
	const pending: { v: number; m: number; depth: number }[] = [
		{ v: root, m: 0, depth: 0 },
	];
	while (pending.length > 0) {
		const item = pending.pop();
		if (!item) break;
		const node = nodes[item.v];
		node.x += item.m;
		node.depth = item.depth;
		for (const child of node.children)
			pending.push({ v: child, m: item.m + node.mod, depth: item.depth + 1 });
	}

	return nodes;
}

/** Layout-space `(across, depth)` mapped onto scene axes. y is up. */
function orient(
	across: number,
	depth: number,
	direction: GraphDirection,
): Point {
	switch (direction) {
		case "up":
			return { x: across, y: depth };
		case "right":
			return { x: depth, y: -across };
		case "left":
			return { x: -depth, y: -across };
		default:
			return { x: across, y: -depth };
	}
}

/**
 * A tidy tree (Manim's `layout="tree"`) over a BFS spanning forest: cycles
 * become chords, and each component's root (`root`, else a vertex with no
 * incoming edge, else the first declared) gets its own tree, packed side by
 * side. Reads `root`, `direction` (default `"down"`), `siblingGap`, `levelGap`.
 *
 * @param graph - Vertices and edges.
 * @param options - Fit and layout settings.
 * @returns A map from vertex id to position, in `graph.vertices` order.
 *
 * @category Graph layouts
 */
export const treeLayout: GraphLayout = (graph, options = {}) => {
	const prepared = prepare(graph);
	const n = prepared.ids.length;
	if (n === 0) return new Map();

	const roots = pickRoots(options, prepared);
	const parent = new Array<number>(n).fill(-1);
	const children: number[][] = prepared.ids.map(() => []);
	const visited = new Array<boolean>(n).fill(false);

	for (const root of roots) {
		if (visited[root]) continue;
		visited[root] = true;
		const queue = [root];
		for (let head = 0; head < queue.length; head++) {
			const at = queue[head];
			for (const next of prepared.neighbors[at]) {
				if (visited[next]) continue;
				visited[next] = true;
				parent[next] = at;
				children[at].push(next);
				queue.push(next);
			}
		}
	}

	const direction = options.direction ?? "down";
	const siblingGap = options.siblingGap ?? 1;
	const levelGap = options.levelGap ?? 1;
	const raw = new Array<Point>(n).fill({ x: 0, y: 0 });

	const nodes = buildTidyNodes(children, parent);
	const placed = new Set<number>();
	let cursor = 0;
	for (const root of roots) {
		// A later root already swallowed by an earlier root's component is a
		// descendant, not a tree of its own; placing it again would overwrite.
		if (parent[root] !== -1 || placed.has(root)) continue;
		placed.add(root);
		tidyTree(root, nodes, 1);
		// Only this root's own subtree was walked; the rest of `nodes` is inert.
		const members: number[] = [];
		const walk = [root];
		while (walk.length > 0) {
			const at = walk.pop();
			if (at === undefined) break;
			members.push(at);
			for (const child of children[at]) walk.push(child);
		}
		let low = Number.POSITIVE_INFINITY;
		let high = Number.NEGATIVE_INFINITY;
		for (const at of members) {
			low = Math.min(low, nodes[at].x);
			high = Math.max(high, nodes[at].x);
		}
		const offset = cursor - low;
		for (const at of members)
			raw[at] = orient(
				(nodes[at].x + offset) * siblingGap,
				nodes[at].depth * levelGap,
				direction,
			);
		cursor += high - low + 1;
	}

	return finish(prepared.ids, raw, options);
};

/* ---------------------------------------------------------------- circular */

/**
 * Evenly around one ring, first vertex at `startAngle` (the top by default).
 * Reads `startAngle` and `clockwise`.
 *
 * @param graph - Vertices and edges (edges do not affect placement).
 * @param options - Fit and layout settings.
 * @returns A map from vertex id to position, in `graph.vertices` order.
 *
 * @category Graph layouts
 */
export const circularLayout: GraphLayout = (graph, options = {}) => {
	const prepared = prepare(graph);
	const n = prepared.ids.length;
	if (n === 0) return new Map();
	if (n === 1) return finish(prepared.ids, [{ x: 0, y: 0 }], options);

	const start = options.startAngle ?? Math.PI / 2;
	const sign = options.clockwise ? -1 : 1;
	const raw = prepared.ids.map((_, i) => {
		const angle = start + (sign * (2 * Math.PI * i)) / n;
		return { x: Math.cos(angle), y: Math.sin(angle) };
	});
	return finish(prepared.ids, raw, options);
};

/* -------------------------------------------------------------------- grid */

/**
 * Row-major, reading order, rows running downward because y is up. Reads
 * `columns` and `rows`.
 *
 * @param graph - Vertices and edges (edges do not affect placement).
 * @param options - Fit and layout settings.
 * @returns A map from vertex id to position, in `graph.vertices` order.
 *
 * @category Graph layouts
 */
export const gridLayout: GraphLayout = (graph, options = {}) => {
	const prepared = prepare(graph);
	const n = prepared.ids.length;
	if (n === 0) return new Map();

	const columns = Math.max(
		1,
		Math.round(
			options.columns ??
				(options.rows
					? Math.ceil(n / Math.max(1, options.rows))
					: Math.ceil(Math.sqrt(n))),
		),
	);
	const raw = prepared.ids.map((_, i) => ({
		x: i % columns,
		y: -Math.floor(i / columns),
	}));
	return finish(prepared.ids, raw, options);
};

/* ------------------------------------------------------------------- shell */

/**
 * Concentric rings (Manim's `layout="shell"`): rings from `partitions`, or BFS
 * distance from `root`. Alternate rings are rotated half a step so small rings
 * don't collapse onto one diameter.
 *
 * @param graph - Vertices and edges.
 * @param options - Fit settings plus `partitions`, `root`, `startAngle`, `clockwise`.
 * @returns A map from vertex id to position, in `graph.vertices` order.
 *
 * @category Graph layouts
 */
export const shellLayout: GraphLayout = (graph, options = {}) => {
	const prepared = prepare(graph);
	const n = prepared.ids.length;
	if (n === 0) return new Map();

	const rings = groupsOf(options, prepared);
	const centred = rings.length > 0 && rings[0].length === 1;
	const start = options.startAngle ?? Math.PI / 2;
	const sign = options.clockwise ? -1 : 1;
	const raw = new Array<Point>(n).fill({ x: 0, y: 0 });

	rings.forEach((ring, index) => {
		const radius = centred ? index : index + 1;
		const stagger = index % 2 === 0 ? 0 : (sign * Math.PI) / ring.length;
		ring.forEach((at, i) => {
			if (radius === 0 || ring.length === 0) {
				raw[at] = { x: 0, y: 0 };
				return;
			}
			const angle = start + stagger + (sign * (2 * Math.PI * i)) / ring.length;
			raw[at] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
		});
	});

	return finish(prepared.ids, raw, options);
};

/* ----------------------------------------------------------------- partite */

/**
 * Columns of vertices (Manim's `layout="partite"`): groups from `partitions`, or
 * BFS levels from `root`, run along `direction` (default `"right"`), each centred
 * across it.
 *
 * @param graph - Vertices and edges.
 * @param options - Fit settings plus `partitions`, `root`, `direction`, `siblingGap`, `levelGap`.
 * @returns A map from vertex id to position, in `graph.vertices` order.
 *
 * @category Graph layouts
 */
export const partiteLayout: GraphLayout = (graph, options = {}) => {
	const prepared = prepare(graph);
	const n = prepared.ids.length;
	if (n === 0) return new Map();

	const groups = groupsOf(options, prepared);
	const direction = options.direction ?? "right";
	const siblingGap = options.siblingGap ?? 1;
	const levelGap = options.levelGap ?? 1;
	const raw = new Array<Point>(n).fill({ x: 0, y: 0 });

	groups.forEach((group, index) => {
		group.forEach((at, i) => {
			const across = (i - (group.length - 1) / 2) * siblingGap;
			raw[at] = orient(across, index * levelGap, direction);
		});
	});

	return finish(prepared.ids, raw, options);
};

/* ---------------------------------------------------------------- explicit */

/**
 * The caller's own coordinates (Manim's `layout={vertex: point}`). Not refitted
 * unless `scale` is given; vertices without a position are spread on a ring.
 *
 * @param graph - Vertices and edges.
 * @param options - Must carry `positions`: a `Map` or a plain object keyed by `String(id)`.
 * @returns A map from vertex id to position, in `graph.vertices` order.
 *
 * @category Graph layouts
 */
export const explicitLayout: GraphLayout = (graph, options = {}) => {
	const prepared = prepare(graph);
	const n = prepared.ids.length;
	if (n === 0) return new Map();

	const source = options.positions;
	const lookup = (id: VertexId): Point | undefined => {
		if (!source) return undefined;
		if (source instanceof Map) return source.get(id);
		return (source as Record<string, Point>)[String(id)];
	};

	const raw = new Array<Point>(n).fill({ x: 0, y: 0 });
	const missing: number[] = [];
	const placed: Point[] = [];

	prepared.ids.forEach((id, i) => {
		const at = lookup(id);
		if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) {
			missing.push(i);
			return;
		}
		raw[i] = { x: at.x, y: at.y };
		placed.push(raw[i]);
	});

	if (missing.length > 0) {
		const known = n - missing.length;
		const { minX, minY, maxX, maxY } = boundsOf([placed]);
		const cx = known > 0 ? (minX + maxX) / 2 : 0;
		const cy = known > 0 ? (minY + maxY) / 2 : 0;
		const radius =
			known > 0
				? Math.max(maxX - minX, maxY - minY) / 2 + 1
				: missing.length / 4 + 1;
		missing.forEach((at, i) => {
			const angle = Math.PI / 2 + (2 * Math.PI * i) / missing.length;
			raw[at] = {
				x: cx + radius * Math.cos(angle),
				y: cy + radius * Math.sin(angle),
			};
		});
	}

	return finish(prepared.ids, raw, options, "none");
};

/* ---------------------------------------------------------------- registry */

/**
 * The named layouts. A string prop is looked up here and nowhere else, so a
 * built-in reaches `<NetworkGraph>` by exactly the route your own function
 * does.
 *
 * Keys: `circular`, `explicit`, `grid`, `partite`, `shell`, `spring`, `tree`.
 *
 * @category Graph layouts
 */
export const graphLayouts = Object.freeze({
	circular: circularLayout,
	explicit: explicitLayout,
	grid: gridLayout,
	partite: partiteLayout,
	shell: shellLayout,
	spring: springLayout,
	tree: treeLayout,
} satisfies Record<string, GraphLayout>);

/**
 * Name of a built-in layout, e.g. `"spring"` or `"tree"`.
 *
 * @category Graph layouts
 */
export type GraphLayoutName = keyof typeof graphLayouts;
/**
 * A layout function, or the name of a built-in layout.
 *
 * @category Graph layouts
 */
export type GraphLayoutSpec = GraphLayout | GraphLayoutName;

const graphLayoutResolver = createResolver<GraphLayout>(
	"graph layout",
	graphLayouts,
);

/**
 * A name is sugar for a function — `resolveEasing`, for layouts.
 *
 * @param layout - A layout function, a built-in name, or undefined.
 * @param fallback - Used when `layout` is undefined. Defaults to the spring layout.
 * @returns The layout function. An unknown name throws, listing the valid ones.
 *
 * @category Graph layouts
 */
export function resolveGraphLayout(
	layout: GraphLayoutSpec | undefined,
	fallback: GraphLayout = graphLayouts.spring,
): GraphLayout {
	if (!layout) return fallback;
	return graphLayoutResolver.resolve(layout);
}

/* ----------------------------------------------------------------- helpers */

/**
 * A stable, collision-free key for one edge in the per-edge config maps:
 * `"<source> <target>"`, with spaces and backslashes inside ids escaped.
 *
 * @param source - Edge start id.
 * @param target - Edge end id.
 * @returns The key.
 *
 * @category Graph layouts
 */
export function edgeKey(source: VertexId, target: VertexId): string {
	const esc = (id: VertexId) => String(id).replace(/[\\ ]/g, "\\$&");
	return `${esc(source)} ${esc(target)}`;
}

/**
 * A walk `[a, b, c]` as edge pairs `[a, b], [b, c]`, for highlighting a traversal.
 *
 * @param path - Vertex ids in walk order.
 * @returns Consecutive `[from, to]` pairs; empty for fewer than two vertices.
 *
 * @category Graph layouts
 */
export function pathEdges(path: readonly VertexId[]): [VertexId, VertexId][] {
	const out: [VertexId, VertexId][] = [];
	for (let i = 1; i < path.length; i++) out.push([path[i - 1], path[i]]);
	return out;
}
