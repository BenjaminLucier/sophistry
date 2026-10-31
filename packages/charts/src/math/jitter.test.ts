import { hashUnit } from "@sophistry/core/internal";
import { describe, expect, it } from "vitest";
import { jitterOffsets } from "./jitter";

describe("hashUnit", () => {
	it("is a pure function of key and seed, in [0, 1)", () => {
		expect(hashUnit("a", 1)).toBe(hashUnit("a", 1));
		expect(hashUnit("a", 1)).not.toBe(hashUnit("a", 2));
		for (let i = 0; i < 200; i++) {
			const u = hashUnit(i);
			expect(u).toBeGreaterThanOrEqual(0);
			expect(u).toBeLessThan(1);
		}
	});

	it("spreads consecutive keys over the whole interval", () => {
		const values = Array.from({ length: 1000 }, (_, i) => hashUnit(i));
		const buckets = new Array(10).fill(0);
		for (const v of values) buckets[Math.floor(v * 10)]++;
		for (const count of buckets) {
			expect(count).toBeGreaterThan(60);
			expect(count).toBeLessThan(140);
		}
	});
});

describe("jitterOffsets", () => {
	it("centres the offsets on zero within the width", () => {
		const offsets = jitterOffsets(
			Array.from({ length: 100 }, (_, i) => i),
			{ width: 0.5 },
		);
		for (const o of offsets) {
			expect(o).toBeGreaterThanOrEqual(-0.25);
			expect(o).toBeLessThan(0.25);
		}
	});

	it("keys an offset to its datum, not its position in the list", () => {
		const a = jitterOffsets(["x", "y", "z"], { seed: 3 });
		const b = jitterOffsets(["z", "x"], { seed: 3 });
		expect(b[0]).toBe(a[2]);
		expect(b[1]).toBe(a[0]);
	});
});
