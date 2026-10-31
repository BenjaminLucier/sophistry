import { describe, expect, it } from "vitest";
import { writeLagRatio, writePhase } from "./write-phase";

describe("writePhase", () => {
	it("uses Manim's Write lag: min(4 / count, 0.2)", () => {
		expect(writeLagRatio(5)).toBe(0.2);
		expect(writeLagRatio(40)).toBe(0.1);
		expect(writeLagRatio(0)).toBe(0.2);
	});

	it("traces the outline over the first half of a piece's window, then fills", () => {
		// One piece: its window is the whole write.
		expect(writePhase(0.25, 0, 1)).toEqual({ border: 0.5, fill: 0 });
		expect(writePhase(0.5, 0, 1)).toEqual({ border: 1, fill: 0 });
		expect(writePhase(0.75, 0, 1)).toEqual({ border: 1, fill: 0.5 });
		expect(writePhase(1, 0, 1)).toEqual({ border: 1, fill: 1 });
	});

	it("staggers pieces, matching Animation.get_sub_alpha", () => {
		// Two pieces at lag 0.5: the span is 1.5, the second starts at 0.5.
		expect(writePhase(0, 1, 2, 0.5)).toEqual({ border: 0, fill: 0 });
		expect(writePhase(1 / 3, 1, 2, 0.5)).toEqual({ border: 0, fill: 0 });
		expect(writePhase(1, 0, 2, 0.5)).toEqual({ border: 1, fill: 1 });
		expect(writePhase(1, 1, 2, 0.5)).toEqual({ border: 1, fill: 1 });
	});
});
