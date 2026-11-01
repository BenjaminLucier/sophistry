import { describe, expect, it } from "vitest";
import { parseColor } from "../color/index.js";
import type { ColormapName } from "./colormap.js";
import { colormapStops, colormaps, resolveColormap } from "./colormap.js";

/** Loosens a hex-vs-`rgba()` comparison to "close enough to be the same
 * colour" — `colorRamp` always emits `rgba(...)`, and `t = 0`/`t = 1` should
 * reproduce the published endpoint exactly, up to Canvas2D-grade rounding. */
function expectSameColor(css: string, hex: string) {
	const a = parseColor(css);
	const b = parseColor(hex);
	expect(a.r).toBeCloseTo(b.r, 0);
	expect(a.g).toBeCloseTo(b.g, 0);
	expect(a.b).toBeCloseTo(b.b, 0);
}

describe("colormaps", () => {
	const names = Object.keys(colormapStops) as (keyof typeof colormapStops)[];

	for (const name of names) {
		it(`${name}: t=0 matches its published first stop`, () => {
			expectSameColor(colormaps[name](0), colormapStops[name][0]);
		});

		it(`${name}: t=1 matches its published last stop`, () => {
			const stops = colormapStops[name];
			expectSameColor(colormaps[name](1), stops[stops.length - 1]);
		});

		// Only meaningful when the stop count is odd: `colorRamp` treats N stops
		// as N-1 equal segments, and `t = 0.5` only lands exactly on a stop when
		// N-1 is even — true for every map here except the 2-stop `grey`.
		if ((colormapStops[name].length - 1) % 2 === 0) {
			it(`${name}: t=0.5 matches its published midpoint stop`, () => {
				const stops = colormapStops[name];
				const midIndex = (stops.length - 1) / 2;
				expectSameColor(colormaps[name](0.5), stops[midIndex]);
			});
		}

		it(`${name}: is defined and clamped across the full domain`, () => {
			for (const t of [-1, 0, 0.25, 0.5, 0.75, 1, 2]) {
				expect(typeof colormaps[name](t)).toBe("string");
			}
		});
	}

	it("sequential maps get monotonically lighter or darker in OKLCH lightness overall (endpoint check)", () => {
		// Not true pointwise for every map (turbo dips and rises), but every
		// endpoint pair here is deliberately far apart in perceived lightness —
		// a basic sanity check that these aren't all-one-shade placeholders.
		for (const name of [
			"viridis",
			"magma",
			"plasma",
			"inferno",
			"cividis",
		] as const) {
			const start = parseColor(colormapStops[name][0]);
			const end = parseColor(
				colormapStops[name][colormapStops[name].length - 1],
			);
			const startLum = 0.2126 * start.r + 0.7152 * start.g + 0.0722 * start.b;
			const endLum = 0.2126 * end.r + 0.7152 * end.g + 0.0722 * end.b;
			expect(Math.abs(endLum - startLum)).toBeGreaterThan(50);
		}
	});

	it("grey runs from black to white, with a mid-tone (not black or white) at t=0.5", () => {
		expectSameColor(colormaps.grey(0), "#000000");
		expectSameColor(colormaps.grey(1), "#ffffff");
		const mid = parseColor(colormaps.grey(0.5));
		expect(mid.r).toBeGreaterThan(40);
		expect(mid.r).toBeLessThan(220);
	});

	it("diverging maps (coolwarm, rdbu) have a near-neutral midpoint", () => {
		for (const name of ["coolwarm", "rdbu"] as const) {
			const mid = parseColor(
				colormapStops[name][Math.floor((colormapStops[name].length - 1) / 2)],
			);
			// Near-neutral: channels within a modest spread of each other.
			const spread =
				Math.max(mid.r, mid.g, mid.b) - Math.min(mid.r, mid.g, mid.b);
			expect(spread).toBeLessThan(20);
		}
	});
});

describe("resolveColormap", () => {
	it("resolves a built-in name", () => {
		expect(resolveColormap("viridis")).toBe(colormaps.viridis);
	});

	it("resolves names case-insensitively and still lists canonical names", () => {
		expect(resolveColormap("Viridis" as ColormapName)).toBe(colormaps.viridis);
		expect(resolveColormap("RdBu" as ColormapName)).toBe(colormaps.rdbu);
		expect(() => resolveColormap("Nope" as ColormapName)).toThrow(/rdbu/);
	});

	it("passes a function through unchanged", () => {
		const custom = (t: number) => `rgb(${t * 255}, 0, 0)`;
		expect(resolveColormap(custom)).toBe(custom);
	});

	it("falls back to viridis when undefined", () => {
		expect(resolveColormap(undefined)).toBe(colormaps.viridis);
	});

	it("a custom fallback is honored", () => {
		const fallback = () => "red";
		expect(resolveColormap(undefined, fallback)).toBe(fallback);
	});

	it("throws for an unrecognised name, listing valid ones", () => {
		expect(() => resolveColormap("nonexistent" as ColormapName)).toThrow(
			/Unknown colormap "nonexistent"/,
		);
	});

	it("a custom map is passed as a value, unchanged", () => {
		const mine = (t: number) => `rgb(${t * 255}, 0, 0)`;
		expect(resolveColormap(mine)).toBe(mine);
	});
});
