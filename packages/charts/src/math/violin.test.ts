import { describe, expect, it } from "vitest";
import {
	blendViolinProfiles,
	gaussianKde,
	violinProfile,
	violinProfileRing,
	violinRing,
} from "./violin";

describe("gaussianKde", () => {
	it("bins a large sample to within a hair of the exact sum", () => {
		// Two skewed clusters from a fixed LCG: lumpy enough to show bias.
		let state = 12345;
		const next = () => {
			state = (state * 1664525 + 1013904223) % 4294967296;
			return state / 4294967296;
		};
		const values = Array.from({ length: 20_000 }, (_, i) =>
			i % 3 === 0 ? 5 + next() ** 2 * 3 : -Math.log(1 - next()),
		);
		const bandwidth = 0.15;
		const kde = gaussianKde(values, { bandwidth, samples: 120 });
		const peak = Math.max(...kde.map((p) => p.density));
		let worst = 0;
		for (const { x, density } of kde) {
			let sum = 0;
			for (const v of values) {
				const u = (x - v) / bandwidth;
				sum += Math.exp(-(u * u) / 2) / Math.sqrt(2 * Math.PI);
			}
			const exact = sum / (values.length * bandwidth);
			worst = Math.max(worst, Math.abs(density - exact));
		}
		expect(worst / peak).toBeLessThan(1e-3);
		// The default (Silverman) bandwidth bins too.
		const auto = gaussianKde(values);
		expect(auto).toHaveLength(80);
		expect(auto.every((p) => Number.isFinite(p.density))).toBe(true);
	});

	it("bins a large constant sample exactly", () => {
		const values = new Array<number>(5000).fill(2);
		const kde = gaussianKde(values, { bandwidth: 0.5, samples: 5 });
		const small = gaussianKde([2], { bandwidth: 0.5, samples: 5 });
		kde.forEach((p, i) => {
			expect(p.x).toBe(small[i].x);
			expect(p.density).toBeCloseTo(small[i].density, 12);
		});
	});

	it("peaks near the data cluster", () => {
		const values = [9, 10, 10, 11, 10];
		const kde = gaussianKde(values, { samples: 200 });
		expect(kde.length).toBe(200);
		const peak = kde.reduce((best, point) =>
			point.density > best.density ? point : best,
		);
		expect(peak.x).toBeGreaterThan(8);
		expect(peak.x).toBeLessThan(12);
	});

	it("roughly integrates to ~1 over its domain (coarse Riemann sum)", () => {
		const values = [1, 2, 3, 4, 5, 4, 3, 2, 3];
		const kde = gaussianKde(values, { samples: 500 });
		const step = (kde[kde.length - 1].x - kde[0].x) / (kde.length - 1);
		const area = kde.reduce((sum, point) => sum + point.density * step, 0);
		expect(area).toBeCloseTo(1, 1);
	});

	it("returns [] for empty input", () => {
		expect(gaussianKde([])).toEqual([]);
	});

	it("returns [] when every value is non-finite", () => {
		expect(gaussianKde([Number.NaN, Number.POSITIVE_INFINITY])).toEqual([]);
	});

	it("does not NaN/Infinity out for all-identical values", () => {
		const kde = gaussianKde([5, 5, 5, 5], { samples: 20 });
		expect(kde.length).toBe(20);
		for (const point of kde) {
			expect(Number.isFinite(point.x)).toBe(true);
			expect(Number.isFinite(point.density)).toBe(true);
		}
		// The density should be concentrated near 5, not uniformly zero.
		const maxDensity = Math.max(...kde.map((p) => p.density));
		expect(maxDensity).toBeGreaterThan(0);
	});

	it("honours explicit bandwidth, samples and domain overrides", () => {
		const kde = gaussianKde([0, 1, 2], {
			bandwidth: 0.5,
			samples: 11,
			domain: [-1, 1],
		});
		expect(kde.length).toBe(11);
		expect(kde[0].x).toBeCloseTo(-1);
		expect(kde[kde.length - 1].x).toBeCloseTo(1);
	});
});

describe("violinRing", () => {
	it("returns [] for fewer than 2 points", () => {
		expect(violinRing([], 0)).toEqual([]);
		expect(violinRing([5], 0)).toEqual([]);
	});

	it("mirrors the first half against the second half around center", () => {
		const values = [1, 2, 3, 4, 5, 4, 3, 2, 1];
		const center = 2.5;
		const ring = violinRing(values, center, { samples: 30 });
		expect(ring.length).toBe(60);
		const half = ring.length / 2;
		const right = ring.slice(0, half);
		const left = ring.slice(half).reverse();
		for (let i = 0; i < half; i++) {
			expect(right[i].y).toBeCloseTo(left[i].y);
			expect(right[i].x - center).toBeCloseTo(-(left[i].x - center));
		}
	});

	it("produces no NaN/Infinity coordinates for a normal dataset", () => {
		const values = [3, 5, 4, 6, 5, 7, 4, 5, 6, 5];
		const ring = violinRing(values, 1, { samples: 40 });
		expect(ring.length).toBeGreaterThan(0);
		for (const point of ring) {
			expect(Number.isFinite(point.x)).toBe(true);
			expect(Number.isFinite(point.y)).toBe(true);
		}
	});

	it("stays within scale of center on the x axis", () => {
		const values = [1, 2, 3, 4, 5];
		const scale = 0.3;
		const ring = violinRing(values, 10, { scale });
		for (const point of ring) {
			expect(Math.abs(point.x - 10)).toBeLessThanOrEqual(scale + 1e-9);
		}
	});
});

describe("violin profiles", () => {
	const a = [1, 2, 2, 3, 3, 3, 4, 5];
	const b = [6, 7, 7, 8, 9, 9, 9, 12];

	it("mirror into exactly the ring violinRing draws", () => {
		const profile = violinProfile(a, { samples: 40 });
		if (!profile) throw new Error("a has a profile");
		expect(violinProfileRing(profile, 2.5, 0.3)).toEqual(
			violinRing(a, 2.5, { samples: 40, scale: 0.3 }),
		);
	});

	it("are null where violinRing draws nothing", () => {
		expect(violinProfile([4])).toBeNull();
		expect(violinProfile([])).toBeNull();
		expect(violinRing([4], 0)).toEqual([]);
	});

	it("blend exactly to either end at 0 and 1", () => {
		const p = violinProfile(a);
		const q = violinProfile(b);
		expect(blendViolinProfiles(p, q, 0)).toBe(p);
		expect(blendViolinProfiles(p, q, 1)).toBe(q);
	});

	it("blend on the union of both grids, each end zero beyond its own", () => {
		const p = violinProfile(a, { samples: 20 });
		const q = violinProfile(b, { samples: 20 });
		if (!p || !q) throw new Error("both have profiles");
		const mid = blendViolinProfiles(p, q, 0.5);
		if (!mid) throw new Error("a blend of two profiles is one");
		expect(mid.ys.length).toBeGreaterThan(20);
		expect([...mid.ys]).toEqual([...mid.ys].sort((x, y) => x - y));
		// At a's peak, b contributes nothing: half of a's width.
		const peak = p.widths.indexOf(1);
		const at = mid.ys.indexOf(p.ys[peak]);
		expect(mid.widths[at]).toBeCloseTo(0.5 * (1 + 0));
		for (const w of mid.widths) {
			expect(w).toBeGreaterThanOrEqual(0);
			expect(w).toBeLessThanOrEqual(1);
		}
	});

	it("grow a missing end out of zero width", () => {
		const q = violinProfile(b);
		if (!q) throw new Error("b has a profile");
		const grown = blendViolinProfiles(null, q, 0.25);
		expect(grown?.ys).toEqual(q.ys);
		expect(grown?.widths.map((w) => w / 0.25)).toEqual(
			q.widths.map((w) => expect.closeTo(w, 9)),
		);
		expect(blendViolinProfiles(null, null, 0.5)).toBeNull();
	});
});
