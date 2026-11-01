/**
 * Implicit curves: the zero set `f(x, y) = 0` over a rectangle, by adaptive
 * marching squares. A `2^minDepth` grid is refined only in cells the curve
 * crosses (sign change), while the next pass fits in `maxQuads`; crossings are
 * linearly interpolated and stitched into polylines.
 *
 * Every kept cell refines to the same depth, so neighbours agree on shared-edge
 * crossings (stitching keys on exact lattice integers), and the band follows
 * the curve into neighbouring cells. A component smaller than a starting cell,
 * or a double root that never changes sign, is not found.
 */

import type { Point } from "./path/types.js";
import { stitchSegments } from "./stitch.js";

/** Manim's `min_depth`: a 32 × 32 starting grid. */
const DEFAULT_MIN_DEPTH = 5;
/** Manim's `max_quads`: the budget for the finest pass. */
const DEFAULT_MAX_QUADS = 1500;
/** 4096 cells per side; past this the budget, not the depth, is the limit in practice. */
const DEFAULT_MAX_DEPTH = 12;

/**
 * Resolution controls for {@link implicitCurve}, named after Manim's
 * `ImplicitFunction`.
 *
 * @category Fields
 */
export interface ImplicitCurveOptions {
	/**
	 * Starting grid is `2^minDepth` cells per side. The default is 32 × 32; a component smaller
	 * than one of these cells can be missed.
	 * @default 5
	 */
	minDepth?: number;
	/**
	 * Approximate cap on the cells of the finest pass; refinement stops before exceeding it.
	 * @default 1500
	 */
	maxQuads?: number;
	/**
	 * Hard cap on refinement: at most `2^maxDepth` cells per side.
	 * @default 12
	 */
	maxDepth?: number;
}

/**
 * One connected piece of an implicit curve.
 *
 * @category Fields
 */
export interface ImplicitCurvePiece {
	/** Vertices in order. A closed piece does not repeat its first point. */
	points: Point[];
	/** Whether the piece is a loop. An open piece ends at the rectangle's edge (or at a non-finite value). */
	closed: boolean;
}

/** One lattice: `n` cells per side over the rectangle. */
interface Lattice {
	n: number;
	at(i: number, j: number): Point;
	/** `f` at corner `(i, j)`, evaluated once. */
	value(i: number, j: number): number;
}

function createLattice(
	f: (x: number, y: number) => number,
	x: [number, number],
	y: [number, number],
	n: number,
): Lattice {
	const cache = new Map<number, number>();
	const at = (i: number, j: number): Point => ({
		x: x[0] + ((x[1] - x[0]) * i) / n,
		y: y[0] + ((y[1] - y[0]) * j) / n,
	});
	return {
		n,
		at,
		value(i, j) {
			const key = j * (n + 1) + i;
			let v = cache.get(key);
			if (v === undefined) {
				const p = at(i, j);
				v = f(p.x, p.y);
				cache.set(key, v);
			}
			return v;
		},
	};
}

/** Cell `(i, j)` packed into one number; `i` and `j` are below `n`. */
const cellKey = (n: number, i: number, j: number) => j * n + i;

/** The four corner values of a cell, counter-clockwise from bottom-left. */
function corners(lattice: Lattice, i: number, j: number): number[] {
	return [
		lattice.value(i, j),
		lattice.value(i + 1, j),
		lattice.value(i + 1, j + 1),
		lattice.value(i, j + 1),
	];
}

/**
 * Which edges of a cell the curve crosses — bottom, right, top, left — or
 * `null` when a corner is non-finite. "Positive" is `f > 0`, so an exact zero
 * sits on the negative side and the crossing lands on that corner.
 */
function crossedEdges(values: number[]): boolean[] | null {
	if (!values.every(Number.isFinite)) return null;
	const positive = values.map((v) => v > 0);
	return [0, 1, 2, 3].map((e) => positive[e] !== positive[(e + 1) % 4]);
}

/** The neighbouring cell across edge `e` (bottom, right, top, left). */
const ACROSS: [number, number][] = [
	[0, -1],
	[1, 0],
	[0, 1],
	[-1, 0],
];

/**
 * The cells the curve passes through at this lattice, starting from
 * `candidates` and chasing every crossing into the cell beyond it.
 */
function band(lattice: Lattice, candidates: Iterable<number>): Set<number> {
	const { n } = lattice;
	const kept = new Set<number>();
	const seen = new Set<number>();
	const queue: number[] = [];
	for (const key of candidates) {
		if (!seen.has(key)) {
			seen.add(key);
			queue.push(key);
		}
	}
	while (queue.length > 0) {
		const key = queue.pop() as number;
		const i = key % n;
		const j = (key - i) / n;
		const crossed = crossedEdges(corners(lattice, i, j));
		if (!crossed?.some(Boolean)) continue;
		kept.add(key);
		crossed.forEach((hit, e) => {
			if (!hit) return;
			const ni = i + ACROSS[e][0];
			const nj = j + ACROSS[e][1];
			if (ni < 0 || nj < 0 || ni >= n || nj >= n) return;
			const next = cellKey(n, ni, nj);
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		});
	}
	return kept;
}

/**
 * Where the curve crosses one lattice edge, keyed so the two cells sharing the
 * edge agree exactly: by the edge, or by the corner when `f` is exactly zero
 * there (so every cell touching that corner meets at the same key).
 */
interface Crossing {
	key: number;
	point: Point;
}

function crossingOn(
	lattice: Lattice,
	a: [number, number],
	b: [number, number],
	edgeKey: number,
): Crossing {
	const n1 = lattice.n + 1;
	const fa = lattice.value(a[0], a[1]);
	const fb = lattice.value(b[0], b[1]);
	// Corner keys are negative, edge keys non-negative: they never collide.
	if (fa === 0)
		return { key: -1 - (a[1] * n1 + a[0]), point: lattice.at(...a) };
	if (fb === 0)
		return { key: -1 - (b[1] * n1 + b[0]), point: lattice.at(...b) };
	const t = fa / (fa - fb);
	const pa = lattice.at(...a);
	const pb = lattice.at(...b);
	return {
		key: edgeKey,
		point: { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t },
	};
}

/** Marching squares over the kept cells: one or two keyed segments per cell. */
function segments(
	f: (x: number, y: number) => number,
	lattice: Lattice,
	cells: Set<number>,
): { points: Map<number, Point>; pairs: [number, number][] } {
	const { n } = lattice;
	const n1 = n + 1;
	const points = new Map<number, Point>();
	const pairs: [number, number][] = [];

	// Ascending keys, so the output order doesn't depend on discovery order.
	for (const key of [...cells].sort((a, b) => a - b)) {
		const i = key % n;
		const j = (key - i) / n;
		const values = corners(lattice, i, j);
		const crossed = crossedEdges(values);
		if (!crossed) continue;

		// Edge keys: 2·(corner index) for the edge going right, +1 for going up.
		const edges: [[number, number], [number, number], number][] = [
			[[i, j], [i + 1, j], 2 * (j * n1 + i)],
			[[i + 1, j], [i + 1, j + 1], 2 * (j * n1 + i + 1) + 1],
			[[i, j + 1], [i + 1, j + 1], 2 * ((j + 1) * n1 + i)],
			[[i, j], [i, j + 1], 2 * (j * n1 + i) + 1],
		];
		const hit: (number | null)[] = edges.map(([a, b, edgeKey], e) => {
			if (!crossed[e]) return null;
			const c = crossingOn(lattice, a, b, edgeKey);
			points.set(c.key, c.point);
			return c.key;
		});

		const join = (a: number | null, b: number | null) => {
			// Two crossings on one zero corner make no segment.
			if (a !== null && b !== null && a !== b) pairs.push([a, b]);
		};
		const found = hit.filter((h) => h !== null);
		if (found.length === 2) {
			join(found[0], found[1]);
		} else if (found.length === 4) {
			// The saddle: the centre's sign says which diagonal pair is connected.
			// Bottom-left's region reaching the centre cuts off the other two corners.
			const mid = lattice.at(i + 0.5, j + 0.5);
			const centre = f(mid.x, mid.y);
			if (centre > 0 === values[0] > 0) {
				join(hit[0], hit[1]); // cut off bottom-right
				join(hit[2], hit[3]); // cut off top-left
			} else {
				join(hit[3], hit[0]); // cut off bottom-left
				join(hit[1], hit[2]); // cut off top-right
			}
		}
	}
	return { points, pairs };
}

/**
 * Orients a piece so the negative side of `f` is on its left: a level set
 * `g(x, y) = c` written as `g − c` then runs counter-clockwise round the region
 * where `g < c`, the way `<Circle>` runs, so a unit circle drawn implicitly
 * and one drawn as a shape reveal in the same direction.
 */
function orient(f: (x: number, y: number) => number, points: Point[]): Point[] {
	for (let k = 0; k + 1 < points.length; k++) {
		const a = points[k];
		const b = points[k + 1];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const length = Math.hypot(dx, dy);
		if (length === 0) continue;
		// A quarter of the segment's length to its left.
		const s = 0.25;
		const probe = f((a.x + b.x) / 2 - dy * s, (a.y + b.y) / 2 + dx * s);
		if (!Number.isFinite(probe) || probe === 0) continue;
		return probe < 0 ? points : points.slice().reverse();
	}
	return points;
}

/**
 * The curve `f(x, y) = 0` inside the rectangle `x` × `y`, as polylines — the
 * engine behind `<ImplicitFunction>`, Manim's `ImplicitFunction`.
 *
 * Adaptive marching squares with linear interpolation (see the module notes):
 * a `2^minDepth` grid, refined only where the curve is, as deep as `maxQuads`
 * allows. Cells with a non-finite corner are skipped, so the curve breaks
 * rather than guessing across `NaN`. Each piece runs with `f < 0` on its left.
 *
 * @param f - The function whose zero set is drawn, in the caller's coordinates.
 * @param x - The rectangle's x extent, `[from, to]`.
 * @param y - The rectangle's y extent, `[from, to]`.
 * @param options - Resolution; see {@link ImplicitCurveOptions}.
 * @returns The connected pieces, loops marked `closed`. `[]` when `f` has no sign change in the rectangle or the rectangle is degenerate.
 *
 * @example
 * ```ts
 * import { implicitCurve } from "@sophistry/core/geometry";
 *
 * // The unit circle: one closed piece.
 * const [circle] = implicitCurve((x, y) => x * x + y * y - 1, [-2, 2], [-2, 2]);
 * ```
 *
 * @category Fields
 */
export function implicitCurve(
	f: (x: number, y: number) => number,
	x: [number, number],
	y: [number, number],
	options: ImplicitCurveOptions = {},
): ImplicitCurvePiece[] {
	if (![...x, ...y].every(Number.isFinite) || x[0] === x[1] || y[0] === y[1]) {
		return [];
	}
	const maxDepth = Math.max(
		0,
		Math.floor(options.maxDepth ?? DEFAULT_MAX_DEPTH),
	);
	const minDepth = Math.min(
		maxDepth,
		Math.max(0, Math.floor(options.minDepth ?? DEFAULT_MIN_DEPTH)),
	);
	const maxQuads = options.maxQuads ?? DEFAULT_MAX_QUADS;

	let depth = minDepth;
	let lattice = createLattice(f, x, y, 2 ** depth);
	const all: number[] = [];
	for (let k = 0; k < lattice.n * lattice.n; k++) all.push(k);
	let cells = band(lattice, all);

	while (depth < maxDepth && cells.size > 0 && cells.size * 4 <= maxQuads) {
		const n = lattice.n;
		const finer = createLattice(f, x, y, 2 * n);
		const children: number[] = [];
		for (const key of cells) {
			const i = key % n;
			const j = (key - i) / n;
			for (const [di, dj] of [
				[0, 0],
				[1, 0],
				[0, 1],
				[1, 1],
			]) {
				children.push(cellKey(2 * n, 2 * i + di, 2 * j + dj));
			}
		}
		depth++;
		lattice = finer;
		cells = band(lattice, children);
	}

	const { points, pairs } = segments(f, lattice, cells);
	return stitchSegments(pairs).map(({ keys, closed }) => ({
		points: orient(
			f,
			keys.map((key) => points.get(key) as Point),
		),
		closed,
	}));
}
