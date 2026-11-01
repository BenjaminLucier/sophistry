import { describe, expect, it } from "vitest";
import { createResolver } from "./resolver.js";

describe("createResolver", () => {
	it("resolves a registered name to its value", () => {
		const double = (x: number) => x * 2;
		const triple = (x: number) => x * 3;
		const { resolve } = createResolver("test fn", { double, triple });
		expect(resolve("double")).toBe(double);
		expect(resolve("triple")).toBe(triple);
	});

	it("passes a non-string value through unchanged", () => {
		const double = (x: number) => x * 2;
		const custom = (x: number) => x + 1;
		const { resolve } = createResolver("test fn", { double });
		expect(resolve(custom)).toBe(custom);
	});

	it("throws on an unknown name, naming the registry and listing valid names", () => {
		const double = (x: number) => x * 2;
		const triple = (x: number) => x * 3;
		const { resolve } = createResolver("test fn", { double, triple });
		expect(() => resolve("quadruple")).toThrow(/Unknown test fn "quadruple"/);
		expect(() => resolve("quadruple")).toThrow(/double, triple/);
	});

	it("throws a legible message when there are no built-ins", () => {
		const { resolve } = createResolver<(x: number) => number>("empty", {});
		expect(() => resolve("anything")).toThrow(/\(none\)/);
	});

	it("has no register: the map is frozen and the seed is untouched", () => {
		const double = (x: number) => x * 2;
		const seed = { double };
		const r = createResolver("test fn", seed);
		expect("register" in r).toBe(false);
		expect(Object.isFrozen(r.registry)).toBe(true);
		expect(() => {
			(r.registry as Record<string, unknown>).custom = double;
		}).toThrow();
		expect(seed).not.toHaveProperty("custom");
	});

	it("passes a custom function value through unchanged", () => {
		const custom = (x: number) => x - 1;
		const { resolve } = createResolver("test fn", { custom: custom });
		const mine = (x: number) => x + 7;
		expect(resolve(mine)).toBe(mine);
	});

	it("the registry is directly enumerable", () => {
		const double = (x: number) => x * 2;
		const triple = (x: number) => x * 3;
		const { registry } = createResolver("test fn", { double, triple });
		expect(Object.keys(registry).sort()).toEqual(["double", "triple"]);
	});
});

describe("createResolver prototype names", () => {
	it("treats Object.prototype members as unknown names", () => {
		const r = createResolver<number>("thing", { a: 1 });
		for (const name of [
			"constructor",
			"toString",
			"__proto__",
			"hasOwnProperty",
		])
			expect(() => r.resolve(name)).toThrow(/Unknown thing/);
		expect(r.resolve("a")).toBe(1);
	});
});
