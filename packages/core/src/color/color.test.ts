import { describe, expect, it } from "vitest";
import {
	type ColorSpace,
	colorInterpolator,
	darken,
	FALLBACK_COLOR,
	hslToRgb,
	lighten,
	mixColor,
	oklchToRgb,
	parseColor,
	randomColor,
	rgbToHsl,
	rgbToOklch,
	shadeColor,
	toCss,
	tryParseColor,
	withAlpha,
} from ".";

describe("parseColor", () => {
	it("parses 6-digit hex", () => {
		expect(parseColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
	});

	it("parses 3-digit hex", () => {
		expect(parseColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
	});

	it("parses 8-digit hex (with alpha)", () => {
		const c = parseColor("#ff000080");
		expect(c.r).toBe(255);
		expect(c.g).toBe(0);
		expect(c.b).toBe(0);
		expect(c.a).toBeCloseTo(0.5, 1);
	});

	it("parses 4-digit hex (with alpha)", () => {
		const c = parseColor("#f008");
		expect(c.r).toBe(255);
		expect(c.a).toBeCloseTo(0.53, 1);
	});

	it("parses rgb()", () => {
		expect(parseColor("rgb(10, 20, 30)")).toEqual({
			r: 10,
			g: 20,
			b: 30,
			a: 1,
		});
	});

	it("parses rgba()", () => {
		const c = parseColor("rgba(10, 20, 30, 0.4)");
		expect(c).toEqual({ r: 10, g: 20, b: 30, a: 0.4 });
	});

	it("parses hsl()", () => {
		const c = parseColor("hsl(0, 100%, 50%)");
		expect(c.r).toBeCloseTo(255, 0);
		expect(c.g).toBeCloseTo(0, 0);
		expect(c.b).toBeCloseTo(0, 0);
	});

	it("parses hsla()", () => {
		const c = parseColor("hsla(0, 100%, 50%, 0.5)");
		expect(c.a).toBeCloseTo(0.5, 5);
	});

	it("parses CSS named colours", () => {
		// <SurfacePlot3D color="red"> must not fall back to mid-grey: every
		// colour path goes through one named-colour-aware parser.
		expect(parseColor("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
		expect(parseColor("rebeccapurple")).toEqual({
			r: 102,
			g: 51,
			b: 153,
			a: 1,
		});
	});

	it("falls back to opaque mid-grey for malformed input, rather than throwing", () => {
		expect(parseColor("not-a-colour")).toEqual(FALLBACK_COLOR);
		expect(() => parseColor("garbage(1,2,3)")).not.toThrow();
	});

	it("passes a Color through unchanged (as a copy)", () => {
		const c = { r: 1, g: 2, b: 3, a: 0.5 };
		const parsed = parseColor(c);
		expect(parsed).toEqual(c);
		expect(parsed).not.toBe(c);
	});
});

describe("toCss", () => {
	it("round-trips through parseColor", () => {
		expect(toCss(parseColor("#ff0000"))).toBe("rgba(255, 0, 0, 1)");
	});

	it("clamps and rounds out-of-range channels", () => {
		expect(toCss({ r: 300, g: -10, b: 128.6, a: 2 })).toBe(
			"rgba(255, 0, 129, 1)",
		);
	});

	it("round-trips named colours", () => {
		expect(toCss(parseColor("red"))).toBe(toCss(parseColor("#ff0000")));
	});
});

describe("colour space conversions", () => {
	it("RGB -> HSL -> RGB round-trips", () => {
		const original = parseColor("#3366cc");
		const hsl = rgbToHsl(original);
		const back = hslToRgb(hsl);
		expect(back.r).toBeCloseTo(original.r, 0);
		expect(back.g).toBeCloseTo(original.g, 0);
		expect(back.b).toBeCloseTo(original.b, 0);
	});

	it("RGB -> OKLCH -> RGB round-trips", () => {
		const original = parseColor("#3366cc");
		const oklch = rgbToOklch(original);
		const back = oklchToRgb(oklch);
		expect(back.r).toBeCloseTo(original.r, 0);
		expect(back.g).toBeCloseTo(original.g, 0);
		expect(back.b).toBeCloseTo(original.b, 0);
	});

	it("white round-trips through OKLCH with zero chroma", () => {
		const oklch = rgbToOklch(parseColor("#ffffff"));
		expect(oklch.c).toBeCloseTo(0, 2);
		expect(oklch.l).toBeCloseTo(1, 2);
	});

	it("black round-trips through OKLCH", () => {
		const oklch = rgbToOklch(parseColor("#000000"));
		expect(oklch.l).toBeCloseTo(0, 2);
		const back = oklchToRgb(oklch);
		expect(back.r).toBeCloseTo(0, 0);
	});
});

describe("mixColor", () => {
	it("returns the start colour at t=0 and end colour at t=1, in rgb", () => {
		const a = parseColor("#000000");
		const b = parseColor("#ffffff");
		expect(mixColor(a, b, 0)).toEqual(a);
		const at1 = mixColor(a, b, 1);
		expect(at1.r).toBeCloseTo(b.r, 5);
	});

	it("splits the midpoint evenly in rgb", () => {
		const mid = mixColor("#000000", "#ffffff", 0.5, { colorSpace: "rgb" });
		expect(mid.r).toBeCloseTo(127.5, 1);
	});

	it("returns endpoints exactly at t=0/1 in oklch too", () => {
		const a = parseColor("#204080");
		const b = parseColor("#e0a010");
		const at0 = mixColor(a, b, 0, { colorSpace: "oklch" });
		const at1 = mixColor(a, b, 1, { colorSpace: "oklch" });
		expect(at0.r).toBeCloseTo(a.r, 0);
		expect(at1.r).toBeCloseTo(b.r, 0);
	});

	it("oklch and rgb interpolation diverge at the midpoint for a hue-distant pair", () => {
		const rgbMid = mixColor("#0000ff", "#ffff00", 0.5, { colorSpace: "rgb" });
		const oklchMid = mixColor("#0000ff", "#ffff00", 0.5, {
			colorSpace: "oklch",
		});
		expect(rgbMid).not.toEqual(oklchMid);
	});
});

describe("shadeColor", () => {
	it("scales channels by intensity", () => {
		const shaded = shadeColor("#808080", 0.5);
		expect(shaded.r).toBeCloseTo(64, 0);
		expect(shaded.g).toBeCloseTo(64, 0);
		expect(shaded.b).toBeCloseTo(64, 0);
	});

	it("clamps rather than overflowing at high intensity", () => {
		const shaded = shadeColor("#ffffff", 2);
		expect(shaded.r).toBe(255);
	});
});

describe("lighten / darken", () => {
	it("lighten moves toward white", () => {
		const base = parseColor("#333333");
		const lit = lighten(base, 0.5);
		expect(lit.r).toBeGreaterThan(base.r);
	});

	it("lighten / darken default to oklch and accept an explicit space", () => {
		const base = parseColor("#3b82f6");
		expect(lighten(base, 0.3)).toEqual(
			lighten(base, 0.3, { colorSpace: "oklch" }),
		);
		expect(darken(base, 0.3)).toEqual(
			darken(base, 0.3, { colorSpace: "oklch" }),
		);
		expect(lighten(base, 0.5, { colorSpace: "rgb" })).toEqual(
			mixColor(base, "#ffffff", 0.5, { colorSpace: "rgb" }),
		);
		expect(lighten(base, 0.5, { colorSpace: "rgb" })).not.toEqual(
			lighten(base, 0.5),
		);
	});

	it("darken moves toward black", () => {
		const base = parseColor("#cccccc");
		const dark = darken(base, 0.5);
		expect(dark.r).toBeLessThan(base.r);
	});
});

describe("withAlpha", () => {
	it("replaces only the alpha channel", () => {
		const c = withAlpha("#ff0000", 0.25);
		expect(c).toEqual({ r: 255, g: 0, b: 0, a: 0.25 });
	});
});

describe("randomColor", () => {
	it("is deterministic for a fixed numeric seed", () => {
		expect(randomColor(42)).toEqual(randomColor(42));
	});

	it("is deterministic for a fixed string seed", () => {
		expect(randomColor("streamline-7")).toEqual(randomColor("streamline-7"));
	});

	it("differs across seeds (not a constant)", () => {
		expect(randomColor(1)).not.toEqual(randomColor(2));
	});

	it("differs for non-integer seeds", () => {
		expect(randomColor(1.25)).not.toEqual(randomColor(1.5));
	});

	it("is engine-independent: pinned integer-hash output", () => {
		expect(randomColor(42)).toMatchInlineSnapshot(`
			{
			  "a": 1,
			  "b": 226.66546856480582,
			  "g": 189.47553852222194,
			  "r": 19.817790325182248,
			}
		`);
	});

	it("produces a valid opaque colour by default", () => {
		const c = randomColor("abc");
		expect(c.a).toBe(1);
		expect(c.r).toBeGreaterThanOrEqual(0);
		expect(c.r).toBeLessThanOrEqual(255);
	});
});

describe("modern parsing", () => {
	it("parses transparent as {0,0,0,0}", () => {
		expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
	});

	it("parses space-separated rgb with slash alpha", () => {
		expect(parseColor("rgb(255 0 0 / 50%)")).toEqual({
			r: 255,
			g: 0,
			b: 0,
			a: 0.5,
		});
	});

	it("parses hsl with deg units and slash alpha", () => {
		const c = parseColor("hsl(120deg 100% 50% / 0.25)");
		expect(c.g).toBeCloseTo(255, 3);
		expect(c.r).toBeCloseTo(0, 3);
		expect(c.a).toBe(0.25);
	});

	it("parses oklch", () => {
		const c = parseColor("oklch(0.628 0.2577 29.23)");
		expect(c.r).toBeGreaterThan(240);
		expect(c.g).toBeLessThan(15);
	});

	it("tryParseColor returns null for junk and a Color otherwise", () => {
		expect(tryParseColor("not a colour")).toBeNull();
		expect(tryParseColor("rgb(1 2)")).toBeNull();
		expect(tryParseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
	});

	it("never emits NaN", () => {
		expect(toCss({ r: Number.NaN, g: 0, b: 0, a: 1 })).not.toContain("NaN");
		expect(parseColor({ r: Number.NaN, g: 1, b: 2, a: Number.NaN })).toEqual({
			r: 128,
			g: 1,
			b: 2,
			a: 1,
		});
	});
});

describe("mixColor hsl with achromatic endpoint", () => {
	it("holds the chromatic endpoint's hue", () => {
		const mid = mixColor("#808080", "#ff0000", 0.5, {
			colorSpace: "hsl",
		});
		const h = rgbToHsl(mid).h;
		expect(h === 0 || h > 359.9).toBe(true);
		const mid2 = mixColor("#808080", "#0000ff", 0.5, {
			colorSpace: "hsl",
		});
		expect(rgbToHsl(mid2).h).toBeCloseTo(240, 0);
	});
});

describe("colorInterpolator", () => {
	// The straightforward implementation, kept as the oracle: parse and
	// convert both endpoints on every call.
	const reference = (
		a: string,
		b: string,
		t: number,
		colorSpace: ColorSpace,
	) => {
		const from = parseColor(a);
		const to = parseColor(b);
		if (colorSpace === "rgb") {
			return {
				r: from.r + (to.r - from.r) * t,
				g: from.g + (to.g - from.g) * t,
				b: from.b + (to.b - from.b) * t,
				a: from.a + (to.a - from.a) * t,
			};
		}
		const wrap = (x: number, y: number, k: number) => {
			let d = ((y - x + 180) % 360) - 180;
			if (d < -180) d += 360;
			return x + d * k;
		};
		if (colorSpace === "hsl") {
			const f = rgbToHsl(from);
			const o = rgbToHsl(to);
			const fh = f.s < 1e-4 ? o.h : f.h;
			const oh = o.s < 1e-4 ? f.h : o.h;
			return hslToRgb({
				h: wrap(fh, oh, t),
				s: f.s + (o.s - f.s) * t,
				l: f.l + (o.l - f.l) * t,
				a: f.a + (o.a - f.a) * t,
			});
		}
		const f = rgbToOklch(from);
		const o = rgbToOklch(to);
		const fh = f.c < 1e-4 ? o.h : f.h;
		const oh = o.c < 1e-4 ? f.h : o.h;
		return oklchToRgb({
			l: f.l + (o.l - f.l) * t,
			c: f.c + (o.c - f.c) * t,
			h: wrap(fh, oh, t),
			a: f.a + (o.a - f.a) * t,
		});
	};

	const pairs: [string, string][] = [
		["#3b4cc0", "#b40426"],
		["#ff0010", "#ff00f0"], // hue wrap through 0/360
		["#808080", "#ff0000"], // achromatic start
		["#00ff00", "#ffffff"], // achromatic end
		["#000000", "#ffffff"], // both achromatic
		["rgba(10, 20, 30, 0.25)", "oklch(0.7 0.2 140)"],
	];

	it("matches the per-call implementation in every space", () => {
		for (const colorSpace of ["rgb", "hsl", "oklch"] as const) {
			for (const [a, b] of pairs) {
				const f = colorInterpolator(a, b, { colorSpace });
				for (const t of [-0.25, 0, 0.1, 0.5, 0.9, 1, 1.5]) {
					expect(f(t)).toEqual(reference(a, b, t, colorSpace));
					expect(mixColor(a, b, t, { colorSpace })).toEqual(f(t));
				}
			}
		}
	});

	it("returns a fresh Color per sample", () => {
		const f = colorInterpolator("#000", "#fff");
		expect(f(0.5)).not.toBe(f(0.5));
	});
});
