import { describe, expect, it } from "vitest";
import { waterfallSteps } from "./waterfall";

describe("waterfallSteps", () => {
	it("floats each change from the running total", () => {
		expect(waterfallSteps([100, -30, 20])).toEqual([
			{ base: 0, end: 100, delta: 100, kind: "up" },
			{ base: 100, end: 70, delta: -30, kind: "down" },
			{ base: 70, end: 90, delta: 20, kind: "up" },
		]);
	});

	it("stands a total on zero at the running total, ignoring its own value", () => {
		const steps = waterfallSteps([100, -30, 999], [false, false, true]);
		expect(steps[2]).toEqual({ base: 0, end: 70, delta: 70, kind: "total" });
	});

	it("treats a non-finite change as no change", () => {
		const steps = waterfallSteps([10, Number.NaN, 5]);
		expect(steps.map((s) => s.end)).toEqual([10, 10, 15]);
	});
});
