import { describe, expect, it } from "vitest";
import { beeswarmOffsets, dodgeSpan } from "./dodge";

describe("dodgeSpan", () => {
	it("splits a band into equal sub-bands with padding on both sides", () => {
		expect(dodgeSpan(0, 2, 0.1)).toEqual([0.025, 0.475]);
		expect(dodgeSpan(1, 2, 0.1)).toEqual([0.525, 0.975]);
		expect(dodgeSpan(0, 1, 0)).toEqual([0, 1]);
	});

	it("clamps padding and a count below one", () => {
		expect(dodgeSpan(0, 0, -1)).toEqual([0, 1]);
		expect(dodgeSpan(0, 1, 5)).toEqual([0.5, 0.5]);
	});
});

describe("beeswarmOffsets", () => {
	const overlaps = (positions: number[], offsets: number[], r: number) => {
		for (let i = 0; i < positions.length; i++)
			for (let j = i + 1; j < positions.length; j++) {
				const d = Math.hypot(
					positions[i] - positions[j],
					offsets[i] - offsets[j],
				);
				if (d < 2 * r - 1e-9) return true;
			}
		return false;
	};

	it("leaves well-separated circles on the axis", () => {
		expect(beeswarmOffsets([0, 1, 2], 0.1)).toEqual([0, 0, 0]);
	});

	it("stacks coincident circles alternately above and below", () => {
		expect(beeswarmOffsets([0, 0, 0], 0.1)).toEqual(
			[0, 0.2, -0.2].map((v) => expect.closeTo(v)),
		);
	});

	it("never overlaps, and stays as close to the axis as it can", () => {
		const positions = Array.from(
			{ length: 60 },
			(_, i) => Math.sin(i * 12.9898) * 0.8,
		);
		const offsets = beeswarmOffsets(positions, 0.05, { gap: 0 });
		expect(overlaps(positions, offsets, 0.05)).toBe(false);
		expect(Math.max(...offsets.map(Math.abs))).toBeLessThan(1);
	});

	it("is deterministic and independent of input order", () => {
		const positions = [0.3, 0.1, 0.2, 0.1, 0.25];
		const a = beeswarmOffsets(positions, 0.05);
		const b = beeswarmOffsets(positions, 0.05);
		expect(a).toEqual(b);
		// The same values in another order make the same swarm (tied values
		// may trade places between themselves).
		const reversed = beeswarmOffsets([...positions].reverse(), 0.05);
		const sorted = (v: number[]) => [...v].sort((p, q) => p - q);
		expect(sorted(reversed)).toEqual(sorted(a));
	});

	it("keeps to one side when asked", () => {
		const offsets = beeswarmOffsets([0, 0, 0, 0], 0.1, { side: "positive" });
		expect(offsets.every((o) => o >= 0)).toBe(true);
		expect(overlaps([0, 0, 0, 0], offsets, 0.1)).toBe(false);
	});

	it("respects a gap and per-circle radii", () => {
		const offsets = beeswarmOffsets([0, 0], [0.1, 0.3], { gap: 0.05 });
		expect(Math.abs(offsets[1] - offsets[0])).toBeCloseTo(0.45);
	});

	it("gives a non-finite position a NaN offset", () => {
		const offsets = beeswarmOffsets([0, Number.NaN], 0.1);
		expect(offsets[0]).toBe(0);
		expect(offsets[1]).toBeNaN();
	});
});
