import { describe, expect, it } from "vitest";
import { scalarParam } from "./param.js";

describe("scalarParam step", () => {
	const param = scalarParam(
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ range: [1, 10], step: 4 },
	);
	const at = (x: number) => param.toValue({ x, y: 0 }, undefined as never);

	it("makes lo reachable when it is not a multiple of step", () => {
		expect(at(0)).toBe(1);
	});

	it("never overshoots hi", () => {
		expect(at(10)).toBeLessThanOrEqual(10);
		expect(at(9)).toBeLessThanOrEqual(10);
	});

	it("snaps in steps from lo", () => {
		expect(at(5)).toBe(5);
	});
});
