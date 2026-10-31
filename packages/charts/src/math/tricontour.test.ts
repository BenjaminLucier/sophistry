import { describe, expect, it } from "vitest";
import {
	triangulate,
	tricontourBands,
	tricontourLines,
	tripcolorFaces,
} from "./tricontour";

/** Twice the signed area of a triangle given as points. */
const signedArea = (p: { x: number; y: number }[]) =>
	(p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[1].y - p[0].y) * (p[2].x - p[0].x);

/** Area of a simple polygon (shoelace), positive when counter-clockwise. */
const polygonArea = (ring: { x: number; y: number }[]) => {
	let sum = 0;
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i];
		const b = ring[(i + 1) % ring.length];
		sum += a.x * b.y - b.x * a.y;
	}
	return sum / 2;
};

// A 5 × 5 grid of points over [0, 4]², jittered off the lattice so the
// Delaunay triangulation is unique, with z = x + y (linear, so every
// contour is a straight line x + y = level).
const xs: number[] = [];
const ys: number[] = [];
for (let j = 0; j < 5; j++) {
	for (let i = 0; i < 5; i++) {
		const jitter = (i * 7 + j * 3) % 5 === 0 ? 0.013 : 0;
		xs.push(i + (i > 0 && i < 4 ? jitter : 0));
		ys.push(j);
	}
}
const zs = xs.map((x, i) => x + ys[i]);

describe("triangulate", () => {
	it("Delaunay-triangulates scattered points, every triangle counter-clockwise", () => {
		const tris = triangulate([0, 1, 1, 0], [0, 0, 1, 1]);
		expect(tris).toHaveLength(2);
		for (const t of tris) {
			const pts = t.map((i) => ({ x: [0, 1, 1, 0][i], y: [0, 0, 1, 1][i] }));
			expect(signedArea(pts)).toBeGreaterThan(0);
		}
	});

	it("covers the convex hull: triangle areas sum to the hull's", () => {
		const tris = triangulate(xs, ys);
		const total = tris.reduce(
			(sum, t) => sum + signedArea(t.map((i) => ({ x: xs[i], y: ys[i] }))) / 2,
			0,
		);
		expect(total).toBeCloseTo(16, 6);
	});

	it("keeps explicit triangles, turning clockwise ones counter-clockwise", () => {
		const tris = triangulate([0, 1, 0, 1], [0, 0, 1, 1], {
			triangles: [
				[0, 2, 1], // clockwise
				[1, 3, 2],
			],
		});
		expect(tris).toEqual([
			[0, 1, 2],
			[1, 3, 2],
		]);
	});

	it("drops degenerate and non-finite triangles; throws on a missing point", () => {
		expect(
			triangulate([0, 1, 2, Number.NaN], [0, 0, 0, 1], {
				triangles: [
					[0, 1, 2], // collinear
					[0, 1, 3], // NaN corner
				],
			}),
		).toEqual([]);
		expect(() =>
			triangulate([0, 1, 0], [0, 0, 1], { triangles: [[0, 1, 5]] }),
		).toThrow(RangeError);
	});

	it("returns nothing for too few or collinear points", () => {
		expect(triangulate([0, 1], [0, 1])).toEqual([]);
		expect(triangulate([0, 1, 2], [0, 1, 2])).toEqual([]);
	});
});

describe("tricontourLines", () => {
	it("traces a linear field as one straight, connected line per level", () => {
		const lines = tricontourLines(xs, ys, zs, [2, 5]);
		expect(lines.map((l) => l.level)).toEqual([2, 5]);
		for (const line of lines) {
			// One connected polyline from boundary to boundary.
			expect(line.points.length).toBeGreaterThan(2);
			for (const p of line.points) {
				expect(p.x + p.y).toBeCloseTo(line.level, 9);
			}
		}
	});

	it("spaces a count of levels strictly inside the data's range", () => {
		const lines = tricontourLines(xs, ys, zs, 3);
		const levels = [...new Set(lines.map((l) => l.level))];
		expect(levels).toHaveLength(3);
		for (const level of levels) {
			expect(level).toBeGreaterThan(0);
			expect(level).toBeLessThan(8);
		}
	});

	it("closes a loop around a peak", () => {
		// A ring of 8 points around a raised centre.
		const rx = [0];
		const ry = [0];
		const rz = [1];
		for (let k = 0; k < 8; k++) {
			rx.push(Math.cos((k * Math.PI) / 4));
			ry.push(Math.sin((k * Math.PI) / 4));
			rz.push(0);
		}
		const [loop] = tricontourLines(rx, ry, rz, [0.5]);
		expect(loop.points[0].x).toBeCloseTo(loop.points.at(-1)?.x ?? Number.NaN);
		expect(loop.points[0].y).toBeCloseTo(loop.points.at(-1)?.y ?? Number.NaN);
		for (const p of loop.points) expect(Math.hypot(p.x, p.y)).toBeLessThan(0.6);
	});

	it("skips triangles touching a non-finite value", () => {
		const lines = tricontourLines(
			[0, 1, 0],
			[0, 0, 1],
			[0, Number.NaN, 2],
			[1],
		);
		expect(lines).toEqual([]);
	});
});

describe("tricontourBands", () => {
	it("partitions the hull: band areas sum to the triangulated area", () => {
		const bands = tricontourBands(xs, ys, zs, 5);
		expect(bands).toHaveLength(4);
		expect(bands[0].loLevel).toBe(0);
		expect(bands.at(-1)?.hiLevel).toBeCloseTo(8);
		let total = 0;
		for (const band of bands) {
			for (const ring of band.polygons) {
				const area = polygonArea(ring);
				// Counter-clockwise, so one non-zero fill shows no seams.
				expect(area).toBeGreaterThan(-1e-12);
				total += area;
			}
		}
		expect(total).toBeCloseTo(16, 6);
	});

	it("keeps each band's polygons inside its value window", () => {
		const bands = tricontourBands(xs, ys, zs, [0, 3, 8]);
		for (const band of bands) {
			for (const ring of band.polygons) {
				for (const p of ring) {
					expect(p.x + p.y).toBeGreaterThanOrEqual(band.loLevel - 1e-9);
					expect(p.x + p.y).toBeLessThanOrEqual(band.hiLevel + 1e-9);
				}
			}
		}
	});

	it("draws nothing for a constant field", () => {
		expect(tricontourBands([0, 1, 0], [0, 0, 1], [2, 2, 2], 4)).toEqual([]);
	});
});

describe("tripcolorFaces", () => {
	it("values each face at the mean of its corners", () => {
		const [face] = tripcolorFaces([0, 1, 0], [0, 0, 1], [1, 2, 6]);
		expect(face.value).toBe(3);
		expect(signedArea(face.points)).toBeGreaterThan(0);
	});

	it("uses explicit triangles and skips faces with a non-finite value", () => {
		const faces = tripcolorFaces(
			[0, 1, 0, 1],
			[0, 0, 1, 1],
			[0, 1, 2, Number.NaN],
			{
				triangles: [
					[0, 1, 2],
					[1, 3, 2],
				],
			},
		);
		expect(faces).toHaveLength(1);
		expect(faces[0].indices).toEqual([0, 1, 2]);
		expect(faces[0].value).toBe(1);
	});
});
