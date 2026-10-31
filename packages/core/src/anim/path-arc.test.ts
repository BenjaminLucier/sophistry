import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Polyline } from "../geometry";
import { morphPolylines } from "../geometry/morph";
import { track } from "../reactive";
import { createClock } from "../tween/clock";
import { trackPoint } from "../tween/track";
import { moveBy, moveTo } from "./move";
import { timeline } from "./timeline";
import { morph } from "./transform";

beforeEach(() => {
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
});

const linear = { duration: 1, easing: "linear" as const };

describe("pathArc on moves", () => {
	it("moveTo swings round a half circle instead of cutting across", () => {
		const p = trackPoint(-1, 0);
		const run = timeline(
			moveTo(p, { x: 1, y: 0 }, { ...linear, pathArc: Math.PI }),
			{
				clock: createClock(),
			},
		);
		run.seek(0.5);
		expect(p.peek().x).toBeCloseTo(0, 9);
		expect(p.peek().y).toBeCloseTo(-1, 9);
		run.seek(1);
		expect(p.peek().x).toBeCloseTo(1, 12);
		expect(p.peek().y).toBeCloseTo(0, 12);
	});

	it("moveBy takes it too, and none means straight", () => {
		const p = trackPoint(0, 0);
		const run = timeline(
			moveBy(p, { x: 2, y: 0 }, { ...linear, pathArc: -Math.PI }),
			{
				clock: createClock(),
			},
		);
		run.seek(0.5);
		expect(p.peek().y).toBeCloseTo(1, 9);
		const q = trackPoint(0, 0);
		const straight = timeline(moveBy(q, { x: 2, y: 0 }, linear), {
			clock: createClock(),
		});
		straight.seek(0.5);
		expect(q.peek()).toEqual({ x: 1, y: 0 });
	});
});

describe("pathArc on morphs", () => {
	const left: Polyline = [
		{ x: -3, y: 0 },
		{ x: -2, y: 0 },
		{ x: -2, y: 1 },
		{ x: -3, y: 0 },
	];
	const right = left.map((p) => ({ x: p.x + 5, y: p.y }));

	it("morphPolylines carries every vertex along the arc, exact at both ends", () => {
		const straight = morphPolylines(left, right, { samples: 4 });
		const arced = morphPolylines(left, right, {
			samples: 4,
			pathArc: Math.PI / 2,
		});
		const lowest = (ring: Polyline) => Math.min(...ring.map((p) => p.y));
		expect(lowest(arced(0.5))).toBeLessThan(lowest(straight(0.5)) - 0.5);
		expect(arced(0)).toEqual(straight(0));
		expect(arced(1)).toEqual(straight(1));
	});

	it("morph passes pathArc through", () => {
		const shape = track(left);
		const run = timeline(
			morph(shape, right, { ...linear, samples: 4, pathArc: Math.PI }),
			{
				clock: createClock(),
			},
		);
		run.seek(0.5);
		expect(Math.min(...shape.peek().map((p) => p.y))).toBeLessThan(-1);
	});
});
