import { describe, expect, it } from "vitest";
import type { Bounds } from "../geometry";
import {
	alignTo,
	arrange,
	arrangeInGrid,
	boundsCenter,
	boundsFromCenter,
	boundsHeight,
	boundsWidth,
	centerAt,
	DEFAULT_GAP,
	DL,
	DOWN,
	DR,
	LEFT,
	NO_SHIFT,
	nextTo,
	ORIGIN,
	onlyX,
	onlyY,
	padBounds,
	pointOn,
	RIGHT,
	readDelta,
	shiftBy,
	sumShifts,
	surround,
	toCorner,
	toEdge,
	UL,
	UP,
	UR,
	unionBounds,
} from "./layout";

function box(minX: number, minY: number, maxX: number, maxY: number): Bounds {
	return { minX, minY, maxX, maxY };
}

describe("readDelta / shiftBy / sumShifts / onlyX / onlyY", () => {
	it("readDelta on undefined gives zero", () => {
		expect(readDelta(undefined)).toEqual({ x: 0, y: 0 });
	});

	it("readDelta on NO_SHIFT gives zero, and is a fresh copy", () => {
		const delta = readDelta(NO_SHIFT);
		expect(delta).toEqual({ x: 0, y: 0 });
	});

	it("shiftBy nudges an existing placement", () => {
		// centerAt(box(0,0,2,2) [centre (1,1)], (5,5)) => delta (4,4); +(1,-1) => (5,3).
		const p = shiftBy(centerAt(box(0, 0, 2, 2), { x: 5, y: 5 }), {
			x: 1,
			y: -1,
		});
		expect(readDelta(p)).toEqual({ x: 5, y: 3 });
	});

	it("sumShifts adds multiple placements together", () => {
		// centre (1,1) -> (1,0): delta (0,-1); centre (1,1) -> (0,3): delta (-1,2).
		const a = centerAt(box(0, 0, 2, 2), { x: 1, y: 0 });
		const b = centerAt(box(0, 0, 2, 2), { x: 0, y: 3 });
		expect(readDelta(sumShifts(a, b))).toEqual({ x: -1, y: 1 });
	});

	it("sumShifts with no arguments is zero", () => {
		expect(readDelta(sumShifts())).toEqual({ x: 0, y: 0 });
	});

	it("onlyX / onlyY isolate an axis", () => {
		const p = centerAt(box(0, 0, 2, 2), { x: 3, y: 4 });
		expect(readDelta(onlyX(p))).toEqual({ x: 2, y: 0 });
		expect(readDelta(onlyY(p))).toEqual({ x: 0, y: 3 });
	});
});

describe("boundsWidth / boundsHeight / boundsCenter / boundsFromCenter", () => {
	it("computes width, height and center of a box", () => {
		const b = box(0, 0, 4, 2);
		expect(boundsWidth(b)).toBe(4);
		expect(boundsHeight(b)).toBe(2);
		expect(boundsCenter(b)).toEqual({ x: 2, y: 1 });
	});

	it("boundsFromCenter is the inverse of boundsCenter/width/height", () => {
		const b = boundsFromCenter({ x: 2, y: 1 }, 4, 2);
		expect(b).toEqual(box(0, 0, 4, 2));
	});

	it("handles a degenerate zero-area box", () => {
		const b = box(1, 1, 1, 1);
		expect(boundsWidth(b)).toBe(0);
		expect(boundsHeight(b)).toBe(0);
		expect(boundsCenter(b)).toEqual({ x: 1, y: 1 });
	});
});

describe("pointOn", () => {
	const b = box(0, 0, 2, 4);

	it("ORIGIN gives the centre", () => {
		expect(pointOn(b, ORIGIN)).toEqual({ x: 1, y: 2 });
	});

	it("UP/DOWN/LEFT/RIGHT give edge midpoints", () => {
		expect(pointOn(b, UP)).toEqual({ x: 1, y: 4 });
		expect(pointOn(b, DOWN)).toEqual({ x: 1, y: 0 });
		expect(pointOn(b, LEFT)).toEqual({ x: 0, y: 2 });
		expect(pointOn(b, RIGHT)).toEqual({ x: 2, y: 2 });
	});

	it("diagonal directions give corners", () => {
		expect(pointOn(b, UL)).toEqual({ x: 0, y: 4 });
		expect(pointOn(b, UR)).toEqual({ x: 2, y: 4 });
		expect(pointOn(b, DL)).toEqual({ x: 0, y: 0 });
		expect(pointOn(b, DR)).toEqual({ x: 2, y: 0 });
	});

	it("components beyond +-1 clamp onto the box, not off it", () => {
		expect(pointOn(b, { x: 2, y: -3 })).toEqual(pointOn(b, DR));
	});
});

describe("unionBounds", () => {
	it("empty input gives null", () => {
		expect(unionBounds()).toBeNull();
	});

	it("null/undefined-only input gives null", () => {
		expect(unionBounds(null, undefined)).toBeNull();
	});

	it("single box gives an equal (but distinct) box", () => {
		const b = box(0, 0, 1, 1);
		const out = unionBounds(b);
		expect(out).toEqual(b);
		expect(out).not.toBe(b);
	});

	it("two boxes give the smallest enclosing box", () => {
		const a = box(0, 0, 1, 1);
		const b = box(2, -1, 3, 0.5);
		expect(unionBounds(a, b)).toEqual(box(0, -1, 3, 1));
	});

	it("skips null/undefined items mixed with real ones", () => {
		const a = box(0, 0, 1, 1);
		expect(unionBounds(null, a, undefined)).toEqual(a);
	});
});

describe("padBounds", () => {
	it("positive padding grows the box on every side", () => {
		expect(padBounds(box(0, 0, 2, 2), 1)).toEqual(box(-1, -1, 3, 3));
	});

	it("zero padding is a no-op", () => {
		const b = box(0, 0, 2, 2);
		expect(padBounds(b, 0)).toEqual(b);
	});

	it("negative padding shrinks the box, possibly past zero area", () => {
		expect(padBounds(box(0, 0, 2, 2), -1)).toEqual(box(1, 1, 1, 1));
		// Shrinking past the box's own size inverts min/max — a real edge case,
		// documented here rather than "fixed", since padBounds has no opinion
		// about what a negative padding larger than the box means.
		expect(padBounds(box(0, 0, 2, 2), -3)).toEqual(box(3, 3, -1, -1));
	});
});

describe("nextTo", () => {
	const target = box(0, 0, 2, 2); // centred at (1, 1)
	const self = box(0, 0, 1, 1); // 1x1

	it("returns NO_SHIFT when either box is missing", () => {
		expect(nextTo(null, target, UP)).toBe(NO_SHIFT);
		expect(nextTo(self, undefined, UP)).toBe(NO_SHIFT);
	});

	it("places self above target with default gap, centred horizontally", () => {
		const delta = readDelta(nextTo(self, target, UP));
		// target's UP critical point is (1, 2); self's DOWN critical point,
		// pre-shift, is (0.5, 0): matching them and pushing out by gap gives
		// dx = 1 - 0.5 = 0.5, dy = 2 - 0 + gap.
		expect(delta.x).toBeCloseTo(0.5);
		expect(delta.y).toBeCloseTo(2 + DEFAULT_GAP);
	});

	it("places self to the right of target with a custom gap", () => {
		const delta = readDelta(nextTo(self, target, RIGHT, { gap: 1 }));
		expect(delta.x).toBeCloseTo(2 + 1);
		expect(delta.y).toBeCloseTo(0.5); // centred vertically
	});

	it("folds align into both lookups: aligned_edge flushes the perpendicular axis", () => {
		// Put self above target, left edges flush (align: LEFT).
		const delta = readDelta(nextTo(self, target, UP, { align: LEFT }));
		// target's UL critical point (align + direction = LEFT+UP = UL) is (0, 2).
		// self's DL critical point (align - direction = LEFT-UP = DL) is (0, 0).
		// So delta = (0,2) - (0,0) + (0, gap) = (0, 2 + gap).
		expect(delta.x).toBeCloseTo(0);
		expect(delta.y).toBeCloseTo(2 + DEFAULT_GAP);
	});

	it("works symmetrically for DOWN and LEFT", () => {
		const down = readDelta(nextTo(self, target, DOWN));
		expect(down.x).toBeCloseTo(0.5);
		expect(down.y).toBeCloseTo(0 - DEFAULT_GAP - 1);

		const left = readDelta(nextTo(self, target, LEFT));
		expect(left.x).toBeCloseTo(0 - DEFAULT_GAP - 1);
		expect(left.y).toBeCloseTo(0.5);
	});
});

describe("alignTo", () => {
	const target = box(0, 0, 4, 4);
	const self = box(0, 0, 1, 1);

	it("returns NO_SHIFT when either box is missing", () => {
		expect(alignTo(null, target, LEFT)).toBe(NO_SHIFT);
		expect(alignTo(self, undefined, LEFT)).toBe(NO_SHIFT);
	});

	it("only moves the axis direction names (LEFT touches x only)", () => {
		const delta = readDelta(alignTo(self, target, LEFT));
		expect(delta.x).toBeCloseTo(0); // self's left edge (0) meets target's left edge (0)
		expect(delta.y).toBe(0);
	});

	it("only moves the axis direction names (UP touches y only)", () => {
		const delta = readDelta(alignTo(self, target, UP));
		expect(delta.x).toBe(0);
		expect(delta.y).toBeCloseTo(3); // self top (1) -> target top (4): +3
	});

	it("diagonal direction moves both axes", () => {
		const delta = readDelta(alignTo(self, target, UR));
		expect(delta.x).toBeCloseTo(3);
		expect(delta.y).toBeCloseTo(3);
	});
});

describe("centerAt", () => {
	it("returns NO_SHIFT when self is missing", () => {
		expect(centerAt(null, { x: 1, y: 1 })).toBe(NO_SHIFT);
	});

	it("moves self's centre to the target point", () => {
		const delta = readDelta(centerAt(box(0, 0, 2, 2), { x: 5, y: -3 }));
		expect(delta).toEqual({ x: 4, y: -4 });
	});
});

describe("toEdge / toCorner", () => {
	const frame = box(-5, -5, 5, 5);
	const self = box(0, 0, 1, 1); // 1x1, centred at (0.5, 0.5)

	it("returns NO_SHIFT when either box is missing", () => {
		expect(toEdge(null, frame, UP)).toBe(NO_SHIFT);
		expect(toEdge(self, undefined, UP)).toBe(NO_SHIFT);
	});

	it("pins self's top edge inside the frame's top edge by margin", () => {
		const delta = readDelta(toEdge(self, frame, UP));
		// alignTo(self, frame, UP) flushes self's top (critical point y=1) with
		// frame's top (y=5): dy=4; toEdge insets that by margin.
		expect(delta.y).toBeCloseTo(4 - DEFAULT_GAP);
		expect(delta.x).toBe(0);
	});

	it("custom margin insets further", () => {
		const delta = readDelta(toEdge(self, frame, DOWN, { margin: 1 }));
		expect(delta.y).toBeCloseTo(-5 + 1);
	});

	it("toCorner insets on both axes toward the frame interior", () => {
		const delta = readDelta(toCorner(self, frame, UR));
		expect(delta.x).toBeCloseTo(4 - DEFAULT_GAP);
		expect(delta.y).toBeCloseTo(4 - DEFAULT_GAP);
	});

	it("toCorner and toEdge agree for a diagonal direction", () => {
		expect(toCorner(self, frame, DL)).toEqual(toEdge(self, frame, DL));
	});
});

describe("surround", () => {
	it("collapses to a zero-size box at the origin when target is missing", () => {
		expect(surround(null)).toEqual(box(0, 0, 0, 0));
		expect(surround(undefined)).toEqual(box(0, 0, 0, 0));
	});

	it("pads the target by the default padding", () => {
		expect(surround(box(0, 0, 2, 2))).toEqual(
			box(-DEFAULT_GAP, -DEFAULT_GAP, 2 + DEFAULT_GAP, 2 + DEFAULT_GAP),
		);
	});

	it("respects a custom padding", () => {
		expect(surround(box(0, 0, 2, 2), { padding: 0.5 })).toEqual(
			box(-0.5, -0.5, 2.5, 2.5),
		);
	});
});

describe("arrange", () => {
	it("empty items array gives an empty result", () => {
		expect(arrange([], RIGHT)).toEqual([]);
	});

	it("a single item is recentred onto its own original centre (net no-op)", () => {
		const item = box(0, 0, 2, 2); // centre (1,1)
		const [placement] = arrange([item], RIGHT);
		expect(readDelta(placement)).toEqual({ x: 0, y: 0 });
	});

	it("lays out items left-to-right with equal gaps, recentred on the original union", () => {
		const a = box(0, 0, 2, 2); // width 2
		const b = box(0, 0, 4, 2); // width 4
		const items = [a, b];
		const [pa, pb] = arrange(items, RIGHT, { gap: 1 });

		const da = readDelta(pa);
		const db = readDelta(pb);

		// Gap between the placed boxes' touching edges should be exactly `gap`.
		const aRight = a.maxX + da.x;
		const bLeft = b.minX + db.x;
		expect(bLeft - aRight).toBeCloseTo(1);

		// Vertically, both keep their own centre (RIGHT only moves x).
		expect(da.y).toBeCloseTo(0);
		expect(db.y).toBeCloseTo(0);

		// The arrangement recentres on the original combined union's centre.
		const originalUnion = box(0, 0, 4, 2); // union of a and b before arranging
		const originalCentre = boundsCenter(originalUnion);
		const placedA = box(
			a.minX + da.x,
			a.minY + da.y,
			a.maxX + da.x,
			a.maxY + da.y,
		);
		const placedB = box(
			b.minX + db.x,
			b.minY + db.y,
			b.maxX + db.x,
			b.maxY + db.y,
		);
		const placedUnion = box(
			Math.min(placedA.minX, placedB.minX),
			Math.min(placedA.minY, placedB.minY),
			Math.max(placedA.maxX, placedB.maxX),
			Math.max(placedA.maxY, placedB.maxY),
		);
		expect(boundsCenter(placedUnion).x).toBeCloseTo(originalCentre.x);
		expect(boundsCenter(placedUnion).y).toBeCloseTo(originalCentre.y);
	});

	it("honours an explicit center option", () => {
		const a = box(0, 0, 1, 1);
		const b = box(0, 0, 1, 1);
		const placements = arrange([a, b], RIGHT, { center: { x: 10, y: 10 } });
		const placedBoxes = placements.map((p, i) => {
			const d = readDelta(p);
			const src = i === 0 ? a : b;
			return box(
				src.minX + d.x,
				src.minY + d.y,
				src.maxX + d.x,
				src.maxY + d.y,
			);
		});
		const union = unionBounds(...placedBoxes);
		expect(union).not.toBeNull();
		if (union) {
			expect(boundsCenter(union).x).toBeCloseTo(10);
			expect(boundsCenter(union).y).toBeCloseTo(10);
		}
	});

	it("null/undefined items are skipped but keep their index (zero placement)", () => {
		const a = box(0, 0, 1, 1);
		const placements = arrange([a, null, box(0, 0, 1, 1)], RIGHT);
		expect(placements).toHaveLength(3);
		// The null item's placement is still a valid Placement (zero, then recentred).
		expect(readDelta(placements[1])).toBeDefined();
	});
});

describe("arrangeInGrid", () => {
	it("empty items array gives an empty result", () => {
		expect(arrangeInGrid([])).toEqual([]);
	});

	it("lays out a 4-item grid in a near-square (2x2) arrangement by default", () => {
		const items = [
			box(0, 0, 1, 1),
			box(0, 0, 1, 1),
			box(0, 0, 1, 1),
			box(0, 0, 1, 1),
		];
		const placements = arrangeInGrid(items, { gap: 1 });
		expect(placements).toHaveLength(4);

		const placed = items.map((item, i) => {
			const d = readDelta(placements[i]);
			return box(
				item.minX + d.x,
				item.minY + d.y,
				item.maxX + d.x,
				item.maxY + d.y,
			);
		});

		// Row 0 (items 0,1) should share the same y-centre; row 1 (items 2,3) another.
		expect(boundsCenter(placed[0]).y).toBeCloseTo(boundsCenter(placed[1]).y);
		expect(boundsCenter(placed[2]).y).toBeCloseTo(boundsCenter(placed[3]).y);
		// Rows run downward (y is up, so row 1 sits below row 0).
		expect(boundsCenter(placed[2]).y).toBeLessThan(boundsCenter(placed[0]).y);
		// Columns 0 (items 0,2) share x-centre; column 1 (items 1,3) another.
		expect(boundsCenter(placed[0]).x).toBeCloseTo(boundsCenter(placed[2]).x);
		expect(boundsCenter(placed[1]).x).toBeCloseTo(boundsCenter(placed[3]).x);
		expect(boundsCenter(placed[1]).x).toBeGreaterThan(
			boundsCenter(placed[0]).x,
		);
	});

	it("mixed-size items still align on both axes, using widest column / tallest row", () => {
		const wide = box(0, 0, 4, 1);
		const narrow = box(0, 0, 1, 1);
		const tall = box(0, 0, 1, 3);
		const small = box(0, 0, 1, 1);
		const items = [wide, narrow, tall, small];
		const placements = arrangeInGrid(items, { columns: 2, gap: 0 });
		const placed = items.map((item, i) => {
			const d = readDelta(placements[i]);
			return box(
				item.minX + d.x,
				item.minY + d.y,
				item.maxX + d.x,
				item.maxY + d.y,
			);
		});
		// Column 0 (wide, tall) centred on the same x.
		expect(boundsCenter(placed[0]).x).toBeCloseTo(boundsCenter(placed[2]).x);
		// Column 1 (narrow, small) centred on the same x, to the right of column 0's
		// centre (since column 0 is wider).
		expect(boundsCenter(placed[1]).x).toBeGreaterThan(
			boundsCenter(placed[0]).x,
		);
	});

	it("respects an explicit rows option to derive column count", () => {
		const items = [box(0, 0, 1, 1), box(0, 0, 1, 1), box(0, 0, 1, 1)];
		// 3 items, 1 row -> 3 columns.
		const placements = arrangeInGrid(items, { rows: 1, gap: 1 });
		const placed = items.map((item, i) => {
			const d = readDelta(placements[i]);
			return box(
				item.minX + d.x,
				item.minY + d.y,
				item.maxX + d.x,
				item.maxY + d.y,
			);
		});
		// All three should share the same y centre (one row).
		expect(boundsCenter(placed[0]).y).toBeCloseTo(boundsCenter(placed[1]).y);
		expect(boundsCenter(placed[1]).y).toBeCloseTo(boundsCenter(placed[2]).y);
	});

	it("recentres the grid on the items' combined original centre by default", () => {
		const items = [box(0, 0, 1, 1), box(10, 10, 11, 11)];
		const placements = arrangeInGrid(items, { columns: 2, gap: 1 });
		const placed = items.map((item, i) => {
			const d = readDelta(placements[i]);
			return box(
				item.minX + d.x,
				item.minY + d.y,
				item.maxX + d.x,
				item.maxY + d.y,
			);
		});
		const union = unionBounds(...placed);
		const originalUnion = unionBounds(...items);
		expect(union).not.toBeNull();
		expect(originalUnion).not.toBeNull();
		if (union && originalUnion) {
			expect(boundsCenter(union).x).toBeCloseTo(boundsCenter(originalUnion).x);
			expect(boundsCenter(union).y).toBeCloseTo(boundsCenter(originalUnion).y);
		}
	});

	it("honours an explicit center option", () => {
		const items = [box(0, 0, 1, 1), box(0, 0, 1, 1)];
		const placements = arrangeInGrid(items, {
			columns: 2,
			center: { x: -5, y: 5 },
		});
		const placed = items.map((item, i) => {
			const d = readDelta(placements[i]);
			return box(
				item.minX + d.x,
				item.minY + d.y,
				item.maxX + d.x,
				item.maxY + d.y,
			);
		});
		const union = unionBounds(...placed);
		expect(union).not.toBeNull();
		if (union) {
			expect(boundsCenter(union).x).toBeCloseTo(-5);
			expect(boundsCenter(union).y).toBeCloseTo(5);
		}
	});

	it("null/undefined items among real ones don't break the layout", () => {
		const items = [box(0, 0, 1, 1), null, box(0, 0, 1, 1)];
		const placements = arrangeInGrid(items, { columns: 2 });
		expect(placements).toHaveLength(3);
		// The null slot still gets a placement (uniformly recentred along with
		// the real ones), it just has no box behind it to place.
		expect(readDelta(placements[1])).toEqual(readDelta(placements[1]));
		expect(Number.isFinite(readDelta(placements[1]).x)).toBe(true);
		expect(Number.isFinite(readDelta(placements[1]).y)).toBe(true);
	});
});
