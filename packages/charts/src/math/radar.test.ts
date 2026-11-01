import { describe, expect, it } from "vitest";
import {
	assertRadarShape,
	radarAxisFrames,
	radarFramePolygon,
	radarVertices,
} from "./radar.js";

describe("radarVertices", () => {
	it("places n vertices evenly around a full turn", () => {
		const vertices = radarVertices([1, 1, 1, 1]);
		expect(vertices).toHaveLength(4);
		const angles = vertices.map((v) => v.angle).sort((a, b) => a - b);
		for (let i = 1; i < angles.length; i++) {
			expect(angles[i] - angles[i - 1]).toBeCloseTo(Math.PI / 2);
		}
	});

	it("scales radius by share of maxValue", () => {
		const vertices = radarVertices([1, 2, 4]);
		const radiusOf = (v: (typeof vertices)[number]) => Math.hypot(v.x, v.y);
		expect(radiusOf(vertices[0])).toBeCloseTo(0.25);
		expect(radiusOf(vertices[1])).toBeCloseTo(0.5);
		expect(radiusOf(vertices[2])).toBeCloseTo(1);
	});

	it("sits a max value on the unit circle", () => {
		const vertices = radarVertices([1, 1, 1]);
		for (const v of vertices) {
			expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
		}
	});

	it("keeps a zero-value entry as an origin-sitting vertex, not dropped", () => {
		const vertices = radarVertices([1, 0, 1]);
		expect(vertices).toHaveLength(3);
		expect(vertices[1].index).toBe(1);
		expect(vertices[1].x).toBeCloseTo(0);
		expect(vertices[1].y).toBeCloseTo(0);
	});

	it("clamps a negative value to 0 instead of throwing", () => {
		expect(() => radarVertices([1, -5, 2])).not.toThrow();
		const vertices = radarVertices([1, -5, 2]);
		expect(vertices[1].value).toBe(0);
	});

	it("returns [] for fewer than 3 values", () => {
		expect(radarVertices([])).toEqual([]);
		expect(radarVertices([1])).toEqual([]);
		expect(radarVertices([1, 2])).toEqual([]);
	});

	it("honours an explicit maxValue, letting a series exceed the unit circle's opposite (share > 1 stays unclamped)", () => {
		const vertices = radarVertices([1, 1, 1], { maxValue: 2 });
		for (const v of vertices) {
			expect(Math.hypot(v.x, v.y)).toBeCloseTo(0.5);
		}
	});

	it("defaults startAngle to Math.PI / 2 (12 o'clock on a y-up stage)", () => {
		const vertices = radarVertices([1, 1, 1]);
		expect(vertices[0].angle).toBeCloseTo(Math.PI / 2);
	});
});

describe("assertRadarShape", () => {
	it("accepts matching groups, empty groups and missing labels", () => {
		expect(() =>
			assertRadarShape([[1, 2, 3], []], ["a", "b", "c"]),
		).not.toThrow();
		expect(() => assertRadarShape([[1, 2]], undefined)).not.toThrow();
	});

	it("throws when a group does not match the axis label count", () => {
		expect(() => assertRadarShape([[1, 2, 3, 4]], ["a", "b", "c"])).toThrow(
			/group 0/,
		);
		expect(() =>
			assertRadarShape(
				[
					[1, 2, 3],
					[1, 2],
				],
				["a", "b", "c"],
			),
		).toThrow(/group 1/);
	});
});

describe("radarAxisFrames", () => {
	const at = (exit: number, update: number, enter: number) =>
		radarAxisFrames(["N", "E", "S", "W"], ["N", "E", "W"], {
			exit,
			update,
			enter,
		});
	const angleOf = (frames: ReturnType<typeof at>, key: string) =>
		frames.find((f) => f.key === key)?.angle ?? Number.NaN;

	it("is each end's even spacing at the ends, the other end's own axes at weight 0", () => {
		const start = at(0, 0, 0);
		const plain = radarVertices([1, 1, 1, 1]);
		expect(start.map((f) => f.key)).toEqual(["N", "E", "S", "W"]);
		expect(start.map((f) => f.angle)).toEqual(plain.map((v) => v.angle));
		expect(start.map((f) => f.weight)).toEqual([1, 1, 1, 1]);
		const end = at(1, 1, 1);
		const three = radarVertices([1, 1, 1]);
		const whole = end.filter((f) => f.weight > 0);
		expect(whole.map((f) => f.key)).toEqual(["N", "E", "W"]);
		expect(whole.map((f) => f.angle)).toEqual(three.map((v) => v.angle));
		expect(end.find((f) => f.key === "S")?.weight).toBe(0);
	});

	it("folds a leaving axis in place, then turns the rest the short way round", () => {
		const exiting = at(0.5, 0, 0);
		expect(exiting.find((f) => f.key === "S")?.weight).toBe(0.5);
		expect(angleOf(exiting, "E")).toBeCloseTo(0);
		const updating = at(1, 0.5, 0);
		// E: 0 → −π/6 (clockwise from 12 o'clock: π/2, then π/2 − 2π/3).
		expect(angleOf(updating, "E")).toBeCloseTo(-Math.PI / 12);
		// W: −π → −5π/6, halfway −11π/12.
		const w = angleOf(updating, "W");
		expect(Math.cos(w)).toBeCloseTo(Math.cos((-11 * Math.PI) / 12));
		expect(Math.sin(w)).toBeCloseTo(Math.sin((-11 * Math.PI) / 12));
		// S stays between its neighbours E and W as they turn.
		const s = angleOf(updating, "S");
		expect(Math.sin(s)).toBeLessThan(-0.9);
	});

	it("unfolds an entering axis between its new neighbours", () => {
		const frames = radarAxisFrames(["a", "b", "c"], ["a", "x", "b", "c"], {
			exit: 1,
			update: 1,
			enter: 0.25,
		});
		expect(frames.map((f) => f.key)).toEqual(["a", "x", "b", "c"]);
		expect(frames[1]).toMatchObject({ from: -1, to: 1, weight: 0.25 });
		expect(frames[1].angle).toBeCloseTo(0); // 3 o'clock, clockwise from 12
	});

	it("without a `to`, is the axes of `data`, whole", () => {
		const frames = radarAxisFrames([0, 1, 2], undefined);
		expect(frames.map((f) => [f.key, f.weight, f.anchor])).toEqual([
			[0, 1, true],
			[1, 1, true],
			[2, 1, true],
		]);
	});
});

describe("radarFramePolygon", () => {
	it("is exactly radarVertices with every axis whole", () => {
		const values = [3, 1, 4, 1, 5];
		const axes = radarAxisFrames([0, 1, 2, 3, 4], undefined);
		const plain = radarVertices(values, { maxValue: 5 });
		expect(radarFramePolygon(axes, (a) => values[a.slot], 5)).toEqual(
			plain.map((v) => ({ x: v.x, y: v.y })),
		);
	});

	it("flattens a folding axis's corner onto the chord between its neighbours", () => {
		// A square of radius 1; S folding: at weight 0 its corner lies on E–W.
		const values = [1, 1, 1, 1];
		const half = radarAxisFrames(["N", "E", "S", "W"], ["N", "E", "W"], {
			exit: 0.5,
		});
		const polygon = radarFramePolygon(half, (a) => values[a.from], 1);
		expect(polygon).toHaveLength(4);
		const s = polygon[2];
		expect(s.x).toBeCloseTo(0);
		expect(s.y).toBeCloseTo(-0.5); // halfway from the chord (0, 0) to (0, −1)
		const gone = radarAxisFrames(["N", "E", "S", "W"], ["N", "E", "W"], {
			exit: 1,
		});
		expect(radarFramePolygon(gone, (a) => values[a.from], 1)).toHaveLength(3);
	});

	it("collapses onto the centre with fewer than two anchors, and drops below three vertices", () => {
		const frames = radarAxisFrames(["a", "b", "c"], ["x", "y", "z"], {
			exit: 0.5,
		});
		const polygon = radarFramePolygon(
			frames,
			(a) => (a.from >= 0 ? 2 : undefined),
			2,
		);
		expect(polygon).toHaveLength(3);
		for (const p of polygon) expect(Math.hypot(p.x, p.y)).toBeCloseTo(0.5);
		expect(
			radarFramePolygon(radarAxisFrames(["a", "b"], undefined), () => 1, 1),
		).toEqual([]);
	});
});
