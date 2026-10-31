import { describe, expect, it } from "vitest";
import {
	loess,
	loessBand,
	meanInterval,
	regression,
	studentT,
} from "./regression";

describe("studentT", () => {
	it("matches tabulated quantiles", () => {
		expect(studentT(0.975, 1)).toBeCloseTo(12.706, 2);
		expect(studentT(0.975, 2)).toBeCloseTo(4.303, 3);
		expect(studentT(0.975, 3)).toBeCloseTo(3.182, 1);
		expect(studentT(0.975, 5)).toBeCloseTo(2.571, 2);
		expect(studentT(0.975, 10)).toBeCloseTo(2.228, 3);
		expect(studentT(0.975, 30)).toBeCloseTo(2.042, 3);
		expect(studentT(0.995, 20)).toBeCloseTo(2.845, 2);
		expect(studentT(0.5, 7)).toBeCloseTo(0, 10);
		expect(studentT(0.025, 10)).toBeCloseTo(-2.228, 3);
	});

	it("is NaN outside its domain", () => {
		expect(studentT(1, 5)).toBeNaN();
		expect(studentT(0.9, 0)).toBeNaN();
	});
});

describe("regression", () => {
	it("recovers an exact line, with a band of no width", () => {
		const xs = [0, 1, 2, 3, 4];
		const fit = regression(
			xs,
			xs.map((x) => 2 * x + 1),
			{ samples: 5 },
		);
		expect(fit.map((p) => p.x)).toEqual([0, 1, 2, 3, 4]);
		fit.forEach((p) => {
			expect(p.y).toBeCloseTo(2 * p.x + 1);
			expect(p.high - p.low).toBeCloseTo(0);
		});
	});

	it("matches the textbook band: narrowest at the mean of x", () => {
		const xs = [1, 2, 3, 4, 5, 6];
		const ys = [2.0, 4.1, 5.9, 8.2, 9.9, 12.1];
		const fit = regression(xs, ys, { samples: 11 });
		const width = fit.map((p) => p.high - p.low);
		const narrowest = width.indexOf(Math.min(...width));
		expect(fit[narrowest].x).toBeCloseTo(3.5);
		// By hand: slope = Sxy / Sxx, se of the mean at x̄ = s / √n.
		const n = xs.length;
		const mx = 3.5;
		const my = ys.reduce((a, b) => a + b) / n;
		const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
		const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
		const sse = xs.reduce(
			(a, x, i) => a + (ys[i] - (my + slope * (x - mx))) ** 2,
			0,
		);
		const s = Math.sqrt(sse / (n - 2));
		expect(fit[narrowest].y).toBeCloseTo(my);
		expect(fit[narrowest].high - fit[narrowest].y).toBeCloseTo(
			studentT(0.975, n - 2) * (s / Math.sqrt(n)),
		);
	});

	it("fits a polynomial", () => {
		const xs = [-2, -1, 0, 1, 2, 3];
		const fit = regression(
			xs,
			xs.map((x) => x * x - x),
			{ degree: 2, samples: 6, level: 0 },
		);
		fit.forEach((p) => {
			expect(p.y).toBeCloseTo(p.x * p.x - p.x);
			expect(p.low).toBe(p.y);
		});
	});

	it("needs more points than coefficients, and drops non-finite pairs", () => {
		expect(regression([1, 2], [1, 2])).toEqual([]);
		expect(regression([1, 2, Number.NaN], [1, 2, 3])).toEqual([]);
		expect(regression([1, 2, 3], [1, 2, 3])).toHaveLength(50);
	});
});

describe("loess", () => {
	it("follows a line exactly", () => {
		const xs = Array.from({ length: 20 }, (_, i) => i);
		const fit = loess(
			xs,
			xs.map((x) => 3 - x / 2),
			{ samples: 7 },
		);
		expect(fit).toHaveLength(7);
		for (const p of fit) expect(p.y).toBeCloseTo(3 - p.x / 2);
	});

	it("smooths noise towards the trend", () => {
		const xs = Array.from({ length: 40 }, (_, i) => i / 4);
		const ys = xs.map((x, i) => Math.sin(x) + (i % 2 ? 0.3 : -0.3));
		const fit = loess(xs, ys, { bandwidth: 0.25, samples: 9 });
		for (const p of fit.slice(1, -1))
			expect(Math.abs(p.y - Math.sin(p.x))).toBeLessThan(0.2);
	});
});

describe("robust loess", () => {
	// A slightly noisy line with one wild point in the middle.
	const xs = Array.from({ length: 21 }, (_, i) => i);
	const ys = xs.map((x) => (x === 10 ? 40 : x / 2 + (x % 2 ? 0.1 : -0.1)));

	it("a plain fit is pulled toward an outlier; robustness iterations ignore it", () => {
		const plain = loess(xs, ys, { bandwidth: 0.5, samples: 21 });
		const robust = loess(xs, ys, {
			bandwidth: 0.5,
			samples: 21,
			iterations: 2,
		});
		expect(plain[10].y - 5).toBeGreaterThan(2);
		for (const p of robust) expect(Math.abs(p.y - p.x / 2)).toBeLessThan(0.15);
	});

	it("0 iterations is the plain fit, and an exact fit stops iterating", () => {
		expect(loess(xs, ys, { iterations: 0 })).toEqual(loess(xs, ys));
		const line = xs.map((x) => (x === 10 ? 40 : 1 + x));
		// Most points fitted exactly: the median residual is 0, nothing to
		// re-weight by (R's `lowess` stops there too).
		expect(loess(xs, line, { iterations: 3, samples: 5 })).toEqual(
			loess(xs, line, { samples: 5 }),
		);
	});
});

describe("loessBand", () => {
	/** Seeded uniform in [0, 1) (an LCG), then Box–Muller normals. */
	function normals(seed: number) {
		let state = seed >>> 0;
		const uniform = () => {
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			return (state + 0.5) / 2 ** 32;
		};
		return () =>
			Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
	}

	it("has the smooth of loess as its centre line", () => {
		const xs = Array.from({ length: 30 }, (_, i) => i / 3);
		const ys = xs.map((x, i) => Math.sin(x) + (i % 3) * 0.1);
		const band = loessBand(xs, ys, { bandwidth: 0.4, samples: 12 });
		const plain = loess(xs, ys, { bandwidth: 0.4, samples: 12 });
		band.forEach((p, i) => {
			expect(p.x).toBeCloseTo(plain[i].x);
			expect(p.y).toBeCloseTo(plain[i].y);
			expect(p.low).toBeLessThan(p.y);
			expect(p.high - p.y).toBeCloseTo(p.y - p.low);
		});
	});

	it("has no width for an exact fit, or at level 0", () => {
		const xs = Array.from({ length: 12 }, (_, i) => i);
		for (const p of loessBand(
			xs,
			xs.map((x) => 2 * x - 1),
			{ samples: 6 },
		)) {
			expect(p.low).toBeCloseTo(p.y);
			expect(p.high).toBeCloseTo(p.y);
		}
		const noisy = xs.map((x, i) => x + (i % 2 ? 1 : -1));
		for (const p of loessBand(xs, noisy, { level: 0, samples: 6 }))
			expect(p.high).toBe(p.low);
	});

	it("widens with the level", () => {
		const xs = Array.from({ length: 40 }, (_, i) => i);
		const draw = normals(7);
		const ys = xs.map((x) => x / 4 + draw());
		const narrow = loessBand(xs, ys, { level: 0.8, samples: 5 });
		const wide = loessBand(xs, ys, { level: 0.99, samples: 5 });
		narrow.forEach((p, i) => {
			expect(wide[i].high - wide[i].low).toBeGreaterThan(p.high - p.low);
		});
	});

	it("covers the true mean about as often as its level says", () => {
		// A straight line is unbiased for a local linear fit, so coverage of
		// the true mean reads the band's width alone.
		const xs = Array.from({ length: 50 }, (_, i) => i / 5);
		const truth = (x: number) => 1 + 0.5 * x;
		const draw = normals(42);
		let covered = 0;
		let total = 0;
		for (let run = 0; run < 300; run++) {
			const ys = xs.map((x) => truth(x) + draw());
			for (const p of loessBand(xs, ys, { bandwidth: 0.4, samples: 5 })) {
				total++;
				if (p.low <= truth(p.x) && truth(p.x) <= p.high) covered++;
			}
		}
		const rate = covered / total;
		expect(rate).toBeGreaterThan(0.9);
		expect(rate).toBeLessThan(0.99);
	});

	it("robustness keeps an outlier from widening the band", () => {
		const xs = Array.from({ length: 30 }, (_, i) => i);
		const draw = normals(3);
		const ys = xs.map((x) => x / 3 + 0.2 * draw());
		ys[15] += 30;
		const width = (fit: ReturnType<typeof loessBand>) =>
			fit.reduce((s, p) => s + p.high - p.low, 0) / fit.length;
		const plain = loessBand(xs, ys, { bandwidth: 0.5, samples: 9 });
		const robust = loessBand(xs, ys, {
			bandwidth: 0.5,
			samples: 9,
			iterations: 2,
		});
		expect(width(robust)).toBeLessThan(width(plain) / 5);
		for (const p of robust) expect(Math.abs(p.y - p.x / 3)).toBeLessThan(0.3);
	});

	it("needs two points, and more than three for a band", () => {
		expect(loessBand([1], [1])).toEqual([]);
		for (const p of loessBand([0, 1, 2], [0, 2, 1], { samples: 3 }))
			expect(p.high).toBe(p.low);
	});
});

describe("meanInterval", () => {
	it("is the t interval of the mean", () => {
		const values = [1, 2, 3, 4, 5];
		const { mean, low, high, n } = meanInterval(values);
		const se = Math.sqrt(2.5) / Math.sqrt(5);
		expect(mean).toBe(3);
		expect(n).toBe(5);
		expect(high - mean).toBeCloseTo(studentT(0.975, 4) * se, 3);
		expect(mean - low).toBeCloseTo(high - mean);
	});

	it("does standard error and deviation too", () => {
		expect(meanInterval([1, 3], "sd").high).toBeCloseTo(2 + Math.SQRT2);
		expect(meanInterval([1, 3], "se").high).toBeCloseTo(3);
	});

	it("has no width for one value and is NaN for none", () => {
		expect(meanInterval([4])).toEqual({ mean: 4, low: 4, high: 4, n: 1 });
		expect(meanInterval([Number.NaN]).n).toBe(0);
	});
});
