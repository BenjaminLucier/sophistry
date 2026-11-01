import { describe, expect, it } from "vitest";
import type { ConstraintSpec } from "./constrain.js";
import { constraints, free, resolveConstraint } from "./constrain.js";

describe("resolveConstraint", () => {
	it("resolves undefined to null", () => {
		expect(resolveConstraint(undefined)).toBeNull();
	});

	it("resolves an empty array to null", () => {
		expect(resolveConstraint([])).toBeNull();
	});

	it("resolves a built-in name to the matching constraint", () => {
		expect(resolveConstraint("axisX")).toBe(constraints.axisX);
	});

	it("passes a function straight through", () => {
		const custom = (p: { x: number; y: number }) => p;
		expect(resolveConstraint(custom)).toBe(custom);
	});

	it("chains an array of specs", () => {
		const resolved = resolveConstraint(["axisX", "axisY"]);
		expect(resolved).not.toBeNull();
		expect(typeof resolved).toBe("function");
	});

	it("throws for an unrecognised name, listing valid ones", () => {
		expect(() => resolveConstraint("nonexistent" as ConstraintSpec)).toThrow(
			/Unknown constraint "nonexistent"/,
		);
	});

	it("a custom constraint is passed as a value, unchanged", () => {
		const mine = free();
		expect(resolveConstraint(mine)).toBe(mine);
	});
});
