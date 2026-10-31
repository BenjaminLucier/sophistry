/**
 * Hit testing is geometry over specs in scene units.
 *
 * Everything here is stated in scene units — the pointer, the slop and the
 * stroke half-widths — because that is what `ShapeSpec` carries and what the
 * pointer driver converts into. The tests pin the rules in `hit.ts`'s header
 * (non-zero winding, partial reveal, invisible geometry) in that space, plus the
 * one view-dependent bit: where a text run's box hangs off its anchor depends on
 * whether scene `y` runs up or down the screen.
 */

import { describe, expect, it } from "vitest";
import type { Polyline } from "../geometry";
import { clipRings } from "../spec/clip";
import { labelBox } from "../spec/metrics";
import type {
	ClipRegion,
	ShapeSpec,
	StrokeStyle,
	TextSpec,
	TextStyle,
} from "../spec/types";
import {
	boundsOfNodes,
	boundsOfSpec,
	createHitCache,
	hitSpec,
	hitTest,
	indexSpecs,
	pointInClip,
	pointInRings,
	textBoxAt,
} from "./hit";
import type { HitCandidate } from "./types";

const style: StrokeStyle = {
	stroke: "#000",
	strokeWidth: 0.1,
	fill: null,
	along: null,
	opacity: 1,
	fillOpacity: 1,
	lineCap: "round",
	lineJoin: "round",
	dash: null,
	dashOffset: 0,
};

let nextId = 1;

function shape(
	polylines: Polyline[],
	options: Partial<Omit<ShapeSpec, "style">> & {
		style?: Partial<StrokeStyle>;
	} = {},
): ShapeSpec {
	const { style: styleOverride, ...rest } = options;
	return {
		kind: "shape",
		id: nextId++,
		zIndex: 0,
		polylines,
		closed: false,
		fillFrom: 0,
		style: { ...style, ...styleOverride },
		progress: 1,
		...rest,
	};
}

const square = (min: number, max: number): Polyline => [
	{ x: min, y: min },
	{ x: max, y: min },
	{ x: max, y: max },
	{ x: min, y: max },
];

const painted = (id: number): HitCandidate => ({
	id,
	pointerEvents: "painted",
	hitArea: null,
});

const textStyle: TextStyle = {
	fill: "#000",
	fontSize: 1,
	fontFamily: "sans-serif",
	fontWeight: 400,
	italic: false,
	align: "center",
	baseline: "middle",
	opacity: 1,
	letterSpacing: 0,
};

function text(
	at: { x: number; y: number },
	options: Partial<TextSpec> = {},
): TextSpec {
	return {
		kind: "text",
		id: nextId++,
		zIndex: 0,
		text: "hello",
		at,
		rotation: 0,
		style: textStyle,
		progress: 1,
		...options,
	};
}

describe("shapes, in scene units", () => {
	it("a filled shape is hit inside, not outside", () => {
		const s = shape([square(0, 2)], {
			closed: true,
			style: { fill: "#f00" },
		});
		expect(hitSpec(s, painted(s.id), { x: 1, y: 1 })).toBe(true);
		expect(hitSpec(s, painted(s.id), { x: 3, y: 1 })).toBe(false);
	});

	it("an empty-string fill is not hittable, matching the renderer's paintsFill", () => {
		const s = shape([square(0, 2)], {
			closed: true,
			style: { fill: "", stroke: "none" },
		});
		expect(hitSpec(s, painted(s.id), { x: 1, y: 1 })).toBe(false);
	});

	it("a stroke is hit within half its scene-unit width, and slop adds scene-unit reach", () => {
		const line = shape(
			[
				[
					{ x: 0, y: 0 },
					{ x: 4, y: 0 },
				],
			],
			{ style: { strokeWidth: 0.2 } },
		);
		const c = painted(line.id);
		expect(hitSpec(line, c, { x: 2, y: 0.09 })).toBe(true);
		expect(hitSpec(line, c, { x: 2, y: 0.15 })).toBe(false);
		expect(hitSpec(line, c, { x: 2, y: 0.15 }, 0.1)).toBe(true);
		expect(hitSpec(line, c, { x: 2, y: 0.25 }, 0.1)).toBe(false);
	});

	it("a thin line far from the origin is tapped by the same scene-unit tolerance", () => {
		const line = shape([
			[
				{ x: 1000, y: 1000 },
				{ x: 1004, y: 1000 },
			],
		]);
		expect(hitSpec(line, painted(line.id), { x: 1002, y: 1000.04 })).toBe(true);
	});

	it("a partially revealed stroke is hit only where it has been drawn", () => {
		const line = shape(
			[
				[
					{ x: 0, y: 0 },
					{ x: 10, y: 0 },
				],
			],
			{ progress: 0.5 },
		);
		const c = painted(line.id);
		expect(hitSpec(line, c, { x: 2, y: 0 })).toBe(true);
		expect(hitSpec(line, c, { x: 8, y: 0 })).toBe(false);
		// "all" ignores the reveal.
		expect(hitSpec(line, { ...c, pointerEvents: "all" }, { x: 8, y: 0 })).toBe(
			true,
		);
	});

	it("fills are non-zero winding: a reversed inner ring punches a hole", () => {
		const outer = square(0, 10);
		const hole = square(3, 7).reverse();
		expect(pointInRings([outer, hole], { x: 5, y: 5 })).toBe(false);
		expect(pointInRings([outer, hole], { x: 1, y: 1 })).toBe(true);
	});

	it("invisible geometry does not catch the pointer", () => {
		const s = shape([square(0, 2)], {
			closed: true,
			style: { fill: "#f00", opacity: 0 },
		});
		expect(hitSpec(s, painted(s.id), { x: 1, y: 1 })).toBe(false);
	});

	it("a hit area replaces the geometry and is already in scene units", () => {
		const s = shape([square(0, 1)], { closed: true, style: { fill: "#f00" } });
		const c: HitCandidate = {
			id: s.id,
			pointerEvents: "painted",
			hitArea: square(10, 12),
		};
		expect(hitSpec(s, c, { x: 11, y: 11 })).toBe(true);
		expect(hitSpec(s, c, { x: 0.5, y: 0.5 })).toBe(false);
	});

	it("hitTest walks the snapshot topmost-first and honours exclude", () => {
		const below = shape([square(0, 4)], {
			closed: true,
			style: { fill: "#f00" },
		});
		const above = shape([square(1, 3)], {
			closed: true,
			style: { fill: "#0f0" },
		});
		const candidates = new Map([
			[below.id, painted(below.id)],
			[above.id, painted(above.id)],
		]);
		const specs = [below, above];
		expect(hitTest(specs, candidates, { x: 2, y: 2 })).toBe(above.id);
		expect(
			hitTest(specs, candidates, { x: 2, y: 2 }, { exclude: above.id }),
		).toBe(below.id);
		expect(hitTest(specs, candidates, { x: 3.5, y: 3.5 })).toBe(below.id);
	});
});

describe("text runs hang off their anchor in on-screen orientation", () => {
	const box = labelBox("hello", textStyle);

	it("y-up: the box is the label box added to the anchor", () => {
		const t = text({ x: 5, y: 5 });
		const b = textBoxAt(t, true);
		expect(b.minY).toBeCloseTo(5 + box.minY, 9);
		expect(b.maxY).toBeCloseTo(5 + box.maxY, 9);
		expect(b.minX).toBeCloseTo(5 + box.minX, 9);
	});

	it("y-down: the vertical extent mirrors about the anchor, the horizontal does not", () => {
		const t = text(
			{ x: 5, y: 5 },
			{ style: { ...textStyle, baseline: "top" } },
		);
		const up = textBoxAt(t, true);
		const down = textBoxAt(t, false);
		// A top-baseline run hangs *below* its anchor on screen: smaller scene y
		// when y is up, larger when y is down.
		expect(up.maxY).toBeLessThanOrEqual(5 + 1e-9);
		expect(down.minY).toBeGreaterThanOrEqual(5 - 1e-9);
		expect(down.minX).toBeCloseTo(up.minX, 9);
	});

	it("a point just below a top-aligned run is a hit in the view where below is +y, and a miss in the other", () => {
		const t = text(
			{ x: 0, y: 0 },
			{ style: { ...textStyle, baseline: "top", align: "left" } },
		);
		const c = painted(t.id);
		const belowOnYUp = { x: 0.1, y: -0.2 };
		const belowOnYDown = { x: 0.1, y: 0.2 };
		expect(hitSpec(t, c, belowOnYUp, 0, undefined, true)).toBe(true);
		expect(hitSpec(t, c, belowOnYUp, 0, undefined, false)).toBe(false);
		expect(hitSpec(t, c, belowOnYDown, 0, undefined, false)).toBe(true);
		expect(hitSpec(t, c, belowOnYDown, 0, undefined, true)).toBe(false);
	});

	it("rotation turns the box about the anchor (same scene-axis sense in both orientations)", () => {
		const t = text(
			{ x: 0, y: 0 },
			{ rotation: Math.PI / 2, style: { ...textStyle, align: "left" } },
		);
		const c = painted(t.id);
		// Quarter turn counter-clockwise: the run now extends along +y.
		expect(hitSpec(t, c, { x: 0, y: 0.3 }, 0, undefined, true)).toBe(true);
		expect(hitSpec(t, c, { x: 2, y: 0 }, 0, undefined, true)).toBe(false);
		expect(hitSpec(t, c, { x: 0, y: 0.3 }, 0, undefined, false)).toBe(true);
	});

	it("its bounds enclose the rotated box", () => {
		const t = text({ x: 2, y: 3 }, { rotation: Math.PI / 2 });
		const b = boundsOfSpec(t, true);
		const flat = textBoxAt(t, true);
		const width = flat.maxX - flat.minX;
		const height = flat.maxY - flat.minY;
		expect(b).not.toBeNull();
		if (!b) return;
		expect(b.maxX - b.minX).toBeCloseTo(height, 6);
		expect(b.maxY - b.minY).toBeCloseTo(width, 6);
	});

	it("progress wipes the box left to right", () => {
		const t = text(
			{ x: 0, y: 0 },
			{ progress: 0.5, style: { ...textStyle, align: "left" } },
		);
		const width = textBoxAt(t, true).maxX;
		expect(hitSpec(t, painted(t.id), { x: width * 0.25, y: 0 })).toBe(true);
		expect(hitSpec(t, painted(t.id), { x: width * 0.75, y: 0 })).toBe(false);
	});
});

describe("boundsOfNodes", () => {
	it("unions shapes and text in scene units", () => {
		const a = shape([square(0, 2)]);
		const b = shape([square(5, 6)]);
		const t = text({ x: 20, y: 20 });
		const box = boundsOfNodes([a.id, b.id], [a, b, t]);
		expect(box).toEqual({ minX: 0, minY: 0, maxX: 6, maxY: 6 });
		const all = boundsOfNodes([a.id, t.id], [a, b, t]);
		expect(all?.maxX).toBeGreaterThan(20);
		expect(boundsOfNodes([999], [a, b, t])).toBeNull();
	});

	it("depends on the view's y direction only through text", () => {
		const t = text(
			{ x: 0, y: 0 },
			{ style: { ...textStyle, baseline: "top" } },
		);
		const up = boundsOfNodes([t.id], [t], true);
		const down = boundsOfNodes([t.id], [t], false);
		expect(up?.maxY).toBeLessThanOrEqual(1e-9);
		expect(down?.minY).toBeGreaterThanOrEqual(-1e-9);
		const s = shape([square(0, 1)]);
		expect(boundsOfNodes([s.id], [s], true)).toEqual(
			boundsOfNodes([s.id], [s], false),
		);
	});
});

describe("the box cache", () => {
	it("is keyed on geometry identity, and on the view's orientation for text", () => {
		const cache = createHitCache();
		const t = text(
			{ x: 0, y: 0 },
			{ style: { ...textStyle, baseline: "top" } },
		);
		const c = painted(t.id);
		const probe = { x: 0, y: -0.2 };
		expect(hitSpec(t, c, probe, 0, cache, true)).toBe(true);
		// Same spec, flipped view: a stale y-up box would answer true again.
		expect(hitSpec(t, c, probe, 0, cache, false)).toBe(false);
		expect(hitSpec(t, c, probe, 0, cache, true)).toBe(true);

		const s = shape([square(0, 1)], { closed: true, style: { fill: "#f00" } });
		expect(hitSpec(s, painted(s.id), { x: 0.5, y: 0.5 }, 0, cache)).toBe(true);
		const moved = { ...s, polylines: [square(10, 11)] };
		expect(hitSpec(moved, painted(s.id), { x: 0.5, y: 0.5 }, 0, cache)).toBe(
			false,
		);
	});
});

describe("the box cache bookkeeping", () => {
	it("keeps both orientations of a text run, so alternating views do not thrash", () => {
		const cache = createHitCache();
		const t = text(
			{ x: 0, y: 0 },
			{ style: { ...textStyle, baseline: "top" } },
		);
		const c = painted(t.id);
		hitSpec(t, c, { x: 0, y: -0.2 }, 0, cache, true);
		hitSpec(t, c, { x: 0, y: -0.2 }, 0, cache, false);
		const entries = [...cache.boxes.values()];
		expect(entries).toHaveLength(2);
		hitSpec(t, c, { x: 0, y: -0.2 }, 0, cache, true);
		hitSpec(t, c, { x: 0, y: -0.2 }, 0, cache, false);
		const again = [...cache.boxes.values()];
		for (const [i, entry] of again.entries()) expect(entry).toBe(entries[i]);
	});

	it("drops boxes of nodes that left the snapshot when a new snapshot is tested", () => {
		const cache = createHitCache();
		const a = shape([square(0, 1)], { closed: true, style: { fill: "#f00" } });
		const b = shape([square(5, 6)], { closed: true, style: { fill: "#f00" } });
		const candidates = new Map([
			[a.id, painted(a.id)],
			[b.id, painted(b.id)],
		]);
		hitTest([a, b], candidates, { x: 0.5, y: 0.5 }, { cache });
		hitTest([a, b], candidates, { x: 5.5, y: 5.5 }, { cache });
		expect(cache.boxes.size).toBe(2);
		hitTest([b], candidates, { x: 5.5, y: 5.5 }, { cache });
		expect(cache.boxes.size).toBe(1);
	});
});

describe("boundsOfNodes with an index", () => {
	it("accepts a prebuilt id to spec map and agrees with the array form", () => {
		const a = shape([square(0, 2)]);
		const b = shape([square(5, 6)]);
		const t = text({ x: 20, y: 20 });
		const index = indexSpecs([a, b, t]);
		expect(boundsOfNodes([a.id, t.id], index)).toEqual(
			boundsOfNodes([a.id, t.id], [a, b, t]),
		);
		expect(boundsOfNodes([999], index)).toBeNull();
	});
});

describe("picking and bounds through a clip", () => {
	const unit = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
	const region: ClipRegion = { rings: clipRings(unit) };
	const filled: ShapeSpec = {
		kind: "shape",
		id: 1,
		zIndex: 0,
		polylines: clipRings({ minX: -2, minY: -2, maxX: 2, maxY: 2 }),
		closed: true,
		fillFrom: 0,
		style: {
			stroke: "none",
			strokeWidth: 0,
			fill: "#fff",
			along: null,
			opacity: 1,
			fillOpacity: 1,
			lineCap: "round",
			lineJoin: "round",
			dash: null,
			dashOffset: 0,
		},
		progress: 1,
		clip: [region],
	};
	const candidate = { id: 1, pointerEvents: "painted" as const, hitArea: null };

	it("a point outside the clip misses, even on the geometry or a hit area", () => {
		expect(hitSpec(filled, candidate, { x: 0.5, y: 0.5 })).toBe(true);
		expect(hitSpec(filled, candidate, { x: -1, y: -1 })).toBe(false);
		// No slop widens the window.
		expect(hitSpec(filled, candidate, { x: 1.05, y: 0.5 }, 0.2)).toBe(false);
		const area = [
			{ x: -5, y: -5 },
			{ x: 5, y: -5 },
			{ x: 5, y: 5 },
		];
		expect(
			hitSpec(filled, { ...candidate, hitArea: area }, { x: 4, y: -4 }),
		).toBe(false);
		expect(pointInClip(undefined, { x: 99, y: 99 })).toBe(true);
	});

	it("a node's bounds (focus ring, a11y box) are cut to its clip", () => {
		expect(boundsOfNodes([1], [filled])).toEqual(unit);
		const gone = {
			...filled,
			clip: [{ rings: clipRings({ ...unit, minX: 5, maxX: 6 }) }],
		};
		expect(boundsOfNodes([1], [gone])).toBeNull();
	});
});
