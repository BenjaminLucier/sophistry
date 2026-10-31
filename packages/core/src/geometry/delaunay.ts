/**
 * 2D Delaunay triangulation (Bowyer-Watson), shared by `TriSurface3D` and the
 * tri-contours. Only `(x, y)` is triangulated. Degenerate input (fewer than three
 * points, or all collinear) returns `[]`.
 */

interface Vertex {
	x: number;
	y: number;
}

interface Triangle {
	a: number;
	b: number;
	c: number;
}

const EPSILON = 1e-9;

/** Twice the signed area of `a,b,c` — positive when counter-clockwise. */
function cross(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	cx: number,
	cy: number,
): number {
	return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * True when `p` is strictly inside the circumcircle of `a, b, c` — `a, b, c`
 * must already be counter-clockwise for the sign of this determinant to mean
 * "inside" (see Guibas/Stolfi's in-circle predicate).
 */
function inCircumcircle(p: Vertex, a: Vertex, b: Vertex, c: Vertex): boolean {
	const ax = a.x - p.x;
	const ay = a.y - p.y;
	const bx = b.x - p.x;
	const by = b.y - p.y;
	const cx = c.x - p.x;
	const cy = c.y - p.y;
	const aSq = ax * ax + ay * ay;
	const bSq = bx * bx + by * by;
	const cSq = cx * cx + cy * cy;
	const det =
		ax * (by * cSq - bSq * cy) -
		ay * (bx * cSq - bSq * cx) +
		aSq * (bx * cy - by * cx);
	return det > EPSILON;
}

function triVertices(
	vertices: Vertex[],
	t: Triangle,
): [Vertex, Vertex, Vertex] {
	return [vertices[t.a], vertices[t.b], vertices[t.c]];
}

/** Reorders `a, b, c` counter-clockwise if the signed area comes out negative. */
function ccw(vertices: Vertex[], t: Triangle): Triangle {
	const [a, b, c] = triVertices(vertices, t);
	return cross(a.x, a.y, b.x, b.y, c.x, c.y) < 0
		? { a: t.a, b: t.c, c: t.b }
		: t;
}

function edgeKey(u: number, v: number): string {
	return u < v ? `${u}:${v}` : `${v}:${u}`;
}

/** Every point within `EPSILON` (scaled to the point spread) of the line through the first two non-coincident points — i.e. no triangle in this set can have positive area. */
function allCollinear(vertices: Vertex[]): boolean {
	const p0 = vertices[0];
	let p1: Vertex | null = null;
	for (const v of vertices) {
		if (Math.hypot(v.x - p0.x, v.y - p0.y) > EPSILON) {
			p1 = v;
			break;
		}
	}
	if (!p1) return true; // every point coincides with the first
	const scale = Math.hypot(p1.x - p0.x, p1.y - p0.y);
	for (const v of vertices) {
		const area = Math.abs(cross(p0.x, p0.y, p1.x, p1.y, v.x, v.y));
		if (area > EPSILON * scale) return false;
	}
	return true;
}

/** Boundary edges of the polygonal hole left by removing `badTriangles`: an edge shared by two bad triangles is interior to the hole and dropped; an edge that appears once is on its boundary. Direction is preserved from the (CCW) triangle it came from, which is what keeps the new fan triangles CCW too. */
function holeBoundary(badTriangles: Triangle[]): [number, number][] {
	const counts = new Map<string, number>();
	const edges: [number, number][] = [];
	for (const t of badTriangles) {
		const triEdges: [number, number][] = [
			[t.a, t.b],
			[t.b, t.c],
			[t.c, t.a],
		];
		for (const [u, v] of triEdges) {
			counts.set(edgeKey(u, v), (counts.get(edgeKey(u, v)) ?? 0) + 1);
			edges.push([u, v]);
		}
	}
	return edges.filter(([u, v]) => counts.get(edgeKey(u, v)) === 1);
}

/**
 * A 2D Delaunay triangulation of `(xs[i], ys[i])`, `z` ignored entirely (see
 * module doc), returned as index triples into `xs`/`ys`. `[]` for fewer than
 * 3 usable points or an all-collinear point set.
 *
 * @param xs - X coordinates, in data units.
 * @param ys - Y coordinates, in data units. Paired with `xs` by index; non-finite pairs are skipped.
 * @returns Index triples into the original `xs`/`ys`.
 *
 * @category Math & helpers
 */
export function delaunayTriangleIndices(
	xs: readonly number[],
	ys: readonly number[],
): [number, number, number][] {
	const n = Math.min(xs.length, ys.length);
	const realIndices: number[] = [];
	const vertices: Vertex[] = [];
	for (let i = 0; i < n; i++) {
		const x = xs[i];
		const y = ys[i];
		if (Number.isFinite(x) && Number.isFinite(y)) {
			realIndices.push(i);
			vertices.push({ x, y });
		}
	}
	if (vertices.length < 3 || allCollinear(vertices)) return [];

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const v of vertices) {
		minX = Math.min(minX, v.x);
		minY = Math.min(minY, v.y);
		maxX = Math.max(maxX, v.x);
		maxY = Math.max(maxY, v.y);
	}

	// A super-triangle guaranteed to contain the whole point set with margin
	// to spare — the standard construction: centred on the bounding box, sized
	// to 20x its largest span.
	const dmax = Math.max(maxX - minX, maxY - minY, 1);
	const midX = (minX + maxX) / 2;
	const midY = (minY + maxY) / 2;
	const superStart = vertices.length;
	const allVertices: Vertex[] = [
		...vertices,
		{ x: midX - 20 * dmax, y: midY - dmax },
		{ x: midX, y: midY + 20 * dmax },
		{ x: midX + 20 * dmax, y: midY - dmax },
	];

	let triangles: Triangle[] = [
		ccw(allVertices, { a: superStart, b: superStart + 1, c: superStart + 2 }),
	];

	for (let pi = 0; pi < vertices.length; pi++) {
		const p = allVertices[pi];
		const bad: Triangle[] = [];
		const good: Triangle[] = [];
		for (const t of triangles) {
			const [a, b, c] = triVertices(allVertices, t);
			if (inCircumcircle(p, a, b, c)) bad.push(t);
			else good.push(t);
		}
		const boundary = holeBoundary(bad);
		triangles = good;
		for (const [u, v] of boundary) triangles.push({ a: u, b: v, c: pi });
	}

	const result: [number, number, number][] = [];
	for (const t of triangles) {
		if (t.a >= superStart || t.b >= superStart || t.c >= superStart) continue;
		result.push([realIndices[t.a], realIndices[t.b], realIndices[t.c]]);
	}
	return result;
}
