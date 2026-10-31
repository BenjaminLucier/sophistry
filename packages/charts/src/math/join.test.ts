import { describe, expect, it } from "vitest";
import {
	joinStages,
	keyedJoin,
	rescaleKind,
	rescaleWindow,
	stageProgress,
	staggeredStageProgress,
} from "./join";

describe("keyedJoin", () => {
	it("splits keys into update, enter and exit, from's order then to's new keys", () => {
		const join = keyedJoin(["a", "b", "c"], ["b", "d", "c"]);
		expect(join.keys).toEqual(["a", "b", "c", "d"]);
		expect(join.from.get("a")).toBe(0);
		expect(join.to.get("a")).toBeUndefined();
		expect(join.to.get("d")).toBe(1);
		expect(join.enters).toBe(true);
		expect(join.exits).toBe(true);
	});

	it("reports no enters or exits when the keys match in any order", () => {
		const join = keyedJoin([1, 2, 3], [3, 1, 2]);
		expect(join.enters).toBe(false);
		expect(join.exits).toBe(false);
		expect(join.keys).toEqual([1, 2, 3]);
	});
});

describe("joinStages", () => {
	it("is the whole blend for an update alone", () => {
		const stages = joinStages();
		expect(stages.update).toEqual([0, 1]);
		expect(stages.eased).toBe(true);
	});

	it("collapses empty stages and keeps at most three, in rule 13's order", () => {
		const all = joinStages({
			exits: true,
			enters: true,
			expand: true,
			contract: true,
		});
		const close = (window: readonly number[], expected: number[]) =>
			window.forEach((edge, i) => {
				expect(edge).toBeCloseTo(expected[i]);
			});
		close(all.exit, [0, 1 / 3]);
		expect(all.expand).toBe(all.exit);
		close(all.update, [1 / 3, 2 / 3]);
		close(all.contract, [2 / 3, 1]);
		expect(all.enter).toBe(all.contract);

		const exitOnly = joinStages({ exits: true });
		expect(exitOnly.exit).toEqual([0, 0.5]);
		expect(exitOnly.update).toEqual([0.5, 1]);
		expect(exitOnly.enter).toEqual([1, 1]);

		const growing = joinStages({ expand: true });
		expect(growing.expand).toEqual([0, 0.5]);
		expect(growing.update).toEqual([0.5, 1]);
	});

	it("runs everything over the whole blend, unseased, when together", () => {
		const stages = joinStages({
			exits: true,
			enters: true,
			staging: "together",
		});
		expect(stages.exit).toEqual([0, 1]);
		expect(stages.enter).toEqual([0, 1]);
		expect(stages.eased).toBe(false);
	});
});

describe("stageProgress", () => {
	it("is 0 before its window, 1 after, and linear or eased within", () => {
		expect(stageProgress(0.1, [0.5, 1])).toBe(0);
		expect(stageProgress(1, [0, 0.5])).toBe(1);
		expect(stageProgress(0.75, [0.5, 1])).toBeCloseTo(0.5);
		expect(stageProgress(0.6, [0.5, 1], true)).toBeLessThan(0.2);
		expect(stageProgress(0.75, [0.5, 1], true)).toBeCloseTo(0.5);
	});

	it("is exactly 0 at t = 0 and 1 at t = 1 for every window", () => {
		for (const window of [
			[0, 1],
			[0, 0.5],
			[0.5, 1],
			[1 / 3, 2 / 3],
		] as const) {
			expect(stageProgress(0, window, true)).toBe(0);
			expect(stageProgress(1, window, true)).toBe(1);
		}
	});

	it("treats an empty window as a step at its start", () => {
		expect(stageProgress(0.99, [1, 1])).toBe(0);
		expect(stageProgress(1, [1, 1])).toBe(1);
		expect(stageProgress(0, [0, 0])).toBe(1);
	});
});

describe("staggeredStageProgress", () => {
	it("is the stage's own progress without a spread or with one item", () => {
		for (const t of [0, 0.3, 0.7, 0.85, 1]) {
			expect(staggeredStageProgress(t, [0.5, 1], true, 2, 4, 0)).toBe(
				stageProgress(t, [0.5, 1], true),
			);
			expect(staggeredStageProgress(t, [0.5, 1], true, 0, 1, 0.5)).toBe(
				stageProgress(t, [0.5, 1], true),
			);
		}
	});

	it("gives each item its own sub-window, a fixed total spread", () => {
		// The window [0.5, 1], spread 0.5 over three items: item 0 runs over
		// the first half of it, item 1 over the middle, item 2 over the last.
		const at = (t: number, rank: number) =>
			staggeredStageProgress(t, [0.5, 1], false, rank, 3, 0.5);
		expect(at(0.75, 0)).toBeCloseTo(1);
		expect(at(0.75, 1)).toBeCloseTo(0.5);
		expect(at(0.75, 2)).toBe(0);
		expect(at(0.875, 2)).toBeCloseTo(0.5);
		// Eased, each item eases on its own sub-window: halfway is still half.
		expect(staggeredStageProgress(0.75, [0.5, 1], true, 1, 3, 0.5)).toBeCloseTo(
			0.5,
		);
		expect(staggeredStageProgress(0.6, [0.5, 1], true, 0, 3, 0.5)).toBeLessThan(
			0.4,
		);
	});

	it("is exactly 0 before the window and 1 at its end, for every item", () => {
		for (let rank = 0; rank < 5; rank++) {
			expect(staggeredStageProgress(0.5, [0.5, 1], true, rank, 5, 0.95)).toBe(
				0,
			);
			expect(staggeredStageProgress(1, [0.5, 1], true, rank, 5, 0.95)).toBe(1);
		}
		// An empty window stays a step at its start.
		expect(staggeredStageProgress(1, [1, 1], true, 3, 4, 0.5)).toBe(1);
		expect(staggeredStageProgress(0.99, [1, 1], true, 0, 4, 0.5)).toBe(0);
	});
});

describe("rescaleKind", () => {
	it("tells growing, shrinking, shifting and unchanged domains apart", () => {
		expect(rescaleKind([0, 10], [0, 10])).toBe("none");
		expect(rescaleKind([0, 10], [0, 100])).toBe("expand");
		expect(rescaleKind([0, 100], [0, 10])).toBe("contract");
		expect(rescaleKind([0, 10], [5, 15])).toBe("shift");
		// Reversed ranges compare by extent.
		expect(rescaleKind([10, 0], [0, 20])).toBe("expand");
	});

	it("picks the window a domain rescales in", () => {
		const stages = joinStages({ expand: true, contract: true });
		expect(rescaleWindow(stages, "expand")).toBe(stages.expand);
		expect(rescaleWindow(stages, "contract")).toBe(stages.contract);
		expect(rescaleWindow(stages, "shift")).toBe(stages.update);
	});
});
