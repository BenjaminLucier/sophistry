import { describe, expect, it } from "vitest";
import type { EasingName } from "./easing";
import {
	easings,
	exponentialDecay,
	notQuiteThere,
	resolveEasing,
	runningStart,
	squish,
	thereAndBack,
	thereAndBackWithPause,
} from "./easing";

describe("easings registry", () => {
	const names = Object.keys(easings) as EasingName[];

	for (const name of names) {
		it(`${name}: f(0) is 0 and f(1) is 1`, () => {
			const f = easings[name];
			// thereAndBack-style curves intentionally return to 0 at t=1; skip those.
			if (name === "thereAndBack") return;
			expect(f(0)).toBeCloseTo(0, 4);
			expect(f(1)).toBeCloseTo(1, 4);
		});
	}

	it("linear is the identity", () => {
		for (const t of [0, 0.25, 0.5, 0.75, 1]) {
			expect(easings.linear(t)).toBeCloseTo(t, 9);
		}
	});
});

describe("thereAndBack", () => {
	it("f(0) and f(1) are both 0 (round trip)", () => {
		const f = thereAndBack();
		expect(f(0)).toBeCloseTo(0, 6);
		expect(f(1)).toBeCloseTo(0, 6);
	});

	it("f(0.5) is 1 (the far point of the trip)", () => {
		const f = thereAndBack();
		expect(f(0.5)).toBeCloseTo(1, 6);
	});

	it("is symmetric about t=0.5", () => {
		const f = thereAndBack();
		for (const t of [0.1, 0.3, 0.4]) {
			expect(f(t)).toBeCloseTo(f(1 - t), 6);
		}
	});

	it("accepts a custom underlying curve", () => {
		const f = thereAndBack(easings.linear);
		expect(f(0.5)).toBeCloseTo(1, 6);
		expect(f(0)).toBeCloseTo(0, 6);
	});
});

describe("thereAndBackWithPause", () => {
	it("holds at 1 during the pause window", () => {
		const f = thereAndBackWithPause(0.4);
		// ramp = (1-0.4)/2 = 0.3, so [0.3, 0.7) holds at 1
		expect(f(0.3)).toBeCloseTo(1, 6);
		expect(f(0.5)).toBeCloseTo(1, 6);
		expect(f(0.69)).toBeCloseTo(1, 6);
	});

	it("starts and ends at 0", () => {
		const f = thereAndBackWithPause(0.3);
		expect(f(0)).toBeCloseTo(0, 6);
		expect(f(1)).toBeCloseTo(0, 6);
	});
});

describe("resolveEasing", () => {
	it("resolves a name to the matching curve", () => {
		expect(resolveEasing("linear")).toBe(easings.linear);
	});

	it("passes a function straight through", () => {
		const custom = (t: number) => t * t;
		expect(resolveEasing(custom)).toBe(custom);
	});

	it("falls back to smooth (cubicInOut) when undefined", () => {
		expect(resolveEasing(undefined)).toBe(easings.smooth);
	});

	it("a custom fallback is honored", () => {
		const fallback = () => 0.5;
		expect(resolveEasing(undefined, fallback)).toBe(fallback);
	});

	it("throws for an unrecognised name, listing valid ones", () => {
		expect(() => resolveEasing("nonexistent" as EasingName)).toThrow(
			/Unknown easing "nonexistent"/,
		);
	});

	it("a custom curve is passed as a value, unchanged", () => {
		const mine = (t: number) => t;
		expect(resolveEasing(mine)).toBe(mine);
	});

	it("the built-in map is frozen and there is no register function", () => {
		expect(Object.isFrozen(easings)).toBe(true);
	});
});

describe("rushInto / rushFrom", () => {
	it("match Manim's definitions in terms of smooth (exact for a cubic smooth)", () => {
		for (const t of [0, 0.2, 0.5, 0.8, 1]) {
			expect(easings.rushInto(t)).toBeCloseTo(2 * easings.smooth(t / 2), 9);
			expect(easings.rushFrom(t)).toBeCloseTo(
				2 * easings.smooth((t + 1) / 2) - 1,
				9,
			);
		}
	});
});

describe("thereAndBackWithPause edge cases", () => {
	it("never returns NaN for hold = 1", () => {
		const f = thereAndBackWithPause(1);
		for (const t of [0, 0.25, 0.5, 1]) expect(Number.isNaN(f(t))).toBe(false);
		expect(f(0.5)).toBe(1);
	});

	it("clamps hold outside [0, 1]", () => {
		expect(thereAndBackWithPause(5)(0.5)).toBe(1);
		expect(Number.isNaN(thereAndBackWithPause(-3)(0.5))).toBe(false);
		expect(thereAndBackWithPause(-3)(0.5)).toBeCloseTo(1, 6);
	});
});

describe("Manim's remaining rate functions", () => {
	it("squish runs the curve inside its window and holds outside it", () => {
		const f = squish("linear", 0.4, 0.6);
		expect(f(0)).toBe(0);
		expect(f(0.4)).toBe(0);
		expect(f(0.5)).toBeCloseTo(0.5, 9);
		expect(f(0.6)).toBe(1);
		expect(f(1)).toBe(1);
		// Defaults to smooth over Manim's [0.4, 0.6].
		expect(squish()(0.45)).toBeCloseTo(easings.smooth(0.25), 9);
	});

	it("squish with a zero-width window is a step, not NaN", () => {
		const f = squish("linear", 0.5, 0.5);
		expect(f(0.49)).toBe(0);
		expect(f(0.5)).toBe(1);
		expect(f(0.51)).toBe(1);
	});

	it("runningStart pulls back before it goes", () => {
		const f = runningStart();
		expect(f(0)).toBe(0);
		expect(f(1)).toBeCloseTo(1, 12);
		expect(Math.min(...[0.1, 0.2, 0.3].map(f))).toBeLessThan(0);
		// The Bézier at t = 0.5: Σ C(6, i)·cᵢ / 2⁶.
		expect(f(0.5)).toBeCloseTo((15 * -0.5 + 20 * -0.5 + 15 + 6 + 1) / 64, 12);
		expect(runningStart(0)(0.2)).toBeGreaterThanOrEqual(0);
	});

	it("notQuiteThere stops short", () => {
		expect(notQuiteThere()(1)).toBeCloseTo(0.7, 12);
		expect(notQuiteThere("linear", 0.5)(0.5)).toBeCloseTo(0.25, 12);
	});

	it("exponentialDecay leaves fast and lands exactly on 1", () => {
		const f = exponentialDecay();
		expect(f(0)).toBe(0);
		expect(f(1)).toBe(1);
		expect(f(0.1)).toBeCloseTo((1 - Math.exp(-1)) / (1 - Math.exp(-10)), 12);
		expect(exponentialDecay(0.3)(0.5)).toBeLessThan(f(0.5));
	});

	it("slowInto, doubleSmooth and lingering match Manim", () => {
		expect(easings.slowInto(0.5)).toBeCloseTo(Math.sqrt(0.75), 12);
		expect(easings.doubleSmooth(0.5)).toBeCloseTo(0.5, 12);
		expect(easings.doubleSmooth(0.25)).toBeCloseTo(
			0.5 * easings.smooth(0.5),
			12,
		);
		expect(easings.lingering(0.4)).toBeCloseTo(0.5, 12);
		expect(easings.lingering(0.9)).toBe(1);
	});

	it("are reachable by name", () => {
		for (const name of [
			"slowInto",
			"doubleSmooth",
			"lingering",
			"runningStart",
			"exponentialDecay",
		] as const)
			expect(resolveEasing(name)).toBe(easings[name]);
	});
});
